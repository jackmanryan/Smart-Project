/** =============================================================================
 * 01 Primary Utils
 * -----------------------------------------------------------------------------
 * Purpose
 *   Shared, dependency-light helpers for:
 *     - Robust date parsing/normalizing (serials, D/M/Y, text months, YYYYMMDD)
 *     - Time parsing and date+time composition for Sheets
 *     - Phone/email normalization and simple canonicalization
 *     - OCR of PDFs to text via Advanced Drive → Google Doc (with caching/backoff)
 *     - Gmail label/query helpers and vendor thread resolution utilities
 *     - Sheet formatting for date/time columns
 *     - Header canonicalization & column matching for CSV/Sheets (canonHeader_, findHeaderIndex)
 *   - Gmail search URL builder & invoice digit extraction (buildGmailSearchUrl_, invoiceDigits_)
 *   - General text canonicalization helpers (_norm_, _digits_, _naish_)
 *   - Column index → letter conversion (_colLetter_)
 *   - Canonical CI input signature builder (_buildCallSigFromInput_)
 * Entry points (call from menus/triggers)
 *   - deleteOld2FAThreads()         → Trashes 2FA threads older than ~6 minutes (CONFIG.LABELS.TWO_FA)
 *   - ensureDateTimeFormats_(sheet) → Applies dd/MM/yyyy and HH:mm:ss formats to target columns
 *   - resolveVendorThreadIdForInvoice_(input) → Finds a vendor PO thread id from invoice/PO-like text
 *
 * Functions (in this file)
 *   Date & Time
 *     - _monTokenToNum_(tok)
 *     - _daysInMonth_(y, m)
 *     - _excelSerialToDate_(n)
 *     - _composeSameYear_(m, d, today)
 *     - _normalizeRevDate_(raw)
 *     - _toDateFlex_(v, allowDelayed)
 *     - parseDMY(str)
 *     - _parseDMYLoose_(s)
 *     - _fallbackSameYearDate_()
 *     - parseTimeString_(s)
 *     - isDateAtMidnightWithTime(d)
 *     - hasTimeComponent_(d)                 // alias of isDateAtMidnightWithTime
 *     - combineDateAndTime_(dateOnly, timeOnly)
 *     - resolveTimestamp_(aVal, bVal)
 *     - parseDateTime_(dateVal, timeVal)
 *     - toDateOnly_(d)
 *     - toDate(val)
 *     - toMMDDYY(str)
 *     - addDays_(d, n)
 *     - ensureDateTimeFormats_(sheet)
 *
 *   Phone / Canonicalization
 *     - _rowStateKey_(key)
 *     - _getRowState_(key)
 *     - _setRowState_(key, obj, ttlSec)
 *     - _digitsOnly_(s)
 *     - isDigitsOnly_(val)
 *     - normalizePhone10_(v)
 *     - normalizePhone_(v)
 *     - canonLocal_(s)
 *
 *   Email / OCR / Misc
 *     - isValidEmail_(val)
 *     - ocrPdf(blob, lang)                  // Advanced Drive OCR → Google Doc → text, cached
 *     - safeStr_(v)
 *     - pickRandom_(arr)
 *     - _isTruthyBoolean(v)
 *     - safeCell(row, i)                    // guarded define
 *     - normalizeDateLoose(v)               // guarded define
 *     - normalizeSingerDate(v)              // back-compat alias to normalizeDateLoose
 *
 *   Gmail Helpers
 *     - GmailU.getOrCreateLabel(name)
 *     - GmailU.queryWithLookback(labelName, days)
 *     - GmailU.getRecentThreads(labelName, days, max)
 *     - GmailU.threadHasLabel(thread, labelName)
 *     - GmailU.newestMessage(thread)
 *
 *   Thread / Vendor Utilities
 *     - deleteOld2FAThreads()
 *     - _pickNewestByDate_(threads)
 *     - _pickNewestMatchingSubject_(threads, targetSubject)
 *     - buildTrackingQuery(labelName, fromAddress, phrases, opts)
 *     - getCandidateThreadsVerbose(label, lookbackDays, pickLimit)
 *     - resolveVendorThreadIdForInvoice_(input)
 *    Text / Header Utilities
 *       - canonHeader_(s)
 *       - _norm_(s), _digits_(s), _naish_(s), invoiceDigits_(v)
 *       - findHeaderIndex(headerRow, spec, options)
 *       - _colLetter_(colIndex)
 *       - buildGmailSearchUrl_(phone, invoice, email)
 *       - _buildCallSigFromInput_(receiverText, p)
 * Constants/Globals DEFINED here (when absent)
 *   - GmailU (frozen-like helper object)
 *   - Log (fallback logger: info/warn/error)               // only if not already defined
 *   - _cache_() → CacheService.getScriptCache() wrapper    // only if not already defined
 *
 * Globals/Constants USED from other modules (must exist)
 *   - CONFIG.OCR.{MAX_RETRIES, COOLDOWN_MS, CACHE}
 *   - CONFIG.LABELS.TWO_FA
 *   - CONFIG.LABELS.EX_FWD (preferred vendor PO label for search scope)
 *   - CONFIG.VENDORS[0].labelSource (optional fallback scope)
 *   - RE.SO_NAME  // RegExp for Sales Order PDF filenames
 *   - getExtruflexPOThreadId(text)  // external resolver used by resolveVendorThreadIdForInvoice_()
 *     - NA_REGEX
 * Helper services & requirements
 *   - GmailApp, CacheService, Utilities, DocumentApp
 *   - Advanced Google Services: Drive API v2 (Drive.Files) must be enabled for OCR conversion
 *   - Side effects:
 *       • Gmail: reads threads; deleteOld2FAThreads() moves threads to Trash
 *       • Drive: creates & deletes a temporary Google Doc for OCR
 *       • Sheets: ensureDateTimeFormats_() sets number formats on target ranges
 *
 * Notes
 *   - Date parsers accept numeric serials (guarded range), D/M/Y or M/D/Y, **strict** YYYYMMDD, and month tokens
 *     (short & long; e.g., "27 Sep", "September 27"). Text like "pending/week/delay" returns 'DELAYED' where supported.
 *   - resolveTimestamp_() safely combines date-only and time-only values (handles 1899/1900 “time carrier” dates).
 *   - OCR is cached by file content hash (MD5) to avoid repeated Drive OCR work.
 *
 * Last updated: 2025-11-04
 * ============================================================================ */

