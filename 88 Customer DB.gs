
/* Standardized DB header (adds new, preserves your manual fields). */
const DB_HEADERS = [
  'Phone (key-digit-only)',         // 1  key
  'Customer Name (Latest)',         // 2  computed
  'Primary Email (Latest)',         // 3  computed
  'Company',                        // 4  manual (preserved)
  'Account ID / Number',            // 5  manual (preserved)
  'Customer Open Orders',           // 6  manual/placeholder (preserved)
  'Customer Closed Orders',         // 7  manual/placeholder (preserved)
  'First Seen (Call Archive)',      // 8  computed (date)
  'Last Seen (Call Archive)',       // 9  computed (datetime)
  'Total Calls (Call Archive)',     // 10 computed
  'Calls (Last 7d)',                // 11 computed (now - 7d)
  'Calls (Last 14d)',               // 12 computed (now - 14d)
  'Last Category',                  // 13 computed
  'Last Status',                    // 14 computed
  'Last Receiver',                  // 15 computed
  'Last Subject',                   // 16 computed
  'Last Gmail Link',                // 17 computed
  'Last Invoice / Identifier',      // 18 computed
  'Province/State (Latest)',        // 19 computed
  'Aggro Scale (1–5)',              // 20 manual (preserved)
  'Do Not Contact (DNC)',           // 21 manual checkbox (preserved)
  'Notes'                           // 22 manual (preserved)
];

/***** MAIN: rebuild DB from Call Archive *****/
function rebuildCustomerDB() {
  const ss   = SpreadsheetApp.getActive();
  const arch = mustSheet_(SHEET_ARCHIVE);
  const db   = ss.getSheetByName(SHEET_DB) || ss.insertSheet(SHEET_DB);

  const archVals = arch.getDataRange().getValues();
  if (archVals.length < 2) {
    ensureDbHeader_(db);
    return;
  }
  const ah = archVals[0].map(String);
  const A = idxMap_(ah, {
    date: /^date$/i,
    time: /^time$/i,
    phone: /^phone\s*number$/i,
    name: /^name$/i,
    email: /^email$/i,
    province: /^(state|province)/i,
    status: /^status$/i,
    category: /^category$/i,
    receiver: /^recie?ver$/i, // handles "Reciever" misspelling
    subject: /^subject$/i,
    gmail: /^gmail\s*link$/i,
    invoice_id: /^\s*invoice[\s\S]*identifier\s*$|^\s*identifier[\s\S]*invoice\s*$|^\s*invoice\s*$/i
  });
  const INVOICE_IDX_FALLBACK = 5;

  // Preserve manual fields from existing DB
  const keep = readDbManuals_(db);

  // Aggregate by normalized 10-digit phone
  const now = new Date();
  const t7  = addDays_(now, -7);
  const t14 = addDays_(now, -14);

  const agg = {}; // phone10 -> stats
  for (let r = 1; r < archVals.length; r++) {
    const row = archVals[r];
    const phone10 = normalizePhone10_(row[A.phone]);
    if (!phone10) continue;

    const dt = parseDateTime_(row[A.date], row[A.time]);
    if (!dt) continue;

    // --- aggregator row (MUST come before using `a`) ---
    let a = agg[phone10];
    if (!a) {
      a = agg[phone10] = {
        phone10,
        first: dt,          // earliest seen
        last: dt,           // latest seen (for "last*" fields other than invoice)
        total: 0,
        last7: 0,
        last14: 0,
        lastName: '',
        lastEmail: '',
        lastProv: '',
        lastStatus: '',
        lastCat: '',
        lastRecv: '',
        lastSubj: '',
        lastGmail: '',
        lastInv: '',
        lastInvAt: new Date(0) // timestamp of last valid invoice
      };
    }

    // --- read fields (safe to call even when header not found; safeStr_ handles undefined) ---
    const name  = safeStr_(row[A.name]);
    const email = safeStr_(row[A.email]);
    const prov  = safeStr_(row[A.province]);
    const status= safeStr_(row[A.status]);
    const cat   = safeStr_(row[A.category]);
    const recv  = safeStr_(row[A.receiver]);
    const subj  = safeStr_(row[A.subject]);
    const gmail = safeStr_(row[A.gmail]);

    // Invoice/ID from header or fallback to column F (0-based index 5)
    const invIdx = (A.invoice_id >= 0 ? A.invoice_id : 5);
    const invRaw = row[invIdx];
    const inv    = cleanInvoice_(invRaw);

    // --- metrics / windows ---
    a.total++;
    if (dt >= t7)  a.last7++;
    if (dt >= t14) a.last14++;
    if (dt < a.first) a.first = dt;

    // --- track latest *valid* invoice by its own timestamp ---
    if (inv && dt >= a.lastInvAt) {
      a.lastInv   = inv;
      a.lastInvAt = dt;
    }

    // --- "last row wins" for other "last*" fields ---
    if (dt >= a.last) {
      a.last = dt;
      if (name)   a.lastName   = name;
      if (email)  a.lastEmail  = email;
      if (prov)   a.lastProv   = prov;
      if (status) a.lastStatus = status;
      if (cat)    a.lastCat    = cat;
      if (recv)   a.lastRecv   = recv;
      if (subj)   a.lastSubj   = subj;
      if (gmail)  a.lastGmail  = gmail;
    }
  }

  // Flatten rows in DB order
  const rows = Object.values(agg)
    .sort((x, y) => y.last - x.last)
    .map(a => ([
      a.phone10,                         // 1
      a.lastName || '',                  // 2
      a.lastEmail || '',                 // 3
      keep.get(a.phone10)?.company || '',// 4
      keep.get(a.phone10)?.account || '',// 5
      keep.get(a.phone10)?.open || '',   // 6
      keep.get(a.phone10)?.closed || '', // 7
      toDateOnly_(a.first),              // 8
      a.last,                            // 9
      a.total,                           // 10
      a.last7,                           // 11
      a.last14,                          // 12
      a.lastCat || '',                   // 13
      a.lastStatus || '',                // 14
      a.lastRecv || '',                  // 15
      a.lastSubj || '',                  // 16
      a.lastGmail || '',                 // 17
      a.lastInv || '',                   // 18
      a.lastProv || '',                  // 19
      keep.get(a.phone10)?.aggro || '',  // 20
      keep.get(a.phone10)?.dnc || false, // 21
      keep.get(a.phone10)?.notes || ''   // 22
    ]));

  // Write output
  ensureDbHeader_(db);
  db.getRange(2, 1, Math.max(db.getMaxRows()-1, 1), DB_HEADERS.length).clearContent().clearFormat();
  if (rows.length) db.getRange(2, 1, rows.length, DB_HEADERS.length).setValues(rows);

  // Validation + checkboxes
  if (rows.length) {
    const aggroCol = headerCol_(db, 'Aggro Scale (1–5)');
    const dncCol   = headerCol_(db, 'Do Not Contact (DNC)');
    if (aggroCol > 0) {
      const rule = SpreadsheetApp.newDataValidation().requireNumberBetween(1,5).setAllowInvalid(false).build();
      db.getRange(2, aggroCol, rows.length, 1).setDataValidation(rule);
    }
    if (dncCol > 0) {
      const rng = db.getRange(2, dncCol, rows.length, 1);
      rng.insertCheckboxes();
    }
  }

  db.setFrozenRows(1);
  SpreadsheetApp.flush();
}

