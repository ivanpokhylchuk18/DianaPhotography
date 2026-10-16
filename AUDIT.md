# Code and security review — October 16, 2026

Scope: local website and supplied Apps Script. No production token, spreadsheet, Drive folder, hosting configuration or live script was accessed or modified. These are concrete code defects; execution logs were unavailable to identify which caused each historical incident.

## Large-photo download follow-up

Added authenticated 4 MiB Drive range requests for photos above 8 MiB, avoiding one full-photo base64 string for large originals. This mitigates a plausible source of the reported string error; the exact production exception remains unknown. Original bytes and existing permissions are preserved. Requires Drive API enablement, owner authorization, backend redeployment and both gallery frontend files; see the latest section of `DEPLOYMENT.md`. 40 regression tests pass. No measured production speedup is claimed; range requests add overhead while reducing retry size and per-response string size.

## Full local recheck — October 16

The current recheck passes **34 regression tests and 16 headless Chrome checks**. Browser requests use the real page scripts and the Apps Script code against simulated Google services; they do not send live bookings, emails, uploads or credentials. All eight HTML pages load without uncaught JavaScript errors in these tests. This does not prove the reported production admin issue is resolved.

| Files checked | Result / changes |
| --- | --- |
| `admin.html` | Tested login, populated bookings, status save, deliveries, reviews, portfolio upload and galleries. Invalid bookings/reviews responses now show section-specific errors without blocking the other section. Booking search tolerates numeric/blank cells; empty results have a message. |
| `script.js` | Fixed `href="#"` selector exception. Added native date input when the calendar CDN is unavailable, including unavailable-date validation. Booking success clears the hidden attribute. Portfolio folders/lightbox verified in Chrome. |
| `gallery.html` | Missing gallery ID now displays its error instead of hiding the entire error container. Unlock and download controls verified. |
| `index.html` | Corrected missing homepage slideshow categories and inaccurate alt labels; removed duplicate review reversal and review payload logging; API review errors no longer appear as an empty review list. Corrected email typo. |
| `about.html`, `contact.html`, `investment.html` | Corrected email typo; page-load checks pass. Booking wizard submits successfully with simulated service and missing calendar CDN. |
| `experience.html` | Corrected email typo and missing See Highlights anchor; page-load check passes. |
| `portfolio.html`, `styles.css` | Reviewed portfolio/display interactions; real-browser folder grid and lightbox work. No CSS repair required. |
| `upload-client.js`, `gallery-download.js` | Retry, deduplication integration, bounded concurrency, failure handling, cancellation and ZIP original-byte round-trip checks pass. Embedded admin transport matches the standalone helper after line-ending normalization. |
| `apps-script/Code.gs` | Authentication, authorization, sheet mappings, upload locks, retries, gallery access, review moderation, booking/email handling and validation tested using simulated Sheets/Drive. No backend change needed for this recheck's frontend fixes. Missing bookings/reviews sheets still return empty arrays; verify production tab names and headers if data is unexpectedly empty. |
| `vendor/` | Dependency version/license reviewed and ZIP build exercised by round-trip tests; not a line-by-line audit of the minified third-party library. |
| `tests/regression.cjs`, `tests/browser.cjs` | Regression harness reviewed; added real Chrome DOM/interaction checks and malformed-response isolation cases. |
| `README.md`, `DEPLOYMENT.md`, `AUDIT.md`, `CNAME`, `.vscode/settings.json` | Reviewed documentation/domain/editor settings. Domain and user editor settings preserved. |
| `images/` | All **250 image files** pass Pillow format verification; all **24 distinct literal image references** resolve. This is integrity/reference checking, not visual review of every photo or full pixel decoding. |

The images total **3,073.5 MiB**; some originals exceed 30 MiB. Large original assets remain a source of page/download latency. Originals are preserved, and no 20 MB upload cap was reintroduced. Separate web-sized previews would improve page loading without reducing delivered-original quality.

Live Studio Control remains unverified: the supplied URL is the API, and no authenticated production response was available in this recheck. Local populated-data tests pass, so there is insufficient evidence to name a production root cause. Publish the corrected frontend, verify the deployed backend version and sheet names, then use any displayed error to identify the remaining live failure.

## Upload findings

| Defect | Consequence | Repair |
| --- | --- | --- |
| Client upload allowed concurrent calls | Double clicks started overlapping batches | Batch guard, disabled controls, stable file snapshot |
| No per-file exception handling | One read/network/JSON error abandoned remaining files | Continue after individual errors; accurate totals |
| Server always created a new file | Retry after a lost response duplicated saved images | Server-side SHA-256 content identity and deterministic filenames |
| Folder lookup/creation was unsynchronized | Concurrent requests could create competing folders | Script lock around writes; unknown IDs and ambiguous folders rejected |
| Every client image marked JPEG | PNG and other files mislabeled | Signature-based MIME detection; supported-format validation |
| Portfolio always announced success | Failures concealed; failed entries not retried | Accurate totals, failed-only retry, server deduplication |
| Gallery reads created folders and changed permissions | Missing folder could silently become empty gallery | Authenticated read-only listing of existing images |

Duplicate lookup and creation are serialized across browser tabs using Google's [LockService](https://developers.google.com/apps-script/reference/lock/). No existing photo is deleted.

## Security fixes