/** Date& Time */

/** Month token → number (supports "sept") */
function _monTokenToNum_(tok) {
  const t = String(tok || '').trim().toLowerCase();
  const map = {
    jan: 1, january: 1,
    feb: 2, february: 2,
    mar: 3, march: 3,
    apr: 4, april: 4,
    may: 5,
    jun: 6, june: 6,
    jul: 7, july: 7,
    aug: 8, august: 8,
    sep: 9, sept: 9, september: 9,
    oct: 10, october: 10,
    nov: 11, november: 11,
    dec: 12, december: 12
  };

  return map[t] || null;
}

function _daysInMonth_(y, m) { return new Date(y, m, 0).getDate(); }

/** Excel serial → Date (Apps Script/Sheets use 1899-12-31 base) */
function _excelSerialToDate_(n) {
  const num = Number(n);
  if (!isFinite(num) || num < 40000 || num > 80000) return null;
  const ms = Math.round((num - 25569) * 86400000);
  const d = new Date(ms);
  return isNaN(d) ? null : d;

}

/**
 * Compose a Date for month/day with no explicit year:
 * - Use CURRENT YEAR (or next year for Dec→Jan crossover).
 */
function _composeSameYear_(m, d, today) {
  const now = today || new Date();
  const curM = now.getMonth() + 1;
  const year = (curM === 12 && m === 1) ? (now.getFullYear() + 1) : now.getFullYear();
  const day = Math.min(Math.max(1, d | 0), _daysInMonth_(year, m));
  return new Date(year, m - 1, day);
}

/**
 * STRICT normalizer for Revised Ship Date:
 * 1) Date object → return that exact date (strip time).
 * 2) Plausible Excel serial (>= 40000 and <= 80000) → exact date.
 * 3) Full dd/mm/yyyy (or mm/dd/yyyy) → exact date preserving year.
 * 4) dd/mm/##### “glitch” → treat ##### as junk; keep dd/mm with current-year policy.
 * 5) "27 Aug" / "Aug 27" → current-year policy.
 * 6) Otherwise try native Date; else null.
 * Also treats “delay/pending/week” as DELAYED.
 */
