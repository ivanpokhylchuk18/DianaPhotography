# Deploying the repair

Changes are saved locally; nothing has been published to your website or Google account.

## Latest: parallel large-photo downloads

Publish `gallery.html` and `gallery-download.js` together; this speed improvement requires no Apps Script changes. The helper URL has a new cache version. Existing split-ZIP delivery, five-attempt retries, save confirmation and part-resume behavior are retained.

Previously, photos over 8 MiB waited for each 4 MiB request to finish before starting the next. They now fetch a sliding window of three ranges and write them to the ZIP in the correct byte order. All small-photo and range requests share a three-request limit, including retries. Later large photos remain idle until consumed, and ranges are buffered in a bounded window rather than loading whole originals.

Validation: 47 regression checks and 23 Chromium browser checks pass with simulated Google responses. Coverage includes out-of-order range completion, exact extracted photo bytes, shared concurrency, cancellation, failure without partial disk commits, and split-part waiting/resume.

Reproducible benchmark: `node tests/download-benchmark.cjs` (optionally pass an older helper path). A 25 MiB photo with seven requests and a simulated 200 ms delay per request took 1,547 ms before and 669 ms after in the local comparison, about 2.3× faster. Both ZIPs were extracted and verified against the original. This measures overlap under simulated latency, not production Google throughput. The Apps Script/base64 transport and Google's service limits still apply. Compare the same live gallery on the same connection after publishing to measure the client-visible improvement.

## October 20: ZIP browser fallback and memory repair

Publish `gallery.html` and `gallery-download.js` together. This repair does not change Apps Script. The page's helper version has been updated to bypass older cached code.

The public gallery page, helper and ZIP library were reachable and matched the local versions before this repair. The client's exact error and affected gallery credentials were unavailable, so this is not a confirmed diagnosis of that incident.

- Blocked/unsupported native save dialogs now fall back to a standard browser ZIP download. Cancelling a dialog still cancels, and disk write errors remain errors.
- Large originals stream their authenticated 4 MiB ranges into the ZIP without allocating a full photo buffer or preloading three large originals. Original bytes are preserved. Browsers without direct disk saving still retain the complete ZIP Blob in memory, so very large collections remain subject to browser limits.
- A completed browser ZIP keeps a visible **Save your ZIP** link. Clients can click it if automatic saving was blocked, without fetching all photos again. The link remains available until another ZIP is prepared or the page is left.

Validation: 44 regression checks and 23 Chromium browser checks, using simulated Google responses. Tests extract generated ZIPs and compare original bytes, exercise a blocked picker, save the same prepared ZIP twice, and verify failed ranges never commit a partial disk file. A live affected-gallery download remains necessary to confirm the client's specific incident is resolved.

## October 17: gallery and upload confirmations

ZIP completion follow-up: publish the latest `gallery.html`. A prominent green message reports the original-photo count after successful ZIP creation. Direct-to-disk browsers confirm the ZIP was saved only after the writer closes; other browsers confirm the archive is ready and the browser download has started, directing visitors to Downloads to verify saving. Failures and cancellations never show success. The completion message receives focus and scrolls into view. No backend or download-helper change is required. Validation now includes 22 browser checks plus 40 regression checks.

Publish `admin.html` and `gallery.html`, then reload both pages. No Apps Script change or redeployment is needed for these confirmations.

The client gallery shows image-loading progress and confirms success only after every preview has loaded. Preview requests run four at a time, including images below the fold. Failed or timed-out previews are counted and can be retried without reloading successful previews. This confirmation concerns gallery previews; ZIP completion remains a separate message.

The admin upload window shows processed-file progress, then a prominent success or error summary with newly uploaded, already-present and failed counts. The latest result remains in the Client Galleries panel after the modal closes, until another batch starts or the page reloads. Success relies on the server's upload acknowledgements; it does not assert that a visitor's browser has loaded the photos. Existing duplicate protection is retained.

Validation: 40 regression checks and 18 Chrome browser checks pass, including preview failure/retry and upload success/duplicate/failure confirmations. Google services are simulated in tests; no live data was changed.

