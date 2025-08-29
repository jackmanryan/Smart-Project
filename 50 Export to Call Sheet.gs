
function myButtonAction() {
  const ss = SpreadsheetApp.getActive();
  const DEBUG = (typeof DEBUG_MODE === 'boolean') ? DEBUG_MODE : false;

  if (typeof setStatus_ === 'function') setStatus_('Pushing Export → Target…');
  if (DEBUG) ss.toast("Starting export → target push…", "Notification", 3);

  try {
    const rows = pushExportA3A_toTargetA2();  // ← removed perf arg
    if (DEBUG) ss.toast(`Done. Pushed ${rows} row(s).`, "Export → Target", 4);
    if (typeof setStatus_ === 'function') setStatus_('Ready');
  } catch (err) {
    if (DEBUG) ss.toast(`Push failed: ${err}`, "Export → Target", 6);
    if (typeof setStatus_ === 'function') setStatus_('Push failed');
    throw err;
  }
}

function updateExportTimestamp_(prefix = 'Last Updated') {
  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName('Export');
  if (!sh) throw new Error('Sheet "Export" not found.');
  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/Los_Angeles';
  const stamp = Utilities.formatDate(new Date(), tz, 'EEE HH:mm'); // e.g., "Wed 11:48"
  sh.getRange('A1').setValue(`${prefix} ${stamp}`);
  return stamp; // convenient for toasts/logs
}

function pushExportA3A_toTargetA2() {
  const srcSS    = SpreadsheetApp.getActiveSpreadsheet();
  const srcSheet = srcSS.getSheetByName(SOURCE_SHEET_NAME);
  if (!srcSheet) throw new Error(`Source sheet "${SOURCE_SHEET_NAME}" not found.`);

  const lastRow = srcSheet.getLastRow();
  const numRows = Math.max(0, lastRow - SOURCE_START_ROW + 1);

  let rows = [];
  if (numRows > 0) {
    const disp = srcSheet.getRange(SOURCE_START_ROW, 1, numRows, 1).getDisplayValues();
    rows = disp
      .map(r => String(r[0] || ''))
      .filter(s => s.trim() !== '')
      .map(s => [ s ]); // ← copy as-is (already normalized by the sheet)
  }

  const tgtSS    = SpreadsheetApp.openById(TARGET_SPREADSHEET_ID);
  const tgtSheet = TARGET_SHEET_NAME ? tgtSS.getSheetByName(TARGET_SHEET_NAME) : tgtSS.getActiveSheet();
  if (!tgtSheet) throw new Error(`Target sheet "${TARGET_SHEET_NAME}" not found.`);

  tgtSheet.getRange('A2:A').clearContent();

  if (rows.length === 0) {
    SpreadsheetApp.getActive().toast('No rows to push (source empty).', 'Push Export→Target', 4);
    return 0;
  }

  const neededLast = TARGET_START_ROW + rows.length - 1;
  const maxRows = tgtSheet.getMaxRows();
  if (neededLast > maxRows) tgtSheet.insertRowsAfter(maxRows, neededLast - maxRows);

  const writeRange = tgtSheet.getRange(TARGET_START_ROW, TARGET_COLUMN, rows.length, 1);
  writeRange.setValues(rows);
  writeRange.setWrap(true);

  if (typeof updateExportTimestamp_ === 'function') {
    const hhmm = updateExportTimestamp_();
    SpreadsheetApp.getActive().toast(`Pushed ${rows.length} row(s) @ ${hhmm}`, 'Export → Target', 4);
  } else {
    SpreadsheetApp.getActive().toast(`Pushed ${rows.length} row(s)`, 'Export → Target', 4);
  }
  return rows.length;
}

function normalizeBlockNoQuotesFillNA(input) {
  const s = String(input).replace(/\r\n?/g, '\n');

  // Accept with/without outer quotes; capture 7 labeled lines (Message can be multi-line)
  const re =
    /^"?Time:\s*(.*?)\nPhone:\s*(.*?)\nName:\s*(.*?)\nEmail:\s*(.*?)\nInvoice:\s*(.*?)\nMessage:\s*([\s\S]*?)\nTransfer to:\s*(.*?)"?$/;

  const naIfBlank = (v) => (String(v ?? '').trim() === '' ? 'n / a' : String(v));

  const m = s.match(re);
  if (m) {
    const time       = naIfBlank(m[1]);
    const phone      = naIfBlank(m[2]);
    const name       = naIfBlank(m[3]);
    const email      = naIfBlank(m[4]);
    const invoice    = naIfBlank(m[5]);
    const message    = naIfBlank(m[6]); // preserve inner newlines if present
    const transferTo = naIfBlank(m[7]);

    return [
      `Time: ${time}`,
      `Phone: ${phone}`,
      `Name: ${name}`,
      `Email: ${email}`,
      `Invoice: ${invoice}`,
      `Message: ${message}`,
      `Transfer to: ${transferTo}`
    ].join('\n');
  }

  // Not a labeled block → treat entire cell as Message; others to n / a
  return [
    `Time: n / a`,
    `Phone: n / a`,
    `Name: n / a`,
    `Email: n / a`,
    `Invoice: n / a`,
    `Message: ${naIfBlank(s)}`,
    `Transfer to: n / a`
  ].join('\n');
}
