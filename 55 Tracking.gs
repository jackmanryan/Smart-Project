function processTracking() {
  const LOG = '[processTracking] ';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    Logger.log(LOG + 'Another run in progress.');
    return;
  }

  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/Los_Angeles';

    // ---- resolve target rolling sheet name "Tracking - 25MMDD"
    const now = new Date();
    const yy = (now.getFullYear() % 100).toString().padStart(2,'0');
    const mm = Utilities.formatDate(now, tz, 'MM');
    const dd = Utilities.formatDate(now, tz, 'dd');
    const sheetName = `Tracking - ${yy}${mm}${dd}`;

    // ---- find the latest tracking attachment (Extruflex)
    const labelName = (CONFIG && CONFIG.LABELS && CONFIG.LABELS.TRACKING_VENDOR) || 'Vendor/Extruflex/Tracking';
    const fromDomain = (CONFIG && CONFIG.ADDRESSES && CONFIG.ADDRESSES.VENDOR_DOMAIN) || '@extruflex.com';

    const q = `label:"${labelName}" from:${fromDomain} "Tracking Report"`;
    const threads = GmailApp.search(q, 0, 1); // newest
    Logger.log(`${LOG}query "${q}" → ${threads.length}`);

    if (!threads.length) {
      Logger.log(LOG + 'No matching Gmail threads found.');
      // Ensure the sheet exists with headers even if no data today
      const sh = _ensureTrackingSheet_(ss, sheetName);
      _ensureHeaders_(sh);
      return;
    }

    // Find a matching XLSX attachment in that thread
    const thread = threads[0];
    let targetAttachment = null;
    let attachmentName = '';

    outer:
    for (const m of thread.getMessages()) {
      const from = (m.getFrom() || '').toLowerCase();
      if (!from.includes('@extruflex.com')) continue; // vendor messages only
      for (const att of m.getAttachments()) {
        const nm = att.getName() || '';
        if (/^\d+\s*Tracking\s*Report(?:\s+Panamerica)?\.xlsx$/i.test(nm)) {
          targetAttachment = att;
          attachmentName = nm;
          break outer;
        }
      }
    }

    if (!targetAttachment) {
      Logger.log(LOG + 'No matching XLSX attachment found.');
      const sh = _ensureTrackingSheet_(ss, sheetName);
      _ensureHeaders_(sh);
      return;
    }

    // ---- convert XLSX → temp Google Sheet and read data
    let tempId;
    try {
      tempId = Drive.Files.insert(
        { title: `${attachmentName} (Converted)`, mimeType: MimeType.GOOGLE_SHEETS },
        targetAttachment.copyBlob()
      ).id;

      const tss = SpreadsheetApp.openById(tempId);
      const src = tss.getSheets()[0];
      const data = src.getDataRange().getValues();
      if (!data || data.length < 2) {
        Logger.log(LOG + 'Converted sheet has no data.');
        const sh = _ensureTrackingSheet_(ss, sheetName);
        _ensureHeaders_(sh);
        return;
      }

      // ---- robust header detection
      const syn = {
        bp:      ['bp reference no.','bp reference number','bp ref','bp ref no','bp ref #','bp reference'],
        doc:     ['document number','document no.','doc number','doc no.','document #','so number','sales order number','so'],
        post:    ['posting date','post date','posting'],
        ship:    ['shipping type','shipping method','ship method','carrier'],
        track:   ['tracking number','tracking no.','tracking #','tracking'],
        freight: ['freight','freight cost','shipping cost','freight amount']
      };

      const headerInfo = _findHeaderRow_(data, syn);
      const rowNorm = headerInfo.norm.length ? headerInfo.norm : (data[0] || []).map(_normHeader_);
      const idx = {
        bp:      _firstIndexBySyn_(rowNorm, syn.bp),
        doc:     _firstIndexBySyn_(rowNorm, syn.doc),
        post:    _firstIndexBySyn_(rowNorm, syn.post),
        ship:    _firstIndexBySyn_(rowNorm, syn.ship),
        track:   _firstIndexBySyn_(rowNorm, syn.track),
        freight: _firstIndexBySyn_(rowNorm, syn.freight)
      };
      const startRow = (headerInfo.row >= 0 ? headerInfo.row + 1 : 1);

      // ---- build normalized rows
      const headers = [
        'Customer/Vendor Code','BP Reference No.','Document Number',
        'Posting Date','Shipping type','Tracking Number','freight','Customer/Vendor Name'
      ];
      const rows = [];
      for (let r = startRow; r < data.length; r++) {
        const line = data[r];
        if (!line) continue;

        // skip empty-line rows
        if (line.map(v => v == null ? '' : String(v)).join('').trim() === '') continue;

        // skip repeated header rows
        const normLine = line.map(_normHeader_);
        const headerHits = [syn.bp, syn.doc, syn.post, syn.ship, syn.track, syn.freight]
          .reduce((acc, g) => acc + (g && normLine.some(h => g.includes(h)) ? 1 : 0), 0);
        if (headerHits >= 2) continue;

        const bpRef  = (idx.bp  !== -1 ? _asText_(line[idx.bp])   : '');
        const docNum = (idx.doc !== -1 ? _asText_(line[idx.doc])  : '');

        // Posting Date → keep as Date object; fallback to today
        let post = (idx.post !== -1 ? line[idx.post] : now);
        if (!(post instanceof Date)) {
          const tryD = new Date(_asText_(post));
          post = isNaN(tryD) ? now : tryD;
        }

        const ship   = (idx.ship   !== -1 ? _asText_(line[idx.ship])   : '');
        const track  = (idx.track  !== -1 ? _asText_(line[idx.track])  : '');

        // Freight default = 0 if missing/blank
        let freight = (idx.freight !== -1 ? line[idx.freight] : '');
        if (freight === '' || freight === null || freight === undefined) freight = 0;

        rows.push([
          'CUS12411',         // Customer/Vendor Code (default)
          bpRef,              // BP Reference No.
          docNum,             // Document Number (may be blank)
          post,               // Posting Date (Date object)
          ship,               // Shipping type
          track,              // Tracking Number
          freight,            // freight (0 default)
          'Panamerica Trade'  // Customer/Vendor Name (constant)
        ]);
      }

      // ---- ensure tracking sheet (rename any existing "Tracking - 25xxxx")
      let sh = ss.getSheetByName(sheetName);
      if (!sh) {
        const existing = ss.getSheets().find(s => /^Tracking\s*-\s*25\d{4}$/.test(s.getName()));
        if (existing) { existing.setName(sheetName); sh = existing; }
        else { sh = ss.insertSheet(sheetName); }
      }

      // ---- archive ALL existing data rows to "Tracking Log" (no date gating), then clear
      _archiveAllRowsToLog_(ss, sh);

      // ---- write headers and new data
      _ensureHeaders_(sh);
      if (rows.length) {
        sh.getRange(sh.getLastRow() + 1, 1, rows.length, headers.length).setValues(rows);
        // Format Posting Date (col 4) for display; keeps raw Date value
        sh.getRange(2, 4, rows.length, 1).setNumberFormat('mmm d, yyyy');
        // Optionally normalize 'freight' column (col 7) as numeric
        sh.getRange(2, 7, rows.length, 1).setNumberFormat('0.00');
      }
      Logger.log(`${LOG}wrote ${rows.length} row(s) to "${sheetName}".`);
    
      _cleanupTrackingLogByTrackingNumber_(ss);
      Logger.log(`${LOG}wrote ${rows.length} row(s) to "${sheetName}".`);
    } finally {
      // cleanup temp file
      // (ignore errors if file already removed)
      try { if (tempId) Drive.Files.remove(tempId); } catch (_) {}
    }
  } catch (e) {
    Logger.log(LOG + (e && e.stack || e));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

function _cleanupTrackingLogByTrackingNumber_(ss) {
  const LOG = '[cleanupTrackingLog] ';
  const sh = ss.getSheetByName('Tracking Log');
  if (!sh) { Logger.log(LOG + 'No "Tracking Log" sheet.'); return; }

  const lastRow = sh.getLastRow();
  const lastCol = Math.max(sh.getLastColumn(), 8);
  if (lastRow < 2) { Logger.log(LOG + 'No data rows to cleanup.'); return; }

  // Read all data rows
  const dataRange = sh.getRange(2, 1, lastRow - 1, lastCol);
  const data = dataRange.getValues();

  // Utility: normalize tracking number
  const normTrack = v => {
    if (v == null) return '';
    return String(v).replace(/[^A-Za-z0-9]/g, '').toUpperCase();
  };

  // Choose "better" row: newest Posting Date (col 4). Ties → keep existing.
  const pickBetter = (a, b) => {
    const aDate = (a[3] instanceof Date) ? a[3] : new Date(a[3]);
    const bDate = (b[3] instanceof Date) ? b[3] : new Date(b[3]);
    const aTs = isNaN(aDate) ? 0 : +aDate;
    const bTs = isNaN(bDate) ? 0 : +bDate;
    return (bTs > aTs) ? b : a;
  };

  // Build map of unique rows by normalized tracking number
  const byTrack = Object.create(null);
  const blanks = []; // rows with blank tracking number → keep as-is

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    const trkRaw = row[5]; // Column F (1-based)
    const key = normTrack(trkRaw);

    if (!key) { blanks.push(row); continue; } // skip duplicate analysis for blanks

    if (!byTrack[key]) {
      byTrack[key] = row;
    } else {
      byTrack[key] = pickBetter(byTrack[key], row);
    }
  }

  // Collect unique rows (non-blanks) + blanks; sort newest first by Posting Date
  const uniques = Object.keys(byTrack).map(k => byTrack[k]);
  const allKeep = uniques.concat(blanks).sort((a, b) => {
    const ad = (a[3] instanceof Date) ? +a[3] : +new Date(a[3]) || 0;
    const bd = (b[3] instanceof Date) ? +b[3] : +new Date(b[3]) || 0;
    return bd - ad;
  });

  // If nothing changed, exit early
  const sameLength = allKeep.length === data.length;
  let identical = sameLength;
  if (sameLength) {
    for (let r = 0; r < data.length && identical; r++) {
      const A = data[r], B = allKeep[r];
      for (let c = 0; c < lastCol; c++) {
        const av = A[c], bv = B[c];
        if ((av instanceof Date) && (bv instanceof Date)) {
          if (+av !== +bv) { identical = false; break; }
        } else if (String(av) !== String(bv)) { identical = false; break; }
      }
    }
  }
  if (identical) { Logger.log(LOG + 'No changes after de-duplication.'); return; }

  // Rewrite rows 2..N
  sh.getRange(2, 1, lastRow - 1, sh.getLastColumn()).clearContent();
  if (allKeep.length) {
    sh.getRange(2, 1, allKeep.length, lastCol).setValues(allKeep);
    // Re-apply display formats for Date (col 4) and Freight (col 7) if present
    if (lastCol >= 4) sh.getRange(2, 4, allKeep.length, 1).setNumberFormat('mmm d, yyyy');
    if (lastCol >= 7) sh.getRange(2, 7, allKeep.length, 1).setNumberFormat('0.00');
  }

  Logger.log(`${LOG}De-duplicated by Tracking Number: kept ${allKeep.length} of ${data.length} rows.`);
}

