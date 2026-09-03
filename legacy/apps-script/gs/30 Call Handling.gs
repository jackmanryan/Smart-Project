/** ============================================================================
 * Call Log & Archive Maintenance
 * ----------------------------------------------------------------------------
 * Purpose
 *   Keep Call Log/Call Archive tidy, fast, and consistent:
 *   - Seed only lightweight helper formulas in Call Archive (bounded, not full columns)
 *   - Compute counters/links/area values as static values for Call Log rows when appended
 *   - Move aged rows to Call Archive; optional "keep top 3" utility
 *   - Normalize required blanks to CONFIG.NA_VALUE
 *   - Keep Archive layout (headers/width) in sync with Call Log
 *   - Quick sort by time for both sheets
 *
 * Entry points (safe to wire to menu or time triggers)
 *   - runAllNow()
 *   - repairArchiveNow()
 *   - maintainEverythingNow()
 *   - archiveOlderCalls()
 *   - archiveAllButTop3Calls()
 *   - sortCallLogByTimeDesc(opts)
 *   - sortCallArchiveByTimeDesc(opts)
 *   - sortBothCallSheetsByTimeDesc()
 *   - onChange(e)
 *
 * Functions (in this file)
 *   - fillRequiredBlanksWithNA()
 *   - fillRequiredBlanksWithNA_All()
 *   - populateFormulas()
 *   - ensureArchiveLayout_()
 *   - archiveOlderCalls()
 *   - archiveAllButTop3Calls()
 *   - sortCallLogByTimeDesc(opts)
 *   - sortCallArchiveByTimeDesc(opts)
 *   - sortBothCallSheetsByTimeDesc()
 *   - runAllNow()
 *   - repairArchiveNow()
 *   - maintainEverythingNow()
 *   - postComputeCallLogRow_(rowIndex, justWroteAtoQ)   // guarded define
 *
 * Globals & Utils consumed (from 00 Globals.gs / Utils)
 *   CONFIG.NA_VALUE, CL_SHEET, SHEET_ARCHIVE, CL_WRITE_WIDTH, SORT_LAST_COL, SORT_MAX_ROWS
 *   mustSheet_(), sortSheetByColBDesc_(), ensureDateTimeFormats_(), resolveTimestamp_(),
 *   sweepCallDuplicates(), areaFromPhone_(), buildGmailSearchUrl_(), _catLookup_(),
 *   normalizePhone10_(), invoiceDigits_(), ROW_CONFIGS, PropertiesService
 *
 * Sheet dependencies
 *   Tabs: "Call Log", "Call Archive", "Tracking Log", "AreaCodes", "CatMap"
 * ----------------------------------------------------------------------------
 */

/** Normalize required blanks in Call Log to CONFIG.NA_VALUE (skip formula cells). */
function fillRequiredBlanksWithNA() {
  const SHEET = CL_SHEET || 'Call Log';
  const NA = (typeof CONFIG !== 'undefined' && CONFIG.NA_VALUE) ? CONFIG.NA_VALUE : 'n / a';
  const COLS = [3, 5, 6, 7, 9, 12, 17]; // C,E,F,G,I,L,Q

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET);
  if (!sh) throw new Error(`Sheet "${SHEET}" not found`);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return;

  const numRows = lastRow - 1;
  let total = 0;

  COLS.forEach(col => {
    const rng = sh.getRange(2, col, numRows, 1);
    const vals = rng.getValues();
    const fmts = rng.getFormulas();
    let dirty = false;

    for (let r = 0; r < numRows; r++) {
      if (fmts[r][0]) continue; // preserve formulas
      const v = vals[r][0];
      const blank = v === '' || v === null || (typeof v === 'string' && v.trim() === '');
      if (blank) { vals[r][0] = NA; dirty = true; total++; }
    }
    if (dirty) rng.setValues(vals);
  });

  Logger.log(`Filled ${total} cell(s) with '${NA}'.`);
}

