// Simulated network latency, not a measurement of Google or a client's connection.
// node tests/download-benchmark.cjs [path-to-alternate-gallery-download.js]
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const zip = require('../vendor/zip-core-2.24.0.min.js');
const bytes = Buffer.alloc(25 * 1024 * 1024, 123);
let blob, active = 0, peak = 0, requests = 0;
const context = vm.createContext({
  zip, window: {}, WritableStream, ReadableStream, AbortController, DOMException, Uint8Array, atob,
  setTimeout: (fn, ms) => ms === 60000 ? 0 : setTimeout(fn, ms), clearTimeout,
  URL: { createObjectURL(value) { blob = value; return 'blob:test'; }, revokeObjectURL() {} },
  document: { body: { appendChild() {} }, createElement: () => ({ click() {}, remove() {} }) },
  fetch: async (_, options) => {
    const { offset } = JSON.parse(options.body);
    requests++; active++; peak = Math.max(peak, active);
    await new Promise(resolve => setTimeout(resolve, 200));
    const part = bytes.subarray(offset, offset + 4 * 1024 * 1024);
    active--;
    return { ok: true, json: async () => ({ success: true, file_data: part.toString('base64'), size: part.length, total_size: bytes.length, offset }) };
  }
});
vm.runInContext(fs.readFileSync(process.argv[2] || 'gallery-download.js', 'utf8') + '\nthis.downloader = GalleryDownload;', context);
(async () => {
  const started = performance.now();
  await context.downloader.save({ url: 'https://example.test', galleryId: 'benchmark', password: 'test',
    images: [{ file_id: '1', filename: 'large.jpg', size: bytes.length }], signal: new AbortController().signal });
  const elapsedMs = Math.round(performance.now() - started);
  const reader = new zip.ZipReader(new zip.BlobReader(blob));
  const [entry] = await reader.getEntries();
  assert.deepEqual(Buffer.from(await entry.getData(new zip.Uint8ArrayWriter(), { useWebWorkers: false })), bytes);
  await reader.close();
  console.log(JSON.stringify({ simulatedLatencyMs: 200, photoMiB: 25, elapsedMs, requests, peakConcurrentRequests: peak, originalBytesVerified: true }));
})().catch(error => { console.error(error); process.exitCode = 1; });
