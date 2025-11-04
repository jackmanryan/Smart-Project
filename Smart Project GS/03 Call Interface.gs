/** ============================================================================
 * 03 Call Interface
 * ----------------------------------------------------------------------------
 * Optimized Call Interface core logic. This file consolidates and replaces
 * the previous Call Interface implementation with a more performant and
 * maintainable version while preserving the public API surface. It includes
 * critical fixes (duplicate variable shadowing, width clamping, logging
 * consistency, CL row width safety, etc.) and streamlined helpers for
 * readiness checks, debounced autofill, finalization with deduplication,
 * and cached customer lookups. All functions here assume that external
 * constants such as CI_SHEET, CL_SHEET, TRIGGER_COL, CI_COL_START, and
 * ROW_CONFIGS are defined elsewhere (e.g. in 00 Globals.gs).
 */

/* ======================= Customer Index Helpers ======================= */

/**
 * Combined index lookup: wrap the per-invoice index for backward compatibility.
 *
 * Old helpers built separate indexes; consolidated index is preferred now.
 * Use _getCustomerIndices_().byInvoice instead, but keep this as a thin
 * wrapper for code that references _getCustomerInvoiceIndex_ directly.
 *
 * @return {Object} map of invoiceDigits → { phone, name, email }
 */
// Removed duplicate definition of _getCustomerInvoiceIndex_.

/**
 * Customer Database combined index builder (both phone and invoice).
 * Reads the Customer DB sheet once and caches the result for faster lookups.
 *
 * Cache key: 'CUST_IDX_V2'.
 *
 * @return {{byPhone: Object, byInvoice: Object}} maps for phone/invoice.
 */
var __IDX_MEM = null;
function _getCustomerIndices_() {
  if (__IDX_MEM) return __IDX_MEM;
  var cache = _cache_();
  var CK = 'CUST_IDX_V2';
  try {
    var hit = cache.get(CK);
    if (hit) {
      __IDX_MEM = JSON.parse(hit);
      return __IDX_MEM;
    }
  } catch (_) {
    // ignore cache errors, build fresh
  }
  var ss = SpreadsheetApp.getActive();
  var db = ss.getSheetByName(CUSTOMER_DB_SHEET);
  if (!db) return { byPhone: {}, byInvoice: {} };
  var lastRow = db.getLastRow();
  if (lastRow < 2) return { byPhone: {}, byInvoice: {} };
  // Read A..R (1..18) in one call; clamp to sheet width
  var width = Math.min(18, db.getLastColumn());
  var vals = db.getRange(2, 1, lastRow - 1, width).getValues();
  // Column offsets (0‑based), adjust if DB_COL defined
  var OFF = {
    PHONE: (typeof DB_COL !== 'undefined' && DB_COL.PHONE) ? DB_COL.PHONE - 1 : 0,
    NAME: (typeof DB_COL !== 'undefined' && DB_COL.NAME) ? DB_COL.NAME - 1 : 1,
    EMAIL: (typeof DB_COL !== 'undefined' && DB_COL.EMAIL) ? DB_COL.EMAIL - 1 : 2,
    INV: (typeof DB_COL !== 'undefined' && DB_COL.INVOICE) ? DB_COL.INVOICE - 1 : 17
  };
  var byPhone = Object.create(null);
  var byInvoice = Object.create(null);
  for (var i = 0; i < vals.length; i++) {
    var row = vals[i];
    var phoneKey = _norm10_(row[OFF.PHONE] || '');
    var name = _t(row[OFF.NAME]);
    var email = _t(row[OFF.EMAIL]);
    var invDigits = _digits(row[OFF.INV]);
    if (phoneKey) {
      if (!byPhone[phoneKey]) byPhone[phoneKey] = { name: name, email: email, invoice: invDigits };
      else {
        if (!byPhone[phoneKey].name && name) byPhone[phoneKey].name = name;
        if (!byPhone[phoneKey].email && email) byPhone[phoneKey].email = email;
        if (!byPhone[phoneKey].invoice && invDigits) byPhone[phoneKey].invoice = invDigits;
      }
    }
    if (invDigits) {
      if (!byInvoice[invDigits]) byInvoice[invDigits] = { phone: _t(row[OFF.PHONE]), name: name, email: email };
      else {
        if (!byInvoice[invDigits].phone && row[OFF.PHONE]) byInvoice[invDigits].phone = _t(row[OFF.PHONE]);
        if (!byInvoice[invDigits].name && name) byInvoice[invDigits].name = name;
        if (!byInvoice[invDigits].email && email) byInvoice[invDigits].email = email;
      }
    }
  }
  __IDX_MEM = { byPhone: byPhone, byInvoice: byInvoice };
  try {
    cache.put(CK, JSON.stringify(__IDX_MEM), IDX_TTL_SEC);
  } catch (_) {
    // swallow cache put failures silently
  }
  return __IDX_MEM;
}

/* ======================= Call Interface Core ======================= */