## Latest: large-photo string-error mitigation

The exact production error is unknown; the user recalled a string-related message. This update addresses a plausible large-string failure path, not a confirmed production diagnosis.

1. Replace Apps Script source with the complete current `apps-script/Code.gs`.
2. In the Apps Script editor, next to **Services**, click **+**, select **Drive API** (v3), and add it. With a standard Google Cloud project, also enable **Google Drive API** in that linked project's Cloud console; default Apps Script projects enable the API when the service is added. [Google setup instructions](https://developers.google.com/apps-script/guides/services/advanced#enable_advanced_services).
3. Select and run `authorizeGalleryDownloads` in the editor, approving the owner's permissions when prompted. It checks access without sending emails or changing files. If you explicitly maintain `oauthScopes` in `appsscript.json`, retain all existing scopes and include `https://www.googleapis.com/auth/drive` and `https://www.googleapis.com/auth/script.external_request`; do not replace the existing scope list.
4. Deploy a **new version of the existing web app deployment**, preserving its URL and `ADMIN_TOKEN`.
5. Publish **`gallery.html` and `gallery-download.js` together**. The gallery page now has a versioned helper URL to avoid reusing the older cached download code. Reload and unlock the gallery again to obtain photo sizes from the new backend.
6. Download a gallery containing a photo over 8 MiB, extract the ZIP and compare its files with the originals. Test a small gallery too. If it fails, copy the exact visible error, including the filename.

Photos over 8 MiB use 4 MiB byte ranges from Drive; smaller photos retain the original request path. These values control transport, **not permitted upload or photo size**. Every range checks the password, folder membership, file type and trash state. The owner's OAuth token stays in Apps Script. Range offsets, returned length and total size are checked before the ZIP is delivered. No image compression or permission changes are made. [Drive byte-range documentation](https://developers.google.com/workspace/drive/api/guides/manage-downloads).

40 regression checks pass, including a multi-chunk ZIP comparison against the original bytes, invalid ranges, authorization, incomplete-response rejection and cancellation. Production range requests and speed have not been measured. Smaller requests avoid huge base64 strings and retry just a failed chunk, but add request overhead; they are not a guaranteed speedup. Three photos remain in flight at most, with each original assembled as binary in browser memory. Very large originals and Blob-based ZIP saving can still exhaust browser memory. A separate binary-serving download service would be needed to remove the Apps Script/base64 bottleneck.

## ZIP error-handling follow-up

Publish the updated `gallery-download.js` and hard-refresh the gallery. Request timeouts now report the failed filename and timeout instead of falsely reporting a user cancellation. HTTP status and invalid-service-response errors are clearer; transient transport retries use a cancellable delay, and permanent HTTP permission errors are not retried. The updated `Code.gs` also derives the byte count from the original bytes already loaded, removing one redundant Drive metadata call per photo; redeploy it on the same deployment to include that small change.

37 regression checks pass, including ZIP round-trip, no partial delivery, permission errors, invalid responses and timeout classification. The user's actual reported error was not included in the message and remains needed for diagnosis. No live speed improvement is claimed: the Drive → Apps Script → base64 → browser path is unchanged.

## Latest full recheck

Publish the current `admin.html`, `gallery.html`, `script.js`, `index.html`, `about.html`, `contact.html`, `experience.html`, and `investment.html`, then hard-refresh. Keep the existing `gallery-download.js` and `vendor/` files deployed. This recheck does not change `Code.gs`; if the previously supplied backend is already deployed, no further backend update is needed for these frontend fixes. Otherwise use the complete backend file and deployment instructions below.

All 34 regression and 16 browser checks pass locally with simulated services. This is not confirmation that production bookings load. Earlier deployment observations below are historical, not a verified explanation of the current live failure. See the full recheck table in `AUDIT.md`.

## Studio Control loading repair

The public website inspection found an old `admin.html` deployment and a 404 for `upload-client.js`. The corrected `admin.html` now embeds the complete upload/request helper, so it does not depend on that separately published file. Publish the corrected admin page, then hard-refresh it. All four local API URLs now match the supplied deployment ending `KurHnDgX2/exec`; publish `gallery.html`, `script.js`, and `index.html` to keep the rest of the site aligned too. No spreadsheet or photo migration is required.

