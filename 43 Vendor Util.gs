/** ---------------------------------
 *  FORWARDER PIPELINE (generic for all vendors)
 * ----------------------------------*/
function forwardVendorPOs() {
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return Log.warn('Another forwardVendorPOs run already in progress.');

  try {
    Log.info('forwardVendorPOs started.');
    const { LOOKBACK_DAYS, MAX_THREADS_PER_VENDOR, REQUIRE_SINGLE_MESSAGE, DRY_RUN } = CONFIG.RUN;
    const { SUBJECT_PREFIX, BODY_MARKER, FORWARD_BODY_HTML } = CONFIG.PURCHASE_ORDER;

    CONFIG.VENDORS.forEach(v => {
      try {
        Log.info(`→ ${v.name}: scanning…`);
        const threads = GmailU.getRecentThreads(v.labelSource, LOOKBACK_DAYS, MAX_THREADS_PER_VENDOR);
        const processedLabel = GmailU.getOrCreateLabel(v.labelForwarded);
        const sourceLabel    = GmailU.getOrCreateLabel(v.labelSource);

        let forwarded = 0;
        const tenDaysAgo = new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);

        threads.forEach(thread => {
          if (GmailU.threadHasLabel(thread, v.labelForwarded)) return; // idempotent skip

          const messages = thread.getMessages();
          if (REQUIRE_SINGLE_MESSAGE && messages.length !== 1) return; // your original guard

          const msg = messages[0];
          if (msg.getDate() < tenDaysAgo) return;

          const subject = msg.getSubject() || '';
          const body    = msg.getBody()    || '';
          if (!subject.startsWith(SUBJECT_PREFIX)) return;
          if (!body.includes(BODY_MARKER)) return;

          Log.info(`  ✓ Forwarding: ${subject}`);
          if (!DRY_RUN) {
            msg.forward(v.forwardTo.join(', '), { htmlBody: FORWARD_BODY_HTML });
            msg.markRead();
            processedLabel.addToThread(thread);
            sourceLabel.removeFromThread(thread);
          }
          forwarded++;
        });

        Log.info(`← ${v.name}: forwarded ${forwarded} thread(s).`);
      } catch (inner) {
        Log.err(`${v.name}: ${inner}`);
      }
    });

    Log.info('forwardVendorPOs finished.');
  } finally { lock.releaseLock(); }
}

function confirmMidlandCoversPOs() {
  const LOG = '[confirmMidlandCoversPOs] ';
  const FWD_LABEL = CONFIG.LABELS.MID_FWD || 'Vendor/Midland Covers/PO/Forwarded';
  const CNF_LABEL = CONFIG.LABELS.MID_CNF || 'Vendor/Midland Covers/PO/Confirmed';
  const DOMAIN    = CONFIG.ADDRESSES.MIDLAND_DOMAIN || '@midlandcovers.com';
  const SSID      = CONFIG.SHEETS.MAIN_ID;
  const TAB       = CONFIG.SHEETS.MIDLAND_TAB || 'Midland Covers';

  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return Log.warn(`${LOG}another run in progress`);
  try {
    Log.info(`${LOG}start`);

    const fwd = GmailApp.getUserLabelByName(FWD_LABEL);
    if (!fwd) return Log.err(`${LOG}Label missing: ${FWD_LABEL}`);
    const cnf = GmailU.getOrCreateLabel(CNF_LABEL);

    // Ensure destination sheet
    const sh = SheetU.openOrCreateTab(SSID, TAB, ['Invoice #','ETA (on/before)','Confirmed On','Thread Subject']);
    const last = sh.getLastRow();
    const seen = new Set(
      last >= 2 ? sh.getRange(2,1,last-1,1).getValues().flat().map(v => String(v||'').trim()).filter(Boolean) : []
    );

    // Scan recent threads under Forwarded
    const threads = fwd.getThreads(0, 50);
    let added = 0;

    const RX = /Your order\s*\(PO\s*#\s*(\d+)\)\s*has been scheduled to ship on or before\s+([A-Za-z]+\s+\d{1,2}(?:st|nd|rd|th)?,\s*\d{4})/i;

    threads.forEach(th => {
      // Walk messages newest → oldest, find first from @midlandcovers.com that matches
      const msgs = th.getMessages();
      for (let i = msgs.length - 1; i >= 0; i--) {
        const m = msgs[i];
        const fromRaw = m.getFrom() || '';
        const from = (fromRaw.match(/<([^>]+)>/)?.[1] || fromRaw).toLowerCase();
        if (!from.includes(DOMAIN)) continue;

        // Try plain body first; if null, fall back to HTML stripped
        const body = (m.getPlainBody && m.getPlainBody()) || m.getBody() || '';
        const match = body.match(RX);
        if (!match) continue;

        const invoice = (match[1] || '').trim();
        const etaText = (match[2] || '').trim();
        if (!invoice) continue;

        if (seen.has(invoice)) {
          // already captured; just label & archive for cleanliness
          try { fwd.removeFromThread(th); cnf.addToThread(th); th.markRead(); th.moveToArchive(); } catch(_) {}
          return;
        }

        const etaDate = parseMidlandEtaDate(etaText);
        const row = [
          invoice,
          etaDate || stripOrdinalsDateText(etaText), // keep a value even if Date parse fails
          new Date(),
          th.getFirstMessageSubject() || ''
        ];

        try {
          sh.appendRow(row);
          // Format ETA + Confirmed On as dates if we got Date objects
          const newRow = sh.getLastRow();
          // Col 2 (ETA)
          if (etaDate instanceof Date && !isNaN(etaDate)) sh.getRange(newRow, 2).setNumberFormat('mmm d, yyyy');
          // Col 3 (Confirmed On)
          sh.getRange(newRow, 3).setNumberFormat('mmm d, yyyy h:mm AM/PM');

          seen.add(invoice);
          added++;

          // housekeeping
          fwd.removeFromThread(th);
          cnf.addToThread(th);
          th.markRead();
          th.moveToArchive();
        } catch (e) {
          Log.err(`${LOG}append error for invoice ${invoice}: ${e}`);
        }
        return; // stop scanning messages in this thread once handled
      }
    });

    Log.info(`${LOG}added ${added} confirmation(s)`);
  } finally {
    lock.releaseLock();
  }
}

function parseMidlandEtaDate(s) {
  if (!s) return '';
  const clean = stripOrdinalsDateText(s).replace(/\s+on\b/i, ' ').trim();
  const d = new Date(clean);
  return isNaN(d) ? '' : d;
}

function stripOrdinalsDateText(s) {
  if (!s) return '';
  return String(s).replace(/\b(\d{1,2})(st|nd|rd|th)\b/gi, '$1');
}