// Globals: constants, services, helpers (hoisted & reused)
var DOC_PROPS = PropertiesService.getDocumentProperties();
// Use NA_REGEX from globals if defined; fallback to default
var NA_RE = (typeof NA_REGEX !== 'undefined') ? NA_REGEX : /^(?:n\s*\/?\s*a|na|#n\/a|na_value)$/i;

// Tunables (may override via Document Properties)
var READY_MIN_IDLE_MS = _numProp_('READY_MIN_IDLE_MS', 250);
var READY_STABILITY_MS = _numProp_('READY_STABILITY_MS', 120);
var READY_MAX_WAIT_MS = _numProp_('READY_MAX_WAIT_MS', 400);
var FORCE_RANGE_APPEND = true;
var LOCK_TRY_MS = _numProp_('LOCK_TRY_MS', 800);
var FINALIZE_DO_FLUSH = _boolProp_('FINALIZE_DO_FLUSH', false);
var FINALIZE_SLEEP_MS = _numProp_('FINALIZE_SLEEP_MS', 0);
var DRAFT_SCAN_WINDOW = _numProp_('DRAFT_SCAN_WINDOW', 100);
var BUSY_TTL_MS = _numProp_('BUSY_TTL_MS', Math.max(LOCK_TRY_MS * 12, 12000));
var DEDUPE_WINDOW_MS = _numProp_('DEDUPE_WINDOW_MS', Math.max(LOCK_TRY_MS * 6, 12000));
var NONFINALIZE_LOCK_MS = _numProp_('NONFINALIZE_LOCK_MS', 250);
var FINALIZE_LOCK_MS = _numProp_('FINALIZE_LOCK_MS', 800);
var AUTOFILL_COOLDOWN_MS = _numProp_('AUTOFILL_COOLDOWN_MS', 600);
var BATCH_ONLY_ON_FINALIZE = _boolProp_('BATCH_ONLY_ON_FINALIZE', true);
var FINALIZE_POSTCOMPUTE = _boolProp_('FINALIZE_POSTCOMPUTE', true);
var PER_KEY_CACHE_TTL_SEC = _numProp_('PER_KEY_CACHE_TTL_SEC', 6 * 3600);
var IDX_TTL_SEC = _numProp_('IDX_TTL_SEC', 6 * 3600);

// Helper: numeric property with default
function _numProp_(k, d) {
  var n = Number(DOC_PROPS.getProperty(k) || '');
  return isFinite(n) ? n : d;
}

// Helper: boolean property with default
function _boolProp_(k, d) {
  var p = DOC_PROPS.getProperty(k);
  return p == null ? d : String(p) === '1';
}

// Helper: simple doc cache
function _cache_() {
  return _dcache_();
}

// Tiny canonicalization helpers
function _t(v) {
  return String(v == null ? '' : v).trim();
}
function _isNA(v) {
  return NA_RE.test(_t(v));
}
function _filled(v) {
  var s = _t(v);
  return !!s && !_isNA(s);
}
function _digits(s) {
  return String(s == null ? '' : s).replace(/\D+/g, '');
}
function _phone10(s) {
  var d = _digits(s);
  return d.length >= 10 ? d.slice(-10) : d;
}
function _lower(s) {
  return _t(s).toLowerCase();
}
function _literalize_(val) {
  if (val === '' || val == null) return val;
  var s = String(val);
  var first = s.charAt(0);
  return (first === '+' || first === '-' || first === '=') ? ("'" + s) : s;
}
function _propsGetNum(k) {
  var v = Number(DOC_PROPS.getProperty(k) || 0);
  return isFinite(v) ? v : 0;
}
function _propsSet(k, v) {
  try {
    DOC_PROPS.setProperty(k, String(v));
  } catch (_) {
    // ignore
  }
}
function _propsDel(k) {
  try {
    DOC_PROPS.deleteProperty(k);
  } catch (_) {
    // ignore
  }
}

/* ======================= Readiness + Stability ======================= */

/**
 * Quick readiness probe for a Call Interface row. Checks if the required fields
 * (B: phone, C: name, E: subject, G: message) are present and stable and if
 * enough idle time has passed since the last edit on this key. Uses a
 * minuscule budget to read B..K twice, with a small sleep between reads.
 *
 * @param {Sheet} ciSheet call interface sheet handle
 * @param {number} ciRow 1‑based row index
 * @param {string} key unique key for the row (from ROW_CONFIGS)
 * @return {Object} { ok: true } if ready; { ok: false, reason: string, missing: [cols] }
 */
function _isRowReadyQuick_(ciSheet, ciRow, key) {
  // 1) edit idle window
  if (key) {
    var lastKey = 'CI_LAST_EDIT_MS_' + key;
    var lastMs = _propsGetNum(lastKey);
    var now = Date.now();
    if (lastMs && (now - lastMs) < READY_MIN_IDLE_MS) {
      return { ok: false, reason: 'idle', ageMs: now - lastMs };
    }
  }
  // 2) read B..K once (10 cols) → required B,C,E,G checks
  var v = ciSheet.getRange(ciRow, 2, 1, 10).getValues()[0];
  if (!_filled(v[0]) || !_filled(v[1]) || !_filled(v[3]) || !_filled(v[5])) {
    var miss = [];
    if (!_filled(v[0])) miss.push('B');
    if (!_filled(v[1])) miss.push('C');
    if (!_filled(v[3])) miss.push('E');
    if (!_filled(v[5])) miss.push('G');
    return { ok: false, reason: 'missing', missing: miss };
  }
  // 3) quick stability re‑read (tiny budget)
  var waitMs = Math.min(READY_STABILITY_MS, READY_MAX_WAIT_MS);
  if (waitMs > 0) Utilities.sleep(waitMs);
  var v2 = ciSheet.getRange(ciRow, 2, 1, 10).getValues()[0];
  var stable = (String(v[0]) === String(v2[0]) &&
                String(v[1]) === String(v2[1]) &&
                String(v[3]) === String(v2[3]) &&
                String(v[5]) === String(v2[5]) &&
                String(v[9]) === String(v2[9]));
  return stable ? { ok: true } : { ok: false, reason: 'changing' };
}

/* ======================= Trigger Management ======================= */

/** Disable all onEditInstallable triggers on the project. Useful before re‑installing. */
function disableInstallableOnEdit() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditInstallable') ScriptApp.deleteTrigger(t);
  });
}

/** Ensure exactly one installable onEdit trigger is attached to the active spreadsheet. */
function ensureEditTrigger_() {
  var ssId = SpreadsheetApp.getActive().getId();
  var has = ScriptApp.getProjectTriggers().some(function (t) {
    return t.getHandlerFunction() === 'onEditInstallable' &&
           t.getEventType && t.getEventType() === ScriptApp.EventType.ON_EDIT &&
           t.getTriggerSourceId && t.getTriggerSourceId() === ssId;
  });
  if (!has) {
    ScriptApp.newTrigger('onEditInstallable').forSpreadsheet(ssId).onEdit().create();
    Logger.log('Created installable onEdit → onEditInstallable.');
  }
}

/** Install the onEdit trigger after clearing any existing ones. */
function installOnEditTrigger() {
  disableInstallableOnEdit();
  ensureEditTrigger_();
  Logger.log('✅ Installable onEdit (onEditInstallable) is now installed.');
}

/* ======================= Fast Append Helper ======================= */

/**
 * Append a row to the target sheet (A:Q) using the Advanced Sheets API if available,
 * falling back to Range API if not. Inserts columns as needed to fit the width.
 *
 * @param {string} sheetName name of the destination sheet
 * @param {Array} valuesAtoQ array of values (1D) up to 17 columns
 * @return {number} row index of the appended row
 */