For future code edits, keep the `data-studio-transport` script in `admin.html` synchronized with `upload-client.js`. The regression suite checks they match. The new admin also displays the actual data-loading error instead of silently leaving other panels blank.

## Performance update

Redeploy the updated `apps-script/Code.gs` on the existing deployment, then publish `admin.html`, `upload-client.js`, and `gallery-download.js`. Hard-refresh the admin and client gallery pages. Keep the existing endpoint URL.

Client gallery uploads now run up to three transfers at once. The server decodes/hashes client images before acquiring the shared creation lock and releases it after the deterministic file exists, allowing metadata/sharing operations to finish concurrently. The duplicate lookup and file creation remain protected. Repeated JSON serialization/parsing of uploads was removed.

ZIP downloads prefetch up to three originals while writing entries in their original order. The pending window stays bounded rather than loading the entire gallery in parallel. Failure cancels outstanding requests and prevents delivering an incomplete ZIP. Native base64 decoding is used when supported, with a fallback for older browsers.

This reduces per-photo waiting; it does not make large files instant or guarantee a particular speedup. The current architecture still sends original image bytes through Apps Script as base64, and available bandwidth, Drive latency and Google quotas remain factors. Direct binary storage transfers would require a separate storage/authentication integration. Test the same gallery batch before/after on the same network to measure the real improvement. Local regression tests verify three concurrent transfers, ordered ZIP contents and duplicate protection; they do not measure Google's live throughput.

## Follow-up: uncapped uploads and Download all photos

If “The photographer needs to update the gallery download service” appears, check the endpoint URLs first. A mismatch was found locally: `admin.html` used the newer deployment while `gallery.html`, `script.js`, and `index.html` still used the older one. These now match the admin URL. Publish the three corrected files and hard-refresh the gallery, then enter its password again. If the message persists, update the version of that same Apps Script deployment to the latest `Code.gs`; saving source alone is insufficient. You do not need to recreate galleries or reupload photos.

If you already deployed the first repair, replace `Code.gs` with the updated full file and deploy a new version of the **same** Apps Script deployment. Publish `admin.html`, `upload-client.js`, `gallery.html`, `gallery-download.js`, and the entire `vendor/` folder. Existing endpoint URLs have been preserved.

After entering the gallery password, visitors can click **Download all photos** to save one ZIP containing the original Drive files. Names have a numbered prefix so duplicate original names cannot overwrite each other. The password stays in page memory and is sent only in POST bodies; each photo request checks both the password and membership in that gallery. No Google login is added and folders are not made public.

The ZIP library is bundled locally with its license. Supported browsers offer a save dialog and write the archive to disk as it is built; other browsers prepare a Blob and initiate one ordinary download. ZIP64 is supported by the library for large archives. Browser memory/disk space and Google service limits still apply. There is no application-imposed upload size limit. If an original cannot be fetched after retries, the download reports failure instead of silently delivering an incomplete collection. Interrupted direct-to-disk writes are aborted. Refreshing the page requires entering the password again.

Live check: upload a photo larger than 20 MB, unlock an existing gallery, click Download all photos, extract the ZIP and compare its count/filenames/content with the gallery. Test a wrong password and a cancelled download too. The backend must be redeployed for the new download action and file IDs to be available.

## Apps Script

