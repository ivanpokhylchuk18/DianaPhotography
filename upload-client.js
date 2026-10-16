/* Shared admin upload transport. Retries are safe only with the supplied Code.gs. */
const UploadClient = (() => {
  function validate(file) {
    if (!file.size) throw new Error('This file is empty. Choose an image with content.');
    if (!/\.(jpe?g|png|webp|gif)$/i.test(file.name)) throw new Error('Use JPEG, PNG, WebP or GIF. Export HEIC/RAW images first.');
  }
  async function post(url, payload, retry = false) {
    const body = JSON.stringify(payload);
    for (let attempt = 0; ; attempt++) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const response = await fetch(url, {
          method: 'POST', headers: { 'Content-Type': 'text/plain;charset=utf-8' },
          body, signal: controller.signal, redirect: 'follow'
        });
        if (!response.ok) throw new Error(`Server returned HTTP ${response.status}`);
        const result = await response.json();
        if (!result.success) {
          const error = new Error(result.error || 'Upload rejected');
          error.permanent = !result.retryable;
          throw error;
        }
        return result;
      } catch (error) {
        if (!retry || error.permanent || attempt >= 2) throw error;
      } finally { clearTimeout(timer); }
      await new Promise(resolve => setTimeout(resolve, 1000 * (2 ** attempt)));
    }
  }
  async function upload(url, payload, file) {
    validate(file);
    const data = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result.split(',')[1]);
      reader.onerror = () => reject(new Error('Could not read this file.'));
      reader.onabort = () => reject(new Error('File reading was interrupted.'));
      reader.readAsDataURL(file);
    });
    return post(url, { ...payload, file_data: data, file_name: file.name, file_type: file.type }, true);
  }
  // Bound concurrent file reads/requests; do not materialize an entire gallery at once.
  async function batch(items, process, concurrency = 3) {
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, async () => {
      while (next < items.length) {
        const index = next++;
        await process(items[index], index);
      }
    }));
  }
  return { post, upload, validate, batch };
})();
