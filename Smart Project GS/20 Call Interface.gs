/** ============================================================================
 * Call Interface — Consolidated Core
 * ----------------------------------------------------------------------------
 * Purpose
 *   Finalize CI rows into Call Log safely and fast; provide robust autofill
 *   from Customer DB by Phone/Invoice; dedupe utilities; self-heal state; and
 *   minimal lock contention. All public function names preserved.
 *
 * Depends on (from Globals/Utils)
 *   - Sheets:  CI_SHEET, CL_SHEET, CUSTOMER_DB_SHEET
 *   - Layout:  CI_COL_START, CI_COL_END, CL_WRITE_WIDTH
 *   - CI Rows: ROW_CONFIGS (e.g., {2:{key:'R2',receiver:'Front Desk'}, ...})
 *   - Status trigger bounds: TRIGGER_COL, TRIGGER_MIN_ROW, TRIGGER_MAX_ROW
 *   - Utils (if present): Log, _dcache_, diagStart_/diagTick_/diagEnd_/diagError_
 *   - Optional: normalizePhone10_, isValidEmail_, _buildCallSigFromRow_
 *   - Optional: NA_REGEX  (custom NA detector)
 *
 * Document Properties (runtime knobs, optional)
 *   READY_MIN_IDLE_MS, READY_STABILITY_MS, READY_MAX_WAIT_MS
 *   LOCK_TRY_MS, AUTOFILL_COOLDOWN_MS, BUSY_TTL_MS, DEDUPE_WINDOW_MS
 *   FINALIZE_POSTCOMPUTE (1/0), FINALIZE_DO_FLUSH (1/0), FINALIZE_SLEEP_MS
 *   DRAFT_SCAN_WINDOW, PER_KEY_CACHE_TTL_SEC, IDX_TTL_SEC
 *
 * Entry points (safe for menus/triggers)
 *   - installOnEditTrigger()
 *   - disableInstallableOnEdit()
 *   - onEditInstallable(e)      → Status change handler (K on CI)
 *   - onEdit(e)                 → Lightweight autofill while typing
 *   - sweepCallDuplicates()     → Dedupe Call Log & Call Archive
 *   - shakeCI()                 → Clear stuck props, restore pointers, dedupe
 *
 * Sheet UDF helpers (callable from cells)
 *   - FIND_BY_INVOICE(invoice)  → [[phone, name, email]]
 *   - FIND_CUSTOMER(phone)      → [[name, invoice, email]]
 *
 * Functions (in this file)
 *   - _isRowReadyQuick_(ciSheet, ciRow, key)
 *   - installOnEditTrigger(), disableInstallableOnEdit(), ensureEditTrigger_()
 *   - onEditInstallable(e), onEdit(e)
 *   - processInterfaceRow_(ciRow, receiverText, key, editedCol, editedValue)
 *   - appendRowFast_(sheetName, valuesAtoQ)
 *   - getOrCreateDraftRow_(cl, key), clearDraft_(key), keyToCiRow_(key)
 *   - autoFillCIFromPhone_(ciSheet, ciRow, phoneVal)
 *   - autoFillCIFromInvoice_(ciSheet, ciRow, invoiceVal)
 *   - findCustomerRecordByPhone_(phone)
 *   - findCustomerRecordByInvoice_(invoice)
 *   - dedupeCallSheet_(sheetName, windowRows), sweepCallDuplicates(), shakeCI()
 *   - highlightMissingCI_(ciSheet, ciRow, missingColsA1), resetCIFormats_(ciSheet, ciRow)
 *   - _getCustomerIndices_() (combined index; cached)
 *   - _getCustomerPhoneIndex_(), _getCustomerInvoiceIndex_() (compat shims)
 *   - tiny helpers: _numProp_, _boolProp_, _cache_, _t, _filled, _digits, _phone10,
 *                   _lower, _literalize_, _propsGetNum, _propsSet, _propsDel
 * ----------------------------------------------------------------------------
 * Notes
 *   - Uses TextFinder on DB columns first (fast/exact), then a cached combined
 *     index as fallback. Per-key cache prevents repeat DB scans while typing.
 *   - Call Log append guarantees width ≥ 17 (A..Q), even if CL_WRITE_WIDTH is
 *     smaller, to avoid OOB writes when columns are typed.
 *   - Readiness probe double-reads B,C,E,G (+K if available) with tiny delay.
 *   - DELETE status clears the CI row without writing to Call Log.
 * ============================================================================ */

/* ----------------------------- Tunables & Helpers -------------------------- */

