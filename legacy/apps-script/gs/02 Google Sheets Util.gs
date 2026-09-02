/** ============================================================================
 * 02 Google Sheets Util
 * ----------------------------------------------------------------------------
 * Purpose
 *   Spreadsheet-specific utilities: header discovery/creation, column mapping,
 *   cached lookups from local tabs, sorting, formula fill-down, and row matching.
 *
 * Functions (in this file)
 *   - areaFromPhone_(phone)                          // cached AreaCodes → region
 *   - _catLookup_(subject)                           // cached CatMap → category
 *   - SheetU.openOrCreateTab(ssId, name, headers=[])
 *   - headerOr_(sh, headerName, fallbackColIndex)
 *   - headerCol_(sh, exactName)
 *   - headerColByMatch_(sh, rx)
 *   - _getHeaderMap_(sh)                             // canonHeader_ map → col
 *   - _colByHeader_(headerMap, sh, headerName, createIfMissing)
 *   - mustSheet_(name, ssId)                         // open by ID (trigger-safe)
 *   - sortSheetByColBDesc_(sheetName, opts={})
 *   - applyFormulaToColumn(sheetName, headerName, formula, useR1C1)
 *   - populateFormulas()                             // no-op placeholder
 *   - _fillDownR1C1_(sh, colIndex, r1c1Formula)
 *   - _fillDownA1_(sh, colIndex, a1Formula)
 *   - isProbablyHeaderRow(row, idx)
 *   - _buildCallSigFromRow_(rowVals)                 // Call Log/Archive layout
 *   - _findRecentRowBySig_(sh, sig, windowRows)
 *
 * Sheet tabs referenced
 *   - "AreaCodes"  (A: area code, B: region/name)
 *   - "CatMap"     (A: subject token, B: category)
 *
 * External globals / services referenced (read-only unless noted)
 *   - SpreadsheetApp (read/write)
 *   - CacheService   (read/write cache for AreaCodes / CatMap)
 *   - Log.info / Log.warn (00 Globals)
 *   - CONFIG.SHEETS.MAIN_ID (open correct file; trigger-safe)
 *   - CONFIG.NA_VALUE
 *   - SORT_MAX_ROWS    (optional throttle for large sorts; from Globals)
 *   - SORT_LAST_COL    (optional clamp for sort width; from Globals)
 *   - CL_WRITE_WIDTH   (scan width for recent-row search; from Globals)
 *
 * Dependencies (helpers defined in 01 Primary Utils)
 *   - canonHeader_(s)
 *   - _digits_(s), _norm_(s), _naish_(s)
 *   - (optional) normalizePhone10_(phone) — used by areaFromPhone_ if present
 *
 * Notes
 *   - All sheet access uses openById(CONFIG.SHEETS.MAIN_ID) for trigger safety.
 *   - Column-creation helpers only add headers when explicitly requested.
 *   - _buildCallSigFromRow_ assumes current Call Log/Archive column positions.
 * ============================================================================ */

/** Header Find + Normalization */

if (typeof invoiceDigits_ !== 'function') {
  function invoiceDigits_(v) { return String(v || '').replace(/\D+/g, ''); }
}
if (typeof areaFromPhone_ !== 'function') {
  function areaFromPhone_(phone) {
    const d = normalizePhone10_(phone); if (!d) return CONFIG.NA_VALUE;
    const ac = d.slice(0, 3);
    const sh = SpreadsheetApp.getActive().getSheetByName('AreaCodes');
    if (!sh || sh.getLastRow() < 2) return CONFIG.NA_VALUE;
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    const map = Object.fromEntries(vals.map(r => [String(r[0]).replace(/\D+/g, ''), r[1]]));
    return map[ac] || CONFIG.NA_VALUE;
  }
}
if (typeof buildGmailSearchUrl_ !== 'function') {
  function buildGmailSearchUrl_(phone, invoice, email) {
    const bits = [];
    const pushQ = s => { s = String(s || '').trim(); if (s) bits.push(`"${s.replace(/"/g, '')}"`); };
    const p10 = normalizePhone10_(phone); if (p10) pushQ(p10);
    const inv = invoiceDigits_(invoice); if (inv) pushQ(inv);
    if (email) pushQ(email);
    return bits.length ? `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(bits.join(' OR '))}` : '';
  }
}
if (typeof _catLookup_ !== 'function') {
  function _catLookup_(subject) {
    const s = String(subject || '').trim().toLowerCase(); if (!s) return '';
    const sh = SpreadsheetApp.getActive().getSheetByName('CatMap');
    if (!sh || sh.getLastRow() < 2) return 'FAQ';
    const vals = sh.getRange(2, 1, sh.getLastRow() - 1, 2).getValues();
    const map = new Map(vals.map(r => [String(r[0]).trim().toLowerCase(), r[1] || 'FAQ']));
    return map.get(s) || 'FAQ';
  }
}

