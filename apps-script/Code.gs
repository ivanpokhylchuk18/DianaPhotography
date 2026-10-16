// ══════════════════════════════════════════════════════════════════════════
// GLOBAL STUDIO CONFIGURATION
// ══════════════════════════════════════════════════════════════════════════

const STUDIO_NAME = "Diana Obermeyer Photography";
const STUDIO_EMAIL = "dianaobermeyerphotography@gmail.com";

function getAdminToken() {
  return PropertiesService
    .getScriptProperties()
    .getProperty("ADMIN_TOKEN");
}

// Leave as "" to let the script automatically use your main Drive.
const GOOGLE_DRIVE_FOLDER_ID = "";

function jsonResult(value) {
  return ContentService.createTextOutput(JSON.stringify(value)).setMimeType(ContentService.MimeType.JSON);
}
function isAdmin(token) {
  const configured = getAdminToken();
  return typeof configured === 'string' && configured.length > 0 && typeof token === 'string' && token === configured;
}
function sheetCell(value) {
  return typeof value === 'string' && /^[\s]*[=+@-]/.test(value) ? "'" + value : value;
}
function safeRow(values) { return values.map(sheetCell); }
function htmlEscape(value) {
  return String(value == null ? '' : value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
function textField(data, name, max, required) {
  if (data[name] === undefined || data[name] === null) data[name] = '';
  if (typeof data[name] !== 'string' || data[name].length > max || (required && !data[name].trim())) throw new Error('Invalid ' + name + '.');
}
function doGet(e) {
  const action = String((e && e.parameter && (e.parameter.action || e.parameter.sheet)) || '');
  if (!['', 'gallery', 'reviews', 'booked_dates'].includes(action)) return jsonResult({ success: false, error: 'Use an authenticated POST for admin actions.' });
  return legacyGet(e || { parameter: {} });
}
function doPost(e) {
  let lock;
  try {
    if (!e || !e.postData || typeof e.postData.contents !== 'string') throw new Error('Request is missing.');
    const data = JSON.parse(e.postData.contents);
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Invalid request.');
    const action = data.action === undefined ? '' : data.action;
    const actions = ['', 'submit_review', 'get_gallery', 'download_gallery_image', 'admin_verify', 'admin_fetch_all', 'admin_list_galleries', 'admin_update_booking', 'admin_update_review', 'admin_add_gallery', 'admin_create_gallery', 'admin_add_gallery_image'];
    if (!actions.includes(action)) throw new Error('Unknown action.');
    if (action.startsWith('admin_') && !isAdmin(data.token)) throw new Error('Unauthorized');
    if (action === 'admin_fetch_all' || action === 'admin_list_galleries') return legacyGet({ parameter: { action: action, token: data.token } });
    if (action === 'admin_verify') return jsonResult({ success: true, upload_protocol: 2 });
    if (['get_gallery', 'download_gallery_image', 'admin_create_gallery', 'admin_add_gallery_image'].includes(action)) textField(data, 'gallery_id', 160, true);
    if (['get_gallery', 'download_gallery_image', 'admin_create_gallery'].includes(action)) textField(data, 'password', 256, true);
    if (action === 'get_gallery') return jsonResult(getGallery(data.gallery_id, data.password));
    if (action === 'download_gallery_image') {
      textField(data, 'file_id', 256, true);
      return jsonResult(downloadGalleryImage(data.gallery_id, data.password, data.file_id, data.offset));
    }
    if (action === 'admin_create_gallery') {
      if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(data.gallery_id)) throw new Error('Use lowercase letters, numbers and single dashes for the gallery ID.');
      if (data.password.length < 12) throw new Error('Use a gallery password of at least 12 characters.');
      textField(data, 'client_name', 200, false);
    }
    if (action === 'admin_update_booking') {
      textField(data, 'booking_id', 160, true);
      textField(data, 'notes', 10000, false);
      if (!['Pending', 'Confirmed', 'Completed', 'Cancelled'].includes(data.status)) throw new Error('Invalid booking status.');
    }
    if (action === 'admin_update_review') {
      const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('Reviews');
      if (!sheet || !Number.isInteger(data.row_index) || data.row_index < 2 || data.row_index > sheet.getLastRow()) throw new Error('Invalid review row.');
      if (typeof data.approved !== 'boolean' || typeof data.featured !== 'boolean') throw new Error('Invalid moderation values.');
    }
    if (action === 'admin_add_gallery') {
      textField(data, 'category', 100, true);
      textField(data, 'caption', 1000, false);
      textField(data, 'alt_text', 1000, false);
    }
    if (action === '' || action === 'submit_review') {
      textField(data, 'name', 120, true);
      textField(data, 'email', 254, action === '');
      if (data.email && !/^[^\s@,;<>]+@[^\s@,;<>]+\.[^\s@,;<>]+$/.test(data.email)) throw new Error('Please enter one valid email address.');
      textField(data, 'message', action === '' ? 10000 : 1200, false);
      if (action === '') {
        textField(data, 'phone', 80, false);
        textField(data, 'location', 500, false);
        textField(data, 'session_type', 100, true);
        textField(data, 'preferred_date', 10, true);
        if (!/^\d{4}-\d{2}-\d{2}$/.test(data.preferred_date) || !Number.isFinite(Date.parse(data.preferred_date)) || new Date(data.preferred_date).toISOString().slice(0, 10) !== data.preferred_date) throw new Error('Invalid requested date.');
      } else {
        textField(data, 'session', 100, false);
        textField(data, 'text', 1200, false);
      }
    }
    // Decode/hash outside the lock so concurrent requests can prepare in parallel.
    const preparedImage = action === 'admin_add_gallery_image' ? prepareImage(data.file_data, data.file_name, 'client') : null;
    // Only shared Drive lookup/creation and sheet writes need serialization.
    lock = LockService.getScriptLock();
    if (!lock.tryLock(10000)) return jsonResult({ success: false, retryable: true, error: 'Another request is being saved. Please retry.' });
    if (preparedImage) return jsonResult(storeImage(getGalleryFolder(data.gallery_id), data.file_data, data.file_name, 'client', preparedImage, () => {
      // The deterministic file now exists. Metadata and sharing can finish concurrently.
      SpreadsheetApp.flush();
      lock.releaseLock();
    }));
    return legacyPost(null, data);
  } catch (error) {
    return jsonResult({ success: false, error: error.message || 'Request failed.' });
  } finally {
    if (lock && lock.hasLock()) { try { SpreadsheetApp.flush(); } finally { lock.releaseLock(); } }
  }
}
function imageUrl(id) { return 'https://lh3.googleusercontent.com/d/' + encodeURIComponent(id); }
function digestHex(bytes) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, bytes).map(b => ('0' + (b & 255).toString(16)).slice(-2)).join('');
}
function decodeImage(base64, name) {
  if (typeof name !== 'string' || !name || name.length > 240 || /[\x00-\x1f]/.test(name)) throw new Error('Invalid filename.');
  if (typeof base64 !== 'string' || !base64 || base64.length % 4 || /[^A-Za-z0-9+/=]/.test(base64) || !/^[^=]*={0,2}$/.test(base64)) throw new Error('Invalid image data.');
  const bytes = Utilities.base64Decode(base64);
  if (!bytes.length) throw new Error('Image is empty.');
  const b = bytes.slice(0, 12).map(v => v & 255);
  let type, ext;
  if (b[0] === 255 && b[1] === 216 && b[2] === 255) { type = 'image/jpeg'; ext = 'jpg'; }
  else if ([137,80,78,71,13,10,26,10].every((v,i) => b[i] === v)) { type = 'image/png'; ext = 'png'; }
  else if (String.fromCharCode(...b.slice(0,6)).match(/^GIF8[79]a$/)) { type = 'image/gif'; ext = 'gif'; }
  else if (String.fromCharCode(...b.slice(0,4)) === 'RIFF' && String.fromCharCode(...b.slice(8,12)) === 'WEBP') { type = 'image/webp'; ext = 'webp'; }
  else throw new Error('Unsupported image. Export JPEG, PNG, WebP or GIF; SVG, HEIC and RAW are not supported.');
  return { bytes: bytes, type: type, ext: ext };
}
function prepareImage(base64, name, scope) {
  const image = decodeImage(base64, name);
  const contentHash = digestHex(image.bytes);
  const storedName = 'dop_' + hashPassword(scope + ':' + contentHash) + '.' + image.ext;
  return { image, contentHash, storedName };
}
function storeImage(folder, base64, name, scope, prepared, releaseCreationLock) {
  const { image, contentHash, storedName } = prepared || prepareImage(base64, name, scope);
  const matches = folder.getFilesByName(storedName);
  let file = matches.hasNext() ? matches.next() : null;
  // Recognize an old upload with the same filename and bytes, without deleting anything.
  if (!file && scope === 'client') {
    const legacy = folder.getFilesByName(name);
    while (legacy.hasNext()) {
      const candidate = legacy.next();
      if (candidate.getSize() === image.bytes.length && digestHex(candidate.getBlob().getBytes()) === contentHash) { file = candidate; break; }
    }
  }
  const duplicate = !!file;
  // Deterministic name is committed with createFile, before any later operation can fail.
  // Retrying after a sharing/description/network failure finds and repairs this file.
  if (!file) file = folder.createFile(Utilities.newBlob(image.bytes, image.type, storedName));
  if (releaseCreationLock) releaseCreationLock();
  if (!duplicate || !file.getDescription()) file.setDescription(JSON.stringify({ original_name: name }));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);
  // Keep folders private. Individual image links remain public for compatibility.
  return { success: true, duplicate: duplicate, fileId: file.getId(), url: imageUrl(file.getId()) };
}
function originalImageName(file) {
  try {
    const metadata = JSON.parse(file.getDescription() || '{}');
    if (typeof metadata.original_name === 'string') return metadata.original_name;
  } catch (error) { /* Legacy descriptions can be ordinary text. */ }
  return file.getName();
}