var DOC_PROPS = PropertiesService.getDocumentProperties();
var NA_RE = (typeof NA_REGEX !== 'undefined') ? NA_REGEX : /^(?:n\s*\/?\s*a|na|#n\/a|na_value)$/i;

var READY_MIN_IDLE_MS   = _numProp_('READY_MIN_IDLE_MS', 250);
var READY_STABILITY_MS  = _numProp_('READY_STABILITY_MS', 120);
var READY_MAX_WAIT_MS   = _numProp_('READY_MAX_WAIT_MS', 400);

var FORCE_RANGE_APPEND  = true; // set to false to prefer Advanced Service
var LOCK_TRY_MS         = _numProp_('LOCK_TRY_MS', 800);
var FINALIZE_DO_FLUSH   = _boolProp_('FINALIZE_DO_FLUSH', false);
var FINALIZE_SLEEP_MS   = _numProp_('FINALIZE_SLEEP_MS', 0);
var DRAFT_SCAN_WINDOW   = _numProp_('DRAFT_SCAN_WINDOW', 100);
var BUSY_TTL_MS         = _numProp_('BUSY_TTL_MS', Math.max(LOCK_TRY_MS * 12, 60000));
var DEDUPE_WINDOW_MS    = _numProp_('DEDUPE_WINDOW_MS', Math.max(LOCK_TRY_MS * 6, 45000));
var NONFINALIZE_LOCK_MS = _numProp_('NONFINALIZE_LOCK_MS', 250);
var FINALIZE_LOCK_MS    = _numProp_('FINALIZE_LOCK_MS', 800);
var AUTOFILL_COOLDOWN_MS= _numProp_('AUTOFILL_COOLDOWN_MS', 600);
var FINALIZE_POSTCOMPUTE= _boolProp_('FINALIZE_POSTCOMPUTE', true);
var PER_KEY_CACHE_TTL_SEC = _numProp_('PER_KEY_CACHE_TTL_SEC', 6 * 3600);
var IDX_TTL_SEC           = _numProp_('IDX_TTL_SEC', 6 * 3600);

/** property readers */
function _numProp_(k, d) { var n = Number(DOC_PROPS.getProperty(k) || ''); return isFinite(n) ? n : d; }
function _boolProp_(k, d){ var p = DOC_PROPS.getProperty(k); return p == null ? d : String(p) === '1'; }
function _cache_()       { return (typeof _dcache_ === 'function') ? _dcache_() : CacheService.getDocumentCache(); }
function _t(v)           { return String(v == null ? '' : v).trim(); }
function _isNA(v)        { return NA_RE.test(_t(v)); }
function _filled(v)      { var s = _t(v); return !!s && !_isNA(s); }
function _digits(s)      { return String(s == null ? '' : s).replace(/\D+/g, ''); }
function _phone10(s)     { var d = _digits(s); return d.length >= 10 ? d.slice(-10) : d; }
function _lower(s)       { return _t(s).toLowerCase(); }
function _literalize_(val){ if (val === '' || val == null) return val; var s=String(val),c=s.charAt(0); return (c==='+'||c==='-'||c==='=')?("'"+s):s; }
function _propsGetNum(k) { var v = Number(DOC_PROPS.getProperty(k) || 0); return isFinite(v) ? v : 0; }
function _propsSet(k, v) { try { DOC_PROPS.setProperty(k, String(v)); } catch(_){} }
function _propsDel(k)    { try { DOC_PROPS.deleteProperty(k); } catch(_){} }

/* Backstops for optional globals */
if (typeof Log === 'undefined' || !Log || typeof Log.info !== 'function') {
  globalThis.Log = { info: Logger.log, warn: Logger.log, error: Logger.log };
}
if (typeof diagStart_ !== 'function') globalThis.diagStart_ = function(){return{};};
if (typeof diagEnd_   !== 'function') globalThis.diagEnd_   = function(){};
if (typeof diagTick_  !== 'function') globalThis.diagTick_  = function(){};
if (typeof diagCount_ !== 'function') globalThis.diagCount_ = function(){};
if (typeof diagError_ !== 'function') globalThis.diagError_ = function(_ctx,e){Logger.log(e);};
if (typeof isDigitsOnly_ !== 'function') {
  globalThis.isDigitsOnly_ = function (s) { var t=_t(s); return t !== '' && /^\d+$/.test(t); };
}

/* ---------------------------- Readiness / Stability ------------------------ */
function _isRowReadyQuick_(ciSheet, ciRow, key) {
  // 1) quick idle check (avoid racing with autofill)
  if (key) {
    var last = _propsGetNum('CI_LAST_EDIT_MS_' + key);
    var now = Date.now();
    if (last && (now - last) < READY_MIN_IDLE_MS) {
      return { ok: false, reason: 'idle', ageMs: now - last };
    }
  }

  // 2) read B..K (10 cols) and validate B,C,E,G
  var v = ciSheet.getRange(ciRow, 2, 1, 10).getValues()[0]; // B..K
  var miss = [];
  if (!_filled(v[0])) miss.push('B'); // phone
  if (!_filled(v[1])) miss.push('C'); // name
  if (!_filled(v[3])) miss.push('E'); // subject
  if (!_filled(v[5])) miss.push('G'); // message
  if (miss.length) return { ok: false, reason: 'missing', missing: miss };

  // 3) quick re-read for stability
  var waitMs = Math.min(READY_STABILITY_MS, READY_MAX_WAIT_MS);
  if (waitMs > 0) Utilities.sleep(waitMs);
  var v2 = ciSheet.getRange(ciRow, 2, 1, 10).getValues()[0];
  var stable = (
    String(v[0]) === String(v2[0]) && // B
    String(v[1]) === String(v2[1]) && // C
    String(v[3]) === String(v2[3]) && // E
    String(v[5]) === String(v2[5]) && // G
    String(v[9]) === String(v2[9])    // K
  );
  return stable ? { ok: true } : { ok: false, reason: 'changing' };
}

/* ----------------------------- Trigger management ------------------------- */
function disableInstallableOnEdit() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'onEditInstallable') ScriptApp.deleteTrigger(t);
  });
}
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
function installOnEditTrigger() {
  disableInstallableOnEdit();
  ensureEditTrigger_();
  Logger.log('✅ Installable onEdit (onEditInstallable) is now installed.');
}