/** Normalize required blanks in both Call Log and Call Archive. */
function fillRequiredBlanksWithNA_All() {
  const NA = (typeof CONFIG !== 'undefined' && CONFIG.NA_VALUE) ? CONFIG.NA_VALUE : 'n / a';
  const COLS = [3, 5, 6, 7, 9, 12, 17]; // C,E,F,G,I,L,Q
  const ss = SpreadsheetApp.getActive();

  ['Call Log', 'Call Archive'].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;

    const lastRow = sh.getLastRow();
    if (lastRow < 2) return;

    const numRows = lastRow - 1;
    COLS.forEach(col => {
      const rng = sh.getRange(2, col, numRows, 1);
      const vals = rng.getValues();
      const fmts = rng.getFormulas();
      let dirty = false;

      for (let r = 0; r < numRows; r++) {
        if (fmts[r][0]) continue;
        const v = vals[r][0];
        if (v === '' || v == null || (typeof v === 'string' && v.trim() === '')) {
          vals[r][0] = NA; dirty = true;
        }
      }
      if (dirty) rng.setValues(vals);
    });
  });
}

/**
 * Seed/bound formulas (D,H,K and R..X) — ONLY in Call Archive.
 * We bound full-column references to current last rows for speed.
 */
function populateFormulas() {
  function boundCols(formula, bounds) {
    return formula
      // Call Log (bounded)
      .replace(/'Call Log'!A\$2:A\b/g, `'Call Log'!A$2:A${bounds.LOG.A}`)
      .replace(/'Call Log'!B\$2:B\b/g, `'Call Log'!B$2:B${bounds.LOG.B}`)
      .replace(/'Call Log'!C\$2:C\b/g, `'Call Log'!C$2:C${bounds.LOG.C}`)
      .replace(/'Call Log'!F\$2:F\b/g, `'Call Log'!F$2:F${bounds.LOG.F}`)
      // Call Archive (bounded)
      .replace(/'Call Archive'!A\$2:A\b/g, `'Call Archive'!A$2:A${bounds.ARC.A}`)
      .replace(/'Call Archive'!B\$2:B\b/g, `'Call Archive'!B$2:B${bounds.ARC.B}`)
      .replace(/'Call Archive'!C\$2:C\b/g, `'Call Archive'!C$2:C${bounds.ARC.C}`)
      .replace(/'Call Archive'!F\$2:F\b/g, `'Call Archive'!F$2:F${bounds.ARC.F}`)
      // Tracking Log (for "Has Tracking?" only)
      .replace(/'Tracking Log'!B:B\b/g, `'Tracking Log'!B$2:B${bounds.TRK.B}`)
      .replace(/'Tracking Log'!E:E\b/g, `'Tracking Log'!E$2:E${bounds.TRK.E}`)
      .replace(/'Tracking Log'!F:F\b/g, `'Tracking Log'!F$2:F${bounds.TRK.F}`);
  }

  const ss = SpreadsheetApp.getActive();
  const TARGET_SHEETS = ['Call Archive']; // formulas only in Archive
  const logSh = ss.getSheetByName('Call Log');
  const arcSh = ss.getSheetByName('Call Archive');
  const trkSh = ss.getSheetByName('Tracking Log');

  const lastLog = Math.max(2, (logSh?.getLastRow() || 2));
  const lastArc = Math.max(2, (arcSh?.getLastRow() || 2));
  const lastTrk = Math.max(2, (trkSh?.getLastRow() || 2));

  const bounds = {
    LOG: { A: lastLog, B: lastLog, C: lastLog, F: lastLog },
    ARC: { A: lastArc, B: lastArc, C: lastArc, F: lastArc },
    TRK: { B: lastTrk, E: lastTrk, F: lastTrk }
  };

  // ---- Formula templates (Archive only) ----
  const templates = {
    // D: State/Province from Phone (C)
    D: {
      col: 4, refs: [{ c: 'C', base: 3 }],
      f: String.raw`=IF(LEN(C3)=0,"",IFERROR(VLOOKUP(REGEXEXTRACT(REGEXREPLACE(TO_TEXT(C3),"\D",""),"^(?:1)?(\d{3})"),{ARRAYFORMULA(IFERROR(REGEXEXTRACT(TRIM(TO_TEXT(AreaCodes!A$2:A)),"\d{3}"),"")),AreaCodes!B$2:B},2,FALSE),"n / a"))`
    },
    // H: Gmail search link from C/F/G
    H: {
      col: 8, refs: [{ c: 'C', base: 2 }, { c: 'F', base: 2 }, { c: 'G', base: 2 }],
      f: String.raw`=LET(
  termC, IF( OR(LEN(TRIM(C2))=0, SUBSTITUTE(LOWER(TO_TEXT(C2))," ","")="n/a", TO_TEXT(C2)="NA_VALUE"),"",
            IFERROR(LEFT(C2,FIND(":",C2)) & "%22" & SUBSTITUTE(SUBSTITUTE(TRIM(MID(C2,FIND(":",C2)+1,999))," ","+"),"""","%22") & "%22",
                    "%22"&SUBSTITUTE(SUBSTITUTE(C2," ","+"),"""","%22")&"%22")),
  termF, IF( OR(LEN(TRIM(F2))=0, SUBSTITUTE(LOWER(TO_TEXT(F2))," ","")="n/a", TO_TEXT(F2)="NA_VALUE"),"",
            IFERROR(LEFT(F2,FIND(":",F2)) & "%22" & SUBSTITUTE(SUBSTITUTE(TRIM(MID(F2,FIND(":",F2)+1,999))," ","+"),"""","%22") & "%22",
                    "%22"&SUBSTITUTE(SUBSTITUTE(F2," ","+"),"""","%22")&"%22")),
  termG, IF( OR(LEN(TRIM(G2))=0, SUBSTITUTE(LOWER(TO_TEXT(G2))," ","")="n/a", TO_TEXT(G2)="NA_VALUE"),"",
            IFERROR(LEFT(G2,FIND(":",G2)) & "%22" & SUBSTITUTE(SUBSTITUTE(TRIM(MID(G2,FIND(":",G2)+1,999))," ","+"),"""","%22") & "%22",
                    "%22"&SUBSTITUTE(SUBSTITUTE(G2," ","+"),"""","%22")&"%22")),
  query, TEXTJOIN("+OR+", TRUE, termC, termF, termG),
  IF(query="","", HYPERLINK("https://mail.google.com/mail/u/0/#search/" & query, "Search Gmail"))
)`
    },
    // K: Category from Subject (J) using CatMap
    K: {
      col: 11, refs: [{ c: 'J', base: 2 }],
      f: String.raw`=LET(
  s, TRIM(LOWER(TO_TEXT(J2))),
  IF(OR(s="", s="n / a", s="na_value"),"",
    IFERROR(VLOOKUP(s,{ARRAYFORMULA(LOWER(TRIM(TO_TEXT(CatMap!A$2:A)))), CatMap!B$2:B},2,FALSE),"FAQ")
  )
)`
    },
    // R: Has Tracking? (Archive-only)
    R: {
      col: 18,
      f: String.raw`=LET(
  invDigits, IFERROR(REGEXEXTRACT(TO_TEXT(INDEX(F:F,ROW())), "\d+"), ""),
  IF(invDigits="",
    FALSE,
    LET(
      keyTrack, SUBSTITUTE(SUBSTITUTE(SUBSTITUTE("2363-" & invDigits,"–","-"),"—","-"),CHAR(160),""),
      trackText, IFERROR(
        VLOOKUP(
          keyTrack,
          {
            ARRAYFORMULA(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(TRIM('Tracking Log'!B:B),"–","-"),"—","-"),CHAR(160),"")),
            ARRAYFORMULA(TRIM(IF(LEN('Tracking Log'!E:E), 'Tracking Log'!E:E & ", " & 'Tracking Log'!F:F, 'Tracking Log'!F:F)))
          },
          2, FALSE
        ),
        ""
      ),
      IF( AND(trackText<>"", REGEXMATCH(TO_TEXT(trackText), "(?i)(1Z[0-9A-Z]{16}|[0-9]{8,25}|[A-Z]{2}[0-9]{9}[A-Z]{2})")),
        trackText,
        FALSE
      )
    )
  )
)`
    }
  };

  // helpers
  function buildFormulaForRow(template, row, refs) {
    let out = template;
    (refs || []).forEach(({ c, base }) => {
      out = out.replace(new RegExp(`\\b${c}${base}\\b(?!:)`, 'g'), `${c}${row}`);
    });
    return out;
  }
  function fillColumn(sheet, startRow, lastRow, headerRow, colSpec) {
    const col = colSpec.col;
    const rng = sheet.getRange(startRow, col, lastRow - headerRow, 1);
    const vals = rng.getValues();
    for (let i = 0; i < vals.length; i++) {
      if (vals[i][0] !== '') continue;
      const row = startRow + i;
      const fRow = buildFormulaForRow(colSpec.f, row, colSpec.refs);
      const fBound = boundCols(fRow, bounds);
      sheet.getRange(row, col).setFormula(fBound);
    }
  }

  // apply to Archive only
  TARGET_SHEETS.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;

    const HEADER_ROW = 1;
    const startRow = HEADER_ROW + 1;
    const lastRow = sh.getLastRow();
    if (lastRow <= HEADER_ROW) return;

    // Only D, H, K, and R ("Has Tracking?")
    // Seed only what we can, based on existing helper tabs
    const haveArea = !!ss.getSheetByName('AreaCodes');
    const haveCat = !!ss.getSheetByName('CatMap');
    const haveTrk = !!ss.getSheetByName('Tracking Log');

    // D (Area) needs AreaCodes
    if (haveArea) fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.D);

    // H (Gmail link) has no external deps
    fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.H);

    // K (Category) needs CatMap
    if (haveCat) fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.K);

    // R (Has Tracking?) needs Tracking Log
    if (haveTrk) fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.R);


    // Auto follow-up (N) when Status (I) = "Waiting Tracking" and blank date
    const headers = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(v => String(v || '').trim());
    const colStatus = (headers.indexOf('Status') + 1) || 9;          // I
    const colFollow = (headers.indexOf('Follow-up Date') + 1) || 14; // N
    if (colStatus > 0 && colFollow > 0) {
      const nRows = lastRow - 1;
      const statuses = sh.getRange(2, colStatus, nRows, 1).getValues();
      const follows = sh.getRange(2, colFollow, nRows, 1).getValues();
      const today = new Date();
      const tomorrow = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 1);
      let dirty = false;
      for (let i = 0; i < nRows; i++) {
        const s = String(statuses[i][0] || '').trim();
        const f = follows[i][0];
        if (s === 'Waiting Tracking' && (f === '' || f == null)) { follows[i][0] = tomorrow; dirty = true; }
      }
      if (dirty) sh.getRange(2, colFollow, nRows, 1).setValues(follows);
    }
  });

  return 1;
}


