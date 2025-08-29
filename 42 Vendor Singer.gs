/** Accepts Date, Excel-serial, or "MM/DD/YY|YYYY" string; returns Date or '' */
function normalizeSingerDate(v) {
  if (!v) return '';
  if (v instanceof Date) return v;
  if (typeof v === 'number') {
    // Excel serial → JS Date
    return new Date(Math.round((v - 25569) * 86400000));
  }
  if (typeof v === 'string') {
    const s = v.trim();
    if (!s) return '';
    // Try MM/DD/YY or MM/DD/YYYY
    const m = s.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2}|\d{4})$/);
    if (m) {
      const mm = +m[1], dd = +m[2], yy = +m[3];
      const yyyy = (String(yy).length === 2) ? (2000 + yy) : yy;
      const d = new Date(yyyy, mm - 1, dd);
      return isNaN(d) ? '' : d;
    }
    // Last resort: Date parser
    const d2 = new Date(s);
    return isNaN(d2) ? '' : d2;
  }
  return '';
}

/** Find the most recent prior "Singer Safety MMddyy" sheet (by name suffix date). */
function findPreviousSingerSheet(ss, currentName) {
  const PREFIX = 'Singer Safety ';
  const cur = ss.getSheetByName(currentName);
  const sheets = ss.getSheets()
    .filter(sh => sh.getName().startsWith(PREFIX) && sh.getName() !== currentName)
    .map(sh => {
      const m = sh.getName().slice(PREFIX.length).match(/^(\d{6})$/); // MMddyy
      if (!m) return null;
      const s = m[1];
      const mm = +s.slice(0,2), dd = +s.slice(2,4), yy = 2000 + +s.slice(4,6);
      return { sh, when: new Date(yy, mm - 1, dd).getTime() };
    })
    .filter(Boolean)
    .sort((a,b) => b.when - a.when);

  return sheets.length ? sheets[0].sh : null;
}