// Normalize header cell → token
function _normHeader_(v) {
  if (v == null) return '';
  return String(v)
    .replace(/\u00A0/g, ' ')       // NBSP → space
    .replace(/[\u200B-\u200D]/g,'')// zero-widths
    .replace(/\s+/g, ' ')          // collapse spaces
    .trim()
    .toLowerCase();
}

// Find likely header row by matching synonyms
function _findHeaderRow_(data, syn) {
  const maxScan = Math.min(15, data.length);
  let best = { row: -1, score: -1, norm: [] };
  for (let r = 0; r < maxScan; r++) {
    const raw = data[r] || [];
    const norm = raw.map(_normHeader_);
    let score = 0;
    const groups = [syn.bp, syn.doc, syn.post, syn.ship, syn.track, syn.freight];
    groups.forEach(g => {
      if (g && norm.some(h => g.includes(h))) score++;
    });
    if (score > best.score) best = { row: r, score, norm };
  }
  if (best.score < 2) return { row: -1, norm: [] };
  return best;
}

function _firstIndexBySyn_(rowNorm, candidates) {
  if (!candidates || !candidates.length) return -1;
  for (let j = 0; j < rowNorm.length; j++) {
    if (candidates.includes(rowNorm[j])) return j;
  }
  return -1;
}

