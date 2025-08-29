
Editor
00 Globals.gs
000 Scheduled.gs
01 Primary Util.gs
02 Gmail Util.gs
03 Sheets Util.gs
04 Gmail Query.gs
10 Menu UI.gs
20 Call Interface.gs
21 Call Interface Util.gs
30 Call Log.gs
31 Call Log Util.gs
41 Vendor Extruflex.gs
42 Vendor Singer.gs
43 Vendor Other.gs
50 Export to Call Sheet.gs
55 Tracking.gs
66 Drafts.gs
88 Customer DB.gs
99 Phrases And Drafts.gs
zzz.gs
Gmail
Drive
Sheets
Docs
.

154555657585960616263646566676869707172737475767778798081828384858687888990919293949596979899100101102
function findCustomerRecordByPhone_(phone) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CUSTOMER_DB_SHEET);
  if (!sh) return { name:'', invoice:'', email:'' };

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 18) return { name:'', invoice:'', email:'' }; // need at least up to column R

  const data = sh.getRange(1, 1, lastRow, lastCol).getValues(); // includes header row

  const COL_PHONE = 1;  // A
  const COL_NAME  = 2;  // B
  const COL_EMAIL = 3;  // C
  const COL_INV   = 18; // R

  const q = normalizePhone_(phone);
  if (!q) return { name:'', invoice:'', email:'' };

  const last10 = q.length >= 10 ? q.slice(-10) : '';
  const last7  = q.length >= 7  ? q.slice(-7)  : '';

  let best = { score: -1, idx: -1 };

  for (let r = 1; r < data.length; r++) { // start at 1 to skip header
    const row = data[r];
    const dbRaw = row[COL_PHONE - 1];
    if (dbRaw === '' || dbRaw === null) continue;

    const db = normalizePhone_(dbRaw);
    if (!db) continue;

    const db10 = db.length >= 10 ? db.slice(-10) : '';
    const db7  = db.length >= 7  ? db.slice(-7)  : '';

    let score = -1;
    if (last10 && db10 && db10 === last10) score = 3;
    else if (db === q)                      score = 2;
    else if (last7 && db7 && db7 === last7) score = 1;
    else if (db.includes(q) || q.includes(db)) score = 0;

    if (score > best.score) best = { score, idx: r };
    if (best.score === 3) break; // early exit on strongest match
  }

  if (best.idx < 0) return { name:'', invoice:'', email:'' };

  const row = data[best.idx];
  return {
    name:    String(row[COL_NAME - 1]  ?? ''),
    invoice: String(row[COL_INV  - 1]  ?? ''), // ← Column R (most recent invoice)
    email:   String(row[COL_EMAIL - 1] ?? '')
  };
}

function findCustomerRecordByInvoice_(invoice) {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(CUSTOMER_DB_SHEET);
  if (!sh) return { phone:'', name:'', email:'' };

  const lastRow = sh.getLastRow();
  const lastCol = sh.getLastColumn();
  if (lastRow < 2 || lastCol < 18) return { phone:'', name:'', email:'' }; // need at least to column R

  // Norm
/**, ? of 2 found for 'HeaderIndex', at 1:14
Saving project… 
Saving project…
Save project to Drive