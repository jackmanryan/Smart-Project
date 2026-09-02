/** ============================================================================
 * Customer DB Builder & Utilities
 * ----------------------------------------------------------------------------
 * Purpose
 *   Build/refresh the "Customer Database" sheet from Call Log + Call Archive,
 *   keep columns canonical, and provide helpers for backfill/formatting/sorting.
 *
 * Entry points (call these from menus/triggers)
 *   - rebuildCustomerDB()             → Rebuilds the Customer Database tab
 *   - sortCustomerDBByFrequency()     → Sorts DB by Total Calls (desc), Last Seen (desc)
 *   - backfillArchiveFromCustomerDB() → Fills missing Name/Email in Call Archive from DB
 *   - normalizePhonesInArchive()      → Normalizes "Phone Number" to 10 digits in Archive
 *
 * Functions (in this file)
 *   - getDbResolverCols_(db)
 *   - assertDbColumnLayout_(db, { fixHeaders = true } = {})
 *   - trySetNumberFormat_(range, fmt)
 *   - recreateSheet_(ss, name)
 *   - rebuildCustomerDB()                         // uses local helper harvest_(sh)
 *   - sortCustomerDBByFrequency()
 *   - writeNotesFromInvoices_(db, arch)           // no-ops unless "Notes" column exists
 *   - backfillArchiveFromCustomerDB()
 *   - normalizePhonesInArchive()
 *   - cleanInvoice_(v)
 *   - ensureDbHeader_(db)
 *   - readDbManuals_(db)
 *   - idxMap_(headers, spec)
 *
 * Constants/Globals DEFINED here
 *   - DB_HEADERS (array, canonical DB schema – 19 columns, A..S)
 *   - DB_COL (frozen map: PHONE, NAME, EMAIL, INVOICE)
 *
 * Globals/Constants USED from other modules (must exist)
 *   - CONFIG.SHEETS.MAIN_ID
 *   - CL_SHEET                  // "Call Log"
 *   - SHEET_ARCHIVE             // "Call Archive"
 *   - CUSTOMER_DB_SHEET         // "Customer Database"
 *   - SHEET_DB                  // alias of CUSTOMER_DB_SHEET
 *   - MIN_INVOICE_DIGITS, MAX_INVOICE_DIGITS
 *
 * Helper utilities ASSUMED (provided elsewhere)
 *   - mustSheet_(name)
 *   - headerCol_(sheet, headerName)
 *   - headerOr_(sheet, headerName, fallbackColIndex)
 *   - headerColByMatch_(sheet, regex)
 *   - normalizePhone10_(value)
 *   - resolveTimestamp_(dateCell, timeCell)
 *   - safeStr_(value)
 *
 * Sheets read/write (side effects)
 *   READ : CL_SHEET ("Call Log"), SHEET_ARCHIVE ("Call Archive")
 *   WRITE: CUSTOMER_DB_SHEET ("Customer Database") – recreated on rebuild
 *          SHEET_ARCHIVE ("Call Archive") – when backfilling names/emails, phone normalization
 *
 * DB schema (DB_HEADERS; columns A..S)
 *   A  Phone (key-digit-only)
 *   B  Customer Name (Latest)
 *   C  Primary Email (Latest)
 *   D  Company
 *   E  Account ID / Number
 *   F  Customer Orders
 *   G  Customer Last Status
 *   H  First Seen (Call Archive)
 *   I  Last Seen (Call Archive)
 *   J  Total Calls (Call Archive)
 *   K  Calls (Last 7d)
 *   L  Calls (Last 14d)
 *   M  Last Category
 *   N  Last Status
 *   O  Last Receiver
 *   P  Last Subject
 *   Q  Last Gmail Link
 *   R  Last Invoice / Identifier
 *   S  Province/State (Latest)
 *
 * Notes
 *   - writeNotesFromInvoices_() respects schema pruning: it only writes if a "Notes" column exists.
 *   - recreateSheet_() deletes & recreates the DB tab to avoid typed-column artifacts.
 *   - Sorting uses J (Total Calls) then I (Last Seen).
 *
 * Last updated: 2025-11-04
 * ========================================================================== */