// ══════════════════════════════════════════════════════════════════════════
// 1. GET PIPELINE
// ══════════════════════════════════════════════════════════════════════════

function legacyGet(e) {
  try {
    const ss = SpreadsheetApp.getActiveSpreadsheet();
    const target = e.parameter.action || e.parameter.sheet || "";

    // ────────────────────────────────────────────────────────────────────────
    // PUBLIC GALLERY
    // ────────────────────────────────────────────────────────────────────────

    if (target === "gallery") {
      const sheet = ss.getSheetByName("Gallery");
      const data = sheet ? sheet.getDataRange().getValues() : [];
      const images = [];

      if (data.length > 1) {
        for (let i = 1; i < data.length; i++) {

          if (String(data[i][7]).toUpperCase() === "TRUE") {
            images.push({
              photo_url: data[i][0],
              thumbnail: data[i][1],
              category: data[i][2],
              caption: data[i][3],
              alt_text: data[i][4],
              featured: data[i][6]
            });
          }

        }
      }

      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          data: images.reverse()
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }


    // ────────────────────────────────────────────────────────────────────────
    // PUBLIC REVIEWS
    // ────────────────────────────────────────────────────────────────────────

    if (target === "reviews") {

      const sheet = ss.getSheetByName("Reviews");
      const data = sheet ? sheet.getDataRange().getValues() : [];

      const reviews = [];

      if (data.length > 1) {

        for (let i = 1; i < data.length; i++) {

          // Column G = Approved
          const approved =
            String(data[i][6]).toUpperCase() === "TRUE";

          if (approved) {

            reviews.push({
              timestamp: data[i][0],
              session: data[i][1],
              name: data[i][2],
              rating: Number(data[i][3]),
              message: data[i][4],
              featured: data[i][7]
            });

          }
        }
      }

      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          data: reviews.reverse()
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }


// ────────────────────────────────────────────────────────────────────────
// ADMIN LIST CLIENT GALLERIES
// ────────────────────────────────────────────────────────────────────────

if (target === "admin_list_galleries") {

  if (!isAdmin(e.parameter.token)) {
    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: "Unauthorized"
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }

  try {

    const galleries = listGalleries();

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        galleries: galleries
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {

    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: err.message
      }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}



    // ────────────────────────────────────────────────────────────────────────
    // ADMIN FETCH
    // ────────────────────────────────────────────────────────────────────────

    if (target === "admin_fetch_all") {

      if (!isAdmin(e.parameter.token)) {
        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: "Unauthorized"
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      // BOOKINGS

      const bookingsSheet = ss.getSheetByName("DianaBookings");
      const bData = bookingsSheet
        ? bookingsSheet.getDataRange().getValues()
        : [];

      const bookings = [];

      if (bData.length > 1) {

        for (let i = 1; i < bData.length; i++) {

          bookings.push({
            booking_id: bData[i][0],
            timestamp: bData[i][1],
            name: bData[i][2],
            email: bData[i][3],
            phone: bData[i][4],
            session_type: bData[i][5],
            preferred_date: bData[i][6],
            location: bData[i][7],
            message: bData[i][8],
            status: bData[i][9],
            notes: bData[i][10],
            quote_sent: bData[i][11],
            deposit_paid: bData[i][12]
          });

        }
      }


      // REVIEWS

      const reviewsSheet = ss.getSheetByName("Reviews");
      const rData = reviewsSheet
        ? reviewsSheet.getDataRange().getValues()
        : [];

      const reviewsList = [];

      if (rData.length > 1) {

        for (let i = 1; i < rData.length; i++) {

          reviewsList.push({
            row_index: i + 1,
            timestamp: rData[i][0],
            session_type: rData[i][1],
            name: rData[i][2],
            rating: Number(rData[i][3]),
            message: rData[i][4],
            approved: rData[i][6],
            featured: rData[i][7]
          });

        }
      }

      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          bookings: bookings.reverse(),
          reviews: reviewsList.reverse()
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }


    // ────────────────────────────────────────────────────────────────────────
    // BOOKED DATES
    // ────────────────────────────────────────────────────────────────────────

    const sheet = ss.getSheetByName("DianaBookings");
    const data = sheet ? sheet.getDataRange().getValues() : [];

    const bookedDates = [];

    if (data.length > 1) {

      const dateIdx = 6; // Preferred date, never the submission timestamp.

      if (dateIdx !== -1) {

        for (let i = 1; i < data.length; i++) {

          if (String(data[i][9]) === "Cancelled") continue;
          const cellValue = data[i][dateIdx];

          if (cellValue) {

            const formatted =
              cellValue instanceof Date
                ? Utilities.formatDate(
                    cellValue,
                    ss.getSpreadsheetTimeZone(),
                    "yyyy-MM-dd"
                  )
                : cellValue.toString().trim();

            bookedDates.push(formatted);
          }
        }
      }
    }

    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        bookedDates: bookedDates
      }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (err) {

    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: err.message
      }))
      .setMimeType(ContentService.MimeType.JSON);

  }
}


