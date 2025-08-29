/**
 * Create a Gmail draft with:
 * Subject: "Tracking | Invoice #<invoice>" or "######"
 * To: email if valid, else self
 * Body:
 *   <Hi|Hello|Hey> <FirstName>,
 *
 *   <time/day-aware CS greeting (randomized now)>
 *   <random order-tracking line>
 *   <carrier (optional)>
 *   <appreciation + support closer (randomized now)>
 */
function createTrackingDraft(invoice, email, carrier, name) {
  const self = Session.getEffectiveUser().getEmail();

  const invoiceStr = String(invoice ?? '').trim();
  const subject = invoiceStr ? `Tracking | Invoice #${invoiceStr}` : '######';
  const to = isValidEmail_(email) ? String(email).trim() : self;

  // Greeting: random salutation + FIRST name only
  const greeting = pickRandom_(["Hi", "Hello", "Hey"]);
  const firstName = resolveFirstName_(name, email) || 'there';
  const greetingLine = `${greeting} ${firstName},`;

  // Compute time/day-aware CS line (randomized here)
  const tz = SpreadsheetApp.getActive()?.getSpreadsheetTimeZone?.() ||
             Session.getScriptTimeZone() || 'America/Vancouver';
  const { hour, dowNum } = getLocalHourAndDow_(tz);
  const csLine = buildCSGreetingLine_(hour, dowNum);

  // Randomized order-tracking line
  const trackingPhrases = [
    "Here’s the tracking info for your order",
    "You’ll find your tracking details below",
    "Tracking information for your order is below",
    "Here are your shipment tracking details",
    "Below you’ll see the tracking for your order",
    "Here’s where you can track your order",
    "Your tracking details are just below",
    "You can find your order’s tracking info here",
    "Here are the tracking details for your shipment"
  ];
  const trackingLine = pickRandom_(trackingPhrases);

  // Optional carrier line
  const carrierLine = String(carrier ?? '').trim();

  // Appreciation + support closer (randomized here)
  const appreciationPhrases = [
    "Thank you for trusting us with your order",
    "We’re grateful for your continued support",
    "Your business means a lot to us",
    "Thanks for letting us serve you",
    "We appreciate the opportunity to work with you",
    "Thank you for choosing us again",
    "Always a pleasure doing business with you",
    "Thank you for making us your supplier",
    "We value your partnership",
    "Thanks for allowing us to help with your project",
    "It’s a pleasure to work with you",
    "We appreciate your loyalty",
    "Your satisfaction is our priority",
    "Thanks for giving us the chance to serve you",
    "We’re always happy to help",
    "Thanks for making Strip-Curtains.com your choice",
    "We’re here because of customers like you",
    "Thank you for your trust",
    "We’re thankful for your order",
    "Thanks for coming back to us",
    "We truly appreciate your continued support",
    "Your business means so much to us",
    "Thank you for giving us the opportunity to serve you",
    "We’re grateful to have you as a valued customer",
    "It’s always a pleasure to work with you",
    "Thank you for making us your supplier of choice",
    "We value the partnership we share with you",
    "Thank you for letting us assist with your project",
    "It’s a pleasure working together",
    "We sincerely appreciate your loyalty",
    "Your satisfaction is always our top priority",
    "Thank you for giving us the chance to support you",
    "We’re always happy to be of service",
    "Thank you for making Strip-Curtains.com your preferred choice",
    "Thank you for your continued trust",
    "We’re truly thankful for your order",
    "Thank you for returning to us"
  ];
  const supportPhrases = [
    "If you need anything just let me know I’m always here to help",
    "Let me know if there’s anything you need I’m here for you",
    "Just reach out if you have any questions I’m happy to help",
    "I’m here if you need anything just let me know",
    "If you have any questions just say the word I’m here to help",
    "Don’t hesitate to let me know if you need anything I’m here to help out",
    "If there’s anything else I can do just let me know I’ve got you",
    "I’m always around if you need help just let me know",
    "Anytime you need something just let me know I’m here to support you",
    "Just give me a shout if you need anything I’m here to help",
    "Just let us know if you have questions.",
    "We’re always here to help, just reach out.",
    "Feel free to get in touch if you need anything.",
    "If there’s anything we can assist with, please ask.",
    "Reach out anytime if you have concerns.",
    "If you have questions or feedback, we’re listening.",
    "Don’t hesitate to contact us if you need support.",
    "If anything else comes up, just let us know.",
    "We’re just a call or email away.",
    "Always happy to help with your next project.",
    "If you need more info, we’re an email away.",
    "Let us know if you’d like a quote for anything else.",
    "If you need advice on your next order, just ask.",
    "We’re here to answer any questions you have.",
    "If there’s anything more we can do, please tell us.",
    "Need a hand with installation? Reach out anytime.",
    "Happy to help however we can.",
    "If you ever need a quick answer, just call us.",
    "Contact us anytime for support or advice.",
    "We’re only a message away if you need anything."
  ];
  const appreciation = pickRandom_(appreciationPhrases);
  const support = pickRandom_(supportPhrases);
  const closingLine = `${appreciation}${firstName ? `, ${firstName}` : ' :)'}—${support}`;
  const endsWithPunct = /[.!?]$/.test(csLine);
  const csTrackingLine = csLine + (endsWithPunct ? ' ' : '. ') + trackingLine;

  const bodyParts = [
    greetingLine,
    "",              // empty line after greeting
    csTrackingLine
  ];

  bodyParts.push(`(${carrierLine || 'carrier'})`);
  bodyParts.push("");          // single empty line before close
  bodyParts.push(closingLine);

  const body = bodyParts.join('\n');

  const draft = GmailApp.createDraft(to, subject, body);
  Logger.log('Draft created. ID: %s (to=%s, subject=%s)', draft.getId(), to, subject);
  return draft.getId();
}