function _normalizeRevDate_(raw) {
  if (raw == null || raw === '') return null;

  const sMaybe = (typeof raw === 'string') ? raw.trim() : '';
  if (sMaybe && /week|delay|pend/i.test(sMaybe)) return 'DELAYED';

  if (raw instanceof Date && !isNaN(raw)) {
    return new Date(raw.getFullYear(), raw.getMonth(), raw.getDate());
  }

  // Excel serial (plausible range only)
  if (typeof raw === 'number' && isFinite(raw)) {
    // Accept 8-digit YYYYMMDD numbers as well
    if (raw >= 19000101 && raw <= 21991231 && String(Math.floor(raw)).length === 8) {
      const s = String(Math.floor(raw));
      const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
      const dt = new Date(y, m - 1, d);
      return isNaN(dt) ? null : new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }
    if (raw >= 40000 && raw <= 80000) {
      const ms = Math.round((raw - 25569) * 86400000);
      const d = new Date(ms);
      return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return null;
  }

  const s = sMaybe;
  if (!s) return null;

  // dd/mm/yyyy or mm/dd/yyyy
  let m = s.match(/^(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{2,4})\b/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += (y >= 70 ? 1900 : 2000);
    let dd, mm;
    if (a > 12 && b <= 12) { dd = a; mm = b; } else if (b > 12 && a <= 12) { dd = b; mm = a; } else { dd = a; mm = b; }
    return new Date(y, mm - 1, dd);
  }

  // >>> ADD THIS: strict YYYYMMDD text <<<
  m = s.match(/^\d{8}$/);
  if (m) {
    const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8);
    const dt = new Date(y, mo - 1, d);
    return isNaN(dt) ? null : new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());

  }

  // dd/mm/##### glitch → current-year policy
  m = s.match(/^(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{5})\b/);
  if (m) {
    const dd = +m[1], mm = +m[2];
    return _composeSameYear_(mm, dd, new Date());
  }

  // e.g., "27 Aug", "Aug 27"
  m = s.match(/^(\d{1,2})\s+([A-Za-z]{3,})\b/);
  if (m) { const mo = _monTokenToNum_(m[2]); if (mo) return _composeSameYear_(mo, +m[1], new Date()); }
  m = s.match(/^([A-Za-z]{3,})\s+(\d{1,2})\b/);
  if (m) { const mo = _monTokenToNum_(m[1]); if (mo) return _composeSameYear_(mo, +m[2], new Date()); }

  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function _toDateFlex_(v, allowDelayed) {
  if (v == null || v === '') return null;
  if (v instanceof Date && !isNaN(v)) return new Date(v.getFullYear(), v.getMonth(), v.getDate());

  if (typeof v === 'number' && isFinite(v)) {
    if (v >= 19000101 && v <= 21991231 && String(Math.floor(v)).length === 8) {
      const s = String(Math.floor(v));
      const y = +s.slice(0, 4), m = +s.slice(4, 6), d = +s.slice(6, 8);
      const dt = new Date(y, m - 1, d);
      return isNaN(dt) ? null : new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());
    }
    if (v >= 40000 && v <= 80000) {
      const ms = Math.round((v - 25569) * 86400000);
      const d = new Date(ms);
      return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
    }
    return null;
  }

  const s = String(v).trim();
  if (!s) return null;
  if (allowDelayed && /week|delay|pend/i.test(s)) return 'DELAYED';

  // dd/mm/yyyy or mm/dd/yyyy
  let m = s.match(/^(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{2,4})\b/);
  if (m) {
    let a = +m[1], b = +m[2], y = +m[3];
    if (y < 100) y += (y >= 70 ? 1900 : 2000);
    let dd, mm;
    if (a > 12 && b <= 12) { dd = a; mm = b; } else if (b > 12 && a <= 12) { dd = b; mm = a; } else { dd = a; mm = b; }
    return new Date(y, mm - 1, dd);
  }

  // >>> ADD THIS: strict YYYYMMDD text <<<
  if (/^\d{8}$/.test(s)) {
    const y = +s.slice(0, 4), mo = +s.slice(4, 6), d = +s.slice(6, 8);
    const dt = new Date(y, mo - 1, d);
    return isNaN(dt) ? null : new Date(dt.getFullYear(), dt.getMonth(), dt.getDate());

  }

  // dd/mm/##### glitch → current year policy
  m = s.match(/^(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{5})\b/);
  if (m) {
    const dd = +m[1], mm = +m[2];
    return _composeSameYear_(mm, dd, new Date());
  }

  const d = new Date(s);
  return isNaN(d) ? null : new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function parseDMY(str) {
  if (typeof str !== 'string') return null;
  const m = str.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  return new Date(+m[3], +m[2] - 1, +m[1]);
}

function _parseDMYLoose_(s) {
  const m = String(s).trim().match(/^(\d{1,2})[\/\-\.\s](\d{1,2})[\/\-\.\s](\d{2,5})(?:\b.*)?$/);
  if (!m) return null;
  const d = +m[1], mo = +m[2], yRaw = +m[3];
  // "Year" looks like an Excel serial → convert via serial.
  if (yRaw >= 40000) {
    const ms = Math.round((yRaw - 25569) * 86400000);
    const dt = new Date(ms);
    return isNaN(dt) ? null : dt;
  }
  let y = yRaw;
  if (y < 100) y += (y >= 70 ? 1900 : 2000);
  const dt = new Date(y, mo - 1, d);
  return isNaN(dt) ? null : dt;
}

/**
 * General date parser used elsewhere (e.g., Allocation Date).
 * Now guarded so small integers aren’t misread as serials.
 * If allowDelayed === true, returns 'DELAYED' for “delay/week/pending”.
 */
function _fallbackSameYearDate_() {
  const now = new Date();
  const curM = now.getMonth() + 1;
  const nextM = (curM === 12 ? 1 : curM + 1);
  const year = (curM === 12 ? now.getFullYear() + 1 : now.getFullYear());
  return new Date(year, nextM - 1, 1); // 1st day of next month
}