const SheetU = {
  openOrCreateTab(ssId, name, headers = []) {
    const ss = SpreadsheetApp.openById(ssId);
    let sh = ss.getSheetByName(name);
    if (!sh) sh = ss.insertSheet(name);
    if (headers && headers.length && sh.getLastRow() === 0) {
      sh.getRange(1, 1, 1, headers.length).setValues([headers]);
      sh.setFrozenRows(1);
    }
    return sh;
  }
};



function headerOr_(sh, headerName, fallbackColIndex) {
  const c = headerCol_(sh, headerName);
  return (c && c > 0) ? c : fallbackColIndex;
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

function headerCol_(sh, exactName) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0];
  for (let c = 0; c < head.length; c++) if (head[c] === exactName) return c + 1;
  return -1;
}

function headerColByMatch_(sh, rx) {
  const head = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String);
  for (let c = 0; c < head.length; c++) if (rx.test(head[c])) return c + 1;
  return -1;
}

function _getHeaderMap_(sh) {
  const n = sh.getLastColumn();
  if (n === 0) return {};
  const raw = sh.getRange(1, 1, 1, n).getValues()[0];
  const map = {};
  raw.forEach((h, i) => { map[canonHeader_(h)] = i + 1; });
  return map;
}

function _colByHeader_(headerMap, sh, headerName, createIfMissing) {
  const key = canonHeader_(headerName);
  let idx = headerMap[key] || -1;
  if (idx > 0) return idx;
  if (!createIfMissing) return -1;
  // create at end
  const newCol = sh.getLastColumn() + 1;
  sh.insertColumnAfter(sh.getLastColumn());
  sh.getRange(1, newCol).setValue(headerName);
  headerMap[key] = newCol;
  return newCol;
}

function _colLetter_(colIndex) {
  let c = colIndex, s = '';
  while (c > 0) { const m = (c - 1) % 26; s = String.fromCharCode(65 + m) + s; c = (c - m - 1) / 26; }
  return s;
}

/** Sheet Sorting + Formulas */

function mustSheet_(name, ssId) {
  const ss = SpreadsheetApp.openById(ssId || CONFIG.SHEETS.MAIN_ID);
  const sh = ss.getSheetByName(name);
  if (!sh) throw new Error(`Sheet "${name}" not found.`);
  return sh;
}

function sortSheetByColBDesc_(sheetName, opts = {}) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error(`Sheet "${sheetName}" not found.`);

  const HEADER_ROWS = opts.headerRows ?? 1;
  const firstDataRow = HEADER_ROWS + 1;
  const lastRow = sh.getLastRow();
  const rows = lastRow - HEADER_ROWS;
  if (rows <= 0) return false;

  // Throttle huge sorts if requested
  const maxRows = opts.maxRows ?? SORT_MAX_ROWS ?? null;
  if (maxRows && rows > maxRows) {
    Log.info(`sortSheetByColBDesc_: Skipped sort (too many rows) sheet=${sheetName} rows=${rows} maxRows=${maxRows}`);

    return false;
  }

  // Clamp sort width for speed/safety
  const width = opts.maxCols ?? SORT_LAST_COL ?? sh.getLastColumn();

  sh.getRange(firstDataRow, 1, rows, width)
    .sort([{ column: 2, ascending: false }]); // Column B, newest first

  SpreadsheetApp.flush();
  if (typeof logEvent_ === 'function') {
    logEvent_('INFO', 'sortSheetByColBDesc_', 'Sorted by col B desc', { sheetName, firstDataRow, rows, width });
  }
  return true;
}