1. Back up the current Apps Script source and spreadsheet. Keep the existing Drive photos and folders.
2. Open the spreadsheet used by the website → Extensions → Apps Script. Use this existing spreadsheet-bound project; the code uses `getActiveSpreadsheet()`.
3. Replace the old supplied script with the **entire contents of `apps-script/Code.gs`**. Do not append it or leave duplicate definitions in other `.gs` files. It includes the existing email templates and API actions.
4. In Project Settings → Script Properties, retain `ADMIN_TOKEN`. Use a long, unique random secret (32+ characters recommended). Never put it in website files. Rotate the old token because the old admin page sent it in URL query parameters.
5. Keep `GOOGLE_DRIVE_FOLDER_ID = ""` for the original root-folder default, or set an owner-controlled private parent folder. Existing client galleries continue using their stored Folder ID. Keep the existing portfolio parent during this repair: changing it changes where duplicate detection looks.
6. Save → Deploy → Manage deployments → select the existing web app → Edit → choose a new version → Deploy. Retain the public site's execution/access settings (execute as owner; allow visitor access). Complete Google's authorization flow if requested. Saving source alone does not update a versioned `/exec` endpoint. Editing the existing deployment preserves its URL. [Google deployment documentation](https://developers.google.com/apps-script/concepts/deployments).

The existing sheet names/column order remain: `DianaBookings`, `Gallery`, `Reviews`, `ClientGalleries`. No column migration is needed. Restrict spreadsheet and script editor access to trusted studio staff.

## Website

Publish these files together through the existing hosting workflow:

- `admin.html`
- `upload-client.js` — new; must sit beside `admin.html`
- `script.js`
- `gallery.html`
- `gallery-download.js` and `vendor/` — local ZIP library and license
- `index.html`

Keep existing pages, styles and assets. Use a short maintenance window: the new backend rejects old admin GET reads. Hard-refresh the admin afterward. The new page checks `upload_protocol: 2` at login and refuses uploads against the old backend, where retries could duplicate files.

If you create a different deployment URL, replace it in **all four** of `admin.html`, `gallery.html`, `script.js`, and `index.html`. Use `/exec`, not `/dev`.

## Live acceptance checks

Local tests simulate Google services. Complete these checks before sending client deliveries:

1. Verify correct/wrong admin passwords; inspect bookings, reviews, gallery counts.
2. Create a separate test gallery using a lowercase/dashed ID and password of at least 12 characters. Existing passwords are preserved, including shorter ones.
3. Upload a small mixed JPEG/PNG batch. Check totals, images, and the lightbox.
4. Select the batch again. It should report “Already uploaded” without increasing the count. A renamed copy of a new-format upload is also recognized; changed bytes remain a new image even under the same filename.
5. Include an unsupported file or interrupt connectivity. Later files should still be attempted. Restore connectivity and retry; saved files should be skipped.
6. Open the client link in an incognito browser; test correct/wrong passwords. Verify an existing gallery too.
7. Test portfolio upload and public display.
8. Submit a clearly marked test inquiry using your own email; check the row, both emails, status update, and cancellation behavior in availability.
9. Submit a test review. It must remain hidden until approved in admin.

## Upload behavior and recovery

- JPEG, PNG, WebP, GIF; no application-imposed file-size cap. Export RAW/HEIC to a supported format first. Original image bytes are preserved; no silent compression. Google and browser resource limits can still cause large transfers to fail, which is reported per file.
- Keep the page open until the summary appears. Navigation warns during an upload. There is no background service or persisted browser queue; after reload, reselect files.
- Network/HTTP/invalid-response failures retry twice. Explicit validation errors fail that file. Busy-lock responses retry; other Google errors may need manual retry after fixing the cause.
- New files have deterministic `dop_...` Drive names so a retry finds a file even after a later operation failed. Original filenames live in Drive descriptions and appear in client galleries. Renaming stored Drive files breaks this lookup.
- Legacy client files are recognized when original filename and bytes match. Renamed legacy files may not be recognized. **Existing duplicates are not deleted or hidden automatically.** Compare originals/backups before deleting any manually.
- If the old script created several `gallery_<id>` folders, inspect them in Drive and set the intended Folder ID in column E of `ClientGalleries`. Recover photos from other folders manually after checking duplicates. The new code refuses ambiguous recovery.
- A missing/inaccessible stored folder produces an error instead of silently creating an empty replacement. Correct its Folder ID or permissions.
- New folders are not made public. Existing public folders retain their permissions and need manual review. Individual photo links remain public; see the audit.

## Rollback

Restore previous website files and point the existing Apps Script deployment to its previous version together. No columns were added/removed. Old gallery code can display new images, although it will show stored hashed filenames. Do not delete photos during rollback. Rollback restores the old bugs too.