function createTrackingDraftsFromArchive() {
  const sh = SpreadsheetApp.getActive().getSheetByName('Call Archive');
  if (!sh) throw new Error('Sheet "Call Archive" not found.');
  const lastRow = sh.getLastRow();
  if (lastRow < 2) return 0;

  const n = lastRow - 1;
  // F=6 invoice, G=7 email, W=23 tracking flag
  const invoices = sh.getRange(2, 6,  n, 1).getValues();
  const emails   = sh.getRange(2, 7,  n, 1).getValues();
  const flags    = sh.getRange(2, 23, n, 1).getValues();

  // Optional Name column autodetect
  const header = sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(h => String(h || '').trim());
  const nameHeaderCandidates = ['First Name','Name','Contact Name','Customer Name','Contact','Customer','Caller Name'];
  const nameColIndex1Based = findHeaderIndex(header, nameHeaderCandidates, { base: 1 }); // fallback 0 if not found
  const names = nameColIndex1Based ? sh.getRange(2, nameColIndex1Based, n, 1).getValues() : null;

  let created = 0;
  for (let i = 0; i < n; i++) {
    const flag = flags[i][0];
    if (flag === true || String(flag).toUpperCase() === 'TRUE') {
      const invoice = invoices[i][0];
      const email   = emails[i][0];
      const name    = names ? names[i][0] : '';
      createTrackingDraft(invoice, email, /*carrier*/ '', name);
      created++;
    }
  }
  Logger.log('Drafts created: %s', created);
  return created;
}

function createCancelDraftForInvoice(invoiceOrPO) {
  const LOG = '[createCancelDraftForInvoice] ';
  try {
    const input = (invoiceOrPO == null) ? '' : String(invoiceOrPO).trim();
    if (!input) { Log.warn(LOG + 'empty input'); return { threadId: null, draftMessageId: null }; }

    // Use your previously added resolver
    const threadId = getExtruflexPOThreadId(input);
    if (!threadId) {
      Log.warn(LOG + 'no thread found for input: ' + input);
      return { threadId: null, draftMessageId: null };
    }

    const thread = GmailApp.getThreadById(threadId);
    if (!thread) {
      Log.warn(LOG + 'GmailApp.getThreadById returned null for ' + threadId);
      return { threadId: null, draftMessageId: null };
    }

    // Create a draft reply anchored to the latest message in the thread
    // (Apps Script will place the draft on this thread; nothing is sent.)
    const draftMsg = (typeof thread.createDraftReply === 'function')
      ? thread.createDraftReply('cancel?')
      : null;

    const draftMessageId = (draftMsg && typeof draftMsg.getId === 'function') ? draftMsg.getId() : null;
    Log.info(LOG + `draft created on thread ${threadId}` + (draftMessageId ? ` (msg ${draftMessageId})` : ''));
    return { threadId, draftMessageId };
  } catch (e) {
    Log.err(LOG + (e && e.stack ? e.stack : e));
    return { threadId: null, draftMessageId: null };
  }
}

function createCancelDraftsForCancelledRows() {
  const rows = findCancelledExtruflexPOThreads();
  let made = 0;
  rows.forEach(r => {
    if (r.threadId) {
      const th = GmailApp.getThreadById(r.threadId);
      if (th && typeof th.createDraftReply === 'function') {
        th.createDraftReply('cancel?'); made++;
      }
    }
  });
  Log.info(`[createCancelDraftsForCancelledRows] drafts created: ${made}`);
  return made;
}

// ---- helpers ----
function promptCreateCancelDraft() {
  const ui = SpreadsheetApp.getUi();
  const res = ui.prompt('Create "cancel?" draft', 'Enter invoice (e.g., 144123) or PO (2363-144123):', ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;
  const { threadId, draftMessageId } = createCancelDraftForInvoice(res.getResponseText());
  ui.alert(threadId ? `Draft created on thread ${threadId}${draftMessageId ? ` (msg ${draftMessageId})` : ''}` : 'No matching PO thread found.');
}

function findHeaderIndex_(headerRow, candidates) {
  const lower = headerRow.map(h => h.toLowerCase());
  for (const label of candidates) {
    const idx = lower.indexOf(label.toLowerCase());
    if (idx >= 0) return idx + 1;
  }
  return 0;
}



/***Cancel
 * Tracking
 * Follow-up
 * issue
 * 
 */