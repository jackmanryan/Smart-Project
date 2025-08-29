function onOpen() { buildMenusV2_(); }
function onInstall() { onOpen(); }

function buildCustomMenus_() {
  const ui = SpreadsheetApp.getUi();

  // ---- 0) Customers (NEW) ----
  // Add your Customer DB tools as a top-level menu.
  const customers = ui.createMenu('Customers');
  customers.addItem('Rebuild Customer DB', 'rebuildCustomerDB');
  customers.addItem('Backfill Call Archive', 'backfillArchiveFromCustomerDB');
  customers.addSeparator();
  customers.addItem('Normalize Phones (Call Archive)', 'normalizePhonesInArchive');
  customers.addToUi();

  // ---- 1) Command Deck ----
  const cmd = ui.createMenu('Call Options');
  cmd.addItem('Sync Export → Target', 'myButtonAction');
  cmd.addItem('Update "Export" timestamp', 'updateExportTimestamp_');
  cmd.addSeparator();

  // Submenu: Process Call Interface (comlink)
  const iface = ui.createMenu('Process Call Interface (comlink)');
  iface.addItem('Row 2 → Peter (+3)', 'runRow2');
  iface.addItem('Row 3 → Daniel (+6)', 'runRow3');
  iface.addItem('Row 4 → Jack (+8)', 'runRow4');
  cmd.addSubMenu(iface);

  cmd.addToUi();

  // ---- 2) Maintenance (droids) ----
  const mnt = ui.createMenu('Maintenance');
  mnt.addItem('Fill required blanks with "n / a"', 'fillRequiredBlanksWithNA');
  mnt.addItem('Populate column formulas', 'populateFormulas');
  mnt.addItem('Fill + Formulas now (both)', 'runAllNow');
  mnt.addSeparator();
  mnt.addItem('Normalize recent rows — Call Log', 'maintainCallLog');
  mnt.addItem('Normalize recent rows — Call Archive', 'maintainCallArchive');
  mnt.addItem('Normalize both → then sort', 'maintainThenSortBothCallSheets');
  mnt.addToUi();

  // ---- 3) Archives (Jedi) ----
  const arc = ui.createMenu('Archives');
  arc.addItem('Archive > 12h from Call Log → Archive', 'archiveOlderCalls');
  arc.addSeparator();
  arc.addItem('Sort by time (desc) — Call Log', 'sortCallLogByTimeDesc');
  arc.addItem('Sort by time (desc) — Call Archive', 'sortCallArchiveByTimeDesc');
  arc.addItem('Sort both sheets by time (desc)', 'sortBothCallSheetsByTimeDesc');
  arc.addToUi();

  // ---- 4) Extruflex (vendor orders) ----
  const extr = ui.createMenu('Extruflex');
  extr.addItem('Confirm Extruflex POs', 'menuConfirmExtruflexPOs');
  extr.addItem('Update Extruflex ETDs', 'menuUpdateExtruflexETDs');
  extr.addItem('Prune Completed Orders', 'menuPruneExtruflex');
  extr.addToUi();

  // ---- 5) Tracking ----
  const trk = ui.createMenu('Tracking');
  trk.addItem('Get Tracking', 'menuGetTracking');
  trk.addItem('Upload Tracking', 'menuUploadTracking');
  trk.addSeparator();
  trk.addItem('Backfill last 10 → Archive', 'backfillTrackingReports');
  trk.addItem('Backfill… (choose count)', 'backfillTrackingReportsPrompt');
  trk.addToUi();

  // ---- 6) Utility ----
  ui.createMenu('⋯')
    .addItem('Rebuild Menus', 'buildCustomMenus_')
    .addToUi();
}

function buildMenusV2_() {
  const ui = SpreadsheetApp.getUi();

  // Calls (daily use)
  ui.createMenu('Calls')
    .addItem('Row 2 → Peter (+3)', 'runRow2')
    .addItem('Row 3 → Daniel (+6)', 'runRow3')
    .addItem('Row 4 → Jack (+8)', 'runRow4')
    .addSeparator()
    .addItem('Sync Export → Target', 'myButtonAction')
    .addItem('Update Export timestamp', 'updateExportTimestamp_')
    .addToUi();

  // Customers
  ui.createMenu('Customers')
    .addItem('Rebuild Customer DB', 'rebuildCustomerDB')
    .addItem('Backfill Call Archive', 'backfillArchiveFromCustomerDB')
    .addSeparator()
    .addItem('Normalize Phones (Archive)', 'normalizePhonesInArchive')
    .addToUi();

  // Tracking
  ui.createMenu('Tracking')
    .addItem('Get Tracking (fetch & update)', 'menuGetTracking')
    .addItem('Upload Tracking (CSV → extranet)', 'menuUploadTracking')
    .addSeparator()
    .addItem('Backfill last 10 → Archive', 'backfillTrackingReports')
    .addItem('Backfill… (choose count)', 'backfillTrackingReportsPrompt')
    .addToUi();

  // Vendors (forward POs for all; vendor-specific where available)
  const vendors = ui.createMenu('Vendors');
  vendors.addItem('Scan & Forward POs (all vendors)', 'menuForwardAllVendors_'); // wrapper below
  // Extruflex bundle (you already have these)
  vendors.addSeparator();
  vendors.addItem('Extruflex: Confirm POs', 'menuConfirmExtruflexPOs');
  vendors.addItem('Extruflex: Update ETDs', 'menuUpdateExtruflexETDs');
  vendors.addItem('Extruflex: Prune Completed', 'menuPruneExtruflex');
  vendors.addToUi();

  // Data (maintenance + archive/sort)
  ui.createMenu('Data')
    .addItem('Normalize recent rows — Call Log', 'maintainCallLog')
    .addItem('Normalize recent rows — Call Archive', 'maintainCallArchive')
    .addItem('Normalize both → then sort', 'maintainThenSortBothCallSheets')
    .addSeparator()
    .addItem('Archive > 12h Call Log → Archive', 'archiveOlderCalls')
    .addItem('Sort time desc — Call Log', 'sortCallLogByTimeDesc')
    .addItem('Sort time desc — Call Archive', 'sortCallArchiveByTimeDesc')
    .addItem('Sort both (desc)', 'sortBothCallSheetsByTimeDesc')
    .addToUi();

  // Admin (one-offs & fixes)
  ui.createMenu('Admin')
    .addItem('Apply Extruflex formulas', 'applyExtruflexFormulas')
    .addItem('Fix duplicated logic columns', 'migrateAndFixLogicColumns_')     // new
    .addSeparator()
    .addItem('Fill blanks with "n / a"', 'fillRequiredBlanksWithNA')
    .addItem('Populate column formulas', 'populateFormulas')
    .addItem('Run: fill + formulas now', 'runAllNow')
    .addSeparator()
    .addItem('Delete old 2FA threads', 'deleteOld2FAThreads')
    .addItem('Rebuild Menus', 'buildMenusV2_')
    .addToUi();
}