function appendRowFast_(sheetName, valuesAtoQ) {
  var ss = SpreadsheetApp.getActive();
  var ssId = ss.getId();
  var rng = sheetName + '!A:Q';
  if (!FORCE_RANGE_APPEND && typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values) {
    var body = { values: [valuesAtoQ] };
    var params = { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', includeValuesInResponse: true };
    var t0 = Date.now();
    try {
      var res = Sheets.Spreadsheets.Values.append(body, ssId, rng, params);
      if (typeof _diagLite_ === 'function') _diagLite_('write:append-fast', { tookMs: Date.now() - t0 });
      var upd = (res && res.updates && res.updates.updatedRange) || '';
      var m = /![A-Z]+(\d+):/i.exec(upd);
      return m ? parseInt(m[1], 10) : ss.getSheetByName(sheetName).getLastRow();
    } catch (e) {
      // fall through to fallback
    }
  }
  var sh = ss.getSheetByName(sheetName);
  // ensure enough columns for A:Q (17)
  if (sh.getLastColumn() < valuesAtoQ.length) {
    sh.insertColumnsAfter(sh.getLastColumn(), valuesAtoQ.length - sh.getLastColumn());
  }
  var newRow = Math.max(sh.getLastRow() + 1, 2);
  var t1 = Date.now();
  sh.getRange(newRow, 1, 1, Math.min(valuesAtoQ.length, sh.getLastColumn())).setValues([valuesAtoQ]);
  if (typeof _diagLite_ === 'function') _diagLite_('write:append-fallback', { tookMs: Date.now() - t1, row: newRow });
  return newRow;
}

/* ======================= Event Handlers ======================= */

/**
 * Entry point: installable onEdit handler. Handles status edits on CI rows,
 * performs readiness checks, acquires a short lock, and processes the row.
 * Multi-cell pastes and edits outside the trigger column are ignored.
 *
 * @param {Object} e onEdit event
 */
function onEditInstallable(e) {
  var dx = diagStart_('onEditInstallable', {
    hasEvent: !!e,
    sheet: e && e.range && e.range.getSheet && e.range.getSheet().getName(),
    row: e && e.range && e.range.getRow && e.range.getRow(),
    col: e && e.range && e.range.getColumn && e.range.getColumn()
  });
  try {
    if (!e || !e.range) { diagEnd_(dx, 'early:no-event'); return; }
    var sh = e.range.getSheet();
    if (!sh || sh.getName() !== CI_SHEET) { diagEnd_(dx, 'early:wrong-sheet'); return; }
    if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) { diagEnd_(dx, 'early:multi-cell'); return; }
    var row = e.range.getRow();
    var col = e.range.getColumn();
    var cfg = ROW_CONFIGS[row];
    if (!cfg) { diagEnd_(dx, 'early:not-ci-row'); return; }
    var key = cfg.key;
    var receiver = cfg.receiver;
    if (col !== TRIGGER_COL) { diagEnd_(dx, 'early:not-status-col'); return; }
    if (row < TRIGGER_MIN_ROW || row > TRIGGER_MAX_ROW) { diagEnd_(dx, 'early:status-row-outside'); return; }
    var editedValue = (typeof e.value !== 'undefined') ? e.value : e.range.getValue();
    var isDelete = /^delete$/i.test(_t(editedValue));
    if (!_t(editedValue)) { diagEnd_(dx, 'early:blank-status'); return; }
    if (typeof e.oldValue !== 'undefined' && e.oldValue === editedValue) {
      diagTick_(dx, 'skip:same-status'); diagEnd_(dx, 'done'); return;
    }
    // Busy gate: row-level TTL to avoid thrashing
    var BUSY_KEY = 'CL_BUSY_' + key;
    var busyMs = _propsGetNum(BUSY_KEY);
    if (busyMs && (Date.now() - busyMs) < BUSY_TTL_MS) { diagEnd_(dx, 'early:row-busy'); return; }
    if (busyMs) _propsDel(BUSY_KEY); // stale → clear
    // Readiness (quick) — skip for DELETE
    if (!isDelete) {
      var ready = _isRowReadyQuick_(sh, row, key);
      if (!ready.ok) {
        if (ready.reason === 'missing' && ready.missing && ready.missing.length) highlightMissingCI_(sh, row, ready.missing);
        diagEnd_(dx, 'early:not-ready:' + (ready.reason || 'unknown')); return;
      }
    }
    // Acquire short document lock. Try up to 3 times with backoff.
    var lock = LockService.getDocumentLock();
    var got = false;
    var tries = 0;
    var slice = Math.min(200, FINALIZE_LOCK_MS || 200);
    while (!(got = lock.tryLock(slice)) && tries++ < 3) {
      Utilities.sleep(60);
    }
    if (!got) {
      diagEnd_(dx, 'skip:could-not-lock-quickly'); return;
    }
    try {
      processInterfaceRow_(row, receiver, key, col, editedValue);
    } finally {
      try { lock.releaseLock(); } catch (_) {}
    }
  } catch (err) {
    diagError_(dx, err); throw err;
  } finally {
    diagEnd_(dx, 'done');
  }
}

/**
 * Lightweight onEdit handler (simple trigger). Debounces autofill on phone/invoice edits.
 * Only performs autofill on a single-cell edit in CI sheet outside of finalize.
 *
 * @param {Object} e onEdit event
 */
function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (!sh || sh.getName() !== CI_SHEET) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;
  var row = e.range.getRow();
  var col = e.range.getColumn();
  var cfg = ROW_CONFIGS[row];
  if (!cfg) return;
  // Phone edit (B)
  if (col === CI_COL_START) {
    return autoFillCIFromPhone_(sh, row, e.value ?? sh.getRange(row, 2).getValue());
  }
  // Invoice edit (D)
  if (col === CI_COL_START + 2) {
    return autoFillCIFromInvoice_(sh, row, e.value ?? sh.getRange(row, 4).getValue());
  }
}

/* ======================= Row Processing ======================= */

/**
 * Main processor for a CI row. Determines whether the row is finalizing or just editing,
 * performs autofill or finalization accordingly, writes to call log, clears CI row,
 * and handles deduplication and busy logic.
 *
 * @param {number} ciRow row index in CI sheet
 * @param {string} receiverText display label for receiver (from config)
 * @param {string} key unique key for this row
 * @param {number} editedCol column that was edited
 * @param {*} editedValue new value from event
 */