function _asText_(v) {
  if (v == null) return '';
  return String(v).trim();
}

function _ensureTrackingSheet_(ss, sheetName) {
  let sh = ss.getSheetByName(sheetName);
  if (!sh) {
    const existing = ss.getSheets().find(s => /^Tracking\s*-\s*25\d{4}$/.test(s.getName()));
    if (existing) { existing.setName(sheetName); sh = existing; }
    else { sh = ss.insertSheet(sheetName); }
  }
  return sh;
}

function _ensureHeaders_(sh) {
  const headers = [
    'Customer/Vendor Code','BP Reference No.','Document Number',
    'Posting Date','Shipping type','Tracking Number','freight','Customer/Vendor Name'
  ];
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  } else {
    // Overwrite header row to guarantee correct columns/order
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    sh.setFrozenRows(1);
  }
}

/*** This is where we will put scripts that create things in */
/**
 * One-time backfill: pull the last N matching tracking reports from Gmail,
 * parse like processTracking(), and append normalized rows to "Tracking Log".
 * Idempotency: runs _cleanupTrackingLogByTrackingNumber_() after append.
 *
 * Requires Advanced Drive Service (Drive API v2) enabled — same as processTracking().
 */
function backfillTrackingReports(limit /* optional */) {
  const LOG = '[backfillTrackingReports] ';
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) { Logger.log(LOG + 'Another run in progress.'); return; }

  const N = Math.max(1, Number(limit || 10));

  try {
    const ss = SpreadsheetApp.getActive();
    const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/Los_Angeles';
    const now = new Date();

    const labelName = (CONFIG && CONFIG.LABELS && CONFIG.LABELS.TRACKING_VENDOR) || 'Vendor/Extruflex/Tracking';
    const fromDomain = (CONFIG && CONFIG.ADDRESSES && CONFIG.ADDRESSES.VENDOR_DOMAIN) || '@extruflex.com';

    const attachments = _collectRecentTrackingAttachments_(labelName, fromDomain, N);
    Logger.log(`${LOG}found ${attachments.length} attachment(s) to process (target=${N}).`);
    if (!attachments.length) return;

    const allRows = [];
    for (const att of attachments) {
      let tempId;
      try {
        tempId = Drive.Files.insert(
          { title: `${att.name} (Converted)`, mimeType: MimeType.GOOGLE_SHEETS },
          att.blob
        ).id;

        const tss = SpreadsheetApp.openById(tempId);
        const src = tss.getSheets()[0];
        const data = src.getDataRange().getValues();
        if (!data || data.length < 2) { Logger.log(LOG + `no rows in ${att.name}`); continue; }

        const rows = _parseTrackingTableToRows_(data, now, tz);
        if (rows.length) allRows.push(...rows);
        Logger.log(`${LOG}${att.name}: +${rows.length} row(s)`);
      } finally {
        try { if (tempId) Drive.Files.remove(tempId); } catch (_) {}
      }
    }

    if (!allRows.length) { Logger.log(LOG + 'No parsed rows.'); return; }

    _appendToTrackingLog_(ss, allRows);
    _cleanupTrackingLogByTrackingNumber_(ss);

    Logger.log(`${LOG}Appended ${allRows.length} row(s) → Tracking Log, then de-duped.`);
  } catch (e) {
    Logger.log(LOG + (e && e.stack || e));
    throw e;
  } finally {
    lock.releaseLock();
  }
}

