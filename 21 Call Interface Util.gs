function fillRequiredBlanksWithNA() {
  const SHEET = 'Call Log';
  const NA = 'n / a';
  const COLS = [3, 5, 6, 7, 9, 12, 17]; // C,E,F,G,I,L,Q

  const ss = SpreadsheetApp.getActive();
  const sh = ss.getSheetByName(SHEET);
  if (!sh) throw new Error(`Sheet "${SHEET}" not found`);

  const lastRow = sh.getLastRow();
  if (lastRow < 2) return; // no data

  const numRows = lastRow - 1; // excluding header row
  let total = 0;

  COLS.forEach(col => {
    const rng = sh.getRange(2, col, numRows, 1);
    const vals = rng.getValues();     // existing values
    const fmts = rng.getFormulas();   // to avoid overwriting formulas
    let dirty = false;

    for (let r = 0; r < numRows; r++) {
      const hasFormula = Boolean(fmts[r][0]);
      if (hasFormula) continue;

      const v = vals[r][0];
      const blank = v === '' || v === null || (typeof v === 'string' && v.trim() === '');
      if (blank) {
        vals[r][0] = NA;
        dirty = true;
        total++;
      }
    }

    if (dirty) rng.setValues(vals);
  });

  Logger.log(`Filled ${total} cell(s) with '${NA}'.`);
}

function runAllNow() {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    fillRequiredBlanksWithNA();
    populateFormulas();
  } finally {
    lock.releaseLock();
  }
}