if (typeof DB_HEADERS === 'undefined') {
  globalThis.DB_HEADERS = [
    'Phone (key-digit-only)', 'Customer Name (Latest)', 'Primary Email (Latest)', 'Company',
    'Account ID / Number', 'Customer Orders', 'Customer Last Status', 'First Seen (Call Archive)',
    'Last Seen (Call Archive)', 'Total Calls (Call Archive)', 'Calls (Last 7d)', 'Calls (Last 14d)',
    'Last Category', 'Last Status', 'Last Receiver', 'Last Subject', 'Last Gmail Link',
    'Last Invoice / Identifier', 'Province/State (Latest)'
  ];
}
if (typeof DB_COL === 'undefined') {
  globalThis.DB_COL = Object.freeze({
    PHONE: 1,            // A
    NAME: 2,             // B
    EMAIL: 3,            // C
    INVOICE: DB_HEADERS.indexOf('Last Invoice / Identifier') + 1 // R (18)
  });
}

function getDbResolverCols_(db) {
  return {
    phone: headerCol_(db, DB_HEADERS[0]) || DB_COL.PHONE,
    name: headerCol_(db, DB_HEADERS[1]) || DB_COL.NAME,
    email: headerCol_(db, DB_HEADERS[2]) || DB_COL.EMAIL,
    invoice: headerCol_(db, 'Last Invoice / Identifier') || DB_COL.INVOICE,
  };
}

function assertDbColumnLayout_(db, { fixHeaders = true } = {}) {
  ensureDbHeader_(db); // rewrites canonical headers if drifting
}

/** Best-effort number formatting: skip if column is “typed”. */
function trySetNumberFormat_(range, fmt) {
  try {
    range.setNumberFormat(fmt);
    return true;
  } catch (err) {
    const msg = String(err && err.message || err);
    if (/typed column/i.test(msg)) {
      // Column is typed; Sheets controls its display. Ignore and continue.
      return false;
    }
    throw err; // real error—bubble up
  }
}

function recreateSheet_(ss, name) {
  const existing = ss.getSheetByName(name);
  if (!existing) return ss.insertSheet(name);

  const idx = existing.getIndex(); // preserve position
  ss.deleteSheet(existing);
  // insert at the same index (Google is 1-based)
  return ss.insertSheet(name, Math.max(0, idx - 1));
}