/** Keep formulas seeded when pasting/structural edits happen. */
function onChange(e) {
  // e.changeType can be INSERT_ROW, INSERT_COLUMN, EDIT, PASTE, OTHER, etc.
  if (!e || !e.changeType) { populateFormulas(); return; }
  const typesToRun = new Set(['INSERT_ROW', 'PASTE', 'OTHER', 'INSERT_COLUMN', 'REMOVE_COLUMN']);
  if (typesToRun.has(e.changeType)) {
    if (e.changeType === 'INSERT_COLUMN' || e.changeType === 'REMOVE_COLUMN') {
      try { ensureArchiveLayout_(); } catch (_) { }
    }
    populateFormulas();
  }
}

/** Ensure Archive header/width/date formats mirror Call Log. */
function ensureArchiveLayout_() {
  const ss = SpreadsheetApp.getActive();
  const log = mustSheet_(CL_SHEET);          // "Call Log"
  const arc = mustSheet_(SHEET_ARCHIVE);     // "Call Archive"

  // Call Log limited to A:Q (17 cols). Archive adds R (Has Tracking?) → 18 cols total.
  const baseWidth = Math.min(CL_WRITE_WIDTH || 17, log.getLastColumn()); // A..Q
  const desiredArcWidth = baseWidth + 1; // +R

  // Ensure Archive has at least A..R
  if (arc.getLastColumn() < desiredArcWidth) {
    arc.insertColumnsAfter(Math.max(1, arc.getLastColumn()), desiredArcWidth - arc.getLastColumn());
  }

  // Copy A..Q headers from Call Log, then set R header
  const head = log.getRange(1, 1, 1, baseWidth).getValues();
  arc.getRange(1, 1, 1, baseWidth).setValues(head);
  // Only set R header if blank so we don't clobber a custom title
  const rHeadCell = arc.getRange(1, desiredArcWidth);
  if (String(rHeadCell.getValue() || '').trim() === '') {
    rHeadCell.setValue('Has Tracking?'); // R
  }

  // Optional: prune any legacy columns beyond R if flag is enabled
  try {
    if (typeof CONFIG === 'object' && CONFIG && CONFIG.CALL && CONFIG.CALL.PRUNE_EXTRA_COLUMNS === true) {
      const extra = arc.getLastColumn() - desiredArcWidth;
      if (extra > 0) arc.deleteColumns(desiredArcWidth + 1, extra);
    }
  } catch (_) { }


  ensureDateTimeFormats_(log);
  ensureDateTimeFormats_(arc);
  arc.setFrozenRows(1);
}