/***** ACTION: fill blanks in Call Archive from DB *****/
function backfillArchiveFromCustomerDB() {
  const arch = mustSheet_(SHEET_ARCHIVE);
  const db   = mustSheet_(SHEET_DB);

  const dbVals = db.getDataRange().getValues();
  const dh = dbVals[0].map(String);
  const D = idxMap_(dh, {
    key: /^phone\s*\(key\-digit\-only\)$/i,
    name: /^customer\s*name/i,
    email: /^primary\s*email/i
  });

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
    name:  /^name$/i,
    email: /^email$/i
  });

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

    if (!curName && ref.name)  { row[A.name]  = ref.name;  change = true; }
    if (!curEmail && ref.email){ row[A.email] = ref.email; change = true; }

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
  const ah   = vals[0].map(String);
  const phoneCol = headerColByMatch_(arch, /^phone\s*number$/i);
  if (phoneCol < 1) throw new Error('Phone Number column not found.');

  let updates = 0;
  for (let r = 1; r < vals.length; r++) {
    const oldV = vals[r][phoneCol-1];
    const norm = normalizePhone10_(oldV);
    if (norm && norm !== String(oldV)) {
      vals[r][phoneCol-1] = norm;
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
  db.setColumnWidths(5, width-4, 140);
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
    account: /account.*(id|number)/i,
    open: /customer\s*open\s*orders/i,
    closed: /customer\s*closed\s*orders/i
  });
  for (let r = 1; r < vals.length; r++) {
    const key = safeStr_(vals[r][H.key]);
    if (!key) continue;
    m.set(key, {
      aggro: vals[r][H.aggro],
      dnc: vals[r][H.dnc] === true,
      notes: safeStr_(vals[r][H.notes]),
      company: safeStr_(vals[r][H.company]),
      account: safeStr_(vals[r][H.account]),
      open: vals[r][H.open],
      closed: vals[r][H.closed]
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