/* ----------------------------- Fast append helper ------------------------- */
function appendRowFast_(sheetName, valuesAtoQ) {
  var ss = SpreadsheetApp.getActive();
  var ssId = ss.getId();
  var rng = sheetName + '!A:Q';

  // Prefer Advanced Service if allowed
  if (!FORCE_RANGE_APPEND && typeof Sheets !== 'undefined' && Sheets.Spreadsheets && Sheets.Spreadsheets.Values) {
    var body = { values: [valuesAtoQ] };
    var params = { valueInputOption: 'USER_ENTERED', insertDataOption: 'INSERT_ROWS', includeValuesInResponse: true };
    try {
      var t0 = Date.now();
      var res = Sheets.Spreadsheets.Values.append(body, ssId, rng, params);
      if (typeof _diagLite_ === 'function') _diagLite_('write:append-fast', { tookMs: Date.now() - t0 });
      var updatedRange = res && res.updates && res.updates.updatedRange || '';
      var m = /![A-Z]+(\d+):/i.exec(updatedRange);
      return m ? parseInt(m[1], 10) : ss.getSheetByName(sheetName).getLastRow();
    } catch (e) { /* fall through */ }
  }

  // Fallback: Range API
  var sh = ss.getSheetByName(sheetName);
  if (sh.getLastColumn() < valuesAtoQ.length) {
    sh.insertColumnsAfter(sh.getLastColumn(), valuesAtoQ.length - sh.getLastColumn());
  }
  var newRow = Math.max(sh.getLastRow() + 1, 2);
  var t1 = Date.now();
  sh.getRange(newRow, 1, 1, Math.min(valuesAtoQ.length, sh.getLastColumn())).setValues([valuesAtoQ]);
  if (typeof _diagLite_ === 'function') _diagLite_('write:append-fallback', { tookMs: Date.now() - t1, row: newRow });
  return newRow;
}

/* ------------------------------- Event handlers --------------------------- */
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
    var cfg = ROW_CONFIGS[row]; if (!cfg) { diagEnd_(dx, 'early:not-ci-row'); return; }
    var key = cfg.key, receiver = cfg.receiver;

    if (col !== TRIGGER_COL) { diagEnd_(dx, 'early:not-status-col'); return; }
    if (row < TRIGGER_MIN_ROW || row > TRIGGER_MAX_ROW) { diagEnd_(dx, 'early:status-row-outside'); return; }

    var editedValue = (typeof e.value !== 'undefined') ? e.value : e.range.getValue();
    if (!_t(editedValue)) { diagEnd_(dx, 'early:blank-status'); return; }

    // Fast busy gate
    var BUSY_KEY = 'CL_BUSY_' + key;
    var busyMs = _propsGetNum(BUSY_KEY);
    if (busyMs && (Date.now() - busyMs) < BUSY_TTL_MS) { diagEnd_(dx, 'early:row-busy'); return; }
    if (busyMs) _propsDel(BUSY_KEY); // stale → clear

    // Skip readiness for DELETE; otherwise quick probe
    if (!/^delete$/i.test(_t(editedValue))) {
      var ready = _isRowReadyQuick_(sh, row, key);
      if (!ready.ok) {
        if (ready.reason === 'missing' && ready.missing && ready.missing.length) highlightMissingCI_(sh, row, ready.missing);
        diagEnd_(dx, 'early:not-ready:' + (ready.reason || 'unknown')); return;
      }
    }

    // Tiny lock slice
    var lock = LockService.getDocumentLock();
    var got = false, tries = 0, slice = Math.min(200, FINALIZE_LOCK_MS || 200);
    while (!(got = lock.tryLock(slice)) && tries++ < 3) Utilities.sleep(60);
    if (!got) { diagEnd_(dx, 'skip:could-not-lock-quickly'); return; }

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

function onEdit(e) {
  if (!e || !e.range) return;
  var sh = e.range.getSheet();
  if (!sh || sh.getName() !== CI_SHEET) return;
  if (e.range.getNumRows() !== 1 || e.range.getNumColumns() !== 1) return;

  var row = e.range.getRow();
  var col = e.range.getColumn();
  var cfg = ROW_CONFIGS[row]; if (!cfg) return;

  if (col === CI_COL_START)     return autoFillCIFromPhone_(sh, row, (typeof e.value!=='undefined'?e.value:sh.getRange(row,2).getValue()));
  if (col === CI_COL_START + 2) return autoFillCIFromInvoice_(sh, row, (typeof e.value!=='undefined'?e.value:sh.getRange(row,4).getValue()));
}