function processInterfaceRow_(ciRow, receiverText, key, editedCol, editedValue) {
  var dx = diagStart_('processInterfaceRow_', { ciRow: ciRow, key: key, editedCol: editedCol });
  var __markBusy = false;
  try {
    var ss = SpreadsheetApp.getActive();
    var ci = ss.getSheetByName(CI_SHEET);
    var cl = ss.getSheetByName(CL_SHEET);
    if (!ci || !cl) { diagTick_(dx, 'early:missing-sheet'); return; }
    // Read B..K snapshot once
    var t0 = Date.now();
    var srcVals = ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).getValues()[0];
    diagTick_(dx, 'read:CIrow', { tookMs: Date.now() - t0 }); diagCount_(dx, 'reads');
    var vB = srcVals[0], vC = srcVals[1], vD = srcVals[2], vE = srcVals[3], vF = srcVals[4],
        vG = srcVals[5], vH = srcVals[6], vI = srcVals[7], vJ = srcVals[8], vK = srcVals[9];
    // If editing K (status), use event value to avoid stale read
    if (editedCol === CI_COL_END && typeof editedValue !== 'undefined') vK = editedValue;
    var statusText = _t(vK);
    var finalizing = statusText.length > 0;
    var isDelete = /^delete$/i.test(statusText);
    // Required gate for finalize (non-delete)
    if (finalizing && !isDelete && !(_filled(vB) && _filled(vC) && _filled(vE) && _filled(vG))) {
      var miss = [];
      if (!_filled(vB)) miss.push('B');
      if (!_filled(vC)) miss.push('C');
      if (!_filled(vE)) miss.push('E');
      if (!_filled(vG)) miss.push('G');
      if (miss.length) {
        highlightMissingCI_(ci, ciRow, miss);
        diagEnd_(dx, 'blocked:missing-on-finalize'); return;
      }
    }
    var nowMs = Date.now();
    var lastKey = 'CI_LAST_EDIT_MS_' + key;
    // Mark busy for finalization
    if (finalizing) { _propsSet('CL_BUSY_' + key, nowMs); __markBusy = true; }
    // Non-finalize path: debounce autofill only
    if (!finalizing) {
      var lastMs = _propsGetNum(lastKey);
      if (lastMs && (nowMs - lastMs) < AUTOFILL_COOLDOWN_MS) {
        diagTick_(dx, 'debounce:autofill-skip', { ageMs: nowMs - lastMs });
        _propsSet(lastKey, nowMs);
        diagEnd_(dx, 'done'); return;
      }
      _propsSet(lastKey, nowMs);
      var likelyPhoneEdit = (editedCol === CI_COL_START);
      var likelyInvoiceEdit = (editedCol === CI_COL_START + 2);
      if (likelyPhoneEdit || (!_filled(vC) && !_filled(vF))) autoFillCIFromPhone_(ci, ciRow, vB);
      if (likelyInvoiceEdit || (!_filled(vB) && !_filled(vC) && !_filled(vF))) autoFillCIFromInvoice_(ci, ciRow, vD);
      // refresh snapshot once (cheap)
      srcVals = ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).getValues()[0];
      vB = srcVals[0]; vC = srcVals[1]; vD = srcVals[2]; vE = srcVals[3]; vF = srcVals[4];
      vG = srcVals[5]; vH = srcVals[6]; vI = srcVals[7]; vJ = srcVals[8];
      vK = (editedCol === CI_COL_END && typeof editedValue !== 'undefined') ? editedValue : srcVals[9];
      diagTick_(dx, 'nonfinalize:autofill-only'); diagEnd_(dx, 'done'); return;
    }
    // Dedupe latch (per key) to prevent double finalizes within window
    var SIG_KEY = 'CL_LAST_SIG_' + key;
    var TS_KEY = 'CL_LAST_TS_' + key;
    var ciSig = [_lower(receiverText), _phone10(vB), _lower(vC), _lower(vF), _lower(vE), _lower(vG)].join('|');
    var prevSig = DOC_PROPS.getProperty(SIG_KEY);
    var prevTs = _propsGetNum(TS_KEY);
    if (prevSig === ciSig && (nowMs - prevTs) < DEDUPE_WINDOW_MS) {
      diagTick_(dx, 'dedupe:skip', { ageMs: nowMs - prevTs }); _propsDel('CL_BUSY_' + key);
      diagEnd_(dx, 'done'); return;
    }
    diagTick_(dx, 'dedupe:ok');
    // Delete path: clear CI row and formats; no log write
    if (isDelete) {
      ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).clearContent();
      resetCIFormats_(ci, ciRow);
      _propsDel('CL_BUSY_' + key);
      diagTick_(dx, 'finalize:deleted'); diagEnd_(dx, 'done'); return;
    }
    // Build Call Log row A..Q (ensure width >= 17)
    var now = new Date();
    var width = (typeof CL_WRITE_WIDTH !== 'undefined' && CL_WRITE_WIDTH) ? CL_WRITE_WIDTH : 17;
    var dest = new Array(width).fill('');
    dest[0] = now; dest[1] = now;               // A: Date, B: Time
    dest[2] = vB;                               // C: Phone
    dest[4] = vC;                               // E: Name
    if (vD != null && vD !== '') {
      var invDigitsOnly = _digits(vD);
      if (invDigitsOnly) dest[5] = invDigitsOnly;
    }
    dest[6] = vF;                               // G: Email
    dest[8] = vK;                               // I: Status
    dest[9] = vE;                               // J: Subject
    dest[11] = vG;                              // L: Message
    dest[12] = vH;                              // M: Provided Info
    if (vJ !== '' && vJ != null && !isNaN(Number(vJ))) {
      var days = Number(vJ);
      var base = new Date();
      dest[13] = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days);
    }
    dest[15] = _literalize_(_t(receiverText)); // P
    dest[16] = _literalize_(vI);               // Q
    // Non-numeric invoice → append to Message
    var hasInvoice = vD !== '' && vD != null;
    if (hasInvoice && !isDigitsOnly_(vD)) {
      var invText = _literalize_(String(vD).trim());
      dest[11] = dest[11] ? (dest[11] + '\n' + invText) : invText;
      if (dest[5] && !isDigitsOnly_(dest[5])) dest[5] = '';
    }
    // Append row
    var tW = Date.now();
    var newRow = appendRowFast_(CL_SHEET, dest);
    diagCount_(dx, 'writes'); diagTick_(dx, 'write:append', { tookMs: Date.now() - tW, newRow: newRow });
    // Clear CI row on success
    ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).clearContent();
    resetCIFormats_(ci, ciRow);
    // Optional postcompute (formatting, formulas) after call log append
    if (FINALIZE_POSTCOMPUTE) {
      try {
        postComputeCallLogRow_(newRow, dest);
      } catch (e) {
        if (!String(e).includes('typed column')) throw e;
        Logger.log('Skipped formatting due to typed column.');
      }
    }
    // Record dedupe latch
    _propsSet(SIG_KEY, ciSig);
    _propsSet(TS_KEY, nowMs);
    if (FINALIZE_DO_FLUSH) SpreadsheetApp.flush();
    if (FINALIZE_SLEEP_MS > 0) Utilities.sleep(FINALIZE_SLEEP_MS);
    Log.info('[processInterfaceRow_] Finalized row ' + newRow + ': CI cleared; key=' + key);
    _propsDel('CL_BUSY_' + key);
  } catch (err) {
    diagError_(dx, err); throw err;
  } finally {
    if (__markBusy) {
      try { _propsDel('CL_BUSY_' + key); } catch (_) {}
    }
    diagEnd_(dx, 'done');
  }
}