/** Prompt for a custom count, then run backfill. */
function backfillTrackingReportsPrompt() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Backfill Tracking', 'How many reports should I ingest? (default 10)', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const n = Number(res.getResponseText() || '10');
  backfillTrackingReports(isFinite(n) && n > 0 ? n : 10);
}

/** Collect up to maxCount matching XLSX tracking attachments, newest → oldest. */
function _collectRecentTrackingAttachments_(labelName, fromDomain, maxCount) {
  const out = [];
  const lab = GmailApp.getUserLabelByName(labelName);
  if (!lab) return out;

  // Pull a generous window of threads; stop when we have enough attachments.
  const threads = lab.getThreads(0, 100); // newest first
  const RX = /^\d+\s*Tracking\s*Report(?:\s+Panamerica)?(?:\s*\(\d+\))?\.xlsx$/i;

  for (const th of threads) {
    if (out.length >= maxCount) break;

    // newest messages first inside thread
    const msgs = th.getMessages().sort((a,b)=>b.getDate().getTime()-a.getDate().getTime());
    for (const m of msgs) {
      const fromLc = (m.getFrom() || '').toLowerCase();
      if (!fromLc.includes(fromDomain.toLowerCase())) continue;

      const atts = m.getAttachments() || [];
      for (const a of atts) {
        const nm = a.getName() || '';
        if (RX.test(nm)) {
          out.push({ blob: a.copyBlob(), name: nm, when: m.getDate(), threadId: th.getId() });
          if (out.length >= maxCount) break;
        }
      }
      if (out.length >= maxCount) break;
    }
  }
  return out;
}