/* ------------------------------ Finalization core ------------------------- */
function processInterfaceRow_(ciRow, receiverText, key, editedCol, editedValue) {
  var dx = diagStart_('processInterfaceRow_', { ciRow: ciRow, key: key, editedCol: editedCol });
  var __markedBusy = false;

  try {
    var ss = SpreadsheetApp.getActive();
    var ci = ss.getSheetByName(CI_SHEET);
    var cl = ss.getSheetByName(CL_SHEET);
    if (!ci || !cl) { diagTick_(dx, 'early:missing-sheet'); return; }

    // read CI row B..K
    var t0 = Date.now();
    var src = ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).getValues()[0]; // B..K
    diagTick_(dx, 'read:CIrow', { tookMs: Date.now() - t0 }); diagCount_(dx, 'reads');

    var vB = src[0], vC = src[1], vD = src[2], vE = src[3], vF = src[4],
        vG = src[5], vH = src[6], vI = src[7], vJ = src[8], vK = src[9];

    if (editedCol === CI_COL_END && typeof editedValue !== 'undefined') vK = editedValue;
    var statusText = _t(vK);
    var finalizing = statusText.length > 0;
    var isDelete = /^delete$/i.test(statusText);

    // Required fields gate for non-delete finalization
    if (finalizing && !isDelete) {
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
    if (finalizing) { _propsSet('CL_BUSY_' + key, nowMs); __markedBusy = true; }

    // Non-finalize path: debounce autofill only
    if (!finalizing) {
      var lastKey = 'CI_LAST_EDIT_MS_' + key;
      var lastMs = _propsGetNum(lastKey);
      if (lastMs && (nowMs - lastMs) < AUTOFILL_COOLDOWN_MS) {
        diagTick_(dx, 'debounce:autofill-skip', { ageMs: nowMs - lastMs });
        _propsSet(lastKey, nowMs); diagEnd_(dx, 'done'); return;
      }
      _propsSet(lastKey, nowMs);

      var likelyPhoneEdit = (editedCol === CI_COL_START);
      var likelyInvoiceEdit = (editedCol === CI_COL_START + 2);
      if (likelyPhoneEdit || (!_filled(vC) && !_filled(vF))) autoFillCIFromPhone_(ci, ciRow, vB);
      if (likelyInvoiceEdit || (!_filled(vB) && !_filled(vC) && !_filled(vF))) autoFillCIFromInvoice_(ci, ciRow, vD);

      // refresh snapshot once (cheap)
      src = ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).getValues()[0];
      vB = src[0]; vC = src[1]; vD = src[2]; vE = src[3]; vF = src[4];
      vG = src[5]; vH = src[6]; vI = src[7]; vJ = src[8];
      vK = (editedCol === CI_COL_END && typeof editedValue !== 'undefined') ? editedValue : src[9];

      diagTick_(dx, 'nonfinalize:autofill-only'); diagEnd_(dx, 'done'); return;
    }

    // DELETE path: clear CI row and formats; no Call Log write
    if (isDelete) {
      ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).clearContent();
      resetCIFormats_(ci, ciRow);
      _propsDel('CL_BUSY_' + key);
      diagTick_(dx, 'finalize:deleted'); diagEnd_(dx, 'done'); return;
    }

    // Dedupe latch to avoid double finalizes
    var SIG_KEY = 'CL_LAST_SIG_' + key;
    var TS_KEY  = 'CL_LAST_TS_' + key;
    var ciSig = [_lower(receiverText), _phone10(vB), _lower(vC), _lower(vF), _lower(vE), _lower(vG)].join('|');
    var prevSig = DOC_PROPS.getProperty(SIG_KEY);
    var prevTs  = _propsGetNum(TS_KEY);
    if (prevSig === ciSig && (nowMs - prevTs) < DEDUPE_WINDOW_MS) {
      diagTick_(dx, 'dedupe:skip', { ageMs: nowMs - prevTs });
      _propsDel('CL_BUSY_' + key);
      diagEnd_(dx, 'done'); return;
    }

    // Build Call Log row (A..Q = 17)
    var now = new Date();
    var widthCfg = (typeof CL_WRITE_WIDTH !== 'undefined' && CL_WRITE_WIDTH) ? CL_WRITE_WIDTH : 17;
    var width = Math.max(17, Math.min(widthCfg, cl.getLastColumn() || widthCfg)); // ensure ≥17
    var dest = new Array(width).fill('');

    dest[0] = now;                 // A Date
    dest[1] = now;                 // B Time
    dest[2] = vB;                  // C Phone
    dest[4] = vC;                  // E Name
    if (vD != null && vD !== '') {
      var invDigitsOnly = _digits(vD);
      if (invDigitsOnly) dest[5] = invDigitsOnly;  // F Invoice (digits only)
    }
    dest[6]  = vF;                 // G Email
    dest[8]  = vK;                 // I Status
    dest[9]  = vE;                 // J Subject
    dest[11] = vG;                 // L Message
    dest[12] = vH;                 // M Provided Info
    if (vJ !== '' && vJ != null && !isNaN(Number(vJ))) {
      var days = Number(vJ), base = new Date();
      dest[13] = new Date(base.getFullYear(), base.getMonth(), base.getDate() + days); // N Follow-up
    }
    dest[15] = _literalize_(_t(receiverText)); // P Receiver
    dest[16] = _literalize_(vI);               // Q To Transfer

    // If invoice had non-digits, append to Message instead (keep F digits-only)
    var hasInvoice = vD !== '' && vD != null;
    if (hasInvoice && !isDigitsOnly_(vD)) {
      var invText = _literalize_(String(vD).trim());
      dest[11] = dest[11] ? (dest[11] + '\n' + invText) : invText;
      if (dest[5] && !isDigitsOnly_(dest[5])) dest[5] = '';
    }

    var tW = Date.now();
    var newRow = appendRowFast_(CL_SHEET, dest);
    diagCount_(dx, 'writes'); diagTick_(dx, 'write:append', { tookMs: Date.now() - tW, newRow: newRow });

    // Clear CI after successful write
    ci.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1).clearContent();
    resetCIFormats_(ci, ciRow);

    if (FINALIZE_POSTCOMPUTE) {
      try { postComputeCallLogRow_(newRow, dest); }
      catch (e) { if (!String(e).includes('typed column')) throw e; Logger.log('Skipped formatting due to typed column.'); }
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
    if (__markedBusy) { try { _propsDel('CL_BUSY_' + key); } catch(_){} }
    diagEnd_(dx, 'done');
  }
}