/***** MAIN: rebuild DB from Call Archive *****/
function rebuildCustomerDB() {
  const ss = SpreadsheetApp.openById(CONFIG.SHEETS.MAIN_ID);
  const cl = mustSheet_(CL_SHEET);       // "Call Log"
  const ar = mustSheet_(SHEET_ARCHIVE);  // "Call Archive"

  // 1) Preserve manual fields from the existing DB (company/account; legacy notes if present)
  const existingDb = ss.getSheetByName(CUSTOMER_DB_SHEET);
  const oldMap = existingDb ? readDbManuals_(existingDb) : new Map();

  // 2) Recreate DB sheet to ensure no typed columns remain
  const db = recreateSheet_(ss, CUSTOMER_DB_SHEET);

  // 3) Header
  ensureDbHeader_(db); // writes DB_HEADERS, bold, widths

  // 4) Read Call Log + Archive
  function harvest_(sh) {
    const lastRow = sh.getLastRow();
    if (lastRow < 2) return [];
    const vals = sh.getRange(2, 1, lastRow - 1, Math.min(26, sh.getLastColumn())).getValues();
    return vals.map(v => ({
      dateA: v[0],   // A date
      timeB: v[1],   // B time or datetime
      phone: v[2],   // C phone
      region: v[3],  // D province/state
      name: v[4],    // E name
      invoice: v[5], // F invoice
      email: v[6],   // G email
      gmail: v[7],   // H Gmail link
      status: v[8],  // I status
      subject: v[9], // J subject
      category: v[10],   // K category
      message: v[11],    // L message
      provided: v[12],   // M provided info
      receiver: v[15]    // P receiver
    }));
  }

  const arRows = harvest_(ar).map(r => ({ ...r, _src: 'AR' }));
  const clRows = harvest_(cl).map(r => ({ ...r, _src: 'CL' }));
  const rows = arRows.concat(clRows);

  // 5) Aggregate by phone (last 10 digits)
  const now = new Date();
  const cut7 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 7);
  const cut14 = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 14);

  const agg = new Map();
  rows.forEach(r => {
    const key = normalizePhone10_(r.phone || '');
    if (!key) return;

    const ts = resolveTimestamp_(r.dateA, r.timeB) || (r.dateA instanceof Date ? r.dateA : null);
    const tsMs = ts ? ts.getTime() : 0;

    let a = agg.get(key);
    if (!a) {
      a = {
        phone: key, name: '', email: '', company: '', account: '',
        orders: new Map(), firstSeen: null, lastSeen: null,
        totalArchive: 0, c7: 0, c14: 0,
        lastCategory: '', lastStatus: '', lastReceiver: '', lastSubject: '',
        lastLink: '', lastInvoice: '', lastMsg: '', lastProvided: '', province: ''
      };
      agg.set(key, a);
    }

    if (r.region) a.province = String(r.region);

    if (ts) {
      if (!a.firstSeen || tsMs < a.firstSeen.getTime()) a.firstSeen = ts;
      if (!a.lastSeen || tsMs > a.lastSeen.getTime()) a.lastSeen = ts;
      if (ts >= cut7) a.c7++;
      if (ts >= cut14) a.c14++;
    }

    if (r._src === 'AR') a.totalArchive++;

    if (!a.lastSeen || (tsMs && tsMs >= a.lastSeen.getTime())) {
      a.name = String(r.name || a.name || '');
      a.email = String(r.email || a.email || '');
      a.lastStatus = String(r.status || '');
      a.lastSubject = String(r.subject || '');
      a.lastReceiver = String(r.receiver || '');
      a.lastCategory = String(r.category || '');
      a.lastLink = r.gmail ? String(r.gmail) : a.lastLink;
      a.lastInvoice = String(r.invoice || a.lastInvoice || '');
      a.lastMsg = String(r.message || '');
      a.lastProvided = String(r.provided || '');
    }

    const invDigits = String(r.invoice || '').replace(/\D+/g, '');
    if (invDigits) a.orders.set(invDigits, Math.max(a.orders.get(invDigits) || 0, tsMs || 0));
  });

  // 6) Build output rows
  const out = [];
  agg.forEach(a => {
    const invoices = Array.from(a.orders.entries())
      .sort((x, y) => y[1] - x[1])
      .map(([id]) => id)
      .join(', ');

    const lastStatusCombined = (a.lastMsg && a.lastProvided)
      ? (a.lastMsg + ' | ' + a.lastProvided)
      : (a.lastMsg || a.lastProvided || '');

    const keep = oldMap.get(a.phone) || { aggro: '', dnc: '', notes: '' };

    out.push([
      a.phone,
      a.name,
      a.email,
      a.company || keep.company,
      a.account || keep.account,
      invoices,                // Customer Orders
      lastStatusCombined,      // Customer Last Status
      a.firstSeen || '',       // First Seen (Archive)
      a.lastSeen || '',       // Last Seen (Archive)
      a.totalArchive,          // Total Calls (Archive)
      a.c7,                    // Calls (Last 7d)
      a.c14,                   // Calls (Last 14d)
      a.lastCategory,
      a.lastStatus,
      a.lastReceiver,
      a.lastSubject,
      a.lastLink,
      a.lastInvoice,
      a.province,
    ]);
  });

  // 7) Sort: Total Calls desc, then Last Seen desc
  const idxTotalCalls = 10; // J
  const idxLastSeen = 9;  // I
  out.sort((a, b) => {
    const fa = Number(a[idxTotalCalls - 1]) || 0;
    const fb = Number(b[idxTotalCalls - 1]) || 0;
    if (fb !== fa) return fb - fa;
    const ta = a[idxLastSeen - 1] instanceof Date ? a[idxLastSeen - 1].getTime() : 0;
    const tb = b[idxLastSeen - 1] instanceof Date ? b[idxLastSeen - 1].getTime() : 0;
    return tb - ta;
  });

  // 8) Write data
  if (out.length) db.getRange(2, 1, out.length, DB_HEADERS.length).setValues(out);
  db.setFrozenRows(1);
}