/* ======================= Draft Row Helpers ======================= */

/**
 * Get or create a draft row in the Call Log. Draft rows are started upon first
 * edit and reused until finalized or cleared. Uses document properties to
 * remember the row index and timestamp. Repairs pointers if stale.
 *
 * @param {Sheet} cl Call Log sheet handle
 * @param {string} key unique row key
 * @return {number} row index of the draft row
 */
function getOrCreateDraftRow_(cl, key) {
  var dx = diagStart_('getOrCreateDraftRow_', { key: key, sheet: cl ? cl.getName() : '' });
  try {
    if (!cl) throw new Error('getOrCreateDraftRow_: missing Call Log sheet handle');
    var K_ROW = 'CL_DRAFT_ROW_' + key;
    var K_MS = 'CL_DRAFT_MS_' + key;
    var draftRow = parseInt(DOC_PROPS.getProperty(K_ROW) || '', 10);
    var ms = _propsGetNum(K_MS);
    var last = cl.getLastRow();
    // Validate existing pointer
    if (draftRow && ms) {
      var ok = false;
      if (draftRow >= 2 && draftRow <= last) {
        var t = Date.now();
        var aVal = cl.getRange(draftRow, 1).getValue();
        diagCount_(dx, 'reads'); diagTick_(dx, 'validate:existing', { tookMs: Date.now() - t, draftRow: draftRow });
        ok = (aVal instanceof Date) && (aVal.getTime() === ms);
      }
      if (!ok && last >= 2) {
        var window = Math.max(50, DRAFT_SCAN_WINDOW);
        var scanFrom = Math.max(2, last - window + 1);
        var rows = last - scanFrom + 1;
        if (rows > 0) {
          var tScan = Date.now();
          var dates = cl.getRange(scanFrom, 1, rows, 1).getValues();
          diagCount_(dx, 'reads');
          for (var i = 0; i < dates.length; i++) {
            var d = dates[i][0];
            if (d instanceof Date && d.getTime() === ms) {
              draftRow = scanFrom + i;
              _propsSet(K_ROW, draftRow);
              ok = true;
              diagTick_(dx, 'restore:pointer', { tookMs: Date.now() - tScan, draftRow: draftRow, rowsScanned: rows, scanFrom: scanFrom });
              break;
            }
          }
        }
      }
      if (ok) {
        Log.info('[processInterfaceRow_] Reusing draft row ' + draftRow + ' for key ' + key + '.');
        return draftRow;
      }
    }
    // Create new draft at bottom (but never before row 2)
    var tNew = Date.now();
    var newRow = Math.max(last + 1, 2);
    var now = new Date();
    cl.getRange(newRow, 1, 1, 2).setValues([[now, now]]);
    diagCount_(dx, 'writes');
    _propsSet(K_ROW, newRow);
    _propsSet(K_MS, now.getTime());
    diagTick_(dx, 'create:new-draft', { tookMs: Date.now() - tNew, newRow: newRow });
    Log.info('[processInterfaceRow_] Created new draft row ' + newRow + ' for key ' + key + '.');
    return newRow;
  } catch (err) {
    diagError_(dx, err); throw err;
  } finally {
    diagEnd_(dx, 'done');
  }
}

/** Clear the stored draft pointer for the given key and reset CI formats. */
function clearDraft_(key) {
  _propsDel('CL_DRAFT_ROW_' + key);
  _propsDel('CL_DRAFT_MS_' + key);
  try {
    var ciRow = keyToCiRow_(key);
    if (!ciRow) return;
    var ss = SpreadsheetApp.getActive();
    var ci = ss.getSheetByName(CI_SHEET);
    if (!ci) return;
    resetCIFormats_(ci, ciRow);
    Log.info('[clearDraft_] Reset CI formats for row ' + ciRow + ' (key ' + key + ').');
  } catch (err) {
    Log.warn('[clearDraft_] format reset skipped for key ' + key + ': ' + (err && err.stack ? err.stack : err));
  }
}

/** Return the CI row index for a given key from ROW_CONFIGS, or null if absent. */
function keyToCiRow_(key) {
  for (var r in ROW_CONFIGS) {
    if (ROW_CONFIGS[r] && ROW_CONFIGS[r].key === key) return Number(r);
  }
  return null;
}

/** Highlight missing required fields (B,C,E,G) in red. */
function highlightMissingCI_(ciSheet, ciRow, missingColsA1) {
  if (!missingColsA1 || !missingColsA1.length) return;
  ciSheet.getRangeList(missingColsA1.map(function (c) { return c + ciRow; })).setBackground('#ea9999');
}

/** Reset ad-hoc formats on B,C,E,G and wrap the entire input row. */
function resetCIFormats_(ciSheet, ciRow) {
  ciSheet.getRangeList(['B' + ciRow, 'C' + ciRow, 'E' + ciRow, 'G' + ciRow]).clearFormat();
  ciSheet.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
}

/** One-click admin runners for testing. */
function runRow2() { processInterfaceRow_(2, ROW_CONFIGS[2].receiver, ROW_CONFIGS[2].key); }
function runRow3() { processInterfaceRow_(3, ROW_CONFIGS[3].receiver, ROW_CONFIGS[3].key); }
function runRow4() { processInterfaceRow_(4, ROW_CONFIGS[4].receiver, ROW_CONFIGS[4].key); }

/* ======================= Batched Writes ======================= */

/**
 * Batch writes multiple columns in a single row slice. Uses minimal API calls and
 * clamps to the sheet's last column. If only one cell, uses a simple .setValue.
 *
 * @param {Sheet} sh sheet handle
 * @param {number} row row index
 * @param {Array<{ col: number, val: * }>} writes array of column/value pairs
 */
function _writeRowCells_(sh, row, writes) {
  if (!writes || !writes.length) return;
  if (writes.length === 1) {
    sh.getRange(row, writes[0].col).setValue(writes[0].val);
    return;
  }
  var minCol = Math.min.apply(null, writes.map(function (w) { return w.col; }));
  var maxCol = Math.max.apply(null, writes.map(function (w) { return w.col; }));
  var width = maxCol - minCol + 1;
  var rng = sh.getRange(row, minCol, 1, width);
  var vals = rng.getValues();
  for (var i = 0; i < writes.length; i++) {
    var w = writes[i];
    vals[0][w.col - minCol] = w.val;
  }
  rng.setValues(vals);
}

/* ======================= Customer Lookup & Autofill ======================= */