/* ------------------------------ Draft row helpers ------------------------- */
function getOrCreateDraftRow_(cl, key) {
  var dx = diagStart_('getOrCreateDraftRow_', { key: key, sheet: cl ? cl.getName() : '' });
  try {
    if (!cl) throw new Error('getOrCreateDraftRow_: missing Call Log sheet handle');
    var K_ROW = 'CL_DRAFT_ROW_' + key, K_MS = 'CL_DRAFT_MS_' + key;
    var draftRow = parseInt(DOC_PROPS.getProperty(K_ROW) || '', 10);
    var ms = _propsGetNum(K_MS);
    var last = cl.getLastRow();

    if (draftRow && ms) {
      var ok = false;
      if (draftRow >= 2 && draftRow <= last) {
        var t = Date.now(), aVal = cl.getRange(draftRow, 1).getValue();
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

    // create new
    var tNew = Date.now(), newRow = Math.max(last + 1, 2), now = new Date();
    cl.getRange(newRow, 1, 1, 2).setValues([[now, now]]);  // A,B
    diagCount_(dx, 'writes');
    _propsSet(K_ROW, newRow); _propsSet(K_MS, now.getTime());
    diagTick_(dx, 'create:new-draft', { tookMs: Date.now() - tNew, newRow: newRow });
    Log.info('[processInterfaceRow_] Created new draft row ' + newRow + ' for key ' + key + '.');
    return newRow;

  } catch (err) {
    diagError_(dx, err); throw err;
  } finally {
    diagEnd_(dx, 'done');
  }
}

function clearDraft_(key) {
  _propsDel('CL_DRAFT_ROW_' + key);
  _propsDel('CL_DRAFT_MS_' + key);
  try {
    var ciRow = keyToCiRow_(key); if (!ciRow) return;
    var ss = SpreadsheetApp.getActive(); var ci = ss.getSheetByName(CI_SHEET); if (!ci) return;
    resetCIFormats_(ci, ciRow);
    Log.info('[clearDraft_] Reset CI formats for row ' + ciRow + ' (key ' + key + ').');
  } catch (err) {
    Log.warn('[clearDraft_] format reset skipped for key ' + key + ': ' + (err && err.stack ? err.stack : err));
  }
}

function keyToCiRow_(key) {
  for (var r in ROW_CONFIGS) { if (ROW_CONFIGS[r] && ROW_CONFIGS[r].key === key) return Number(r); }
  return null;
}

/* -------------------------------- CI formatting --------------------------- */
function highlightMissingCI_(ciSheet, ciRow, missingColsA1) {
  if (!missingColsA1 || !missingColsA1.length) return;
  ciSheet.getRangeList(missingColsA1.map(function (c) { return c + ciRow; })).setBackground('#ea9999');
}

function resetCIFormats_(ciSheet, ciRow) {
  ciSheet.getRangeList(['B' + ciRow, 'C' + ciRow, 'E' + ciRow, 'G' + ciRow]).clearFormat();
  ciSheet.getRange(ciRow, CI_COL_START, 1, CI_COL_END - CI_COL_START + 1)
    .setWrapStrategy(SpreadsheetApp.WrapStrategy.WRAP);
}

/* --------------------------------- Autofill ------------------------------- */
function autoFillCIFromPhone_(ciSheet, ciRow, phoneVal) {
  if (!_digits(phoneVal)) return;

  // Snapshot B..G
  var rowVals = ciSheet.getRange(ciRow, 2, 1, 6).getValues()[0]; // B..G
  var curName = rowVals[1], curInv = rowVals[2], curEmail = rowVals[4];

  var rec = findCustomerRecordByPhone_(phoneVal);
  var writes = [];
  if (!_filled(curName) && rec.name)   writes.push({ col: 3, val: rec.name });
  if (!_t(curInv)      && rec.invoice) writes.push({ col: 4, val: rec.invoice });
  if (!_filled(curEmail)&& rec.email)  writes.push({ col: 6, val: rec.email });

  _writeRowCells_(ciSheet, ciRow, writes);

  // Save quick state for invoice reuse
  var key = ROW_CONFIGS[ciRow] && ROW_CONFIGS[ciRow].key;
  if (key) {
    var p10 = _norm10_(phoneVal);
    _setRowState_(key, {
      phoneLast: p10,
      rec: { phone: String(phoneVal||''), name: rec.name||'', invoice: String(rec.invoice||''), email: rec.email||'' }
    }, 600);
  }
}

function autoFillCIFromInvoice_(ciSheet, ciRow, invoiceVal) {
  var invDigits = _digits(invoiceVal);
  if (!invDigits) return;

  var key = ROW_CONFIGS[ciRow] && ROW_CONFIGS[ciRow].key;
  var state = key ? _getRowState_(key) : null;

  if (state && state.rec && _digits(state.rec.invoice || '') === invDigits) {
    var rowVals = ciSheet.getRange(ciRow, 2, 1, 6).getValues()[0]; // B..G
    var writes = [];
    var phoneFromState = (state.rec && state.rec.phone) || state.phoneLast || '';
    if (!_filled(rowVals[0]) && phoneFromState) writes.push({ col: 2, val: phoneFromState });
    if (!_filled(rowVals[1]) && state.rec.name) writes.push({ col: 3, val: state.rec.name });
    if (!_filled(rowVals[4]) && state.rec.email) writes.push({ col: 6, val: state.rec.email });
    _writeRowCells_(ciSheet, ciRow, writes);
    return;
  }

  var rec = findCustomerRecordByInvoice_(invDigits);
  var rv = ciSheet.getRange(ciRow, 2, 1, 6).getValues()[0]; // B..G
  var writes2 = [];
  if (!_filled(rv[0]) && rec.phone) writes2.push({ col: 2, val: _norm10_(rec.phone) || rec.phone });
  if (!_filled(rv[1]) && rec.name)  writes2.push({ col: 3, val: rec.name });
  if (!_filled(rv[4]) && rec.email) writes2.push({ col: 6, val: rec.email });
  _writeRowCells_(ciSheet, ciRow, writes2);

  if (key) {
    _setRowState_(key, { invoiceLast: invDigits, rec: { phone: rec.phone||'', name: rec.name||'', email: rec.email||'', invoice: String(invDigits) } }, 600);
  }
}

/* batched single-row write helper */
function _writeRowCells_(sh, row, writes) {
  if (!writes || !writes.length) return;
  if (writes.length === 1) { sh.getRange(row, writes[0].col).setValue(writes[0].val); return; }
  var minCol = Math.min.apply(null, writes.map(function (w) { return w.col; }));
  var maxCol = Math.max.apply(null, writes.map(function (w) { return w.col; }));
  var width  = maxCol - minCol + 1;
  var rng    = sh.getRange(row, minCol, 1, width);
  var vals   = rng.getValues();
  for (var i = 0; i < writes.length; i++) {
    var w = writes[i]; vals[0][w.col - minCol] = w.val;
  }
  rng.setValues(vals);
}

/* ---------------------------- Customer DB lookups ------------------------- */
function _norm10_(v) {
  try { if (typeof normalizePhone10_ === 'function') return normalizePhone10_(v); } catch (_) {}
  return _phone10(v);
}
function _cleanCustomerRec_(r) {
  var clean = function (s) { var t=_t(s); return NA_RE.test(t) ? '' : t; };
  var email = clean(r.email);
  return {
    phone: clean(r.phone || r.phoneRaw || ''),
    name : clean(r.name),
    invoice: _t(r.invoice),
    email: (typeof isValidEmail_ === 'function' && email && isValidEmail_(email)) ? email : email
  };
}
function _cacheGet_(k){ try { return _cache_().get(k); } catch(_){ return null; } }
function _cachePut_(k,v,ttl){ try { _cache_().put(k,v, ttl||PER_KEY_CACHE_TTL_SEC);} catch(_){} }

function _getCustomerIndices_() {
  if (_getCustomerIndices_.__mem) return _getCustomerIndices_.__mem;
  var CK = 'CUST_IDX_V2', cache = _cache_();
  try {
    var hit = cache.get(CK);
    if (hit) { _getCustomerIndices_.__mem = JSON.parse(hit); return _getCustomerIndices_.__mem; }
  } catch (_) {}

  var ss = SpreadsheetApp.getActive();
  var db = ss.getSheetByName(CUSTOMER_DB_SHEET);
  if (!db) return { byPhone: {}, byInvoice: {} };

  var lastRow = db.getLastRow();
  if (lastRow < 2) return { byPhone: {}, byInvoice: {} };

  var width = Math.min(18, db.getLastColumn()); // A..R
  var vals  = db.getRange(2, 1, lastRow - 1, width).getValues();

  var OFF = {
    PHONE: (typeof DB_COL !== 'undefined' && DB_COL.PHONE)   ? DB_COL.PHONE - 1   : 0,  // A
    NAME : (typeof DB_COL !== 'undefined' && DB_COL.NAME)    ? DB_COL.NAME - 1    : 1,  // B
    EMAIL: (typeof DB_COL !== 'undefined' && DB_COL.EMAIL)   ? DB_COL.EMAIL - 1   : 2,  // C
    INV  : (typeof DB_COL !== 'undefined' && DB_COL.INVOICE) ? DB_COL.INVOICE - 1 : 17  // R
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
        if (!byInvoice[invDigits].name && name)   byInvoice[invDigits].name = name;
        if (!byInvoice[invDigits].email && email) byInvoice[invDigits].email = email;
      }
    }
  }

  var idx = { byPhone: byPhone, byInvoice: byInvoice };
  _getCustomerIndices_.__mem = idx;
  try { cache.put(CK, JSON.stringify(idx), IDX_TTL_SEC); } catch(_) {}
  return idx;
}