function resolveTimestamp_(aVal, bVal) {
  // If B is a Date
  if (bVal instanceof Date && !isNaN(bVal)) {
    const hasTime = isDateAtMidnightWithTime(bVal); // true if any time component
    // Sheets often stores "time only" with a year like 1899/1900; combine with A in that case.
    if (bVal.getFullYear() < 1905 && aVal instanceof Date && !isNaN(aVal) && hasTime) {
      return combineDateAndTime_(aVal, bVal);
    }
    // Otherwise, B is good as-is (already full date-time or date only)
    return new Date(bVal);
  }

  // If B is numeric fraction of a day (0..1)
  if (typeof bVal === 'number' && isFinite(bVal)) {
    if (aVal instanceof Date && !isNaN(aVal) && bVal >= 0 && bVal < 1) {
      const base = new Date(aVal);
      base.setHours(0, 0, 0, 0);
      const ms = Math.round(bVal * 24 * 60 * 60 * 1000);
      return new Date(base.getTime() + ms);
    }
    return null;
  }

  // If B is a time string
  if (typeof bVal === 'string' && bVal.trim()) {
    const t = parseTimeString_(bVal.trim());
    if (!t) return null;
    if (aVal instanceof Date && !isNaN(aVal)) {
      const d = new Date(aVal);
      d.setHours(t.h, t.m, t.s || 0, 0);
      return d;
    }
    return null;
  }

  return null;
}

function toDate(val) {
  if (!val) return '';
  const parts = String(val).trim().split('/');
  if (parts.length !== 3) return '';
  const [aStr, bStr, cStr] = parts;
  const a = +aStr, b = +bStr, c = +cStr;
  const yy = cStr.length === 2 ? 2000 + c : c;
  let dd, mm;
  if (a > 12 && b <= 12) { dd = a; mm = b; }
  else if (b > 12 && a <= 12) { dd = b; mm = a; }
  else { dd = a; mm = b; }
  const d = new Date(yy, mm - 1, dd);
  return isNaN(d) ? '' : d;
}

function toMMDDYY(str) {
  if (!str) return '';
  const m = str.match(/^(\d{2})\/(\d{2})\/(\d{2})$/);
  if (!m) return str;
  const d = +m[1], mo = +m[2];
  if (d > 12 && mo <= 12) return `${m[2]}/${m[1]}/${m[3]}`; // DD/MM → MM/DD
  if (mo > 12) return str;                                   // already MM/DD
  return `${m[2]}/${m[1]}/${m[3]}`;                           // default DD/MM
}

function combineDateAndTime_(dateOnly, timeOnly) {
  const d = new Date(dateOnly);
  d.setHours(timeOnly.getHours(), timeOnly.getMinutes(), timeOnly.getSeconds(), timeOnly.getMilliseconds());
  return d;
}

function parseTimeString_(s) {
  const m = s.match(/^\s*(\d{1,2})(?::(\d{2}))?(?::(\d{2}))?\s*(([APap][Mm])|[APap])?\s*$/);
  if (!m) return null;
  let h = parseInt(m[1], 10);
  const min = m[2] ? parseInt(m[2], 10) : 0;
  const sec = m[3] ? parseInt(m[3], 10) : 0;
  const mer = m[4];
  if (mer) {
    const u = mer.toUpperCase();
    const isPM = (u === 'PM' || u === 'P');
    if (h === 12) h = isPM ? 12 : 0;
    else if (isPM) h += 12;
  }
  if (h < 0 || h > 23 || min < 0 || min > 59 || sec < 0 || sec > 59) return null;
  return { h, m: min, s: sec };
}

if (typeof hasTimeComponent_ !== 'function') {
  function hasTimeComponent_(d) { return isDateAtMidnightWithTime(d); }
}

function isDateAtMidnightWithTime(d) {
  return d instanceof Date && !isNaN(d) && d.getHours() + d.getMinutes() + d.getSeconds() + d.getMilliseconds() > 0;
}

function parseDateTime_(dateVal, timeVal) {
  // Handle actual Date objects
  if (dateVal instanceof Date) {
    const d = new Date(dateVal.getTime());
    if (timeVal instanceof Date) {
      d.setHours(timeVal.getHours(), timeVal.getMinutes(), timeVal.getSeconds(), 0);
    } else if (typeof timeVal === 'number') {
      // Time as Excel fraction (rare in Sheets)
      const ms = Math.round(24 * 60 * 60 * 1000 * timeVal);
      d.setHours(0, 0, 0, 0);
      d.setTime(d.getTime() + ms);
    } else if (typeof timeVal === 'string' && timeVal) {
      const t = timeVal.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (t) d.setHours(+t[1], +t[2], +(t[3] || 0), 0);
    }
    return d;
  }

  // String date parsing: try DD/MM/YYYY then MM/DD/YYYY
  const s = safeStr_(dateVal);
  if (!s) return null;
  let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (!m) return null;

  let dd = +m[1], mm = +m[2], yy = +m[3];
  if (mm > 12 && dd <= 12) { // if swapped
    [dd, mm] = [mm, dd];
  }
  const d = new Date(yy, mm - 1, dd);
  if (timeVal) {
    if (timeVal instanceof Date) d.setHours(timeVal.getHours(), timeVal.getMinutes(), timeVal.getSeconds(), 0);
    else if (typeof timeVal === 'string') {
      const t = timeVal.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?/);
      if (t) d.setHours(+t[1], +t[2], +(t[3] || 0), 0);
    }
  }
  return d;
}

