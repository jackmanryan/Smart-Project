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
    any   = [spec];
  } else if (Array.isArray(spec)) {
    exact = spec.slice();
    any   = spec.slice();
  } else if (spec && typeof spec === 'object') {
    exact = (spec.exact || []).slice();
    all   = (spec.all   || []).map(g => g.slice());
    any   = (spec.any   || []).slice();
  }

  const canonList = a => a.map(x => opt.canon(String(x || '')));
  exact = canonList(exact);
  any   = canonList(any);
  all   = all.map(g => canonList(g));

  const range = (opt.prefer === 'right')
    ? ((n) => Array.from({length:n}, (_,i)=>n-1-i))
    : ((n) => Array.from({length:n}, (_,i)=>i));

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

function mustSheet_(name) {
  const sh = SpreadsheetApp.getActive().getSheetByName(name);
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
  const maxRows = opts.maxRows ?? (typeof SORT_MAX_ROWS !== 'undefined' ? SORT_MAX_ROWS : null);
  if (maxRows && rows > maxRows) {
    if (typeof logEvent_ === 'function') {
      logEvent_('INFO', 'sortSheetByColBDesc_', 'Skipped sort (too many rows)', { sheetName, rows, maxRows });
    }
    return false;
  }

  // Clamp sort width for speed/safety
  const width = opts.maxCols ?? (typeof SORT_LAST_COL !== 'undefined' ? SORT_LAST_COL : sh.getLastColumn());

  sh.getRange(firstDataRow, 1, rows, width)
    .sort([{ column: 2, ascending: false }]); // Column B, newest first

  SpreadsheetApp.flush();
  if (typeof logEvent_ === 'function') {
    logEvent_('INFO', 'sortSheetByColBDesc_', 'Sorted by col B desc', { sheetName, firstDataRow, rows, width });
  }
  return true;
}

function headerCol_(sh, exactName) {
  const head = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0];
  for (let c = 0; c < head.length; c++) if (head[c] === exactName) return c+1;
  return -1;
}

function headerColByMatch_(sh, rx) {
  const head = sh.getRange(1,1,1,sh.getLastColumn()).getValues()[0].map(String);
  for (let c = 0; c < head.length; c++) if (rx.test(head[c])) return c+1;
  return -1;
}