/** Singer Safety: import "STRIP CURTAIN ORDER STATUS LOG.xlsx" into a new sheet */
function processSingerSafetyStatusLog() {
  const LOG = '[processSingerSafetyStatusLog] ';
  const OOR_LABEL = CONFIG.LABELS.SINGER_OOR || 'Vendor/Singer Safety/OOR';
  const SENDER_DOMAIN = (CONFIG.ADDRESSES && CONFIG.ADDRESSES.SINGER_DOMAIN) || '@singersafety.com';
  const FILE_RE = /^strip curtain order status log\.xlsx$/i;
  const SSID = CONFIG.SHEETS.TRACKING_ID;

  Log.info(`${LOG}start`);

  const label = GmailApp.getUserLabelByName(OOR_LABEL);
  if (!label) return Log.err(`${LOG}Label "${OOR_LABEL}" not found`);

  // newest thread under label with the Singer attachment
  const threads = label.getThreads(0, 20);
  Log.info(`${LOG}scanning ${threads.length} thread(s) under ${OOR_LABEL}`);

  let targetAttachment = null, attachmentName = '', chosenThread = null;
  for (const th of threads) {
    const msgs = th.getMessages();
    for (let i = msgs.length - 1; i >= 0; i--) {
      const m = msgs[i];
      const from = (m.getFrom() || '').toLowerCase();
      if (!from.includes(SENDER_DOMAIN)) continue;
      for (const att of m.getAttachments()) {
        const nm = (att.getName() || '').trim();
        if (FILE_RE.test(nm)) { targetAttachment = att; attachmentName = nm; chosenThread = th; break; }
      }
      if (targetAttachment) break;
    }
    if (targetAttachment) break;
  }
  if (!targetAttachment) return Log.warn(`${LOG}no matching "${FILE_RE}" attachment under ${OOR_LABEL}`);

  Log.info(`${LOG}using attachment "${attachmentName}" from thread "${chosenThread.getFirstMessageSubject()}"`);

  const ss = SpreadsheetApp.openById(SSID);
  const tz = (typeof ss.getSpreadsheetTimeZone === 'function' && ss.getSpreadsheetTimeZone()) ||
             Session.getScriptTimeZone() || 'America/Chicago';
  const todayName = 'Singer Safety ' + Utilities.formatDate(new Date(), tz, 'MMddyy');

  // Ensure today's sheet exists (don’t delete)
  let out = ss.getSheetByName(todayName);
  if (!out) {
    out = ss.insertSheet(todayName);
    const HEADERS = ['Sage Sale/Invoice #','Document #','Estimated Ship','Actual Ship','Carrier','Tracking'];
    out.getRange(1,1,1,HEADERS.length).setValues([HEADERS]);
    out.setFrozenRows(1);
  }

  // Existing docs in today's sheet
  const existingDocs = new Set();
  if (out.getLastRow() >= 2) {
    out.getRange(2, 2, out.getLastRow() - 1, 1).getValues().flat()
      .forEach(v => { if (v !== '' && v !== null) existingDocs.add(String(v).trim()); });
  }

  // Previous Singer sheet (for Closed delta)
  const prevSheet = findPreviousSingerSheet(ss, todayName);
  const prevDocs = new Set();
  if (prevSheet && prevSheet.getLastRow() >= 2) {
    prevSheet.getRange(2, 2, prevSheet.getLastRow() - 1, 1).getValues().flat()
      .forEach(v => { if (v !== '' && v !== null) prevDocs.add(String(v).trim()); });
  }

  // Convert XLSX → temp Google Sheet → read both tabs
  let tempId;
  try {
    tempId = Drive.Files.insert(
      { title: `${attachmentName} (Converted)`, mimeType: MimeType.GOOGLE_SHEETS },
      targetAttachment.copyBlob()
    ).id;

    const tss = SpreadsheetApp.openById(tempId);
    const tabs = tss.getSheets().filter(sh => /open|closed/i.test(sh.getName()));
    if (!tabs.length) {
      Log.warn(`${LOG}no "open"/"closed" sheets found; reading first sheet as fallback`);
      tabs.push(tss.getSheets()[0]);
    }

    const rowsToAppend = [];
    for (const src of tabs) {
      const isClosedTab = /closed/i.test(src.getName());
      const data = src.getDataRange().getValues();
      if (!data || data.length < 2) continue;

      const hdr = (data[0] || []).map(v => String(v || '').trim().toLowerCase());
      let idx = {
        po:    findHeaderIndex(hdr, ['po#','po #','po no','po number']),
        so:    findHeaderIndex(hdr, ['singer safety order#','singer safety order #','singer safety order no','order#','order #','order no','order number']),
        proj:  findHeaderIndex(hdr, ['projected ship','projected ship date','est ship','estimated ship','estimated ship date']),
        act:   findHeaderIndex(hdr, ['actual ship','actual ship date','ship date']),
        carr:  findHeaderIndex(hdr, ['carrier']),
        track: findHeaderIndex(hdr, ['tracking #','tracking number','tracking'])
      };

      let usingFallback = false;
      if (Object.values(idx).some(v => v === -1)) {
        idx = { po:1, so:2, proj:3, act:4, carr:5, track:6 }; // B-G
        usingFallback = true;
        Log.warn(`${LOG}${src.getName().toUpperCase()}: header match incomplete; using B–G fallback mapping`);
      }

      for (let r = 1; r < data.length; r++) {
        const row = data[r];
        if (!row || row.every(v => v === '' || v === null)) continue;

        // Guard: if fallback, skip rows that look like header rows
        if (usingFallback && isProbablyHeaderRow(row, idx)) continue;

        const po    = safeCell(row, idx.po);
        const so    = safeCell(row, idx.so);
        const proj  = normalizeSingerDate(safeCell(row, idx.proj));
        const act   = normalizeSingerDate(safeCell(row, idx.act));
        const carr  = safeCell(row, idx.carr);
        const track = safeCell(row, idx.track);

        const docKey = String(so || '').trim();
        if (!docKey) continue;

        // Dedupe vs today's sheet
        if (existingDocs.has(docKey)) continue;

        // For CLOSED only: exclude anything that already existed in the previous sheet
        if (isClosedTab && prevDocs.size && prevDocs.has(docKey)) continue;

        rowsToAppend.push([po, docKey, proj, act, carr, track]);
        existingDocs.add(docKey);
      }
    }

    if (rowsToAppend.length) {
      const startRow = out.getLastRow() + 1;
      out.getRange(startRow, 1, rowsToAppend.length, 6).setValues(rowsToAppend);
      out.getRange(startRow, 3, rowsToAppend.length, 2).setNumberFormat('dd/MM/yy'); // C & D
    }

    Log.info(`${LOG}appended ${rowsToAppend.length} new row(s) to "${todayName}"`);
  } catch (e) {
    Log.err(`${LOG}${e}`);
    throw e;
  } finally {
    if (tempId) { try { Drive.Files.remove(tempId); } catch (_) {} }
  }

  Log.info(`${LOG}done`);
}

function safeCell(row, i) {
  return (i >= 0 && i < row.length) ? row[i] : '';
}