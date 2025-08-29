/** Hourly trigger handler: only runs M–F, 08:00–16:59 local (America/Vancouver). */
function regularJob() {
  const tz = SpreadsheetApp.getActive()?.getSpreadsheetTimeZone?.() ||
             Session.getScriptTimeZone() || 'America/Vancouver';
  const now  = new Date();
  const hour = Number(Utilities.formatDate(now, tz, 'H'));  // 0–23
  const dow  = Utilities.formatDate(now, tz, 'EEE');        // Mon, Tue, ...
  const isWeekday = ['Mon','Tue','Wed','Thu','Fri'].includes(dow);
  const inWindow  = hour >= 6 && hour <= 17;

  if (!(isWeekday && inWindow)) return; // skip outside window

  try {
    myButtonAction();
  } catch (err) {
    console.error('myButtonAction failed:', err);
  }

  try {
    forwardVendorPOs();
  } catch (err) {
    console.error('forwardVendorPOs failed:', err);
  }

  try {
    confirmExtruflexPOs();
  } catch (err) {
    console.error('confirmExtruflexPOs failed:', err);
  }

  try {
    deleteOld2FAThreads();
  } catch (err) {
    console.error('deleteOld2FAThreads failed:', err);
  }

  try {
    createCancelDraftsForCancelledRows();
  } catch (err) {
    console.error('createCancelDraftsForCancelledRows failed:', err);
  }
}

function hourlyJobs(){
  const tz = SpreadsheetApp.getActive()?.getSpreadsheetTimeZone?.() ||
             Session.getScriptTimeZone() || 'America/Vancouver';
  const now  = new Date();
  const hour = Number(Utilities.formatDate(now, tz, 'H'));  // 0–23
  const dow  = Utilities.formatDate(now, tz, 'EEE');        // Mon, Tue, ...
  const isWeekday = ['Mon','Tue','Wed','Thu','Fri'].includes(dow);
  const inWindow  = hour >= 6 && hour <= 17;

  if (!(isWeekday && inWindow)) return; // skip outside window

  try {
    updateExtruflexETDs();
  } catch (err) {
    console.error('updateExtruflexETDs failed:', err);
  }

  try {
    markThreadsWaitingForTracking();
  } catch (err) {
    console.error('markThreadsWaitingForTracking failed:', err);
  }

  try {
    processTrackingResolved();
  } catch (err) {
    console.error('processTrackingResolved failed:', err);
  }

  try {
    processTracking();
  } catch (err) {
    console.error('processTracking failed:', err);
  }

  try {
    archiveAllButTop3Calls();
  } catch (err) {
    console.error('archiveAllButTop3Calls failed:', err);
  }
}

/** Daily trigger handler: runs M–F (America/Vancouver). 
 *  Attach a time-based trigger to run this once per day. */
function dailyJobs() {
  const tz  = SpreadsheetApp.getActive()?.getSpreadsheetTimeZone?.() ||
              Session.getScriptTimeZone() || 'America/Vancouver';
  const dow = Utilities.formatDate(new Date(), tz, 'EEE'); // Mon, Tue, ...
  const isWeekday = ['Mon','Tue','Wed','Thu','Fri'].includes(dow);
  if (!isWeekday) return;

  try {
    runAllNow();
  } catch (err) {
    console.error('runAllNow failed:', err);
  }

  try {
    maintainThenSortBothCallSheets();
  } catch (err) {
    console.error('maintainThenSortBothCallSheets failed:', err);
  }

  try {
    createTrackingDraftsFromArchive();
  } catch (err) {
    console.error('createTrackingDraftsFromArchive failed:', err);
  }

  try {
    archiveOlderCalls();
  } catch (err) {
    console.error('archiveOlderCalls failed:', err);
  }
}