- **High: stored script injection in admin.** Public booking fields were inserted into HTML without escaping, allowing a crafted inquiry to execute code in the logged-in admin's browser. Escaped booking fields, notes, IDs, status and filenames; removed dynamic IDs from inline JavaScript handlers. Also escaped booking previews, portfolio metadata and email-template submissions.
- **High: missing admin-token configuration.** JSON `null` could match an unset `ADMIN_TOKEN`. Routes now require a configured nonempty string and matching string token.
- **Credentials in URLs.** Admin reads now use POST bodies; public GET rejects admin actions. Rotate the previous token; transport changes do not erase logs.
- **Spreadsheet formula injection.** New appended string cells/private notes starting with formula-triggering characters are saved literally. Existing cells are not rewritten; inspect historical suspicious formulas manually.
- **Unapproved reviews published.** The original comments said approval was required, but the actual cell value was `true`. New reviews start unapproved; existing approved reviews remain unchanged.
- **Validation gaps.** Added action allowlist, text-field limits, email/date/status validation, review row/header protection, and file signatures. Unknown actions no longer fall through to booking creation. The initial upload/request size cap was removed at the owner's request; image format and nonempty-content validation remain.
- Removed client/admin gallery debug dumps; clear authentication inputs after success. Client gallery uses no-referrer/noindex metadata, which are not access controls.

## Other fixes

- Availability explicitly reads preferred-date column G and excludes cancelled inquiries. Pending inquiries still block dates as before.
- New booking IDs use UUIDs; existing IDs continue working.
- Email failure after a saved booking no longer reports the booking as failed. Apps Script logs the email failure; no automatic email-redelivery queue was added.
- Corrected the booking-error email typo and missing experience-slideshow labels.
- Gallery links work under a hosted subdirectory. Image handlers attach before `src`. Repeated login, gallery unlock and form submissions are guarded.

## Remaining limitations

1. **Photos remain link-public.** Gallery passwords protect discovery through the API, but a direct image URL works without the password. This follows Drive's [ANYONE_WITH_LINK semantics](https://developers.google.com/apps-script/reference/drive/access). New code stops sharing whole folders, but does not revoke historical permissions. Truly private delivery needs authenticated image serving or restricted storage with expiring links plus an existing-file migration; that changes the current direct-link behavior.
2. **Plaintext gallery passwords remain in column C and the authenticated admin list.** This preserves the password-retrieval workflow; column D retains the legacy unsalted SHA-256 verifier. Use unique random passwords and restrict spreadsheet access. Stronger password storage requires a deliberate move to password reset/one-time display and migration.
3. **No robust abuse protection/MFA.** Public bookings/reviews can be automated; password attempts are not rate-limited. Validation/moderation do not prevent quota exhaustion, spam or guessing. Verified CAPTCHA/rate-limiting infrastructure and proper admin identity/session management remain needed. Hiding the URL or CORS is not authentication.
4. **Drive hosting and Google quotas remain constraints.** Sheets holds metadata; Drive stores photos. Image availability, email quotas and Apps Script execution limits still apply. The compatibility image URL is not authenticated delivery. Gallery listings return all photos; admin counts scan folders; global write locking prioritizes correctness over throughput. See [Google service quotas](https://developers.google.com/apps-script/guides/services/quotas).
5. **Bookings/reviews lack durable request IDs.** Same-page double submits are blocked, but manually retrying after an ambiguous lost response can still create a duplicate row. Uploads have stronger server-side protection.
6. **Historical data/infrastructure not verified live.** Old duplicate photos, malformed cells, Drive access, deployment ownership, credentials, HTTPS/security headers need account/host inspection. Privacy Policy/Terms links are placeholders. Flatpickr uses an unversioned external CDN URL. These remain follow-up work; no legal policy or hosting configuration was invented.

## Verification

Performance follow-up: client gallery uploads and ZIP fetches now use a bounded three-transfer pipeline. Upload preparation and metadata/sharing run outside the serialized Drive creation section. Existing duplicate detection is still under that lock. The expanded suite passes **32 checks**, including the concurrency ceiling, out-of-order network completion with ordered ZIP contents, and decoding outside the shared lock. Real Google-service throughput has not been benchmarked.

`node tests/regression.cjs`: 28 checks covering page/shared-script parsing, authentication, admin reads, duplicate/retried uploads, interrupted sharing, MIME validation, unknown/missing folders, locking, gallery access, portfolio metadata, review moderation, formula safety, booking/email behavior, validation, client batch continuation/double clicks, failed-only portfolio retry and malicious admin input rendering. Follow-up coverage includes a 21 MiB upload, download authorization/cross-gallery rejection, a real ZIP round-trip preserving original bytes and unique safe filenames, failure without a partial archive, and direct-to-disk completion/cancellation.

Bulk downloads use the locally bundled zip.js 2.24.0 core build (BSD-3-Clause; license in `vendor/zip-LICENSE.txt`). Originals are returned through an authenticated per-photo Apps Script action rather than relying on cross-origin preview downloads or archiving an entire gallery inside a single Apps Script execution. This preserves original bytes and avoids a server-side whole-gallery ZIP memory spike; per-photo base64 responses and browser resource limits still apply.

Static checks found no missing literal local HTML `src`/`href` targets. Tests need no external packages. Google services and minimal UI behavior are simulated; these do not establish real-browser visual correctness or production CORS, permissions, quotas, email or image availability. Complete `DEPLOYMENT.md` live acceptance checks before client delivery.