function sortCustomerDBByFrequency() {
  const db = mustSheet_(SHEET_DB);
  const lastRow = db.getLastRow();
  if (lastRow < 3) return; // header + at least 1 row
  const lastCol = db.getLastColumn();

  // J (10): Total Calls — desc, I (9): Last Seen — desc
  db.getRange(2, 1, lastRow - 1, lastCol).sort([
    { column: 10, ascending: false },
    { column: 9, ascending: false }
  ]);
}


function writeNotesFromInvoices_(db, arch) {
  // --- Locate columns ---
  const notesCol = headerCol_(db, 'Notes');              // respect removal; do not revive
  if (notesCol < 1) return; // If Notes column doesn't exist, skip entirely
  const openCol = headerOr_(db, 'Customer Orders', 6);


  // Read DB rows present
  const lastRow = db.getLastRow();
  if (lastRow < 2) return;
  const dbRowCount = lastRow - 1;

  // --- Read Call Archive once ---
  const archVals = arch.getDataRange().getValues();
  if (archVals.length < 2) {
    return;
  }
  // 1-based columns in Sheets: F=6, L=12, M=13, A=1
  const A_COL_INVOICE = 6, A_COL_L = 12, A_COL_M = 13; // (1-based)
  // Build invoice -> lines[] map; each line is "L, M" for that archive row (skips blanks)
  const invMap = new Map();
  for (let r = 1; r < archVals.length; r++) {  // skip header
    const row = archVals[r];
    const invRaw = row[A_COL_INVOICE - 1];
    const inv = String(invRaw == null ? '' : invRaw).replace(/\D+/g, ''); // digits only
    if (!inv) continue;

    const l = String(row[A_COL_L - 1] ?? '').trim().replace(/\u00A0/g, ' ');
    const m = String(row[A_COL_M - 1] ?? '').trim().replace(/\u00A0/g, ' ');
    const pieces = [];
    if (l) pieces.push(l);
    if (m) pieces.push(m);
    if (!pieces.length) continue;

    const line = pieces.join(', ');
    if (!invMap.has(inv)) invMap.set(inv, []);
    invMap.get(inv).push(line);
  }

  // --- Read all DB F (open orders) in one go and produce Notes text ---
  const fVals = db.getRange(2, openCol, dbRowCount, 1).getValues(); // [[F2],[F3],...]
  const curNotes = db.getRange(2, notesCol, dbRowCount, 1).getValues();
  const notesOut = new Array(dbRowCount);
  for (let i = 0; i < dbRowCount; i++) {
    const existing = (curNotes[i] && curNotes[i][0]) ? String(curNotes[i][0]).trim() : '';
    const keyRaw = fVals[i][0];
    if (!keyRaw) { notesOut[i] = [existing]; continue; }

    // Parse invoice IDs from F (accept "142555" or "142555, 142536", any separators)
    const ids = String(keyRaw).match(/\d+/g) || [];
    if (!ids.length) { notesOut[i] = [existing]; continue; }

    // Gather all lines from archive for each id, in sheet order (dedupe optional)
    const lines = [];
    for (const id of ids) {
      const arr = invMap.get(id);
      if (arr && arr.length) lines.push(...arr);
    }

    // Join into newline text; wrap in one cell
    notesOut[i] = [existing ? existing : (lines.length ? lines.join('\n') : '')];
  }

  // --- Write Notes column ---
  db.getRange(2, notesCol, dbRowCount, 1).setValues(notesOut);
}