/** Normalize a converted tracking sheet into rows for Tracking Log (8 cols). */
function _parseTrackingTableToRows_(data, now, tz) {
  const syn = {
    bp:      ['bp reference no.','bp reference number','bp ref','bp ref no','bp ref #','bp reference'],
    doc:     ['document number','document no.','doc number','doc no.','so number','sales order number','so','order number'],
    post:    ['posting date','post date','posting'],
    ship:    ['shipping type','shipping method','ship method','carrier'],
    track:   ['tracking number','tracking no.','tracking #','tracking'],
    freight: ['freight','freight cost','shipping cost','freight amount']
  };

  const headerInfo = _findHeaderRow_(data, syn); // uses your existing helper
  const rowNorm = headerInfo.norm.length ? headerInfo.norm : (data[0] || []).map(_normHeader_);
  const idx = {
    bp:      _firstIndexBySyn_(rowNorm, syn.bp),
    doc:     _firstIndexBySyn_(rowNorm, syn.doc),
    post:    _firstIndexBySyn_(rowNorm, syn.post),
    ship:    _firstIndexBySyn_(rowNorm, syn.ship),
    track:   _firstIndexBySyn_(rowNorm, syn.track),
    freight: _firstIndexBySyn_(rowNorm, syn.freight)
  };
  const startRow = (headerInfo.row >= 0 ? headerInfo.row + 1 : 1);

  const headers = [
    'Customer/Vendor Code','BP Reference No.','Document Number',
    'Posting Date','Shipping type','Tracking Number','freight','Customer/Vendor Name'
  ];

  const rows = [];
  for (let r = startRow; r < data.length; r++) {
    const line = data[r];
    if (!line) continue;

    // skip empty or repeat header lines
    if (line.map(v => v == null ? '' : String(v)).join('').trim() === '') continue;
    const normLine = line.map(_normHeader_);
    const headerHits = [syn.bp, syn.doc, syn.post, syn.ship, syn.track, syn.freight]
      .reduce((acc, g) => acc + (g && normLine.some(h => g.includes(h)) ? 1 : 0), 0);
    if (headerHits >= 2) continue;

    const _txt = v => (v == null ? '' : String(v).trim());

    const bpRef  = (idx.bp  !== -1 ? _txt(line[idx.bp])   : '');
    const docNum = (idx.doc !== -1 ? _txt(line[idx.doc])  : '');

    // Posting Date → Date object; handle Excel serials & strings
    let post = (idx.post !== -1 ? line[idx.post] : now);
    if (typeof post === 'number') {
      const ms = Math.round((post - 25569) * 86400000); // Excel serial → ms
      post = new Date(ms);
    } else if (!(post instanceof Date)) {
      const tryD = new Date(_txt(post));
      post = isNaN(tryD) ? now : tryD;
    }

    const ship   = (idx.ship   !== -1 ? _txt(line[idx.ship])   : '');
    const track  = (idx.track  !== -1 ? _txt(line[idx.track])  : '');

    let freight = (idx.freight !== -1 ? line[idx.freight] : '');
    if (freight === '' || freight === null || freight === undefined) freight = 0;

    rows.push([
      'CUS12411',         // Customer/Vendor Code (default)
      bpRef,              // BP Reference No.
      docNum,             // Document Number
      post,               // Posting Date (Date)
      ship,               // Shipping type
      track,              // Tracking Number
      freight,            // freight (numeric/0)
      'Panamerica Trade'  // Customer/Vendor Name (constant)
    ]);
  }
  return rows;
}

/** Append normalized rows to "Tracking Log" with headers & basic formatting. */
function _appendToTrackingLog_(ss, rows) {
  const headers = [
    'Customer/Vendor Code','BP Reference No.','Document Number',
    'Posting Date','Shipping type','Tracking Number','freight','Customer/Vendor Name'
  ];
  const sh = ss.getSheetByName('Tracking Log') || ss.insertSheet('Tracking Log');

  // Ensure headers and frozen row
  if (sh.getLastRow() === 0) {
    sh.appendRow(headers);
    sh.setFrozenRows(1);
  } else {
    sh.getRange(1,1,1,headers.length).setValues([headers]); // enforce order
    sh.setFrozenRows(1);
  }

  const start = sh.getLastRow() + 1;
  sh.getRange(start, 1, rows.length, headers.length).setValues(rows);

  // Format Posting Date (col 4) & Freight (col 7)
  sh.getRange(start, 4, rows.length, 1).setNumberFormat('mmm d, yyyy');
  sh.getRange(start, 7, rows.length, 1).setNumberFormat('0.00');
}