/** Clean customer record fields, stripping NA values and validating email. */
function _cleanCustomerRec_(r) {
  var clean = function (s) {
    var t = _t(s);
    return NA_RE.test(t) ? '' : t;
  };
  var email = clean(r.email);
  return {
    phone: clean(r.phone || r.phoneRaw || ''),
    name: clean(r.name),
    invoice: _t(r.invoice),
    email: (typeof isValidEmail_ === 'function' && email && isValidEmail_(email)) ? email : ''
  };
}

/** Tiny cache helpers for per-key lookups. */
function _cacheGet_(k) {
  try { return _cache_().get(k); } catch (_) { return null; }
}
function _cachePut_(k, v, ttl) {
  try { _cache_().put(k, v, ttl || PER_KEY_CACHE_TTL_SEC); } catch (_) {}
}

/** Normalize to 10 digits; tries custom normalizePhone10_ if defined. */
function _norm10_(v) {
  try { if (typeof normalizePhone10_ === 'function') return normalizePhone10_(v); } catch (_) {}
  return _phone10(v);
}

/** Combined index: expose byPhone and byInvoice lookups. */
// Removed duplicate definition of _getCustomerPhoneIndex_.

/**
 * Find customer record by phone. Uses TextFinder on column A, per-key cache,
 * then combined index fallback. Returns a cleaned record.
 *
 * @param {string} phone raw phone input
 * @return {{ name: string, invoice: string, email: string }} cleaned record
 */
function findCustomerRecordByPhone_(phone) {
  var EMPTY = { name: '', invoice: '', email: '' };
  var q10 = _norm10_(phone);
  if (!q10) return EMPTY;
  // Per-key cache
  var CK = 'CUST_P_' + q10;
  var hit = _cacheGet_(CK);
  if (hit) {
    try { return _cleanCustomerRec_(JSON.parse(hit)); } catch (_) {}
  }
  // TextFinder on column A
  var ss = SpreadsheetApp.getActive();
  var db = ss.getSheetByName(CUSTOMER_DB_SHEET);
  if (db) {
    var lastRow = db.getLastRow();
    if (lastRow >= 2) {
      var A = (typeof DB_COL !== 'undefined' && DB_COL.PHONE) ? DB_COL.PHONE : 1;
      var NAME = (typeof DB_COL !== 'undefined' && DB_COL.NAME) ? DB_COL.NAME : 2;
      var EMAIL = (typeof DB_COL !== 'undefined' && DB_COL.EMAIL) ? DB_COL.EMAIL : 3;
      var INV = (typeof DB_COL !== 'undefined' && DB_COL.INVOICE) ? DB_COL.INVOICE : 18;
      var rng = db.getRange(2, A, lastRow - 1, 1);
      var tf = rng.createTextFinder(q10).useRegularExpression(false).matchEntireCell(true).findNext();
      if (tf) {
        var r = tf.getRow();
        var row = db.getRange(r, 1, 1, Math.max(NAME, EMAIL, INV)).getValues()[0];
        var rec = { phone: q10, name: row[NAME - 1], email: row[EMAIL - 1], invoice: _digits(row[INV - 1]) };
        _cachePut_(CK, JSON.stringify(rec));
        return _cleanCustomerRec_(rec);
      }
    }
  }
  // Fallback to combined index
  var recIdx = _getCustomerIndices_().byPhone[q10];
  if (recIdx) {
    _cachePut_(CK, JSON.stringify(recIdx));
    return _cleanCustomerRec_(recIdx);
  }
  return EMPTY;
}

/**
 * Find customer record by invoice. Uses TextFinder on invoice column, per-key cache,
 * then combined index fallback. Returns a cleaned record.
 *
 * @param {string} invoice raw invoice input
 * @return {{ phone: string, name: string, email: string }} cleaned record
 */
function findCustomerRecordByInvoice_(invoice) {
  var EMPTY = { phone: '', name: '', email: '' };
  var inv = _digits(invoice);
  if (!inv) return EMPTY;
  var CK = 'CUST_I_' + inv;
  var hit = _cacheGet_(CK);
  if (hit) {
    try { return _cleanCustomerRec_(JSON.parse(hit)); } catch (_) {}
  }
  var ss = SpreadsheetApp.getActive();
  var db = ss.getSheetByName(CUSTOMER_DB_SHEET);
  if (db) {
    var lastRow = db.getLastRow();
    if (lastRow >= 2) {
      var INV = (typeof DB_COL !== 'undefined' && DB_COL.INVOICE) ? DB_COL.INVOICE : 18;
      var NAME = (typeof DB_COL !== 'undefined' && DB_COL.NAME) ? DB_COL.NAME : 2;
      var EMAIL = (typeof DB_COL !== 'undefined' && DB_COL.EMAIL) ? DB_COL.EMAIL : 3;
      var PHONE = (typeof DB_COL !== 'undefined' && DB_COL.PHONE) ? DB_COL.PHONE : 1;
      var rng = db.getRange(2, INV, lastRow - 1, 1);
      var tf2 = rng.createTextFinder(inv).useRegularExpression(false).matchEntireCell(true).findNext();
      if (tf2) {
        var r2 = tf2.getRow();
        var row2 = db.getRange(r2, 1, 1, Math.max(PHONE, NAME, EMAIL, INV)).getValues()[0];
        var rec2 = { phone: row2[PHONE - 1], name: row2[NAME - 1], email: row2[EMAIL - 1], invoice: inv };
        _cachePut_(CK, JSON.stringify(rec2));
        return _cleanCustomerRec_(rec2);
      }
    }
  }
  var recIdx2 = _getCustomerIndices_().byInvoice[inv];
  if (recIdx2) {
    _cachePut_(CK, JSON.stringify(recIdx2));
    return _cleanCustomerRec_(recIdx2);
  }
  return EMPTY;
}

/**
 * Autofill CI from phone: writes name/invoice/email if blank and found in DB.
 * Uses debounce state for repeated edits.
 *
 * @param {Sheet} ciSheet CI sheet
 * @param {number} ciRow row index
 * @param {string} phoneVal raw phone
 */
function autoFillCIFromPhone_(ciSheet, ciRow, phoneVal) {
  if (_digits(phoneVal).length < 7) return; // optional early return for short phones
  var rowVals = ciSheet.getRange(ciRow, 2, 1, 6).getValues()[0]; // B..G
  var curName = rowVals[1];
  var curInv = rowVals[2];
  var curEmail = rowVals[4];
  var rec = findCustomerRecordByPhone_(phoneVal);
  var writes = [];
  if (!_filled(curName) && rec.name) writes.push({ col: 3, val: rec.name });
  if (!_t(curInv) && rec.invoice) writes.push({ col: 4, val: rec.invoice });
  if (!_filled(curEmail) && rec.email) writes.push({ col: 6, val: rec.email });
  _writeRowCells_(ciSheet, ciRow, writes);
  var cfg = ROW_CONFIGS[ciRow];
  if (cfg && cfg.key) {
    var p10 = _norm10_(phoneVal);
    _setRowState_(cfg.key, {
      phoneLast: p10,
      rec: {
        phone: String(phoneVal || ''),
        name: rec.name || '',
        invoice: String(rec.invoice || ''),
        email: rec.email || ''
      }
    }, 600);
  }
}

