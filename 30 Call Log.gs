function sortCallLogByTimeDesc(opts = {}) {
  return sortSheetByColBDesc_('Call Log', opts);
}

function sortCallArchiveByTimeDesc(opts = {}) {
  return sortSheetByColBDesc_('Call Archive', opts);
}

function sortBothCallSheetsByTimeDesc() {
  const opts = { maxCols: (typeof SORT_LAST_COL !== 'undefined' ? SORT_LAST_COL : null),
                 maxRows: (typeof SORT_MAX_ROWS !== 'undefined' ? SORT_MAX_ROWS : null) };
  const a = sortCallLogByTimeDesc(opts);
  const b = sortCallArchiveByTimeDesc(opts);
  SpreadsheetApp.flush();
  return a || b;
}