function populateFormulas() {
  const ss = SpreadsheetApp.getActive();
  const TARGET_SHEETS = ['Call Log', 'Call Archive'];

  // ---- Formula templates (exactly as provided) ----
  // Note: templates use example refs (C3/F3/I3 or C2/F2/G2).
  // The script replaces those with the current row number safely.
  const templates = {
    D: {
      col: 4,
      refs: [{c:'C', base:3}],
      f: String.raw`=IF(
  LEN(C3)=0,
  "",
  IFERROR(
    VLOOKUP(
      REGEXEXTRACT(REGEXREPLACE(TO_TEXT(C3),"\D",""),"^(?:1)?(\d{3})"),
      {ARRAYFORMULA(IFERROR(REGEXEXTRACT(TRIM(TO_TEXT(AreaCodes!A$2:A)),"\d{3}"),"")), AreaCodes!B$2:B},
      2,
      FALSE
    ),
    "n / a"
  )
)`
    },

    H: {
      col: 8,
      refs: [{c:'C', base:2},{c:'F', base:2},{c:'G', base:2}],
      f: String.raw`=LET(
  termC, IF( OR(LEN(TRIM(C2))=0, SUBSTITUTE(LOWER(TO_TEXT(C2))," ","")="n/a", TO_TEXT(C2)="NA_VALUE"),
            "",
            IFERROR(
              LEFT(C2,FIND(":",C2)) & "%22" & SUBSTITUTE(SUBSTITUTE(TRIM(MID(C2,FIND(":",C2)+1,999))," ","+"),"""","%22") & "%22",
              "%22"&SUBSTITUTE(SUBSTITUTE(C2," ","+"),"""","%22")&"%22"
            )
       ),
  termF, IF( OR(LEN(TRIM(F2))=0, SUBSTITUTE(LOWER(TO_TEXT(F2))," ","")="n/a", TO_TEXT(F2)="NA_VALUE"),
            "",
            IFERROR(
              LEFT(F2,FIND(":",F2)) & "%22" & SUBSTITUTE(SUBSTITUTE(TRIM(MID(F2,FIND(":",F2)+1,999))," ","+"),"""","%22") & "%22",
              "%22"&SUBSTITUTE(SUBSTITUTE(F2," ","+"),"""","%22")&"%22"
            )
       ),
  termG, IF( OR(LEN(TRIM(G2))=0, SUBSTITUTE(LOWER(TO_TEXT(G2))," ","")="n/a", TO_TEXT(G2)="NA_VALUE"),
            "",
            IFERROR(
              LEFT(G2,FIND(":",G2)) & "%22" & SUBSTITUTE(SUBSTITUTE(TRIM(MID(G2,FIND(":",G2)+1,999))," ","+"),"""","%22") & "%22",
              "%22"&SUBSTITUTE(SUBSTITUTE(G2," ","+"),"""","%22")&"%22"
            )
       ),
  query, TEXTJOIN("+OR+", TRUE, termC, termF, termG),
  IF(query="","", HYPERLINK("https://mail.google.com/mail/u/0/#search/" & query, "Search Gmail"))
)`
    },

    K: {
      col: 11,
      refs: [{c:'I', base:3}],
      f: String.raw`=IF(LEN(TRIM(J3))=0, "",
  IFERROR(VLOOKUP(TRIM(J3), CatMap!A:B, 2, FALSE), "FAQ")
)`
    },

    // Earliest matching entry across Call Log + Call Archive
    R: {
      col: 18,
      refs: [{c:'F', base:3}],
      f: String.raw`=IFERROR(
    IF(
      OR(
        LEN(TRIM(F3))=0,
        REGEXMATCH(LOWER(TRIM(F3)),"^(n\s*/\s*a|na_value|new\s*customer)$"),
        LEN(REGEXREPLACE(TO_TEXT(F3),"[^\d]",""))=0
      ),
      "",
      INDEX(
        SORT(
          {
            FILTER({A$2:A, B$2:B},
              REGEXREPLACE(TO_TEXT(F$2:F),"[^\d]","") = REGEXREPLACE(TO_TEXT(F3),"[^\d]",""),
              LEN(REGEXREPLACE(TO_TEXT(F$2:F),"[^\d]",""))>0,
              LEN(A$2:A)>0
            );
            FILTER({'Call Archive'!A$2:A, 'Call Archive'!B$2:B},
              REGEXREPLACE(TO_TEXT('Call Archive'!F$2:F),"[^\d]","") = REGEXREPLACE(TO_TEXT(F3),"[^\d]",""),
              LEN(REGEXREPLACE(TO_TEXT('Call Archive'!F$2:F),"[^\d]",""))>0,
              LEN('Call Archive'!A$2:A)>0
            )
          },
          1, TRUE
        ),
        1, 2
      )
    ),
    ""
    )`
    },

    // Count of F across both sheets (numeric-only; blank if F non-numeric)
    S: {
      col: 19,
      refs: [{c:'F', base:3}],
      f: String.raw`=LET(
      ftxt, LOWER(TRIM(TO_TEXT(F3))),
      fnum, REGEXREPLACE(TO_TEXT(F3),"[^\d]",""),
      IF(
        OR(ftxt="", LEN(fnum)=0, REGEXMATCH(ftxt,"^(n\s*/\s*a|na_value|new\s*customer)$")),
        "",
        SUMPRODUCT(
          (REGEXREPLACE(TO_TEXT('Call Log'!F$2:F),"[^\d]","") = fnum) *
          (LEN('Call Log'!F$2:F)>0) *
          (NOT(REGEXMATCH(LOWER(TRIM('Call Log'!F$2:F)),"^(n\s*/\s*a|na_value|new\s*customer)$")))
        )
        +
        SUMPRODUCT(
          (REGEXREPLACE(TO_TEXT('Call Archive'!F$2:F),"[^\d]","") = fnum) *
          (LEN('Call Archive'!F$2:F)>0) *
          (NOT(REGEXMATCH(LOWER(TRIM('Call Archive'!F$2:F)),"^(n\s*/\s*a|na_value|new\s*customer)$")))
        )
      )
    )`
    },


    // Count of C in last 5 days across both sheets
    T: {
      col: 20,
      refs: [{c:'C', base:3}],
      f: String.raw`=IF(
  OR(C3="", REGEXMATCH(REGEXREPLACE(LOWER(C3),"^\s+|\s+$",""), "^(n\s*/\s*a|na_value)$")),
  "",
  SUMPRODUCT(
    (REGEXREPLACE(LOWER('Call Log'!C$2:C),"^\s+|\s+$","") = REGEXREPLACE(LOWER(C3),"^\s+|\s+$","")) *
    (REGEXMATCH(REGEXREPLACE(LOWER('Call Log'!C$2:C),"^\s+|\s+$",""), "^(n\s*/\s*a|na_value)$")=FALSE) *
    (INT('Call Log'!A$2:A) >= TODAY()-5) *
    (INT('Call Log'!A$2:A) <= TODAY())
  )
  +
  SUMPRODUCT(
    (REGEXREPLACE(LOWER('Call Archive'!C$2:C),"^\s+|\s+$","") = REGEXREPLACE(LOWER(C3),"^\s+|\s+$","")) *
    (REGEXMATCH(REGEXREPLACE(LOWER('Call Archive'!C$2:C),"^\s+|\s+$",""), "^(n\s*/\s*a|na_value)$")=FALSE) *
    (INT('Call Archive'!A$2:A) >= TODAY()-5) *
    (INT('Call Archive'!A$2:A) <= TODAY())
  )
)`
    },

    // Count of C in last 15 days across both sheets
    U: {
      col: 21,
      refs: [{c:'C', base:3}],
      f: String.raw`=IF(
  OR(C3="", REGEXMATCH(REGEXREPLACE(LOWER(C3),"^\s+|\s+$",""), "^(n\s*/\s*a|na_value)$")),
  "",
  SUMPRODUCT(
    (REGEXREPLACE(LOWER('Call Log'!C$2:C),"^\s+|\s+$","") = REGEXREPLACE(LOWER(C3),"^\s+|\s+$","")) *
    (REGEXMATCH(REGEXREPLACE(LOWER('Call Log'!C$2:C),"^\s+|\s+$",""), "^(n\s*/\s*a|na_value)$")=FALSE) *
    (INT('Call Log'!A$2:A) >= TODAY()-15) *
    (INT('Call Log'!A$2:A) <= TODAY())
  )
  +
  SUMPRODUCT(
    (REGEXREPLACE(LOWER('Call Archive'!C$2:C),"^\s+|\s+$","") = REGEXREPLACE(LOWER(C3),"^\s+|\s+$","")) *
    (REGEXMATCH(REGEXREPLACE(LOWER('Call Archive'!C$2:C),"^\s+|\s+$",""), "^(n\s*/\s*a|na_value)$")=FALSE) *
    (INT('Call Archive'!A$2:A) >= TODAY()-15) *
    (INT('Call Archive'!A$2:A) <= TODAY())
  )
)`
    },

    // Total count of C across both sheets (no date window)
    V: {
      col: 22,
      refs: [{c:'C', base:3}],
      f: String.raw`=IF(
  OR(C3="", REGEXMATCH(REGEXREPLACE(LOWER(C3),"^\s+|\s+$",""), "^(n\s*/\s*a|na_value)$")),
  "",
  SUMPRODUCT(
    (REGEXREPLACE(LOWER('Call Log'!C$2:C),"^\s+|\s+$","") = REGEXREPLACE(LOWER(C3),"^\s+|\s+$","")) *
    (REGEXMATCH(REGEXREPLACE(LOWER('Call Log'!C$2:C),"^\s+|\s+$",""), "^(n\s*/\s*a|na_value)$")=FALSE)
  )
  +
  SUMPRODUCT(
    (REGEXREPLACE(LOWER('Call Archive'!C$2:C),"^\s+|\s+$","") = REGEXREPLACE(LOWER(C3),"^\s+|\s+$","")) *
    (REGEXMATCH(REGEXREPLACE(LOWER('Call Archive'!C$2:C),"^\s+|\s+$",""), "^(n\s*/\s*a|na_value)$")=FALSE)
  )
)`
    }
  };

  // ---- helpers ----
  /**
   * Replace only the example single-cell refs (e.g. C3 / F3 / I3 or C2/F2/G2),
   * while NOT touching anchored ranges like C$2:C or A$2:A.
   */
  function buildFormulaForRow(template, row, refs) {
    let out = template;
    for (const {c, base} of refs) {
      // Match whole token like C3 but not C$2:C (due to negative lookahead for ':')
      const re = new RegExp(`\\b${c}${base}\\b(?!:)`, 'g');
      out = out.replace(re, `${c}${row}`);
    }
    return out;
  }

  function fillColumn(sheet, startRow, lastRow, headerRow, colSpec) {
    const col = colSpec.col;
    const rng = sheet.getRange(startRow, col, lastRow - headerRow, 1);
    const vals = rng.getValues(); // to avoid overwriting existing content
    for (let i = 0; i < vals.length; i++) {
      const row = startRow + i;
      if (vals[i][0] === '') {
        const f = buildFormulaForRow(colSpec.f, row, (colSpec.refs || []));
        sheet.getRange(row, col).setFormula(f);
      }
    }
  }

  // ---- apply to Call Log + Call Archive only ----
  TARGET_SHEETS.forEach(name => {
    const sh = ss.getSheetByName(name);
    if (!sh) return;
    const HEADER_ROW = 1;
    const startRow = HEADER_ROW + 1;
    const lastRow = sh.getLastRow();
    if (lastRow <= HEADER_ROW) return;

    fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.D);
    fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.H);
    fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.K);
    fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.R);
    fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.S);
    fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.T);
    fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.U);
    fillColumn(sh, startRow, lastRow, HEADER_ROW, templates.V);
  });
}