function findCustomerRecordByPhone_(phone) {
  var EMPTY = { name: '', invoice: '', email: '' };
  var q10 = _norm10_(phone);
  if (!q10) return EMPTY;

  var CK = 'CUST_P_' + q10;
  var hit = _cacheGet_(CK);
  if (hit) { try { return _cleanCustomerRec_(JSON.parse(hit)); } catch(_){} }

  var ss = SpreadsheetApp.getActive(), db = ss.getSheetByName(CUSTOMER_DB_SHEET);
  if (db) {
    var lastRow = db.getLastRow();
    if (lastRow >= 2) {
      var A = (typeof DB_COL !== 'undefined' && DB_COL.PHONE)   ? DB_COL.PHONE   : 1;
      var NAME  = (typeof DB_COL !== 'undefined' && DB_COL.NAME)  ? DB_COL.NAME    : 2;
      var EMAIL = (typeof DB_COL !== 'undefined' && DB_COL.EMAIL) ? DB_COL.EMAIL   : 3;
      var INV   = (typeof DB_COL !== 'undefined' && DB_COL.INVOICE)? DB_COL.INVOICE : 18;

      var rng = db.getRange(2, A, lastRow - 1, 1);
      var tf  = rng.createTextFinder(q10).useRegularExpression(false).matchEntireCell(true).findNext();
      if (tf) {
        var r = tf.getRow();
        var row = db.getRange(r, 1, 1, Math.max(NAME, EMAIL, INV)).getValues()[0];
        var rec = { phone: q10, name: row[NAME - 1], email: row[EMAIL - 1], invoice: _digits(row[INV - 1]) };
        _cachePut_(CK, JSON.stringify(rec));
        return _cleanCustomerRec_(rec);
      }
    }
  }

  var recIdx = _getCustomerIndices_().byPhone[q10];
  if (recIdx) { _cachePut_(CK, JSON.stringify(recIdx)); return _cleanCustomerRec_(recIdx); }
  return EMPTY;
}