/***** ACTION: fill blanks in Call Archive from DB *****/
function backfillArchiveFromCustomerDB() {
  const arch = mustSheet_(SHEET_ARCHIVE);
  const db = mustSheet_(SHEET_DB);

  const dbVals = db.getDataRange().getValues();
  const dh = dbVals[0].map(String);
  const D = idxMap_(dh, {
    key: /^phone\s*\(key\-digit\-only\)$/i,
    name: /^customer\s*name/i,
    email: /^primary\s*email/i
  });
  if (D.key < 0 || D.name < 0 || D.email < 0) {
    throw new Error('Customer DB missing required headers: Phone (key-digit-only), Customer Name (Latest), Primary Email (Latest).');
  }

  const map = new Map();
  for (let r = 1; r < dbVals.length; r++) {
    const key = safeStr_(dbVals[r][D.key]);
    if (!key) continue;
    map.set(key, {
      name: safeStr_(dbVals[r][D.name]),
      email: safeStr_(dbVals[r][D.email])
    });
  }

  const archVals = arch.getDataRange().getValues();
  const ah = archVals[0].map(String);
  const A = idxMap_(ah, {
    phone: /^phone\s*number$/i,
    name: /^name$/i,
    email: /^email$/i
  });
  if (A.phone < 0 || A.name < 0 || A.email < 0) {
    throw new Error('Call Archive missing required headers: Phone Number, Name, Email.');
  }

  let touched = 0;
  for (let r = 1; r < archVals.length; r++) {
    const row = archVals[r];
    const key = normalizePhone10_(row[A.phone]);
    if (!key) continue;
    const ref = map.get(key);
    if (!ref) continue;

    const curName = safeStr_(row[A.name]);
    const curEmail = safeStr_(row[A.email]);
    let change = false;

    if (!curName && ref.name) { row[A.name] = ref.name; change = true; }
    if (!curEmail && ref.email) { row[A.email] = ref.email; change = true; }

    if (change) { archVals[r] = row; touched++; }
  }

  if (touched) {
    arch.getDataRange().setValues(archVals);
  }
}

/***** ACTION: normalize phones in Call Archive to 10 digits *****/
function normalizePhonesInArchive() {
  const arch = mustSheet_(SHEET_ARCHIVE);
  const vals = arch.getDataRange().getValues();
  const ah = vals[0].map(String);
  const phoneCol = headerColByMatch_(arch, /^phone\s*number$/i);
  if (phoneCol < 1) throw new Error('Phone Number column not found.');

  let updates = 0;
  for (let r = 1; r < vals.length; r++) {
    const oldV = vals[r][phoneCol - 1];
    const norm = normalizePhone10_(oldV);
    if (norm && norm !== String(oldV)) {
      vals[r][phoneCol - 1] = norm;
      updates++;
    }
  }
  if (updates) arch.getDataRange().setValues(vals);
}

function cleanInvoice_(v) {
  const s0 = safeStr_(v);
  if (!s0) return '';
  const s = s0.replace(/\s+/g, ''); // strip spaces

  // discard known error tokens
  const U = s.toUpperCase();
  if (U === '#N/A' || U === '#VALUE!' || U === '#REF!' || U === '#DIV/0!' || U === '#ERROR!' || U === 'N/A' || U === 'NA') {
    return '';
  }

  // must be digits only; reject mixed or special characters
  if (!/^\d+$/.test(s)) return '';

  // gate very short/long tokens
  if (s.length < MIN_INVOICE_DIGITS || s.length > MAX_INVOICE_DIGITS) return '';

  return s;
}

function ensureDbHeader_(db) {
  const width = DB_HEADERS.length;
  db.getRange(1, 1, 1, width).setValues([DB_HEADERS]).setFontWeight('bold');
  // Widen key + text columns for readability
  db.setColumnWidths(1, 4, 160);
  db.setColumnWidths(5, width - 4, 140);
}

function readDbManuals_(db) {
  const m = new Map();
  const vals = db.getDataRange().getValues();
  if (vals.length < 2) return m;
  const hh = vals[0].map(String);
  const H = idxMap_(hh, {
    key: /^phone\s*\(key\-digit\-only\)$/i,
    aggro: /^aggro/i,
    dnc: /do\s*not\s*contact/i,
    notes: /^notes$/i,
    company: /^company$/i,
    account: /account.*(id|number)/i
  });
  for (let r = 1; r < vals.length; r++) {
    const key = safeStr_(vals[r][H.key]);
    if (!key) continue;
    m.set(key, {
      aggro: vals[r][H.aggro],
      dnc: vals[r][H.dnc] === true,
      notes: safeStr_(vals[r][H.notes]),
      company: safeStr_(vals[r][H.company]),
      account: safeStr_(vals[r][H.account])
    });
  }
  return m;
}


function idxMap_(headers, spec) {
  const o = {};
  for (const k of Object.keys(spec)) o[k] = -1;
  for (let i = 0; i < headers.length; i++) {
    const h = headers[i];
    for (const [k, rx] of Object.entries(spec)) {
      if (rx.test(h)) o[k] = i;
    }
  }
  // Critical checks for archive & db handled in callers when needed.
  return o;
}