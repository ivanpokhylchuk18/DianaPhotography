/* Original photos are fetched through the password-checked Apps Script API.
 * zip.js 2.24.0 is bundled locally; STORE mode preserves bytes without recompression.
 */
const GalleryDownload = (() => {
  function safeName(name) {
    return String(name || 'photo').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '') || 'photo';
  }
  async function original(url, galleryId, password, image, signal, onProgress, offset) {
    for (let attempt = 0; attempt < 3; attempt++) {
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      const timeout = new AbortController();
      const cancel = () => timeout.abort();
      signal.addEventListener('abort', cancel, { once: true });
      const timer = setTimeout(cancel, 300000);
      try {
        const response = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' }, signal: timeout.signal,
          body: JSON.stringify({ action: 'download_gallery_image', gallery_id: galleryId, password, file_id: image.file_id, offset })
        });
        if (!response.ok) {
          const error = new Error(`Download service returned HTTP ${response.status}.`);
          error.permanent = response.status >= 400 && response.status < 500 && ![408, 429].includes(response.status);
          throw error;
        }
        let result;
        try { result = await response.json(); }
        catch (error) {
          if (timeout.signal.aborted) throw error;
          throw new Error('The download service returned an unreadable response.');
        }
        if (!result || typeof result !== 'object') throw new Error('The download service returned an invalid response.');
        if (!result.success) {
          const error = new Error(result.error || 'Could not download this photo.');
          error.permanent = !result.retryable;
          throw error;
        }
        if (typeof result.file_data !== 'string' || !Number.isSafeInteger(result.size) || result.size <= 0) {
          const error = new Error('The download service did not return original photo data. Update the Apps Script deployment.');
          error.permanent = true;
          throw error;
        }
        if (offset !== undefined && (result.offset !== offset || result.total_size !== image.size || result.size !== Math.min(4 * 1024 * 1024, image.size - offset))) {
          const error = new Error('Photo range mismatch. Reload the gallery and confirm the latest Apps Script version is deployed.');
          error.permanent = true;
          throw error;
        }
        let bytes;
        if (typeof Uint8Array.fromBase64 === 'function') {
          bytes = Uint8Array.fromBase64(result.file_data);
        } else {
          const binary = atob(result.file_data);
          bytes = new Uint8Array(binary.length);
          for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
        }
        if (bytes.length !== result.size || !bytes.length) throw new Error('Incomplete photo received.');
        return bytes;
      } catch (error) {
        if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
        const reason = timeout.signal.aborted ? 'The photo request timed out after five minutes.' : error.message;
        if (error.permanent || attempt === 2) throw new Error(`${image.filename || 'Photo'}: ${reason}`);
        if (onProgress) onProgress(`Retrying ${image.filename || 'photo'} (${attempt + 2} of 3): ${reason}`);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
      }
      // Give a busy service time to recover; cancellation must interrupt the delay.
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(delay); reject(new DOMException('Cancelled', 'AbortError')); };
        const delay = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, 1000 * (attempt + 1));
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }
  async function photoBytes(url, galleryId, password, image, signal, onProgress) {
    if (!Number.isSafeInteger(image.size) || image.size <= 8 * 1024 * 1024) {
      return original(url, galleryId, password, image, signal, onProgress);
    }
    // Only small base64 strings cross the API; assemble the original as binary bytes.
    const bytes = new Uint8Array(image.size);
    for (let offset = 0; offset < image.size; offset += 4 * 1024 * 1024) {
      const part = await original(url, galleryId, password, image, signal, onProgress, offset);
      bytes.set(part, offset);
      if (onProgress) onProgress(`Downloading ${image.filename}: ${Math.round((offset + part.length) / image.size * 100)}%`);
    }
    return bytes;
  }
  async function save({ url, galleryId, password, images, signal, onProgress }) {
    if (!images.length) throw new Error('This gallery has no photos yet.');
    if (images.some(image => !image.file_id)) throw new Error('This gallery is connected to an older download service. The photographer must use the same Apps Script URL as the admin page and deploy the latest Code.gs version, then reload this page.');
    if (typeof zip === 'undefined') throw new Error('The download library could not load. Refresh this page and try again.');
    const archiveName = safeName(galleryId) + '-photos.zip';
    const transfer = new AbortController();
    const cancel = () => transfer.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    let disk;
    try {
      // Must be invoked directly from the click to retain browser user activation.
      if (typeof window.showSaveFilePicker === 'function') {
        const handle = await window.showSaveFilePicker({ suggestedName: archiveName, types: [{ description: 'ZIP photo collection', accept: { 'application/zip': ['.zip'] } }] });
        disk = await handle.createWritable();
      }
      const destination = disk ? new WritableStream({
        write: chunk => disk.write(chunk), close: () => disk.close(), abort: reason => disk.abort(reason)
      }) : new zip.BlobWriter('application/zip');
      const writer = new zip.ZipWriter(destination, { level: 0, useWebWorkers: false });
      const pending = new Map();
      const prefetch = index => {
        if (index >= images.length) return;
        // Settle failures immediately, even if a different photo is still being written.
        pending.set(index, photoBytes(url, galleryId, password, images[index], transfer.signal, onProgress)
          .then(bytes => ({ bytes }), error => ({ error })));
      };
      for (let i = 0; i < Math.min(3, images.length); i++) prefetch(i);
      for (let i = 0; i < images.length; i++) {
        const image = images[i];
        onProgress(`Preparing photo ${i + 1} of ${images.length}: ${image.filename}`);
        const result = await pending.get(i);
        pending.delete(i);
        if (result.error) throw result.error;
        const name = String(i + 1).padStart(4, '0') + ' - ' + safeName(image.filename);
        await writer.add(name, new zip.Uint8ArrayReader(result.bytes), { signal: transfer.signal });
        prefetch(i + 3);
      }
      if (signal.aborted) throw new DOMException('Cancelled', 'AbortError');
      onProgress('Finishing your ZIP download…');
      const blob = await writer.close();
      if (!disk) {
        const link = document.createElement('a');
        const objectUrl = URL.createObjectURL(blob);
        link.href = objectUrl; link.download = archiveName;
        document.body.appendChild(link); link.click(); link.remove();
        setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
      }
      return { count: images.length, savedToDisk: !!disk };
    } catch (error) {
      transfer.abort();
      // Never deliver a ZIP missing photos or commit an interrupted disk write.
      if (disk) { try { await disk.abort(); } catch (_) { /* Already closed or aborted. */ } }
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
  return { save, safeName };
})();
