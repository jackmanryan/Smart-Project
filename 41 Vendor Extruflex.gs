function scanRecentExtruflexPOs() {
  const LABEL_NAME  = CONFIG.LABELS.EX_FWD;
  const MAX_THREADS = 10;

  Log.info('scanRecentExtruflexPOs START');
  const label = GmailApp.getUserLabelByName(LABEL_NAME);
  if (!label) return Log.err(`Label "${LABEL_NAME}" not found.`);

  const MS = 24*60*60*1000, cut = Date.now() - CONFIG.RUN.LOOKBACK_DAYS*MS;
  const raw = label.getThreads(0, Math.max(MAX_THREADS, 20));
  const threads = raw.filter(th => th.getLastMessageDate().getTime() >= cut).slice(0, MAX_THREADS);

  const paired = [];
  threads.forEach(th => {
    let ourFirst = null, exLatest = null;
    th.getMessages().forEach(m => {
      const from = m.getFrom().toLowerCase();
      m.getAttachments().forEach(a => {
        if (a.getContentType() !== MimeType.PDF) return;
        const code = a.getName().replace(/\.pdf$/i, '').trim();
        if (from.includes(CONFIG.ADDRESSES.ME) && !ourFirst && RE.PO_NAME.test(a.getName())) ourFirst = code;
        if (/@extruflex\.com/.test(from) && RE.SO_NAME.test(a.getName())) exLatest = code; // keep newest
      });
    });
    if (ourFirst && exLatest) paired.push(`${exLatest}, ${ourFirst}`);
  });

  if (paired.length) {
    Logger.log('\n===== PDF pairs (Extruflex, Ours) =====');
    Logger.log(paired.join('\n'));
    Logger.log('========================================');
  } else {
    Logger.log('\n( No complete PDF pairs found. )');
  }
  Log.info('scanRecentExtruflexPOs END');
}

function debugExtruflexConfirmingScan() {
  const fwd = GmailApp.getUserLabelByName(CONFIG.LABELS.EX_FWD);
  if (!fwd) return Log.err('Forwarded label not found');
  const threads = fwd.getThreads(0, 10);
  Log.info(`Debug: scanning ${threads.length} freshest threads under ${CONFIG.LABELS.EX_FWD}`);
  threads.forEach((th, i) => {
    const subj = th.getFirstMessageSubject();
    const last = th.getLastMessageDate();
    const pdfs = [];
    th.getMessages().forEach(m => {
      const fromRaw = m.getFrom();
      const from = (fromRaw.match(/<([^>]+)>/)?.[1] || fromRaw).toLowerCase().trim();
      m.getAttachments().forEach(a => {
        const name = (a.getName()||'').trim();
        if (/\.pdf$/i.test(name)) pdfs.push(`${from} :: ${name}`);
      });
    });
    Log.info(`  [${i+1}] ${last.toISOString()} "${subj}" PDFs:\n    - ${pdfs.join('\n    - ') || '(none)'}`);
  });
}

function getExtruflexPOThreadId(invoiceOrPO) {
  const LOG = '[getExtruflexPOThreadId] ';
  try {
    const raw = (invoiceOrPO == null) ? '' : String(invoiceOrPO).trim();
    if (!raw) {
      Log.warn(LOG + 'empty input');
      return null;
    }

    // Normalize to invoice digits
    // Accept: "144123", "2363-144123", "PO 2363-144123", etc.
    let m = raw.match(/(?:^|[^0-9])2363-(\d{3,})\b/i);
    const invoice = m ? m[1] : (raw.match(/(\d{3,})$/)?.[1] || '');
    if (!invoice) {
      Log.warn(LOG + 'could not parse invoice digits from: ' + raw);
      return null;
    }

    const SUBJECT_PREFIX = (CONFIG && CONFIG.PURCHASE_ORDER && CONFIG.PURCHASE_ORDER.SUBJECT_PREFIX) || 'Purchase Order 2363-';
    const targetSubject  = `${SUBJECT_PREFIX}${invoice} from Stripcurtains.com`;

    // Prefer the PO sublabel, but also include the parent label as fallback
    const LABEL_A = (CONFIG?.VENDORS?.[0]?.labelSource) || 'Vendor/Extruflex/PO';
    const LABEL_B = 'Vendor/Extruflex';

    // ---- Pass 1: exact phrase in subject
    // Gmail search note: subject:"exact phrase" matches the literal phrase in the subject line.
    const q1 = `(label:"${LABEL_A}" OR label:"${LABEL_B}") subject:"${targetSubject}"`;
    const t1 = GmailApp.search(q1, 0, 20);
    if (t1 && t1.length) {
      const th = _pickNewestByDate_(t1);
      Log.info(LOG + `found by exact subject: "${targetSubject}" → ${th.getId()}`);
      return th.getId();
    }

    // ---- Pass 2: looser subject search with token group, then verify in code
    const q2 = `(label:"${LABEL_A}" OR label:"${LABEL_B}") subject:(Purchase Order 2363-${invoice})`;
    const t2 = GmailApp.search(q2, 0, 50);
    if (t2 && t2.length) {
      const match = _pickNewestMatchingSubject_(t2, targetSubject);
      if (match) {
        Log.info(LOG + `found by loose subject then verified → ${match.getId()}`);
        return match.getId();
      }
    }

    // ---- Pass 3: scan recent labeled threads and match subject exactly (defensive)
    // Look back farther than your normal run window to be safe.
    const recent = GmailApp.search(`(label:"${LABEL_A}" OR label:"${LABEL_B}")`, 0, 200);
    if (recent && recent.length) {
      const match = _pickNewestMatchingSubject_(recent, targetSubject);
      if (match) {
        Log.info(LOG + `found by labeled scan → ${match.getId()}`);
        return match.getId();
      }
    }

    Log.info(LOG + `no thread found for invoice ${invoice}`);
    return null;
  } catch (e) {
    Log.err(LOG + (e && e.stack ? e.stack : e));
    return null;
  }
}