function findCustomerRecordByInvoice_(invoice) {
  var EMPTY = { phone: '', name: '', email: '' };
  var inv = _digits(invoice);
  if (!inv) return EMPTY;

  var CK = 'CUST_I_' + inv;
  var hit = _cacheGet_(CK);
  if (hit) { try { return _cleanCustomerRec_(JSON.parse(hit)); } catch(_){} }

  var ss = SpreadsheetApp.getActive(), db = ss.getSheetByName(CUSTOMER_DB_SHEET);
  if (db) {
    var lastRow = db.getLastRow();
    if (lastRow >= 2) {
      var INV   = (typeof DB_COL !== 'undefined' && DB_COL.INVOICE) ? DB_COL.INVOICE : 18;
      var NAME  = (typeof DB_COL !== 'undefined' && DB_COL.NAME)    ? DB_COL.NAME    : 2;
      var EMAIL = (typeof DB_COL !== 'undefined' && DB_COL.EMAIL)   ? DB_COL.EMAIL   : 3;
      var PHONE = (typeof DB_COL !== 'undefined' && DB_COL.PHONE)   ? DB_COL.PHONE   : 1;

      var rng = db.getRange(2, INV, lastRow - 1, 1);
      var tf  = rng.createTextFinder(inv).useRegularExpression(false).matchEntireCell(true).findNext();
      if (tf) {
        var r = tf.getRow();
        var row = db.getRange(r, 1, 1, Math.max(PHONE, NAME, EMAIL, INV)).getValues()[0];
        var rec = { phone: row[PHONE - 1], name: row[NAME - 1], email: row[EMAIL - 1], invoice: inv };
        _cachePut_(CK, JSON.stringify(rec));
        return _cleanCustomerRec_(rec);
      }
    }
  }

  var recIdx = _getCustomerIndices_().byInvoice[inv];
  if (recIdx) { _cachePut_(CK, JSON.stringify(recIdx)); return _cleanCustomerRec_(recIdx); }
  return EMPTY;
}

/* UDF wrappers */
function FIND_BY_INVOICE(invoice) { var rec = findCustomerRecordByInvoice_(invoice); return [[rec.phone, rec.name, rec.email]]; }
function FIND_CUSTOMER(phone)     { var rec = findCustomerRecordByPhone_(phone);     return [[rec.name, rec.invoice, rec.email]]; }

