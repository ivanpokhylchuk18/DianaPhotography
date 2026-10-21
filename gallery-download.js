/* Original photos are fetched through the password-checked Apps Script API.
 * zip.js is bundled locally; STORE mode preserves bytes without recompression.
 *
 * Two delivery modes:
 *  - Browsers with showSaveFilePicker (desktop Chrome/Edge): ONE ZIP streamed straight to disk.
 *  - Every other browser (iPhone/iPad, Safari, Firefox, Android): a ZIP has to be built in memory,
 *    so the collection is delivered as several smaller ZIP parts, one at a time, instead of
 *    one giant blob that mobile browsers cannot hold.
 */
const GalleryDownload = (() => {
  const MB = 1024 * 1024;
  const MAX_ATTEMPTS = 5;        // per request; Drive throttling can last several seconds
  const RANGE_BYTES = 4 * MB;    // must match the chunk size in Code.gs
  const WHOLE_FILE_MAX = 8 * MB; // photos up to this size are fetched in one request
  const TRANSFERS = 3;          // shared cap for whole photos and byte ranges

  function safeName(name) {
    return String(name || 'photo').replace(/[\x00-\x1f\x7f<>:"/\\|?*]/g, '_').replace(/[. ]+$/g, '') || 'photo';
  }

  function isMobile() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    return /Android|iPhone|iPad|iPod/i.test(ua) ||
      (typeof navigator !== 'undefined' && navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  }
  // How much original-photo data one in-memory ZIP part may hold.
  function defaultPartBytes() { return isMobile() ? 200 * MB : 800 * MB; }

  // Split photos into consecutive parts of roughly `limit` bytes. Returns arrays of image indexes.
  function planParts(images, limit) {
    const parts = [];
    let current = [];
    let bytes = 0;
    images.forEach((image, index) => {
      const size = Number.isSafeInteger(image.size) && image.size > 0 ? image.size : 20 * MB;
      if (current.length && bytes + size > limit) { parts.push(current); current = []; bytes = 0; }
      current.push(index);
      bytes += size;
    });
    if (current.length) parts.push(current);
    return parts;
  }

  function cancelled() { return new DOMException('Cancelled', 'AbortError'); }

  function waitOrAbort(promise, signal) {
    return new Promise((resolve, reject) => {
      if (signal.aborted) return reject(cancelled());
      const abort = () => reject(cancelled());
      signal.addEventListener('abort', abort, { once: true });
      Promise.resolve(promise).then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
    });
  }

  async function original(url, galleryId, password, image, signal, onProgress, offset) {
    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      if (signal.aborted) throw cancelled();
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
        if (offset !== undefined && (result.offset !== offset || result.total_size !== image.size || result.size !== Math.min(RANGE_BYTES, image.size - offset))) {
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
        if (signal.aborted) throw cancelled();
        const reason = timeout.signal.aborted ? 'The photo request timed out after five minutes.' : error.message;
        if (error.permanent || attempt === MAX_ATTEMPTS - 1) throw new Error(`${image.filename || 'Photo'}: ${reason}`);
        if (onProgress) onProgress(`Retrying ${image.filename || 'photo'} (${attempt + 2} of ${MAX_ATTEMPTS}): ${reason}`);
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', cancel);
      }
      // Back off (1s, 2s, 4s, 8s, then 10s) so a throttled service can recover; cancellation interrupts the delay.
      const wait = Math.min(10000, 1000 * 2 ** attempt) + Math.floor(Math.random() * 500);
      await new Promise((resolve, reject) => {
        const abort = () => { clearTimeout(delay); reject(cancelled()); };
        const delay = setTimeout(() => { signal.removeEventListener('abort', abort); resolve(); }, wait);
        signal.addEventListener('abort', abort, { once: true });
        if (signal.aborted) abort();
      });
    }
  }

  // One pool per download, including retries. Large ranges and small-photo prefetch
  // share the same slots rather than multiplying requests for each photo.
  function requestPool() {
    let active = 0;
    const queue = [];
    function pump() {
      while (active < TRANSFERS && queue.length) {
        const { args, resolve, reject } = queue.shift();
        active++;
        original(...args).then(resolve, reject).finally(() => { active--; pump(); });
      }
    }
    return (...args) => new Promise((resolve, reject) => {
      queue.push({ args, resolve, reject });
      pump();
    });
  }

  async function photoReader(url, galleryId, password, image, signal, onProgress, request) {
    if (!Number.isSafeInteger(image.size) || image.size <= WHOLE_FILE_MAX) {
      return new zip.Uint8ArrayReader(await request(url, galleryId, password, image, signal, onProgress));
    }
    // A sliding window overlaps network latency, but writes ranges in byte order.
    // Only the actively consumed large photo starts requests; later large photos stay idle.
    const pending = new Map();
    let offset = 0;
    let nextOffset = 0;
    function fill() {
      while (!signal.aborted && pending.size < TRANSFERS && nextOffset < image.size) {
        const start = nextOffset;
        nextOffset += RANGE_BYTES;
        // Observe failures immediately even when an earlier range is still in flight.
        pending.set(start, request(url, galleryId, password, image, signal, onProgress, start)
          .then(bytes => ({ bytes }), error => ({ error })));
      }
    }
    return new ReadableStream({
      async pull(controller) {
        if (signal.aborted) throw cancelled();
        fill();
        const result = await pending.get(offset);
        if (result.error) throw result.error;
        if (signal.aborted) throw cancelled();
        pending.delete(offset);
        const part = result.bytes;
        offset += part.length;
        controller.enqueue(part);
        fill();
        if (onProgress) onProgress(`Downloading ${image.filename}: ${Math.round(offset / image.size * 100)}%`);
        if (offset === image.size) controller.close();
      }
    }, { highWaterMark: 0 });
  }

  /* save({ url, galleryId, password, images, signal, onProgress, onReady, startPart, partBytes })
   *
   * onReady({ url, filename, part, parts, photos }) is called for every ZIP that has to be saved
   * by the visitor (in-memory mode). For every part except the last, it may return a promise:
   * the next part is only built once that promise resolves, which keeps just one part in memory
   * and lets the page ask the visitor to save before continuing.
   *
   * startPart (1-based) resumes in-memory mode after a failure. A rejected save() carries
   * error.resumePart: the part to restart from. Parts are planned deterministically, so the same
   * gallery always splits the same way.
   *
   * Resolves { count, savedToDisk, parts }.
   */
  async function save({ url, galleryId, password, images, signal, onProgress = () => {}, onReady, startPart = 1, partBytes }) {
    if (!images.length) throw new Error('This gallery has no photos yet.');
    if (images.some(image => !image.file_id)) throw new Error('This gallery is connected to an older download service. The photographer must use the same Apps Script URL as the admin page and deploy the latest Code.gs version, then reload this page.');
    if (typeof zip === 'undefined') throw new Error('The download library could not load. Refresh this page and try again.');
    const archiveBase = safeName(galleryId) + '-photos';
    const transfer = new AbortController();
    const request = requestPool();
    const cancel = () => transfer.abort();
    signal.addEventListener('abort', cancel, { once: true });
    if (signal.aborted) cancel();
    let disk;
    let currentPart = Math.max(1, startPart | 0);
    try {
      // Must be invoked directly from the click to retain browser user activation.
      // Skipped when resuming: only the in-memory mode can resume, and it has no picker.
      if (currentPart === 1 && typeof window.showSaveFilePicker === 'function') {
        try {
          const handle = await window.showSaveFilePicker({ suggestedName: archiveBase + '.zip', types: [{ description: 'ZIP photo collection', accept: { 'application/zip': ['.zip'] } }] });
          disk = await handle.createWritable();
        } catch (error) {
          // An exposed picker can still be blocked by browser permissions/policy.
          // Explicit cancellation must never start a fallback download.
          if (error.name === 'AbortError' || signal.aborted) throw error;
          if (!['SecurityError', 'NotAllowedError', 'NotSupportedError'].includes(error.name)) throw error;
          onProgress('Using your browser’s standard ZIP download…');
        }
      }

      // Streaming to disk needs no splitting; in-memory mode splits into parts that fit in RAM.
      const parts = disk ? [images.map((_, index) => index)] : planParts(images, partBytes || defaultPartBytes());
      if (currentPart > parts.length) currentPart = 1;

      async function addPhotos(writer, indices, label) {
        const pending = new Map();
        const prefetch = n => {
          if (n >= indices.length) return;
          // Settle failures immediately, even if a different photo is still being written.
          pending.set(n, photoReader(url, galleryId, password, images[indices[n]], transfer.signal, onProgress, request)
            .then(reader => ({ reader }), error => ({ error })));
        };
        for (let n = 0; n < Math.min(3, indices.length); n++) prefetch(n);
        for (let n = 0; n < indices.length; n++) {
          const index = indices[n];
          const image = images[index];
          onProgress(`${label}Preparing photo ${index + 1} of ${images.length}: ${image.filename}`);
          const result = await pending.get(n);
          pending.delete(n);
          if (result.error) throw result.error;
          // The photo's position in the whole gallery keeps names unique and ordered across parts.
          const name = String(index + 1).padStart(4, '0') + ' - ' + safeName(image.filename);
          await writer.add(name, result.reader, { signal: transfer.signal });
          prefetch(n + 3);
        }
      }

      if (disk) {
        const destination = new WritableStream({
          write: chunk => disk.write(chunk), close: () => disk.close(), abort: reason => disk.abort(reason)
        });
        const writer = new zip.ZipWriter(destination, { level: 0, useWebWorkers: false });
        await addPhotos(writer, parts[0], '');
        if (signal.aborted) throw cancelled();
        onProgress('Finishing your ZIP download…');
        await writer.close();
        return { count: images.length, savedToDisk: true, parts: 1 };
      }

      for (let p = currentPart - 1; p < parts.length; p++) {
        currentPart = p + 1;
        const label = parts.length > 1 ? `Part ${p + 1} of ${parts.length}: ` : '';
        const writer = new zip.ZipWriter(new zip.BlobWriter('application/zip'), { level: 0, useWebWorkers: false });
        await addPhotos(writer, parts[p], label);
        if (signal.aborted) throw cancelled();
        onProgress(parts.length > 1 ? `Finishing part ${p + 1} of ${parts.length}…` : 'Finishing your ZIP download…');
        const blob = await writer.close();
        const filename = parts.length > 1 ? `${archiveBase}-part-${p + 1}-of-${parts.length}.zip` : archiveBase + '.zip';
        const objectUrl = URL.createObjectURL(blob);
        const info = { url: objectUrl, filename, part: p + 1, parts: parts.length, photos: parts[p].length };
        // Keep a user-clickable link when automatic downloads are blocked (e.g. mobile).
        // The page owns this URL until it continues/retries; standalone callers get cleanup.
        const ready = onReady ? onReady(info) : undefined;
        const link = document.createElement('a');
        link.href = objectUrl; link.download = filename;
        document.body.appendChild(link); link.click(); link.remove();
        if (!onReady) setTimeout(() => URL.revokeObjectURL(objectUrl), 60000);
        // Wait for the visitor before building the next part, so only one part is in memory.
        if (p < parts.length - 1) await waitOrAbort(ready, signal);
      }
      return { count: images.length, savedToDisk: false, parts: parts.length };
    } catch (error) {
      transfer.abort();
      // Never deliver a ZIP missing photos or commit an interrupted disk write.
      if (disk) { try { await disk.abort(); } catch (_) { /* Already closed or aborted. */ } }
      // Where a retry should restart (in-memory mode only; a disk write always restarts at 1).
      if (error && typeof error === 'object') { try { error.resumePart = disk ? 1 : currentPart; } catch (_) { /* frozen error */ } }
      throw error;
    } finally {
      signal.removeEventListener('abort', cancel);
    }
  }
  return { save, safeName, planParts };
})();