function findCancelledExtruflexPOThreads() {
  const LOG = '[findCancelledExtruflexPOThreads] ';
  try {
    const ss = (CONFIG?.SHEETS?.MAIN_ID)
      ? SpreadsheetApp.openById(CONFIG.SHEETS.MAIN_ID)
      : SpreadsheetApp.getActive();

    const tabName = (CONFIG?.SHEETS?.MAIN_TAB) || 'Extruflex';
    const sh = ss.getSheetByName(tabName);
    if (!sh) { Log.warn(LOG + `Sheet "${tabName}" not found`); return []; }

    const lastRow = sh.getLastRow();
    const lastCol = sh.getLastColumn();
    if (lastRow < 2 || lastCol < 1) return [];

    // --- Read header row & resolve columns (loose)
    const header = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(v => String(v || ''));
    const H = header.map(_canonHeader_ || canonLocal_); // use your canon if present

    const colInvoice = findHeaderIndex(
      H,
      { all: [['sage','invoice'], ['invoice','number'], ['invoice','#']], any: ['invoice'] },
      { base: 1, fallback: 1 } // default to column A if not found
    );

    const colCancelled = findHeaderIndex(
      H,
      { exact: ['cancelled?','canceled?','cancelled','canceled'], any: ['cancel'] },
      { base: 1, fallback: 11 } // default to column K if not found
    );

    // Small debug breadcrumb
    Log.info(LOG + `Using columns → Invoice: ${colInvoice}  Cancelled: ${colCancelled}`);

    // --- Read data
    const n = lastRow - 1;
    const invoices  = sh.getRange(2, colInvoice,  n, 1).getValues().flat();
    const cancelled = sh.getRange(2, colCancelled, n, 1).getValues().flat();

    const out = [];
    for (let i = 0; i < n; i++) {
      if (!_isTruthyBoolean(cancelled[i])) continue;
      const inv = String(invoices[i] == null ? '' : invoices[i]).trim();
      if (!inv) continue;

      let threadId = null;
      try {
        threadId = getExtruflexPOThreadId(inv);
      } catch (e) {
        Log.err(LOG + `row ${i+2} invoice ${inv}: lookup error: ${e}`);
      }
      out.push({ row: i + 2, invoice: inv, threadId: threadId || null });
    }

    Log.info(LOG + `matched ${out.length} cancelled row(s)`);
    return out;
  } catch (e) {
    Log.err(LOG + (e && e.stack ? e.stack : e));
    return [];
  }

  // --- helpers (scoped) ---
  function headerIndexLoose_(canonHeaders, preferredGroups, fallbackTokens) {
    // preferred: first column where *all* tokens in any group are included
    for (const grp of (preferredGroups || [])) {
      for (let i = 0; i < canonHeaders.length; i++) {
        if (grp.every(tok => canonHeaders[i].includes(tok))) return i + 1; // 1-based
      }
    }
    // fallback: any column containing any token
    for (let i = 0; i < canonHeaders.length; i++) {
      if ((fallbackTokens || []).some(tok => canonHeaders[i].includes(tok))) return i + 1;
    }
    return 0;
  }
  canonLocal_(s);
}