// -------------------- Tracking menu handlers (existing) --------------------
function menuGetTracking() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  try {
    ss.toast('Fetching latest tracking data...', 'Please wait', 5);
    processTracking();
    ss.toast('Tracking sheet has been updated.', 'Done', 3);
  } catch (err) {
    ui.alert('Get Tracking Error', 'Failed to update tracking: ' + (err && err.message || err), ui.ButtonSet.OK);
  }
}

function menuUploadTracking() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActive();
  try {
    ss.toast('Preparing tracking export...', 'Please wait', 5);

    // Ensure tracking sheet is current before export
    processTracking();

    // Resolve the current "Tracking - 25MMDD" sheet
    const tz = ss.getSpreadsheetTimeZone() || Session.getScriptTimeZone() || 'America/Los_Angeles';
    const now = new Date();
    const yy = (now.getFullYear() % 100).toString().padStart(2,'0');
    const mm = Utilities.formatDate(now, tz, 'MM');
    const dd = Utilities.formatDate(now, tz, 'dd');
    const expectedName = `Tracking - ${yy}${mm}${dd}`;

    let sheet = ss.getSheetByName(expectedName);
    if (!sheet) {
      // Fallback: any sheet that matches Tracking - 25MMDD pattern
      sheet = ss.getSheets().find(s => /^Tracking\s*-\s*25\d{4}$/.test(s.getName()));
      if (!sheet) throw new Error('No tracking sheet found to export.');
    }

    const csvUrl = `https://docs.google.com/spreadsheets/d/${ss.getId()}/export?format=csv&gid=${sheet.getSheetId()}`;
    const uploadUrl = 'https://extranet.strip-curtains.com/?p=po_tracking_upload';

    const html = HtmlService.createHtmlOutput(
      `<p style="font:13px Arial; color:#333;margin:10px;">Preparing download…</p>
       <script>
         try { window.open(${JSON.stringify(uploadUrl)}, '_blank', 'noopener'); } catch (e) {}
         try { window.location.href = ${JSON.stringify(csvUrl)}; } catch (e) {}
         setTimeout(function(){ google.script.host.close(); }, 1500);
       </script>`
    ).setWidth(260).setHeight(90);

    ui.showModalDialog(html, 'Export Ready');
    ss.toast('CSV downloaded. Upload page opened.', 'Done', 3);
  } catch (err) {
    ui.alert('Upload Tracking Error', (err && err.message) || String(err), ui.ButtonSet.OK);
  }
}

// -------------------- Extruflex menu handlers --------------------
function menuConfirmExtruflexPOs() {
  const ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive();
  try {
    ss.toast('Processing Extruflex confirmations...', 'Please wait', 5);
    confirmExtruflexPOs();
    ss.toast('Extruflex POs confirmed and logged.', 'Done', 3);
  } catch (err) {
    ui.alert('Confirm Extruflex POs Error', err.message || err, ui.ButtonSet.OK);
  }
}

function menuUpdateExtruflexETDs() {
  const ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive();
  try {
    ss.toast('Updating Extruflex ETDs...', 'Please wait', 5);
    updateExtruflexETDs();
    ss.toast('Extruflex ETDs have been updated.', 'Done', 3);
  } catch (err) {
    ui.alert('Update Extruflex ETDs Error', err.message || err, ui.ButtonSet.OK);
  }
}

function menuPruneExtruflex() {
  const ui = SpreadsheetApp.getUi(), ss = SpreadsheetApp.getActive();
  try {
    pruneByRemoveFlag();
    ss.toast('Completed orders pruned from sheet.', 'Done', 3);
  } catch (err) {
    ui.alert('Prune Completed Orders Error', err.message || err, ui.ButtonSet.OK);
  }
}

// Forward All
function menuForwardAllVendors_() {
  const ss = SpreadsheetApp.getActive();
  try {
    ss.toast('Scanning & forwarding vendor POs…', 'Please wait', 5);
    forwardVendorPOs();
    ss.toast('Forwarding pass complete.', 'Done', 3);
  } catch (e) {
    SpreadsheetApp.getUi().alert('Forwarder error', (e && e.message) || String(e), SpreadsheetApp.getUi().ButtonSet.OK);
  }
}