// ══════════════════════════════════════════════════════════════════════════
// 2. POST PIPELINE
// ══════════════════════════════════════════════════════════════════════════

function legacyPost(e, parsedData) {

  try {

    const data = parsedData || JSON.parse(e.postData.contents);
    const ss = SpreadsheetApp.getActiveSpreadsheet();


    // ────────────────────────────────────────────────────────────────────────
    // ADMIN LOGIN
    // ────────────────────────────────────────────────────────────────────────

    if (data.action === "admin_verify") {

      if (isAdmin(data.token)) {

        return ContentService
          .createTextOutput(JSON.stringify({
            success: true
          }))
          .setMimeType(ContentService.MimeType.JSON);

      }

      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          error: "Access Denied."
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }


    // ────────────────────────────────────────────────────────────────────────
    // CLIENT GALLERY ACCESS
    // ────────────────────────────────────────────────────────────────────────

    if (data.action === "get_gallery") {

      try {

        const result =
          getGallery(
            data.gallery_id,
            data.password
          );

        return ContentService
          .createTextOutput(JSON.stringify(result))
          .setMimeType(ContentService.MimeType.JSON);

      } catch (err) {

        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: err.message
          }))
          .setMimeType(ContentService.MimeType.JSON);

      }
    }


    // ────────────────────────────────────────────────────────────────────────
    // ADMIN ACTIONS
    // ────────────────────────────────────────────────────────────────────────

    if (
      data.action &&
      data.action.startsWith("admin_")
    ) {

      if (!isAdmin(data.token)) {

        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: "Unauthorized"
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }


      // UPDATE BOOKING

      if (data.action === "admin_update_booking") {

        const sheet =
          ss.getSheetByName("DianaBookings");

        const values =
          sheet.getDataRange().getValues();

        let targetRow = -1;

        for (let i = 1; i < values.length; i++) {

          if (values[i][0] === data.booking_id) {

            targetRow = i + 1;
            break;

          }
        }

        if (targetRow !== -1) {

          sheet
            .getRange(targetRow, 10)
            .setValue(data.status);

          sheet
            .getRange(targetRow, 11)
            .setValue(sheetCell(data.notes));

          return ContentService
            .createTextOutput(JSON.stringify({
              success: true
            }))
            .setMimeType(ContentService.MimeType.JSON);
        }

        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: "Booking not found."
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }


      // ─────────────────────────────────────────────────────────────────────
      // ADMIN UPDATE REVIEW
      // ─────────────────────────────────────────────────────────────────────

      if (data.action === "admin_update_review") {

        const sheet =
          ss.getSheetByName("Reviews");

        if (!sheet) {

          return ContentService
            .createTextOutput(JSON.stringify({
              success: false,
              error: "Reviews sheet missing."
            }))
            .setMimeType(ContentService.MimeType.JSON);
        }

        if (Number.isInteger(data.row_index) && data.row_index >= 2 && data.row_index <= sheet.getLastRow()) {

          // G = Approved
          sheet
            .getRange(data.row_index, 7)
            .setValue(
              data.approved === true ||
              data.approved === "TRUE"
            );

          // H = Featured
          sheet
            .getRange(data.row_index, 8)
            .setValue(
              data.featured === true ||
              data.featured === "TRUE"
            );

          return ContentService
            .createTextOutput(JSON.stringify({
              success: true
            }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }


      // ─────────────────────────────────────────────────────────────────────
      // ADD GALLERY IMAGE
      // ─────────────────────────────────────────────────────────────────────

      if (data.action === "admin_add_gallery") {
        const sheet = ss.getSheetByName('Gallery');
        if (!sheet) throw new Error('Gallery sheet missing.');
        const folder = GOOGLE_DRIVE_FOLDER_ID ? DriveApp.getFolderById(GOOGLE_DRIVE_FOLDER_ID) : DriveApp.getRootFolder();
        let result;
        if (data.file_data) result = storeImage(folder, data.file_data, data.file_name, 'portfolio:' + data.category);
        else {
          if (!/^https:\/\//i.test(String(data.photo_url || ''))) throw new Error('An HTTPS photo URL is required.');
          result = { success: true, url: data.photo_url };
        }
        const exists = sheet.getDataRange().getValues().slice(1).some(row => row[0] === result.url && String(row[2]) === data.category);
        if (!exists) sheet.appendRow(safeRow([result.url, result.url, data.category, data.caption || '', data.alt_text || '', Date.now(), false, true]));
        return jsonResult({ success: true, url: result.url, duplicate: exists });
      }

      // CREATE GALLERY

      if (data.action === "admin_create_gallery") {

        try {

          const result =
            createGallery(
              data.gallery_id,
              data.password,
              data.client_name
            );

          return ContentService
            .createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);

        } catch (err) {

          return ContentService
            .createTextOutput(JSON.stringify({
              success: false,
              error: err.message
            }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }


      // ADD GALLERY IMAGE

      if (data.action === "admin_add_gallery_image") {

        try {

          const result =
            addGalleryImage(
              data.gallery_id,
              data.file_data,
              data.file_name
            );

          return ContentService
            .createTextOutput(JSON.stringify(result))
            .setMimeType(ContentService.MimeType.JSON);

        } catch (err) {

          return ContentService
            .createTextOutput(JSON.stringify({
              success: false,
              error: err.message
            }))
            .setMimeType(ContentService.MimeType.JSON);
        }
      }
    }


    // ════════════════════════════════════════════════════════════════════════
    // PUBLIC REVIEW SUBMISSION
    // ════════════════════════════════════════════════════════════════════════

    if (data.action === "submit_review") {

      const sheet =
        ss.getSheetByName("Reviews");

      if (!sheet) {

        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: "Reviews sheet missing."
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }


      const name =
        String(data.name || "").trim();

      const message =
        String(
          data.message ||
          data.text ||
          ""
        ).trim();

      const rating =
        Number(data.rating);


      // VALIDATION

      if (!name) {

        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: "Please enter your name."
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      if (!message) {

        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: "Please enter your review."
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }

      if (
        !Number.isInteger(rating) ||
        rating < 1 ||
        rating > 5
      ) {

        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: "Please select a rating from 1 to 5 stars."
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }


      if (name.length > 80) {

        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: "Name is too long."
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }


      if (message.length > 1200) {

        return ContentService
          .createTextOutput(JSON.stringify({
            success: false,
            error: "Review is too long."
          }))
          .setMimeType(ContentService.MimeType.JSON);
      }


      // IMPORTANT:
      // New reviews are NOT automatically approved.
      // Column G = FALSE.
      //
      // You can approve them from your admin panel
      // or manually change FALSE -> TRUE in Google Sheets.

      sheet.appendRow(safeRow([

        new Date(),                 // A Timestamp
        data.session || "Photography", // B Session
        name,                       // C Name
        rating,                     // D Rating
        message,                    // E Review
        data.email || "",           // F Email
        false,                     // G Approved: requires moderation
        false                       // H Featured

      ]));


      return ContentService
        .createTextOutput(JSON.stringify({
          success: true,
          message: "Review submitted successfully."
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }


    // ════════════════════════════════════════════════════════════════════════
    // PUBLIC BOOKING
    // ════════════════════════════════════════════════════════════════════════

    if (
      !data.name ||
      !data.email ||
      !data.preferred_date
    ) {

      return ContentService
        .createTextOutput(JSON.stringify({
          success: false,
          error: "Missing required fields."
        }))
        .setMimeType(ContentService.MimeType.JSON);
    }


    const sheet =
      ss.getSheetByName("DianaBookings");

    const bookingId =
      "DO-" +
      Utilities.getUuid();

    const timestamp =
      new Date();


    sheet.appendRow(safeRow([

      bookingId,
      timestamp,
      data.name,
      data.email,
      data.phone || "Not provided",
      data.session_type,
      data.preferred_date,
      data.location || "Not provided",
      data.message || "",
      "Pending",
      "",
      false,
      false,
      ""

    ]));


    try { sendLuxuryEmails(data, bookingId); } catch (error) {
      // The booking is already saved. Do not invite a duplicate submission.
      console.error("Booking saved, email delivery failed", bookingId, error.message);
    }


    return ContentService
      .createTextOutput(JSON.stringify({
        success: true,
        booking_id: bookingId
      }))
      .setMimeType(ContentService.MimeType.JSON);


  } catch (err) {

    return ContentService
      .createTextOutput(JSON.stringify({
        success: false,
        error: err.message
      }))
      .setMimeType(ContentService.MimeType.JSON);

  }
}


// ══════════════════════════════════════════════════════════════════════════
// 3. EMAIL UTILITY
// ══════════════════════════════════════════════════════════════════════════

function sendLuxuryEmails(data, bookingId) {
  const recipient = data.email;
  data = Object.keys(data).reduce((safe, key) => { safe[key] = htmlEscape(data[key]); return safe; }, {});

  const clientEmailHtml = `

    <div style="
      background-color:#FAF7F4;
      padding:40px 20px;
      font-family:Georgia,serif;
      color:#2C2C2C;
      line-height:1.8;
    ">

      <div style="
        max-width:600px;
        margin:0 auto;
        background:#FFFFFF;
        border:1px solid rgba(44,44,44,0.06);
        padding:50px 40px;
      ">

        <div style="
          text-align:center;
          margin-bottom:40px;
          border-bottom:1px solid #EBE8E4;
          padding-bottom:30px;
        ">

          <span style="
            font-size:26px;
            letter-spacing:2px;
            text-transform:uppercase;
            display:block;
            font-weight:300;
          ">
            Diana Obermeyer
          </span>

          <span style="
            font-size:14px;
            letter-spacing:4px;
            text-transform:uppercase;
            color:#B8976A;
            display:block;
            margin-top:5px;
            font-style:italic;
          ">
            P h o t o g r a p h y
          </span>

        </div>


        <p style="
          font-size:16px;
          margin-bottom:25px;
        ">
          Hello ${data.name},
        </p>


        <p style="
          font-size:15px;
          color:#555555;
          margin-bottom:25px;
        ">
          Thank you for sharing your vision with the studio.
          Your booking request has been safely received.
        </p>


        <div style="
          background:#FAF7F4;
          border-left:3px solid #B8976A;
          padding:25px;
          margin:30px 0;
          font-size:14px;
        ">

          <p style="margin:0 0 10px 0;">
            <strong>Inquiry Reference:</strong>
            <span style="
              font-family:monospace;
              color:#B8976A;
            ">
              ${bookingId}
            </span>
          </p>

          <p style="margin:0 0 10px 0;">
            <strong>Selected Focus:</strong>
            ${data.session_type} Session
          </p>

          <p style="margin:0 0 10px 0;">
            <strong>Requested Date:</strong>
            ${data.preferred_date}
          </p>

          <p style="margin:0;">
            <strong>Target Location:</strong>
            ${data.location || "To be determined"}
          </p>

        </div>


        <h4 style="
          font-size:16px;
          font-weight:400;
          text-transform:uppercase;
          letter-spacing:1px;
          color:#2C2C2C;
          margin-top:35px;
          margin-bottom:15px;
        ">
          What Happens Next
        </h4>


        <p style="
          font-size:14px;
          color:#555555;
          margin-bottom:35px;
        ">
          I personally evaluate every creative inquiry to ensure
          our stylistic directions match beautifully.
          You can expect a thoughtful personal response
          along with final details inside the next 24 hours.
        </p>


        <div style="
          border-top:1px solid #EBE8E4;
          padding-top:30px;
          margin-top:40px;
          text-align:center;
          font-size:13px;
          color:#8A8278;
        ">

          <p style="
            margin:0 0 5px 0;
            font-style:italic;
          ">
            Capturing the quiet beauty of your most precious moments.
          </p>

          <p style="margin:0;">
            <a
              href="mailto:${STUDIO_EMAIL}"
              style="
                color:#B8976A;
                text-decoration:none;
              "
            >
              ${STUDIO_EMAIL}
            </a>
            — Worldwide Available
          </p>

        </div>

      </div>

    </div>

  `;


  GmailApp.sendEmail(

    recipient,

    "Your Booking Inquiry Summary — " + STUDIO_NAME,

    "",

    {
      htmlBody:clientEmailHtml,
      name:STUDIO_NAME,
      replyTo:STUDIO_EMAIL
    }

  );


  const studioNotificationHtml = `

    <div style="
      background-color:#2C2C2C;
      padding:40px 20px;
      font-family:sans-serif;
      color:#FFFFFF;
      line-height:1.6;
    ">

      <div style="
        max-width:600px;
        margin:0 auto;
        background:#1E1612;
        padding:40px;
        border-radius:4px;
        border-top:4px solid #B8976A;
      ">

        <h2 style="
          margin-top:0;
          font-weight:300;
          font-size:22px;
          color:#B8976A;
        ">
          New Creative Commission Requested
        </h2>


        <p style="
          font-size:14px;
          color:#EBE8E4;
        ">
          A new booking submission is waiting for evaluation.
        </p>


        <table style="
          width:100%;
          border-collapse:collapse;
          margin:25px 0;
          color:#EBE8E4;
          font-size:14px;
        ">

          <tr>
            <td style="padding:8px 0;">
              <strong>Reference ID:</strong>
            </td>

            <td style="
              padding:8px 0;
              font-family:monospace;
              color:#B8976A;
            ">
              ${bookingId}
            </td>
          </tr>


          <tr>
            <td style="padding:8px 0;">
              <strong>Client Name:</strong>
            </td>

            <td style="padding:8px 0;">
              ${data.name}
            </td>
          </tr>


          <tr>
            <td style="padding:8px 0;">
              <strong>Email:</strong>
            </td>

            <td style="padding:8px 0;">
              ${data.email}
            </td>
          </tr>


          <tr>
            <td style="padding:8px 0;">
              <strong>Phone:</strong>
            </td>

            <td style="padding:8px 0;">
              ${data.phone || "Not provided"}
            </td>
          </tr>


          <tr>
            <td style="padding:8px 0;">
              <strong>Session Type:</strong>
            </td>

            <td style="padding:8px 0;">
              ${data.session_type}
            </td>
          </tr>


          <tr>
            <td style="padding:8px 0;">
              <strong>Target Date:</strong>
            </td>

            <td style="padding:8px 0;">
              ${data.preferred_date}
            </td>
          </tr>


          <tr>
            <td style="padding:8px 0;">
              <strong>Location:</strong>
            </td>

            <td style="padding:8px 0;">
              ${data.location || "Not provided"}
            </td>
          </tr>

        </table>


        <div style="
          background:rgba(255,255,255,0.04);
          padding:20px;
          border-left:2px solid #8A8278;
          font-size:14px;
          font-style:italic;
          color:#FAF7F4;
        ">

          <strong>
            Client Vision & Notes:
          </strong>

          <br><br>

          "${(data.message || "No message provided")
            .replace(/\n/g, "<br>")}"

        </div>


        <p style="
          margin-top:30px;
          font-size:12px;
          text-align:center;
        ">

          <a
            href="${SpreadsheetApp
              .getActiveSpreadsheet()
              .getUrl()}"
            target="_blank"
            style="
              color:#B8976A;
              text-decoration:none;
              font-weight:bold;
            "
          >
            → Open Studio Bookings Master Sheet
          </a>

        </p>

      </div>

    </div>

  `;


  GmailApp.sendEmail(

    STUDIO_EMAIL,

    `Alert: New ${data.session_type} Request — ${data.name}`,

    "",

    {
      htmlBody:studioNotificationHtml,
      name:"Studio Booking System"
    }

  );

}


// ══════════════════════════════════════════════════════════════════════════
// 4. CLIENT GALLERIES
// ══════════════════════════════════════════════════════════════════════════

function hashPassword(plain) {

  const digest =
    Utilities.computeDigest(
      Utilities.DigestAlgorithm.SHA_256,
      plain
    );

  return digest
    .map(b =>
      ("0" + (b & 0xFF).toString(16))
        .slice(-2)
    )
    .join("");

}


function getGalleryFolder(galleryId, createIfMissing = true) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ClientGalleries');
  if (!sheet) throw new Error('ClientGalleries sheet missing');
  const rows = sheet.getDataRange().getValues();
  const index = rows.findIndex((row, i) => i > 0 && String(row[0]) === galleryId);
  if (index < 1) throw new Error('Gallery not found');
  if (rows[index][4]) return DriveApp.getFolderById(String(rows[index][4]));
  if (!createIfMissing) return null;
  // Caller holds the script lock; only the admin may create folders.
  const matches = DriveApp.getFoldersByName('gallery_' + galleryId);
  let folder;
  if (matches.hasNext()) {
    folder = matches.next();
    if (matches.hasNext()) throw new Error('Multiple gallery folders exist. Set the correct Folder ID in ClientGalleries.');
  } else {
    folder = GOOGLE_DRIVE_FOLDER_ID ? DriveApp.getFolderById(GOOGLE_DRIVE_FOLDER_ID).createFolder('gallery_' + galleryId) : DriveApp.createFolder('gallery_' + galleryId);
  }
  sheet.getRange(index + 1, 5).setValue(folder.getId());
  SpreadsheetApp.flush();
  return folder;
}

function listGalleries() {

  const sheet =
    SpreadsheetApp
      .getActiveSpreadsheet()
      .getSheetByName("ClientGalleries");

  if (!sheet) return [];

  const data =
    sheet.getDataRange().getValues();

  const galleries = [];

  for (let i = 1; i < data.length; i++) {

    const galleryId = String(data[i][0] || "").trim();

    if (!galleryId) continue;

    let imageCount = 0;

    const folderId = data[i][4];

    if (folderId) {

      try {

        const folder =
          DriveApp.getFolderById(folderId);

        const files =
          folder.getFiles();

        while (files.hasNext()) {

          const file = files.next();

          // Only count image files
          if (
            file.getMimeType() &&
            file.getMimeType().startsWith("image/")
          ) {
            imageCount++;
          }

        }

      } catch (err) {

        console.error(
          "Could not read gallery folder:",
          galleryId,
          err.message
        );

      }
    }

    galleries.push({

      id: galleryId,

      client_name:
        data[i][1] || "",

      password:
        data[i][2] || "",

      image_count:
        imageCount,

      folder_id:
        folderId || ""

    });

  }

  return galleries;
}


function createGallery(
  galleryId,
  password,
  clientName
) {

  const ss =
    SpreadsheetApp
      .getActiveSpreadsheet();


  let sheet =
    ss.getSheetByName(
      "ClientGalleries"
    );


  if (!sheet) {

    sheet =
      ss.insertSheet(
        "ClientGalleries"
      );

    sheet
      .getRange(1,1,1,6)
      .setValues([[
        "Gallery ID",
        "Client Name",
        "Plain Password",
        "Password Hash",
        "Folder ID",
        "Created At"
      ]]);

  }


  const existing =
    sheet
      .getDataRange()
      .getValues()
      .find(
        row =>
          row[0] === galleryId
      );


  if (existing)
    throw new Error(
      "Gallery ID already exists"
    );


  const hashed =
    hashPassword(password);


  sheet.appendRow(safeRow([

    galleryId,
    clientName || "",
    password,
    hashed,
    "",
    new Date()

  ]));


  const folder =
    getGalleryFolder(
      galleryId
    );


  return {
    success:true,
    folderId:folder.getId()
  };

}


function addGalleryImage(galleryId, base64Data, fileName) {
  return storeImage(getGalleryFolder(galleryId), base64Data, fileName, 'client');
}

function authenticatedGalleryRow(galleryId, password) {
  const sheet = SpreadsheetApp.getActiveSpreadsheet().getSheetByName('ClientGalleries');
  const rows = sheet ? sheet.getDataRange().getValues() : [];
  const row = rows.slice(1).find(row => String(row[0]) === galleryId);
  if (!row || !row[3] || hashPassword(password) !== row[3]) throw new Error('Incorrect password or gallery does not exist.');
  return row;
}

function downloadGalleryImage(galleryId, password, fileId, offset) {
  const row = authenticatedGalleryRow(galleryId, password);
  if (!row[4]) throw new Error('Gallery folder not found.');
  const file = DriveApp.getFileById(fileId);
  const parents = file.getParents();
  let belongsToGallery = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === String(row[4])) belongsToGallery = true;
  }
  if (!belongsToGallery || file.isTrashed() || !/^image\/(jpeg|png|webp|gif)$/.test(file.getMimeType())) throw new Error('Photo is not available in this gallery.');
  if (offset !== undefined) {
    const total = file.getSize();
    if (!Number.isSafeInteger(offset) || offset < 0 || offset >= total) throw new Error('Invalid photo byte offset.');
    const end = Math.min(total - 1, offset + 4 * 1024 * 1024 - 1);
    // Keep the owner's OAuth token server-side. Never send it to gallery visitors.
    const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/files/' + encodeURIComponent(fileId) + '?alt=media&supportsAllDrives=true', {
      headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken(), Range: 'bytes=' + offset + '-' + end },
      muteHttpExceptions: true
    });
    const status = response.getResponseCode();
    if (status === 429 || status >= 500) return { success: false, retryable: true, error: 'Drive is temporarily busy (HTTP ' + status + ').' };
    if (status === 403) throw new Error('Drive denied the download. The photographer must enable the Google Drive API for the Apps Script project and check file download permissions.');
    if (status !== 206) throw new Error('Drive did not return the requested photo range (HTTP ' + status + ').');
    const headers = response.getAllHeaders();
    const rangeKey = Object.keys(headers).find(key => key.toLowerCase() === 'content-range');
    if (String(headers[rangeKey]) !== 'bytes ' + offset + '-' + end + '/' + total) throw new Error('Photo changed or Drive returned an unexpected byte range. Reload the gallery.');
    const part = response.getBlob().getBytes();
    if (part.length !== end - offset + 1) throw new Error('Incomplete photo range received from Drive.');
    return { success: true, file_data: Utilities.base64Encode(part), size: part.length, total_size: total, offset: offset };
  }
  // Original Drive bytes, never the preview URL or a resized thumbnail.
  const bytes = file.getBlob().getBytes();
  return { success: true, filename: originalImageName(file), file_data: Utilities.base64Encode(bytes), size: bytes.length };
}

function getGallery(galleryId, password) {
  const row = authenticatedGalleryRow(galleryId, password);
  const folder = getGalleryFolder(galleryId, false);
  if (!folder) return { success: true, gallery: { client_name: row[1] }, images: [] };
  const files = folder.getFiles();
  const images = [];
  while (files.hasNext()) {
    const file = files.next();
    if (!/^image\/(jpeg|png|webp|gif)$/.test(file.getMimeType())) continue;
    // A read never changes permissions or silently creates replacement folders.
    images.push({ filename: originalImageName(file), file_id: file.getId(), size: file.getSize(), url: imageUrl(file.getId()) });
  }
  images.sort((a, b) => a.filename.localeCompare(b.filename));
  return { success: true, gallery: { client_name: row[1] }, images: images };
}

function forceAuthCheck() {
  GmailApp.sendEmail(Session.getActiveUser().getEmail(), "Authorization Test", "Success.");
}

// Run once in the Apps Script editor after enabling the Google Drive API.
// Prompts the owner for required permissions without sending an email or editing data.
function authorizeGalleryDownloads() {
  DriveApp.getRootFolder().getId();
  const response = UrlFetchApp.fetch('https://www.googleapis.com/drive/v3/about?fields=storageQuota', {
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true
  });
  if (response.getResponseCode() !== 200) throw new Error('Google Drive API authorization check failed (HTTP ' + response.getResponseCode() + '). Enable the Google Drive API for this project and authorize the script again.');
  console.log('Gallery download authorization is ready.');
}