/** Move rows older than 12h from Call Log to Call Archive (copy blocks; keep formulas out). */
function archiveOlderCalls() {
  const SRC = CL_SHEET || 'Call Log';
  const DST = SHEET_ARCHIVE || 'Call Archive';
  const ss = SpreadsheetApp.getActive();
  const src = ss.getSheetByName(SRC);
  if (!src) throw new Error(`Sheet "${SRC}" not found`);
  let dst = ss.getSheetByName(DST);
  if (!dst) dst = ss.insertSheet(DST);

  ensureArchiveLayout_();

  const lastRow = src.getLastRow();
  if (lastRow < 2) { Logger.log('No data rows.'); return; }

  // Read A:Q (1..17)
  const rows = src.getRange(2, 1, lastRow - 1, 17).getValues();
  const cutoff = Date.now() - 12 * 60 * 60 * 1000; // 12h

  const picks = [];
  const pickSheetRows = [];
  rows.forEach((r, i) => {
    const ts = resolveTimestamp_(r[0], r[1]); // A,B
    if (ts && ts.getTime() < cutoff) { picks.push(r); pickSheetRows.push(i + 2); }
  });

  if (!picks.length) { Logger.log('Nothing to archive.'); return; }

  const startRow = (dst.getLastRow() || 0) + 1;

  // Helper to pluck 1-based columns
  const pluck = (row, idxs) => idxs.map(c => row[c - 1]);
  const segAC = picks.map(r => pluck(r, [1, 2, 3]));                           // A:C
  const segEG = picks.map(r => pluck(r, [5, 6, 7]));                           // E:G
  const segIJ = picks.map(r => pluck(r, [9, 10]));                             // I:J
  const segLQ = picks.map(r => pluck(r, [12, 13, 14, 15, 16, 17]));            // L:Q

  // Write only requested column blocks to Archive
  dst.getRange(startRow, 1, picks.length, 3).setValues(segAC);        // A:C
  dst.getRange(startRow, 5, picks.length, 3).setValues(segEG);        // E:G
  dst.getRange(startRow, 9, picks.length, 2).setValues(segIJ);        // I:J
  dst.getRange(startRow, 12, picks.length, 6).setValues(segLQ);       // L:Q

  // Delete originals from Call Log (descending to avoid reindex issues)
  pickSheetRows.sort((a, b) => b - a).forEach(r => src.deleteRow(r));

  populateFormulas(); // seed Archive formulas for the new rows
  Logger.log(`Archived ${picks.length} rows from "${SRC}" to "${DST}".`);
}