function applyFormulaToColumn(sheetName, headerName, formulaA1_or_R1C1, useR1C1) {
  const ss = SpreadsheetApp.openById(CONFIG.SHEETS.MAIN_ID);
  const sh = ss.getSheetByName(sheetName);
  if (!sh) throw new Error(`Sheet "${sheetName}" not found`);
  const headerMap = _getHeaderMap_(sh);
  const col = _colByHeader_(headerMap, sh, headerName, /*createIfMissing*/ true);
  if (useR1C1) _fillDownR1C1_(sh, col, formulaA1_or_R1C1);
  else _fillDownA1_(sh, col, formulaA1_or_R1C1);
}

// Top-level no-op for back-compat with any old callers
function populateFormulas() {
  Log.info('populateFormulas() skipped (deprecated no-op).');
  return 0;
}

function _fillDownR1C1_(sh, colIndex, r1c1Formula) {
  const lastRow = Math.max(sh.getLastRow(), 2);
  if (lastRow < 2) return;
  const rows = lastRow - 1;
  sh.getRange(2, colIndex, rows, 1).setFormulaR1C1(r1c1Formula);
}

function _fillDownA1_(sh, colIndex, a1Formula) {
  const lastRow = Math.max(sh.getLastRow(), 2);
  if (lastRow < 2) return;
  const rows = lastRow - 1;
  // put same formula in entire range; it uses ROW() to self-reference
  sh.getRange(2, colIndex, rows, 1).setFormula(a1Formula);
}

function isProbablyHeaderRow(row, idx) {
  // treat as header-ish if all mapped columns are strings with few digits and many alpha tokens
  const cols = [idx.po, idx.so, idx.proj, idx.act, idx.carr, idx.track].filter(i => i >= 0);
  const cells = cols.map(i => String(row[i] ?? '').trim());
  const nonEmpty = cells.filter(s => s.length).length;
  if (!nonEmpty) return false;
  const alphaHeavy = cells.every(s => s === '' || /^[^0-9]*$/.test(s));
  return alphaHeavy;
}

function _naish_(s) {
  const v = String(s == null ? '' : s).trim().toLowerCase();
  return !v || v === 'na_value' || NA_REGEX.test(v);
}
function _norm_(s) { return String(s == null ? '' : s).toLowerCase().replace(/\s+/g, ' ').trim(); }
function _digits_(s) { return String(s == null ? '' : s).replace(/\D+/g, ''); }

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

/** Build signature for an existing row in Call Log/Archive (rowVals is A..Q 0-based). */
function _buildCallSigFromRow_(rowVals) {
  const phone = _digits_(rowVals[2]);    // C
  const name = _naish_(rowVals[4]) ? '' : _norm_(rowVals[4]);  // E
  const invoice = _digits_(rowVals[5]);    // F
  const email = _naish_(rowVals[6]) ? '' : _norm_(rowVals[6]);  // G
  const status = _naish_(rowVals[8]) ? '' : _norm_(rowVals[8]);  // I
  const subject = _naish_(rowVals[9]) ? '' : _norm_(rowVals[9]);  // J
  const message = _naish_(rowVals[11]) ? '' : _norm_(rowVals[11]).slice(0, 160); // L
  const provided = _naish_(rowVals[12]) ? '' : _norm_(rowVals[12]).slice(0, 120); // M
  const recv = _naish_(rowVals[15]) ? '' : _norm_(rowVals[15]); // P
  const transfer = _naish_(rowVals[16]) ? '' : _norm_(rowVals[16]); // Q

  return ['ph:' + phone, 'nm:' + name, 'iv:' + invoice, 'em:' + email, 'st:' + status,
  'sj:' + subject, 'ms:' + message, 'pr:' + provided, 'tf:' + transfer, 'rc:' + recv]
    .join('|');
}

/** Find an existing recent row in sheet by signature (returns 1-based row or 0 if none). */
function _findRecentRowBySig_(sh, sig, windowRows) {
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;
  const start = Math.max(2, lastRow - Math.max(50, windowRows || 500) + 1);
  const width = Math.min(CL_WRITE_WIDTH || 17, sh.getLastColumn());
  const vals = sh.getRange(start, 1, lastRow - start + 1, width).getValues();
  for (let i = vals.length - 1; i >= 0; i--) { // newest first
    if (_buildCallSigFromRow_(vals[i]) === sig) return start + i;
  }
  return 0;
}