/* ------------------------------- Dedupe & Admin --------------------------- */
function dedupeCallSheet_(sheetName, windowRows) {
  var sh = SpreadsheetApp.getActive().getSheetByName(sheetName);
  if (!sh) throw new Error('Sheet "' + sheetName + '" not found');
  var lastRow = sh.getLastRow(); if (lastRow < 3) return 0;

  var width = Math.min(((typeof CL_WRITE_WIDTH !== 'undefined' && CL_WRITE_WIDTH) ? CL_WRITE_WIDTH : 17), sh.getLastColumn());
  var firstDataRow = 2;
  var start = windowRows ? Math.max(firstDataRow, lastRow - windowRows + 1) : firstDataRow;
  var vals = sh.getRange(start, 1, lastRow - start + 1, width).getValues();

  var normPhone = function (s) {
    try { if (typeof normalizePhone10_ === 'function') return normalizePhone10_(s); } catch (_) {}
    return _phone10(s);
  };
  var hasValue = function (x) { return _t(x) !== ''; };

  // Precompute rows
  var rows = new Array(vals.length);
  for (var i = 0; i < vals.length; i++) {
    var v = vals[i], r1 = start + i;
    var sig = (typeof _buildCallSigFromRow_ === 'function') ? _buildCallSigFromRow_(v)
      : JSON.stringify([normPhone(v[2]), _t(v[4]).toLowerCase(), _t(v[9]).toLowerCase()]);
    var a = v[0], b = v[1], ts = 0;
    if (b instanceof Date) ts = b.getTime(); else if (a instanceof Date) ts = a.getTime();
    rows[i] = { r1: r1, v: v, sig: sig, ts: ts };
  }

  // Pass 1: newest per signature
  var keepBySig = new Map(), toDelete = new Set();
  rows.forEach(function (row) {
    var prev = keepBySig.get(row.sig);
    if (!prev || row.ts >= prev.ts) { if (prev) toDelete.add(prev.row); keepBySig.set(row.sig, { row: row.r1, ts: row.ts }); }
    else { toDelete.add(row.r1); }
  });

  // Pass 2: within same phone, drop incomplete rows (keep any complete ones)
  var survivors = rows.filter(function (r) { return !toDelete.has(r.r1); });
  var groups = new Map();
  survivors.forEach(function (r) {
    var phoneKey = normPhone(r.v[2]); if (!phoneKey) return;
    if (!groups.has(phoneKey)) groups.set(phoneKey, []);
    groups.get(phoneKey).push(r);
  });
  groups.forEach(function (group) {
    if (group.length <= 1) return;
    var meta = group.map(function (r) {
      var hasName = hasValue(r.v[4]), hasSubj = hasValue(r.v[9]);
      return { row: r, complete: (hasName && hasSubj), score: (hasName?1:0) + (hasSubj?1:0) };
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

  // Pass 3: duplicate Message collapse — keep row with more filled fields (tie: newest)
  var survivors2 = rows.filter(function (r) { return !toDelete.has(r.r1); });
  var byMsg = new Map();
  var msgKey = function (s) { return String(s || '').replace(/\s+/g, ' ').trim().toLowerCase(); };

  survivors2.forEach(function (r) {
    var key = msgKey(r.v[11]); if (!key) return; // L: Message
    if (!byMsg.has(key)) byMsg.set(key, []);
    byMsg.get(key).push(r);
  });

  var FILL_COLS = [2,4,5,6,8,9,10,11,12,13,15,16].filter(function (i) { return i < width; });
  var filledCount = function (vals) {
    var n = 0; for (var z = 0; z < FILL_COLS.length; z++) {
      var c = vals[FILL_COLS[z]];
      if (c instanceof Date) n++; else if (_t(c) !== '') n++;
    } return n;
  };

  byMsg.forEach(function (arr) {
    if (arr.length <= 1) return;
    var best = arr[0], bestScore = filledCount(best.v);
    for (var i3 = 1; i3 < arr.length; i3++) {
      var sc = filledCount(arr[i3].v);
      if (sc > bestScore || (sc === bestScore && arr[i3].ts >= best.ts)) { best = arr[i3]; bestScore = sc; }
    }
    arr.forEach(function (r) { if (r.r1 !== best.r1) toDelete.add(r.r1); });
  });

  var delRows = Array.from(toDelete)
    .map(function (r) { return Math.floor(Number(r)); })
    .filter(function (r) { return Number.isInteger(r) && r >= 2 && r <= lastRow; });
  if (!delRows.length) return 0;

  delRows = Array.from(new Set(delRows)).sort(function (a, b) { return b - a; });
  delRows.forEach(function (r) { sh.deleteRow(r); });
  return delRows.length;
}

function sweepCallDuplicates() {
  var lock = LockService.getDocumentLock();
  lock.waitLock(30000);
  try {
    var n1 = dedupeCallSheet_('Call Log');
    var n2 = dedupeCallSheet_('Call Archive');
    SpreadsheetApp.flush();
    Logger.log('Dedupe removed ' + n1 + ' (Call Log) and ' + n2 + ' (Call Archive).');
  } finally { lock.releaseLock(); }
}

function shakeCI() {
  var t0 = Date.now(), lock = LockService.getDocumentLock(), got = false;
  try {
    got = lock.tryLock(LOCK_TRY_MS);
    if (!got) { Logger.log('[shakeCI] skipped: could not acquire lock'); return; }
    var ss = SpreadsheetApp.getActive(), ci = ss.getSheetByName(CI_SHEET), cl = ss.getSheetByName(CL_SHEET);

    var DU = Math.max((typeof LOCK_TRY_MS !== 'undefined' ? LOCK_TRY_MS : 700) * 40, 30000);
    var STALE_MS = DU * 2;

    var keys = Object.keys(ROW_CONFIGS || {}).map(function (r) { return ROW_CONFIGS[r] && ROW_CONFIGS[r].key; }).filter(Boolean);
    var clearedBusy = 0, fixedDraft = 0, clearedDraft = 0, clearedDedupe = 0, resetFormats = 0;

    keys.forEach(function (key) {
      var bk = 'CL_BUSY_' + key; if (DOC_PROPS.getProperty(bk) != null) { _propsDel(bk); clearedBusy++; }
      var tsKey = 'CL_LAST_TS_' + key, sigKey = 'CL_LAST_SIG_' + key, ts = _propsGetNum(tsKey);
      if (ts && (Date.now() - ts) > STALE_MS) { _propsDel(sigKey); _propsDel(tsKey); clearedDedupe++; }

      if (cl) {
        var kRow = 'CL_DRAFT_ROW_' + key, kMs = 'CL_DRAFT_MS_' + key;
        var draftRow = parseInt(DOC_PROPS.getProperty(kRow) || '', 10), ms = _propsGetNum(kMs);
        if (draftRow && ms) {
          var ok = false, last = cl.getLastRow();
          if (draftRow >= 2 && draftRow <= last) {
            var aVal = cl.getRange(draftRow, 1).getValue();
            ok = (aVal instanceof Date) && (aVal.getTime() === ms);
          }
          if (!ok && last >= 2) {
            var dates = cl.getRange(2, 1, last - 1, 1).getValues();
            for (var i = 0; i < dates.length; i++) {
              var d = dates[i][0];
              if (d instanceof Date && d.getTime() === ms) {
                draftRow = i + 2; _propsSet(kRow, draftRow); ok = true; fixedDraft++; break;
              }
            }
          }
          if (!ok) { _propsDel(kRow); _propsDel(kMs); clearedDraft++; }
        }
      }
      if (ci) { var r = keyToCiRow_(key); if (r) { resetCIFormats_(ci, r); resetFormats++; } }
    });

    try { sweepCallDuplicates(); } catch (e) {
      if (typeof Log !== 'undefined' && Log.warn) Log.warn('[shakeCI] sweepCallDuplicates skipped: ' + (e && e.message ? e.message : e));
      else Logger.log('[shakeCI] sweepCallDuplicates skipped: ' + (e && e.message ? e.message : e));
    }

    SpreadsheetApp.flush(); Utilities.sleep(50);
    var msg = '[shakeCI] done in ' + (Date.now() - t0) + 'ms — clearedBusy=' + clearedBusy + ', clearedDraft=' + clearedDraft + ', fixedDraft=' + fixedDraft + ', clearedDedupe=' + clearedDedupe + ', resetFormats=' + resetFormats;
    if (typeof Log !== 'undefined' && Log.info) Log.info(msg); else Logger.log(msg);
    try { ss.toast('Shake complete. See logs for details.'); } catch (_) {}
  } finally { if (got) { try { lock.releaseLock(); } catch(_){} } }
}

/* ------------------------------ Compat index shims ------------------------ */
if (typeof _getCustomerPhoneIndex_ !== 'function') {
  function _getCustomerPhoneIndex_() { return _getCustomerIndices_().byPhone; }
}
if (typeof _getCustomerInvoiceIndex_ !== 'function') {
  function _getCustomerInvoiceIndex_() { return _getCustomerIndices_().byInvoice; }
}

/* ------------------------------ Per-row state helpers --------------------- */
/* Requires key (ROW_CONFIGS[*].key). Implemented via Cache for quick reuse. */
if (typeof _getRowState_ !== 'function') {
  function _getRowState_(key) {
    try { var hit = _cache_().get('CI_STATE_' + key); return hit ? JSON.parse(hit) : null; } catch(_) { return null; }
  }
}
if (typeof _setRowState_ !== 'function') {
  function _setRowState_(key, obj, ttlSec) {
    try { _cache_().put('CI_STATE_' + key, JSON.stringify(obj), ttlSec || 600); } catch(_) {}
  }
}