function onChange(e) {
  // e.changeType can be INSERT_ROW, INSERT_COLUMN, EDIT, etc.
  // Keep it simple: repopulate on row inserts or pastes.
  if (!e || !e.changeType) {
    populateFormulas();
    return;
  }
  const typesToRun = new Set(['INSERT_ROW', 'PASTE', 'EDIT', 'OTHER']);
  if (typesToRun.has(e.changeType)) {
    populateFormulas();
  }
}

function archiveOlderCalls() {
  const SRC = 'Call Log';
  const DST = 'Call Archive';
  const ss = SpreadsheetApp.getActive();
  const src = ss.getSheetByName(SRC);
  if (!src) throw new Error(`Sheet "${SRC}" not found`);
  let dst = ss.getSheetByName(DST);
  if (!dst) dst = ss.insertSheet(DST);

  const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/Los_Angeles';
  const lastRow = src.getLastRow();
  if (lastRow < 2) { Logger.log('No data rows.'); return; }

  // Read A:Q (1..17)
  const rows = src.getRange(2, 1, lastRow - 1, 17).getValues();
  const now = new Date();
  const cutoff = now.getTime() - 12 * 60 * 60 * 1000;

  // Decide which rows to move
  const picks = [];          // full rows (A..Q) to copy from
  const pickSheetRows = [];  // 1-based sheet row numbers in Call Log
  rows.forEach((r, i) => {
    const aVal = r[0]; // A (date)
    const bVal = r[1]; // B (time or datetime)
    const ts = resolveTimestamp_(aVal, bVal);
    if (ts && ts.getTime() < cutoff) {
      picks.push(r);
      pickSheetRows.push(i + 2); // row index in sheet
    }
  });

  if (picks.length === 0) { Logger.log('Nothing to archive.'); return; }

  // Compute append start in Archive
  const startRow = (dst.getLastRow() || 0) + 1;
  const n = picks.length;

  // Helper to pluck 1-based columns
  const pluck = (row, idxs) => idxs.map(c => row[c - 1]);
  const segAC = picks.map(r => pluck(r, [1, 2, 3]));                           // A:C
  const segEG = picks.map(r => pluck(r, [5, 6, 7]));                           // E:G
  const segIJ = picks.map(r => pluck(r, [9, 10]));                             // I:J
  const segLQ = picks.map(r => pluck(r, [12, 13, 14, 15, 16, 17]));            // L:Q

  // Write only requested column blocks to Archive
  dst.getRange(startRow, 1, n, 3).setValues(segAC);        // A:C
  dst.getRange(startRow, 5, n, 3).setValues(segEG);        // E:G
  dst.getRange(startRow, 9, n, 2).setValues(segIJ);        // I:J
  dst.getRange(startRow, 12, n, 6).setValues(segLQ);       // L:Q

  // Delete originals from Call Log (descending to avoid reindex issues)
  pickSheetRows.sort((a, b) => b - a).forEach(r => src.deleteRow(r));

  Logger.log(`Archived ${n} rows from "${SRC}" to "${DST}".`);
}