/**
 * Autofill CI from invoice: writes phone/name/email if blank. Uses per-key state
 * to avoid redundant DB hits when same invoice is edited multiple times.
 *
 * @param {Sheet} ciSheet CI sheet
 * @param {number} ciRow row index
 * @param {string} invoiceVal raw invoice
 */
function autoFillCIFromInvoice_(ciSheet, ciRow, invoiceVal) {
  var invDigits = _digits(invoiceVal);
  if (!invDigits) return;
  var key = ROW_CONFIGS[ciRow] && ROW_CONFIGS[ciRow].key;
  var state = key ? _getRowState_(key) : null;
  if (state && state.rec && _digits(state.rec.invoice || '') === invDigits) {
    var rv = ciSheet.getRange(ciRow, 2, 1, 6).getValues()[0];
    var writes = [];
    var phoneFromState = (state.rec && state.rec.phone) || state.phoneLast || '';
    if (!_filled(rv[0]) && phoneFromState) writes.push({ col: 2, val: phoneFromState });
    if (!_filled(rv[1]) && state.rec.name) writes.push({ col: 3, val: state.rec.name });
    if (!_filled(rv[4]) && state.rec.email) writes.push({ col: 6, val: state.rec.email });
    _writeRowCells_(ciSheet, ciRow, writes);
    return;
  }
  var rec3 = findCustomerRecordByInvoice_(invDigits);
  var rowVals2 = ciSheet.getRange(ciRow, 2, 1, 6).getValues()[0];
  var writes2 = [];
  if (!_filled(rowVals2[0]) && rec3.phone) writes2.push({ col: 2, val: _norm10_(rec3.phone) || rec3.phone });
  if (!_filled(rowVals2[1]) && rec3.name) writes2.push({ col: 3, val: rec3.name });
  if (!_filled(rowVals2[4]) && rec3.email) writes2.push({ col: 6, val: rec3.email });
  _writeRowCells_(ciSheet, ciRow, writes2);
  if (key) {
    _setRowState_(key, {
      invoiceLast: invDigits,
      rec: {
        phone: rec3.phone || '',
        name: rec3.name || '',
        email: rec3.email || '',
        invoice: String(invDigits)
      }
    }, 600);
  }
}

/** Sheets UDF wrapper: find by invoice for formulas. */
function FIND_BY_INVOICE(invoice) {
  var rec = findCustomerRecordByInvoice_(invoice);
  return [[rec.phone, rec.name, rec.email]];
}

/** Sheets UDF wrapper: find customer by phone for formulas. */
function FIND_CUSTOMER(phone) {
  var rec = findCustomerRecordByPhone_(phone);
  return [[rec.name, rec.invoice, rec.email]];
}

/* ======================= Dedupe + Admin ======================= */

/**
 * Deduplicate a call sheet by canonical signature. Keeps newest per signature,
 * removes incomplete entries per phone, and collapses duplicate messages.
 *
 * @param {string} sheetName name of sheet ('Call Log' or 'Call Archive')
 * @param {number=} windowRows optional window to scan from bottom; default full
 * @return {number} number of rows deleted
 */
function dedupeCallSheet_(sheetName, windowRows) {
  var sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet "' + sheetName + '" not found');
  var lastRow = sh.getLastRow();
  if (lastRow < 3) return 0;
  var width = Math.min(((typeof CL_WRITE_WIDTH !== 'undefined' && CL_WRITE_WIDTH) ? CL_WRITE_WIDTH : 17), sh.getLastColumn());
  var firstDataRow = 2;
  var start = windowRows ? Math.max(firstDataRow, lastRow - windowRows + 1) : firstDataRow;
  var vals = sh.getRange(start, 1, lastRow - start + 1, width).getValues();
  // normalize phone helper
  var normPhone = function (s) {
    try { if (typeof normalizePhone10_ === 'function') return normalizePhone10_(s); } catch (_) {}
    return _phone10(s);
  };
  var hasValue = function (x) { return _t(x) !== ''; };
  // Precompute rows with signatures and timestamps
  var rows = new Array(vals.length);
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i];
    var r1 = start + i;
    var sig = (typeof _buildCallSigFromRow_ === 'function') ? _buildCallSigFromRow_(v) : JSON.stringify([normPhone(v[2]), _t(v[4]).toLowerCase(), _t(v[9]).toLowerCase()]);
    var a = v[0], b = v[1], ts = 0;
    if (b instanceof Date) ts = b.getTime(); else if (a instanceof Date) ts = a.getTime();
    rows[i] = { r1: r1, v: v, sig: sig, ts: ts };
  }
  // Pass 1: newest per signature
  var keepBySig = new Map();
  var toDelete = new Set();
  for (var j = 0; j < rows.length; j++) {
    var row = rows[j];
    var prev = keepBySig.get(row.sig);
    if (!prev || row.ts >= prev.ts) {
      if (prev) toDelete.add(prev.row);
      keepBySig.set(row.sig, { row: row.r1, ts: row.ts });
    } else {
      toDelete.add(row.r1);
    }
  }
  // Pass 2: within same phone, drop incomplete entries
  var survivors = rows.filter(function (r) { return !toDelete.has(r.r1); });
  var groups = new Map();
  for (var k = 0; k < survivors.length; k++) {
    var s = survivors[k];
    var phoneKey = normPhone(s.v[2]);
    if (!phoneKey) continue;
    if (!groups.has(phoneKey)) groups.set(phoneKey, []);
    groups.get(phoneKey).push(s);
  }
  groups.forEach(function (group) {
    if (group.length <= 1) return;
    var meta = group.map(function (r) {
      var hasName = hasValue(r.v[4]);
      var hasSubj = hasValue(r.v[9]);
      return { row: r, complete: (hasName && hasSubj), score: (hasName ? 1 : 0) + (hasSubj ? 1 : 0) };
    });
    var completes = meta.filter(function (m) { return m.complete; });
    var incompletes = meta.filter(function (m) { return !m.complete; });
    if (completes.length >= 1) {
      incompletes.forEach(function (m) { toDelete.add(m.row.r1); });
    } else {
      var newest = incompletes[0];
      for (var i2 = 1; i2 < incompletes.length; i2++) {
        if (incompletes[i2].row.ts >= newest.row.ts) newest = incompletes[i2];
      }
      incompletes.forEach(function (m) { if (m.row.r1 !== newest.row.r1) toDelete.add(m.row.r1); });
    }
  });
  // Pass 3: duplicate message collapse
  var survivors2 = rows.filter(function (r) { return !toDelete.has(r.r1); });
  var byMsg = new Map();
  var msgKey = function (s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); };
  for (var m2 = 0; m2 < survivors2.length; m2++) {
    var rr = survivors2[m2];
    var key = msgKey(rr.v[11]);
    if (!key) continue;
    if (!byMsg.has(key)) byMsg.set(key, []);
    byMsg.get(key).push(rr);
  }
  var FILL_COLS = [2, 4, 5, 6, 8, 9, 10, 11, 12, 13, 15, 16].filter(function (i) { return i < width; });
  var filledCount = function (vals) {
    var n = 0;
    for (var z = 0; z < FILL_COLS.length; z++) {
      var c = vals[FILL_COLS[z]];
      if (c instanceof Date) n++;
      else if (_t(c) !== '') n++;
    }
    return n;
  };
  byMsg.forEach(function (arr) {
    if (arr.length <= 1) return;
    var best = arr[0];
    var bestScore = filledCount(best.v);
    for (var i3 = 1; i3 < arr.length; i3++) {
      var sc = filledCount(arr[i3].v);
      if (sc > bestScore || (sc === bestScore && arr[i3].ts >= best.ts)) {
        best = arr[i3];
        bestScore = sc;
      }
    }
    arr.forEach(function (r) {
      if (r.r1 !== best.r1) toDelete.add(r.r1);
    });
  });
  var delRows = Array.from(toDelete).map(function (r) { return Math.floor(Number(r)); }).filter(function (r) { return Number.isInteger(r) && r >= 2 && r <= lastRow; });
  if (!delRows.length) return 0;
  delRows = Array.from(new Set(delRows)).sort(function (a, b) { return b - a; });
  for (var d = 0; d < delRows.length; d++) {
    sh.deleteRow(delRows[d]);
  }
  return delRows.length;
}