/** Keep only the 3 most recent finalized rows in Call Log; archive the rest. */
function archiveAllButTop3Calls() {
  const ss = SpreadsheetApp.getActive();
  const cl = mustSheet_(CL_SHEET);
  const arch = mustSheet_(SHEET_ARCHIVE);
  ensureArchiveLayout_();

  const width = Math.min(CL_WRITE_WIDTH || 17, cl.getLastColumn());
  const lastRow = cl.getLastRow();
  if (lastRow < 2) return;

  const data = cl.getRange(1, 1, lastRow, width).getValues(); // includes header
  const IDX_DATE = 0, IDX_TIME = 1, IDX_STATUS = 8;

  const props = PropertiesService.getDocumentProperties();
  const keepSet = new Set([1]); // header

  // drafts tracked per configured rows
  Object.keys(ROW_CONFIGS).forEach(k => {
    const key = ROW_CONFIGS[k].key;
    const rowStr = props.getProperty(`CL_DRAFT_ROW_${key}`);
    const row = rowStr ? parseInt(rowStr, 10) : NaN;
    if (row && !isNaN(row)) keepSet.add(row);
  });

  // Collect finalized rows with timestamps
  const finalized = [];
  for (let r = 2; r <= lastRow; r++) {
    const rowVals = data[r - 1];
    const status = rowVals[IDX_STATUS];
    if (status === '' || status == null) { keepSet.add(r); continue; }

    const a = rowVals[IDX_DATE], b = rowVals[IDX_TIME];
    let ts = 0;
    if (b instanceof Date) ts = b.getTime();
    else if (a instanceof Date) ts = a.getTime();
    else { keepSet.add(r); continue; }

    finalized.push({ row: r, ts });
  }

  // Keep three newest finalized rows
  finalized.sort((x, y) => y.ts - x.ts);
  finalized.slice(0, 3).forEach(o => keepSet.add(o.row));

  // Archive the rest
  const rowsToArchive = finalized.filter(o => !keepSet.has(o.row)).map(o => o.row);
  if (!rowsToArchive.length) return;

  rowsToArchive.sort((a, b) => a - b);
  const toWrite = rowsToArchive.map(r => data[r - 1].slice(0, width));
  const start = Math.max(arch.getLastRow() + 1, 2);
  arch.getRange(start, 1, toWrite.length, width).setValues(toWrite);

  // Delete from Call Log (bottom-up)
  rowsToArchive.sort((a, b) => b - a).forEach(r => cl.deleteRow(r));
}