function toDateOnly_(d) {
  if (!(d instanceof Date) || isNaN(d)) return '';
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

function addDays_(d, n) {
  const x = new Date(d.getTime());
  x.setDate(x.getDate() + n);
  return x;
}

function ensureDateTimeFormats_(sheet) {
  // Show date as dd/MM/yyyy and time as HH:mm:ss
  const lastRow = sheet.getLastRow();
  const numRows = Math.max(0, lastRow - 1); // data rows below header
  if (numRows > 0) {
    sheet.getRange(2, 1, numRows, 1).setNumberFormat('dd/MM/yyyy'); // A
    sheet.getRange(2, 2, numRows, 1).setNumberFormat('HH:mm:ss');    // B
    sheet.getRange(2, 14, numRows, 1).setNumberFormat('dd/MM/yyyy');  // N (Follow-up)
    sheet.getRange(2, 18, numRows, 1).setNumberFormat('HH:mm:ss');    // R (Earliest time)
  }

}

/** Phone */
function _rowStateKey_(key) { return 'CI_ROW_STATE:' + key; }
function _getRowState_(key) {
  try { const j = _cache_().get(_rowStateKey_(key)); return j ? JSON.parse(j) : null; } catch (_) { return null; }
}
function _setRowState_(key, obj, ttlSec) {
  try { _cache_().put(_rowStateKey_(key), JSON.stringify(obj || {}), Math.max(10, ttlSec || 600)); } catch (_) { }
}
function _digitsOnly_(s) { return String(s == null ? '' : s).replace(/\D+/g, ''); }

function isDigitsOnly_(val) {
  const s = String(val ?? '').trim();
  return s.length > 0 && /^\d+$/.test(s);
}

function normalizePhone10_(v) {
  const d = String(v == null ? '' : v).replace(/\D+/g, '');
  if (d.length === 11 && d.startsWith('1')) return d.slice(1);
  if (d.length === 10) return d;
  return ''; // invalid; skip
}

function normalizePhone_(v) {
  const d = String(v || '').replace(/[^\d]/g, '');
  // Strip leading 1 for NANP-style 11-digit numbers
  return (d.length === 11 && d.startsWith('1')) ? d.slice(1) : d;
}

function canonLocal_(s) {
  return String(s || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

/** Email */

function isValidEmail_(val) {
  if (!val) return false;
  const s = String(val).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s);
}

function ocrPdf(blob, lang) {
  const { MAX_RETRIES, COOLDOWN_MS, CACHE } = CONFIG.OCR; // assumes CONFIG.OCR exists
  const md5 = Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, blob.getBytes())
  );
  const key = `ocr:${md5}`;
  const cache = CacheService.getScriptCache();

  if (CACHE) {
    const hit = cache.get(key);
    if (hit) return hit;
  }

  let delay = 0;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (delay) Utilities.sleep(delay);
    try {
      // Advanced Drive v2: force conversion to Google Doc + OCR so DocumentApp works
      const file = Drive.Files.insert(
        { title: blob.getName(), mimeType: 'application/vnd.google-apps.document' },
        blob,
        {
          ocr: true,
          ocrLanguage: lang || 'en',
          supportsAllDrives: true,
          fields: 'id'
        }
      );

      const txt = DocumentApp.openById(file.id).getBody().getText();
      try { Drive.Files.remove(file.id); } catch (delErr) { Log && Log.warn ? Log.warn('Drive delete failed (ignored): %s', delErr) : null; }
      if (CACHE) cache.put(key, txt, 86400);
      if (COOLDOWN_MS) Utilities.sleep(COOLDOWN_MS);
      return txt;

    } catch (e) {
      // retry only on rate-limit style errors; otherwise surface immediately
      if (!/rate ?limit|userRateLimitExceeded|quota/i.test(e.message) || attempt === MAX_RETRIES) throw e;
      delay = (1 << attempt) * 1000 + Math.random() * 500; // backoff + jitter
      if (typeof Log !== 'undefined' && Log.warn) Log.warn('OCR rate-limit; retry %d in %ds', attempt, Math.round(delay / 1000));
    }
  }
}

/** Other */

function safeStr_(v) { return (v == null) ? '' : String(v).trim(); }

