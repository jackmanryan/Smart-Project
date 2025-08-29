/** ---------------------------------
 *  GMAIL UTILS
 * ----------------------------------*/
const GmailU = {
  getOrCreateLabel(name) {
    return GmailApp.getUserLabelByName(name) || GmailApp.createLabel(name);
  },
  /** Build a safer query with lookback */
  queryWithLookback(labelName, days) {
    // newer_than uses days only (no hours). Escaping for quotes handled by wrapping in quotes.
    return `label:"${labelName}" newer_than:${Math.max(1, days)}d`;
  },
  /** Fetch a limited set of recent threads by label using Gmail search */
  getRecentThreads(labelName, days, max) {
    const q = this.queryWithLookback(labelName, days);
    const threads = GmailApp.search(q, 0, max);
    Log.info(`Query: ${q} → ${threads.length} thread(s)`);
    return threads;
  },
  threadHasLabel(thread, labelName) {
    return thread.getLabels().some(l => l.getName() === labelName);
  },
  newestMessage(thread) {
    const msgs = thread.getMessages();
    return msgs[msgs.length - 1];
  }
};

/** ---------------------------------
 *  2FA cleanup
 * ----------------------------------*/
function deleteOld2FAThreads() {
  const label = GmailApp.getUserLabelByName(CONFIG.LABELS.TWO_FA);
  if (!label) return Log.err(`Label "${CONFIG.LABELS.TWO_FA}" not found`);
  const sixMinutesAgo = new Date(Date.now() - 6 * 60 * 1000);
  const threads = label.getThreads(0, 50);
  threads.forEach(thread => {
    const latest = GmailU.newestMessage(thread);
    if (latest.getDate() < sixMinutesAgo) GmailApp.moveThreadToTrash(thread);
  });
}

function _pickNewestByDate_(threads) {
  let newest = null, best = -1;
  for (const th of threads) {
    const ts = th.getLastMessageDate()?.getTime?.() || 0;
    if (ts > best) { best = ts; newest = th; }
  }
  return newest || (threads?.[0] || null);
}

/** From a set of threads, return the newest whose subject exactly matches targetSubject. */
function _pickNewestMatchingSubject_(threads, targetSubject) {
  let best = null, bestTs = -1;
  for (const th of threads) {
    const subj = th.getFirstMessageSubject?.() || '';
    if (subj === targetSubject) {
      const ts = th.getLastMessageDate()?.getTime?.() || 0;
      if (ts > bestTs) { bestTs = ts; best = th; }
    }
  }
  return best;
}