/** Quick sorts */
function sortCallLogByTimeDesc(opts = {}) {
  return sortSheetByColBDesc_('Call Log', opts);
}
function sortCallArchiveByTimeDesc(opts = {}) {
  return sortSheetByColBDesc_('Call Archive', opts);
}
function sortBothCallSheetsByTimeDesc() {
  const opts = {
    maxCols: (typeof SORT_LAST_COL !== 'undefined' ? SORT_LAST_COL : null),
    maxRows: (typeof SORT_MAX_ROWS !== 'undefined' ? SORT_MAX_ROWS : null)
  };
  const a = sortCallLogByTimeDesc(opts);
  const b = sortCallArchiveByTimeDesc(opts);
  SpreadsheetApp.flush();
  return a || b;
}

/** Small runners */
function runAllNow() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    fillRequiredBlanksWithNA();
    populateFormulas();
  } finally { lock.releaseLock(); }
}
function repairArchiveNow() {
  const lock = LockService.getDocumentLock(); lock.waitLock(30000);
  try {
    ensureArchiveLayout_();
    sweepCallDuplicates();
    populateFormulas();              // re-seed D/H/K/R
    sortCallArchiveByTimeDesc();     // newest first
  } finally { lock.releaseLock(); }
}
function maintainEverythingNow() {
  const lock = LockService.getScriptLock(); lock.waitLock(30000);
  try {
    ensureArchiveLayout_();
    archiveOlderCalls();             // moves old rows and seeds formulas
    sweepCallDuplicates();
    fillRequiredBlanksWithNA_All();
    populateFormulas();
    sortBothCallSheetsByTimeDesc();
    try { if (typeof rebuildCustomerDB === 'function') rebuildCustomerDB(); } catch (_) { }
  } finally { lock.releaseLock(); }
}

/**
 * Compute & write D/H/K and R..W as PLAIN VALUES for one appended Call Log row.
 * This is used by your append pipeline so the live Call Log stays formula-light.
 * Guarded define so it won’t overwrite if already provided elsewhere.
 */
// Compute & write D/H/K as PLAIN VALUES for a single appended Call Log row (no columns after Q).
if (typeof postComputeCallLogRow_ !== 'function') {
  function postComputeCallLogRow_(rowIndex, justWroteAtoQ) {
    const ss = SpreadsheetApp.getActive();
    const cl = ss.getSheetByName(CL_SHEET);

    // A..Q → indices 0..16
    const phone = justWroteAtoQ[2];  // C
    const invoice = justWroteAtoQ[5];  // F
    const email = justWroteAtoQ[6];  // G
    const subject = justWroteAtoQ[9];  // J

    // D/H/K as values (fallbacks if helpers missing)
    const D_val = (typeof areaFromPhone_ === 'function') ? areaFromPhone_(phone) : 'n / a';
    const H_url = (typeof buildGmailSearchUrl_ === 'function') ? buildGmailSearchUrl_(phone, invoice, email) : '';
    const K_val = (typeof _catLookup_ === 'function') ? _catLookup_(subject) : '';

    cl.getRange(rowIndex, 4).setValue(D_val); // D
    cl.getRange(rowIndex, 8).setValue(H_url); // H
    cl.getRange(rowIndex, 11).setValue(K_val); // K

    ensureDateTimeFormats_(cl);
  }
}