function pickRandom_(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

function _isTruthyBoolean(v) {
  if (v === true) return true;
  if (typeof v === 'string') return v.trim().toLowerCase() === 'true';
  if (typeof v === 'number') return v === 1;
  return false;
}


/** Guarded define to avoid accidental duplicate definitions */
if (typeof safeCell !== 'function') {
  function safeCell(row, i) {
    return (row && Number.isInteger(i) && i >= 0 && i < row.length) ? row[i] : '';
  }
}

/**
 * Accepts Date | Excel-serial Number | "MM/DD/YY|YYYY" | ISO-ish text.
 * Returns Date or '' (so Sheets writes a blank when unknown).
 */
if (typeof normalizeDateLoose !== 'function') {
  function normalizeDateLoose(v) {
    if (!v) return '';
    if (v instanceof Date && !isNaN(v)) return v;

    if (typeof v === 'number' && isFinite(v)) {
      // Guard: accept only plausible Excel serials (roughly 2009–2191 here)
      if (v >= 40000 && v <= 80000) {
        return new Date(Math.round((v - 25569) * 86400000));
      }
      return '';
    }

    if (typeof v === 'string') {
      const s = v.trim();
      if (!s) return '';

      // MM/DD/YY or MM/DD/YYYY
      let m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
      if (m) {
        const mm = +m[1], dd = +m[2], yy = m[3].length === 2 ? 2000 + (+m[3]) : +m[3];
        const d = new Date(yy, mm - 1, dd);
        return isNaN(d) ? '' : d;
      }

      // 8-digit YYYYMMDD
      m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
      if (m) {
        const d = new Date(+m[1], +m[2] - 1, +m[3]);
        return isNaN(d) ? '' : d;
      }

      // Last resort: Date parser
      const d2 = new Date(s);
      return isNaN(d2) ? '' : d2;
    }

    return '';
  }
}

/** Back-compat alias so existing vendor code keeps working */
if (typeof normalizeSingerDate !== 'function') {
  function normalizeSingerDate(v) { return normalizeDateLoose(v); }
}

if (typeof Log === 'undefined') {
  // Respect global Log (from 00 Globals.gs); add a safe alias if needed.
  if (typeof Log !== 'undefined') {
    if (!Log.error && Log.err) {
      Log.error = function (...args) { return Log.err.apply(Log, args); };
    }
  } else {
    // Fallback no-op logger (only if Globals didn’t define Log)
    var Log = {
      info: function () { },
      warn: function () { },
      err: function () { },
      error: function (...args) { return this.err.apply(this, args); }
    };
  }

}
if (typeof _cache_ !== 'function') {
  function _cache_() { return CacheService.getScriptCache(); }
}

/** ---------------------------------
 *  GMAIL UTILS
 * ----------------------------------*/
const GmailU = {
  getOrCreateLabel(name) {
    return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  },
  /** Build a safer query with lookback */
  queryWithLookback(labelName, days) {
    // newer_than uses days only (no hours). Escaping for quotes handled by wrapping in quotes.
    const escaped = String(labelName || '').replace(/"/g, '\\"');
    return `label:"${escaped}" newer_than:${Math.max(1, days)}d`;

  },
  /** Fetch a limited set of recent threads by label using Gmail search */
  getRecentThreads(labelName, days, max) {
    const q = this.queryWithLookback(labelName, days);
    const threads = GmailApp.search(q, 0, max);
    Log.info(`Query: ${q} → ${threads.length} thread(s)`);
    return threads;
  },
  threadHasLabel(thread, labelName) {
    return thread.getLabels().some(l => l.getName() === labelName);
  },
  newestMessage(thread) {
    const msgs = thread.getMessages() || [];
    return msgs.length ? msgs[msgs.length - 1] : null;
  }
};

/** ---------------------------------
 *  2FA cleanup
 * ----------------------------------*/
function deleteOld2FAThreads() {
  const label = GmailApp.getUserLabelByName(CONFIG.LABELS.TWO_FA);
  if (!label) { Log.error(`Label "${CONFIG.LABELS.TWO_FA}" not found`); return; }

  const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
  const threads = label.getThreads(0, 50);
  const toTrash = [];

  threads.forEach(thread => {
    const latest = GmailU.newestMessage(thread);
    if (!latest) return;
    if (latest.getDate() < sixMinutesAgo) toTrash.push(thread);
  });

  if (toTrash.length) GmailApp.moveThreadsToTrash(toTrash);
  Log.info(`2FA cleanup: trashed ${toTrash.length} thread(s).`);
}

/** ---------------------------------
 *  Thread Utils
 * ----------------------------------*/
function _pickNewestByDate_(threads) {
  let newest = null, best = -1;
  for (const th of threads) {
    const ts = th.getLastMessageDate()?.getTime?.() || 0;
    if (ts > best) { best = ts; newest = th; }
  }
  return newest || (threads?.[0] || null);
}

function _pickNewestMatchingSubject_(threads, targetSubject) {
  let best = null, bestTs = -1;
  for (const th of threads) {
    const subj = (th.getFirstMessageSubject?.() || '').trim().toLowerCase();
    if (subj === String(targetSubject || '').trim().toLowerCase()) {
      const ts = th.getLastMessageDate()?.getTime?.() || 0;
      if (ts > bestTs) { bestTs = ts; best = th; }
    }
  }
  return best;
}

function buildTrackingQuery(labelName, fromAddress, phrases, opts) {
  const opt = Object.assign({ requireMarker: true }, opts || {});

  const normalizeQuotes = s =>
    String(s || '')
      .replace(/[“”]/g, '"')
      .replace(/[‘’]/g, "'")
      .trim();

  const escapedLabel = String(labelName || '').replace(/"/g, '\\"');
  const base = [`label:"${escapedLabel}"`];

  if (fromAddress) base.push(`from:${fromAddress}`);

  let orBlock = '';
  const list = (phrases || [])
    .map(p => normalizeQuotes(p))
    .filter(Boolean);

  if (list.length) {
    orBlock = '(' + list.map(p => `"${p.replace(/"/g, '\\"')}"`).join(' OR ') + ')';
  }

  const marker = '("Tracking Number(s):" OR "Tracking Number:" OR "Tracking:")';

  // Assemble parts
  const parts = [base.join(' ')];
  if (opt.requireMarker) {
    if (orBlock) parts.push(`(${marker} AND ${orBlock})`);
    else parts.push(marker);
  } else if (orBlock) {
    parts.push(orBlock);
  }

  return parts.join(' ').trim();
}

function getCandidateThreadsVerbose(label, lookbackDays, pickLimit) {
  const MS = 24 * 60 * 60 * 1000, cut = Date.now() - lookbackDays * MS;
  const scanCap = Math.min(200, Math.max(50, (pickLimit || 10) * 6)); // headroom for lookback filtering
  const raw = label.getThreads(0, scanCap); // newest first
  Log.info(`[confirmExtruflexPOs] label scanCap=${scanCap} threads=${raw.length} (lookback ${lookbackDays}d)`);

  const out = [];
  raw.forEach((th, idx) => {
    const last = th.getLastMessageDate();
    const tooOld = last.getTime() < cut;
    if (tooOld) return;

    // Consider SO PDFs by filename (not MIME alone)
    const hasSO = th.getMessages().some(m =>
      m.getAttachments().some(a => {
        const nm = (a.getName() || '').trim();
        return /\.pdf$/i.test(nm) && RE.SO_NAME.test(nm);
      })
    );

    Log.info(`  • [${idx + 1}] "${th.getFirstMessageSubject()}" last=${last} hasSO=${hasSO}`);
    if (hasSO) out.push(th);
  });

  Log.info(`[confirmExtruflexPOs] candidates with SO: ${out.length} (pick ≤ ${pickLimit})`);
  return out.slice(0, pickLimit);
}

function resolveVendorThreadIdForInvoice_(input) {
  const LOG = '[resolveVendorThreadIdForInvoice_] ';
  const raw = String(input || '').trim();
  if (!raw) return null;

  // 1) As-is
  try {
    const t1 = getExtruflexPOThreadId(raw);
    if (t1) { Log.info(LOG + `resolver(as-is) OK for "${raw}" -> ${t1}`); return t1; }
  } catch (e) { Log.warn(LOG + `resolver(as-is) err for "${raw}": ${e}`); }

  // 2) Prefix "2363-" if raw is digits-only
  const digits = raw.replace(/\D+/g, '');
  if (digits) {
    try {
      const pref = `2363-${digits}`;
      const t2 = getExtruflexPOThreadId(pref);
      if (t2) { Log.info(LOG + `resolver(prefixed) OK for "${pref}" -> ${t2}`); return t2; }
    } catch (e) { Log.warn(LOG + `resolver(prefixed) err for "2363-${digits}": ${e}`); }
  }

  // 3) Gmail fallback search
  try {
    const needle = digits ? `2363-${digits}` : raw;
    // Prefer vendor PO label scope if available; else global search
    const labelName = (CONFIG?.LABELS?.EX_FWD) || (CONFIG?.VENDORS?.[0]?.labelSource) || '';
    let threads = [];
    if (labelName) {
      const lab = GmailApp.getUserLabelByName(labelName);
      if (lab) {
        // scan a reasonable window of labeled threads
        const batch = lab.getThreads(0, 50) || [];
        threads = batch.filter(th => {
          let subj = '';
          try {
            subj = (typeof th.getFirstMessageSubject === 'function')
              ? th.getFirstMessageSubject()
              : (th.getSubject?.() || '');
          } catch (e) { }
          return subj && subj.indexOf(needle) >= 0;
        });

      }
    }
    if (!threads.length) {
      // global fallback (limit to a narrow query)
      threads = GmailApp.search(`subject:"${needle}" newer_than:2y`);
    }
    if (threads && threads.length) {
      const th = threads[0];
      const id = th.getId();
      Log.info(LOG + `gmail fallback OK for "${needle}" -> ${id}`);
      return id;
    }
    Log.warn(LOG + `gmail fallback no match for "${needle}"`);
  } catch (e) {
    Log.warn(LOG + `gmail fallback err: ${e}`);
  }

  return null;
}

if (typeof invoiceDigits_ !== 'function') {
  function invoiceDigits_(v) { return String(v || '').replace(/\D+/g, ''); }
}

function canonHeader_(s) {
  return String(s || '')
    .normalize('NFD')                // split accents
    .replace(/[\u0300-\u036f]/g, '') // strip diacritics
    .replace(/[–—]/g, '-')           // normalize fancy dashes first
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')     // remove punctuation → single spaces
    .trim()
    .replace(/\s+/g, ' ');           // collapse spaces
}

function _naish_(s) {
  const v = String(s == null ? '' : s).trim().toLowerCase();
  return !v || v === 'na_value' || NA_REGEX.test(v);
}

function _norm_(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
function _digits_(s) { return String(s == null ? '' : s).replace(/\D+/g, ''); }

function findHeaderIndex(headerRow, spec, options) {
  const opt = Object.assign({
    base: 0,
    fallback: undefined,       // set below based on base
    prefer: 'left',
    canon: canonHeader_
  }, options || {});
  if (opt.fallback === undefined) opt.fallback = (opt.base === 1 ? 0 : -1);

  // Normalize headers once
  const headers = (headerRow || []).map(h => opt.canon(String(h == null ? '' : h)));

  // Normalize spec into unified shape
  let exact = [], all = [], any = [];
  if (typeof spec === 'string') {
    exact = [spec];
    any = [spec];
  } else if (Array.isArray(spec)) {
    exact = spec.slice();
    any = spec.slice();
  } else if (spec && typeof spec === 'object') {
    exact = (spec.exact || []).slice();
    all = (spec.all || []).map(g => g.slice());
    any = (spec.any || []).slice();
  }

  const canonList = a => a.map(x => opt.canon(String(x || '')));
  exact = canonList(exact);
  any = canonList(any);
  all = all.map(g => canonList(g));

  const range = (opt.prefer === 'right')
    ? ((n) => Array.from({ length: n }, (_, i) => n - 1 - i))
    : ((n) => Array.from({ length: n }, (_, i) => i));

  // 1) Exact matches
  for (const lbl of exact) {
    for (const i of range(headers.length)) {
      if (headers[i] === lbl) return i + opt.base;
    }
  }

  // 2) ALL-tokens groups (first column where a whole group fits)
  for (const grp of all) {
    for (const i of range(headers.length)) {
      const h = headers[i];
      if (grp.every(tok => h.includes(tok))) return i + opt.base;
    }
  }

  // 3) ANY-token/label contains
  for (const i of range(headers.length)) {
    const h = headers[i];
    if (any.some(tok => h.includes(tok))) return i + opt.base;
  }

  return opt.fallback;
}

if (typeof buildGmailSearchUrl_ !== 'function') {
  function buildGmailSearchUrl_(phone, invoice, email) {
    const bits = [];
    const pushQ = s => { s = String(s || '').trim(); if (s) bits.push(`"${s.replace(/"/g, '')}"`); };
    const p10 = (typeof normalizePhone10_ === 'function')
      ? normalizePhone10_(phone)
      : String(phone || '').replace(/\D+/g, '').slice(-10);
    if (p10) pushQ(p10);

    const inv = invoiceDigits_(invoice); if (inv) pushQ(inv);
    if (email) pushQ(email);
    return bits.length ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(bits.join(' OR '))}` : '';
  }
}

function _colLetter_(colIndex) {
  let c = colIndex, s = '';
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

/** Build a canonical signature from CI input payload (+ receiver). */
function _buildCallSigFromInput_(receiverText, p) {
  // Only include meaningful tokens; ignore “n / a” & blanks.
  const phone = _digits_(p.phone);
  const name = _naish_(p.name) ? '' : _norm_(p.name);
  const invoice = _digits_(p.invoice);
  const email = _naish_(p.email) ? '' : _norm_(p.email);
  const status = _naish_(p.status) ? '' : _norm_(p.status);
  const subject = _naish_(p.subject) ? '' : _norm_(p.subject);
  const message = _naish_(p.message) ? '' : _norm_(p.message).slice(0, 160);
  const provided = _naish_(p.provided) ? '' : _norm_(p.provided).slice(0, 120);
  const transfer = _naish_(p.transfer) ? '' : _norm_(p.transfer);
  const recv = _naish_(receiverText) ? '' : _norm_(receiverText);

  // Order matters but keep it short & stable
  return ['ph:' + phone, 'nm:' + name, 'iv:' + invoice, 'em:' + email, 'st:' + status,
  'sj:' + subject, 'ms:' + message, 'pr:' + provided, 'tf:' + transfer, 'rc:' + recv]
    .join('|');
}