/** Remove duplicates from both Call Log and Call Archive. */
function sweepCallDuplicates() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var n1 = dedupeCallSheet_('Call Log');
    var n2 = dedupeCallSheet_('Call Archive');
    SpreadsheetApp.flush();
    Logger.log('Dedupe removed ' + n1 + ' (Call Log) and ' + n2 + ' (Call Archive).');
  } finally {
    lock.releaseLock();
  }
}

/** Admin "shake" to clear stuck state, stale busy or dedupe latches, repair draft pointers, and dedupe both sheets. */
function shakeCI() {
  var t0 = Date.now();
  var lock = LockService.getDocumentLock();
  var got = false;
  try {
    got = lock.tryLock(LOCK_TRY_MS);
    if (!got) {
      Logger.log('[shakeCI] skipped: could not acquire lock');
      return;
    }
    var ss = SpreadsheetApp.getActive();
    var ci = ss.getSheetByName(CI_SHEET);
    var cl = ss.getSheetByName(CL_SHEET);
    var DU = Math.max((typeof LOCK_TRY_MS !== 'undefined' ? LOCK_TRY_MS : 700) * 40, 30000);
    var STALE_MS = DU * 2;
    var keys = Object.keys(ROW_CONFIGS || {}).map(function (r) { return ROW_CONFIGS[r] && ROW_CONFIGS[r].key; }).filter(Boolean);
    var clearedBusy = 0, fixedDraft = 0, clearedDraft = 0, clearedDedupe = 0, resetFormats = 0;
    keys.forEach(function (key) {
      var bk = 'CL_BUSY_' + key;
      if (DOC_PROPS.getProperty(bk) != null) {
        _propsDel(bk);
        clearedBusy++;
      }
      var tsKey = 'CL_LAST_TS_' + key;
      var sigKey = 'CL_LAST_SIG_' + key;
      var ts = _propsGetNum(tsKey);
      if (ts && (Date.now() - ts) > STALE_MS) {
        _propsDel(sigKey);
        _propsDel(tsKey);
        clearedDedupe++;
      }
      if (cl) {
        var kRow = 'CL_DRAFT_ROW_' + key;
        var kMs = 'CL_DRAFT_MS_' + key;
        var draftRow = parseInt(DOC_PROPS.getProperty(kRow) || '', 10);
        var ms = _propsGetNum(kMs);
        if (draftRow && ms) {
          var ok = false;
          var last = cl.getLastRow();
          if (draftRow >= 2 && draftRow <= last) {
            var aVal = cl.getRange(draftRow, 1).getValue();
            ok = (aVal instanceof Date) && (aVal.getTime() === ms);
          }
          if (!ok && last >= 2) {
            var dates = cl.getRange(2, 1, last - 1, 1).getValues();
            for (var i = 0; i < dates.length; i++) {
              var d = dates[i][0];
              if (d instanceof Date && d.getTime() === ms) {
                draftRow = i + 2;
                _propsSet(kRow, draftRow);
                ok = true;
                fixedDraft++;
                break;
              }
            }
          }
          if (!ok) {
            _propsDel(kRow);
            _propsDel(kMs);
            clearedDraft++;
          }
        }
      }
      if (ci) {
        var r = keyToCiRow_(key);
        if (r) {
          resetCIFormats_(ci, r);
          resetFormats++;
        }
      }
    });
    try {
      sweepCallDuplicates();
    } catch (e) {
      if (typeof Log !== 'undefined' && Log.warn) {
        Log.warn('[shakeCI] sweepCallDuplicates skipped: ' + (e && e.message ? e.message : e));
      } else {
        Logger.log('[shakeCI] sweepCallDuplicates skipped: ' + (e && e.message ? e.message : e));
      }
    }
    SpreadsheetApp.flush();
    Utilities.sleep(50);
    var msg = '[shakeCI] done in ' + (Date.now() - t0) + 'ms — clearedBusy=' + clearedBusy + ', clearedDraft=' + clearedDraft + ', fixedDraft=' + fixedDraft + ', clearedDedupe=' + clearedDedupe + ', resetFormats=' + resetFormats;
    if (typeof Log !== 'undefined' && Log.info) Log.info(msg); else Logger.log(msg);
    try { ss.toast('Shake complete. See logs for details.'); } catch (_) {}
  } finally {
    if (got) {
      try { lock.releaseLock(); } catch (_) {}
    }
  }
}

/** Keep legacy accessors for backward compatibility. */
function _getCustomerPhoneIndex_() {
  return _getCustomerIndices_().byPhone;
}
function _getCustomerInvoiceIndex_() {
  return _getCustomerIndices_().byInvoice;
}