function archiveAllButTop3Calls() {
  const ss   = SpreadsheetApp.getActive();
  const cl   = mustSheet_(CL_SHEET);        // "Call Log"
  const arch = mustSheet_(SHEET_ARCHIVE);   // "Call Archive"

  const width   = cl.getLastColumn();
  const lastRow = cl.getLastRow();
  if (lastRow < 2) return;

  const data = cl.getRange(1, 1, lastRow, width).getValues(); // includes header

  // 0-based indexes in data rows (A..Q)
  const IDX_DATE   = 0; // A
  const IDX_TIME   = 1; // B
  const IDX_STATUS = 8; // I

  // Keep-set: header + any active draft rows stored in properties + any draft (Status empty)
  const props   = PropertiesService.getDocumentProperties();
  const keepSet = new Set([1]); // always keep header row 1

  // Respect active draft rows tracked per form row (r2/r3/r4)
  Object.keys(ROW_CONFIGS).forEach(k => {
    const key = ROW_CONFIGS[k].key; // e.g., 'r2'
    const rowStr = props.getProperty(`CL_DRAFT_ROW_${key}`);
    const row = rowStr ? parseInt(rowStr, 10) : NaN;
    if (row && !isNaN(row)) keepSet.add(row);
  });

  // Collect finalized rows with timestamps
  const finalized = []; // {row, ts}
  for (let r = 2; r <= lastRow; r++) {
    const rowVals = data[r - 1];
    const status  = rowVals[IDX_STATUS];

    // Treat empty Status as draft; do not archive
    if (status === '' || status === null) { keepSet.add(r); continue; }

    const a = rowVals[IDX_DATE];
    const b = rowVals[IDX_TIME];
    let ts = 0;
    if (b instanceof Date)      ts = b.getTime();
    else if (a instanceof Date) ts = a.getTime();
    else { keepSet.add(r); continue; } // no timestamp → don't archive

    finalized.push({ row: r, ts });
  }

  // Keep the three most recent finalized rows
  finalized.sort((x, y) => y.ts - x.ts);
  finalized.slice(0, 3).forEach(o => keepSet.add(o.row));

  // Everything else (finalized, not in keepSet) → archive
  const rowsToArchive = finalized
    .filter(o => !keepSet.has(o.row))
    .map(o => o.row);

  if (!rowsToArchive.length) return;

  // Append to archive (preserve sheet order)
  rowsToArchive.sort((a, b) => a - b);
  const toWrite = rowsToArchive.map(r => data[r - 1].slice(0, width));
  const start = Math.max(arch.getLastRow() + 1, 2);
  arch.getRange(start, 1, toWrite.length, width).setValues(toWrite);

  // Delete from Call Log (bottom-up)
  rowsToArchive.sort((a, b) => b - a).forEach(r => cl.deleteRow(r));
}

