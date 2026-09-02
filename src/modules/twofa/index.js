/**
 * Extranet 2FA relay — SAFETY CRITICAL. Two halves, one module, two hosts.
 *
 * Verify page (extranet `?p=verify_2fa`):
 *   mounts a "Fetch 2FA from Gmail" button. Clicking it *arms* the relay (writes a
 *   timestamp to `strip2fa_arm`) and opens Gmail in a new tab. It also consumes a code
 *   that is already fresh — that handles the race where the Gmail tab delivered while
 *   this page was reloading — and listens for one pushed from the Gmail tab.
 *
 * Gmail half (`mail.google.com`):
 *   does nothing at all unless the verify page armed it within the last two minutes.
 *   When armed it optionally clicks POP3 "Check mail now", then polls the Atom feed on a
 *   backoff schedule for a six-digit code from an entry issued inside the freshness
 *   window, writes it back over GM storage and closes the tab.
 *
 * THE GATES — unchanged from the legacy script, do not widen:
 *   1. The Gmail half runs only when `strip2fa_arm` holds a timestamp no older than
 *      ARM_MS (2 minutes). Not armed → it returns before touching the DOM, the feed or
 *      the POP3 settings. Arming happens exactly once, on a human clicking the button.
 *   2. A code is only ever taken from a feed entry whose `issued`/`modified` date is
 *      inside FRESH_MS (5 minutes + 15s of clock-skew grace), and the verify page only
 *      submits a cached code that is inside the same window.
 *   3. The code is only submitted when it is exactly six digits.
 *   4. The live listener on the verify page ignores non-remote value changes, so this
 *      tab never re-submits on a value it wrote itself.
 *   5. Delivering a code clears the arm, so further navigation in the Gmail tab cannot
 *      start a second run.
 *
 * Storage keys are load bearing and verbatim from the legacy script: the GM values
 * `strip2fa_arm`, `strip2fa_code`, `strip2fa_ts`, mirrored into localStorage under the
 * `strip2fa:` prefix (`strip2fa:arm`, `strip2fa:code`, `strip2fa:ts`) for debugging.
 *
 * Ported from legacy/userscripts/extranet-2fa.user.js (v2.3.0). What changed:
 *   - the launcher's MutationObserver is ctx.observe.onChange, and its inline
 *     margin-left moved into styles.css;
 *   - the Atom fetch goes through ctx.net.request instead of a hand-rolled
 *     XMLHttpRequest, and the body is always parsed with DOMParser as text/xml (the
 *     legacy script already had that as its fallback when responseXML was empty);
 *     a non-2xx response now resolves to "no code" without being parsed;
 *   - GM_getValue/GM_setValue go through ctx.settings.shared and the localStorage
 *     mirror through ctx.settings.raw, same keys;
 *   - timestamps read back out of storage are coerced with Number() — a no-op under GM
 *     storage, which round-trips numbers, but it keeps the windows honest if the
 *     settings layer ever falls back to string-valued localStorage;
 *   - the private sleep helper is ctx.dom.sleep, `console.info('[2FA] …')` is
 *     ctx.log.info, and host/page detection is ctx.page.
 * Everything about the two windows, the arm handshake, the scoring and the backoff
 * schedule is unchanged.
 *
 * GM APIs called directly, because core has no wrapper for them:
 *   GM_addValueChangeListener — the cross-tab push into the verify page. Called here
 *     rather than through ctx.settings.shared.onChange so the `remote` flag stays the
 *     raw one from Tampermonkey (gate 4).
 *   GM_saveTab — tags this tab as the verify page. Note meta/sc-gmail-bridge.json does
 *     not grant it, so the probe below currently skips it; it was informational in the
 *     legacy script and nothing reads it back.
 */

import css from './styles.css';

const STYLE_ID = 'twofa';

const CONFIG = {
  // Freshness windows
  FRESH_MS: 5 * 60 * 1000 + 15000, //             5 min + 15s grace to avoid clock skew
  ARM_MS: 2 * 60 * 1000, //                       must open Gmail within 2 minutes of arming

  // Email heuristics
  SUBJECT: '2FA Verification Code',
  SUBJECT_RE: /\b2FA\b/i, //                      extra guard if SUBJECT differs
  SENDER_RE: null, //                             e.g. /@strip-curtains\.com$/i (null disables)

  // POP3 refresh (optional speed-up)
  ENABLE_POP3_REFRESH: true,
  POP3_ACCOUNT_EMAIL: 'order-management@strip-curtains.com',
  POP3_BTN_RE: /check mail now/i,
  POP3_TIMEOUT_MS: 30000,
  POP3_POLL_MS: 150,
  POP3_SETTLE_MS: 800,
};

/** Cross-tab channel keys. GM storage; preserved verbatim — users have data here. */
const CHANNEL_KEY = 'strip2fa_code';
const CHANNEL_TS = 'strip2fa_ts';
const ARM_KEY = 'strip2fa_arm';

/** The localStorage mirror of the same three values, for eyeballing state in devtools. */
const MIRROR_PREFIX = 'strip2fa:';

const CODE_RE = /\b(\d{6})\b/;
const SIX_DIGITS = /^\d{6}$/;

const GMAIL_INBOX_URL = 'https://mail.google.com/mail/u/0/#inbox';

/** The launcher button on the verify page. The id is what makes mounting idempotent. */
const BUTTON_ID = 'strip2faFetchBtn';

const now = () => Date.now();

/* ------------------------------------------------------------------ shared storage */

/** GM storage, with the localStorage mirror the legacy script kept beside it. */
function createChannel(ctx) {
  const { shared, raw } = ctx.settings;
  return {
    get: (key, fallback) => shared.get(key, fallback),
    set: (key, value) => shared.set(key, value),
    /** Timestamps come back as numbers under GM storage; coerce for the raw fallback. */
    ts: (key) => Number(shared.get(key, 0)) || 0,
    mirror: (name, value) => raw.set(MIRROR_PREFIX + name, value),
  };
}

/* ------------------------------------------------------------------ verify_2fa page */

/**
 * Put the code in the field and submit. Returns false — and touches nothing — unless
 * the value is exactly six digits and the page actually has an input for it.
 */
function fillAndSubmit(ctx, code) {
  const { $ } = ctx.dom;
  if (!SIX_DIGITS.test(code)) return false;

  const input =
    $('#verification_code') ||
    $('input[name="verification_code"]') ||
    $('input[autocomplete="one-time-code"]') ||
    $('input[type="text"][maxlength="6"]');

  if (!input) return false;

  if (input.focus) input.focus();
  input.value = code;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));

  const form = input.closest('form') || $('form[action*="verify_2fa"]') || $('form');

  if (form) {
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else if (typeof form.submit === 'function') form.submit();
  } else {
    $('[type="submit"], button.primary, .btn-primary, .verify-submit')?.click();
  }
  return true;
}

/** Mount the launcher. Cheap and idempotent: the observer calls it after every batch. */
function mountButton(ctx, channel) {
  const { $, el } = ctx.dom;
  if (document.getElementById(BUTTON_ID)) return;

  const input = $('#verification_code');
  const host = input?.parentElement || document.body;

  const btn = el('button', { id: BUTTON_ID, type: 'button' }, 'Fetch 2FA from Gmail');

  // Legacy placement, kept as-is: the code field's sibling when there is a field, and
  // otherwise after the host element itself (appendChild only runs on the ancient
  // browsers where insertAdjacentElement is missing).
  const anchor = input || host;
  if (anchor.insertAdjacentElement) anchor.insertAdjacentElement('afterend', btn);
  else host.appendChild(btn);

  btn.addEventListener('click', () => {
    const t = now();
    channel.set(ARM_KEY, t);
    channel.mirror('arm', t);
    ctx.log.info('Arm set; opening Gmail helper…');
    window.open(GMAIL_INBOX_URL, '_blank', 'noopener,noreferrer');
  });
}

function initVerifyPage(ctx) {
  const channel = createChannel(ctx);
  ctx.log.info('Extranet armed. Page ready.');

  // Informational only: tags this tab so the Gmail side could tell where it came from.
  try {
    if (typeof GM_saveTab === 'function') GM_saveTab({ role: 'extranet-verify_2fa', when: now() });
  } catch { /* no grant, or storage disabled */ }

  ctx.style.add(css, { id: STYLE_ID });

  // Consume a fresh code immediately (handles reload races).
  const cached = channel.get(CHANNEL_KEY, null);
  const ts = channel.ts(CHANNEL_TS);
  if (cached && now() - ts <= CONFIG.FRESH_MS) {
    ctx.log.info('Using fresh cached code.');
    fillAndSubmit(ctx, String(cached));
  }

  // Live listener for codes pushed from the Gmail tab. `remote` is the gate: a change
  // this tab made itself must never trigger a submit.
  try {
    if (typeof GM_addValueChangeListener === 'function') {
      GM_addValueChangeListener(CHANNEL_KEY, (_name, _old, val, remote) => {
        if (!remote) return;
        if (typeof val === 'string' && SIX_DIGITS.test(val)) {
          setTimeout(() => fillAndSubmit(ctx, val), 50);
        }
      });
    }
  } catch { /* no grant: the cached-code path above still works */ }

  mountButton(ctx, channel);
  ctx.observe.onChange(() => mountButton(ctx, channel));
}

/* ------------------------------------------------------------------ gmail helper */

/** The Atom feed for whichever account this tab is signed into (/mail/u/<n>/…). */
function feedPath() {
  const m = location.pathname.match(/\/u\/(\d+)\//);
  const uIdx = (m && m[1]) || '0';
  return `/mail/u/${uIdx}/feed/atom`;
}

/** Poll a predicate until it returns something truthy, or throw after timeoutMs. */
async function poll(ctx, fn, timeoutMs, stepMs, label) {
  const t0 = now();
  for (;;) {
    const v = fn();
    if (v) return v;
    if (now() - t0 > timeoutMs) throw new Error('Timeout: ' + (label || 'poll'));
    await ctx.dom.sleep(stepMs);
  }
}

/** Gmail's settings live in nested frames, so the POP3 row is hunted across all of them. */
function getAllDocs() {
  const out = new Set();
  const crawl = (win) => {
    try {
      if (!win || !win.document || out.has(win.document)) return;
      out.add(win.document);
      win.document.querySelectorAll('iframe, frame').forEach((f) => {
        try {
          if (f.contentWindow) crawl(f.contentWindow);
        } catch { /* cross-origin frame */ }
      });
    } catch { /* cross-origin frame */ }
  };
  crawl(window.top || window);
  return [...out];
}

/**
 * Optional POP3 refresh — isolated and guarded. It only ever clicks the "Check mail now"
 * of the one configured account, identified by a row that carries the account address,
 * the button text *and* a "Last checked" column, so a partial match cannot click
 * something else. Any failure is logged and skipped; the poll below still runs.
 */
async function pop3Refresh(ctx) {
  if (!CONFIG.ENABLE_POP3_REFRESH) return false;

  const startHash = location.hash;
  const toAccounts = () => {
    if (!/settings\/accounts/.test(location.hash)) {
      location.hash = '#settings/accounts';
    }
  };

  const findPop3Row = (docs) => {
    for (const doc of docs) {
      const nodes = doc.querySelectorAll('tr, div, section, tbody, table');
      for (const node of nodes) {
        const txt = (node.innerText || '').trim();
        // Row must contain target POP3 account AND "Check mail now"
        // Additional guard: expect "Last checked" to avoid false positives.
        if (
          txt.includes(CONFIG.POP3_ACCOUNT_EMAIL) &&
          CONFIG.POP3_BTN_RE.test(txt) &&
          /last\s+checked/i.test(txt)
        ) {
          return { doc, row: node };
        }
      }
    }
    return null;
  };

  const findCheckBtn = (row) =>
    [...row.querySelectorAll('button, [role="button"], a, span, div')].find((n) =>
      CONFIG.POP3_BTN_RE.test(n.textContent || ''),
    );

  try {
    toAccounts();
    await ctx.dom.sleep(CONFIG.POP3_SETTLE_MS);

    const { doc, row } = await poll(
      ctx,
      () => findPop3Row(getAllDocs()),
      CONFIG.POP3_TIMEOUT_MS,
      CONFIG.POP3_POLL_MS,
      'POP3 row',
    );

    row.scrollIntoView({ block: 'center' });
    await ctx.dom.sleep(CONFIG.POP3_SETTLE_MS);

    const before = row.innerText || '';
    const btn = await poll(
      ctx,
      () => findCheckBtn(row),
      CONFIG.POP3_TIMEOUT_MS,
      CONFIG.POP3_POLL_MS,
      'Check mail now button',
    );

    ['mouseover', 'mousedown', 'mouseup', 'click'].forEach((type) =>
      btn.dispatchEvent(
        new window.MouseEvent(type, { bubbles: true, cancelable: true, view: doc.defaultView || window }),
      ),
    );

    await poll(
      ctx,
      () => {
        const t = row.innerText || '';
        return t !== before || /checking mail/i.test(t);
      },
      CONFIG.POP3_TIMEOUT_MS,
      CONFIG.POP3_POLL_MS,
      'row update',
    );

    // Restore prior view if needed
    if (startHash && !/settings\/accounts/.test(startHash)) {
      location.hash = startHash;
    }
    return true;
  } catch (e) {
    ctx.log.warn('POP3 refresh skipped/failed:', e.message || e);
    return false;
  }
}

/** Score one Atom entry: fresh, right subject, right sender, contains a six-digit code. */
function scoreEntry(entry) {
  const issuedStr =
    entry.querySelector('issued')?.textContent || entry.querySelector('modified')?.textContent || '';
  const issued = issuedStr ? new Date(issuedStr) : null;
  const subj = entry.querySelector('title')?.textContent?.trim() || '';
  const body = entry.querySelector('summary')?.textContent?.trim() || '';
  const from =
    entry.querySelector('author > email')?.textContent?.trim() ||
    entry.querySelector('author > name')?.textContent?.trim() ||
    '';

  // simple score for ordering
  let score = 0;
  if (issued && now() - issued.getTime() < CONFIG.FRESH_MS) score += 10;
  if (subj === CONFIG.SUBJECT) score += 5;
  else if (CONFIG.SUBJECT_RE && CONFIG.SUBJECT_RE.test(subj)) score += 3;
  if (CONFIG.SENDER_RE && CONFIG.SENDER_RE.test(from)) score += 4;
  const codeMatch = (subj + ' ' + body).match(CODE_RE);
  if (codeMatch) score += 2;

  return { issued, subj, body, from, codeMatch, score };
}

/** One read of the Atom feed. Resolves the six-digit code, or null for anything else. */
async function fetchCodeOnce(ctx) {
  let text = '';
  try {
    const res = await ctx.net.request(feedPath());
    if (res.status && (res.status < 200 || res.status >= 300)) return null;
    text = res.text || '';
  } catch {
    return null; // legacy: xhr.onerror -> resolve(null)
  }
  if (!text) return null;

  let xml = null;
  try {
    xml = new DOMParser().parseFromString(text, 'text/xml');
  } catch { /* not XML: treated as no code */ }
  if (!xml) return null;

  const entries = [...xml.querySelectorAll('entry')].map(scoreEntry);

  // Keep fresh first, then score descending, then newest
  const freshSorted = entries
    .filter((it) => it.issued && now() - it.issued.getTime() < CONFIG.FRESH_MS)
    .sort((a, b) => b.score - a.score || (b.issued?.getTime() || 0) - (a.issued?.getTime() || 0));

  for (const it of freshSorted) {
    if (it.codeMatch) return it.codeMatch[1];
  }
  return null;
}

/** Backoff schedule, in ms from the start of the run. Tuned against the live feed. */
const DEADLINES = [0, 300, 700, 1200, 1800, 2500, 3500, 5000, 7000, 9000, 12000, 15000, 20000, 25000, 30000, 35000, 40000];

async function runGmailHelper(ctx, channel, armed) {
  ctx.log.info('Gmail helper active. Armed within window:', armed, location.hash);

  // Optional: kick POP3 pull first to reduce wait
  await pop3Refresh(ctx).catch(() => {});

  const t0 = now();
  let code = null;

  for (let i = 0; i < DEADLINES.length; i++) {
    const wait = Math.max(0, DEADLINES[i] - (now() - t0));
    if (wait) await ctx.dom.sleep(wait);
    code = await fetchCodeOnce(ctx);
    if (code) break;
  }

  if (!code) {
    ctx.log.info('No fresh code yet; leaving Gmail tab open.');
    return;
  }

  try {
    channel.set(CHANNEL_KEY, code);
    channel.set(CHANNEL_TS, now());
    // Clear arm so we don't re-run on further navigation
    channel.set(ARM_KEY, 0);
    channel.mirror('code', code);
    channel.mirror('ts', now());
    ctx.log.info('Code delivered to Extranet:', code);
  } finally {
    // Try to close; if blocked, at least blank
    window.close();
    setTimeout(() => {
      try {
        location.replace('about:blank');
      } catch { /* navigation blocked */ }
    }, 200);
  }
}

function initGmail(ctx) {
  const channel = createChannel(ctx);
  const armedAt = channel.ts(ARM_KEY);
  const armed = armedAt > 0 && now() - armedAt <= CONFIG.ARM_MS;

  // Absolutely no action if not armed by the verify page.
  if (!armed) return;

  runGmailHelper(ctx, channel, armed).catch((err) => ctx.log.error(err));
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'twofa',
  title: 'Extranet 2FA relay',
  runAt: 'idle',
  // Both halves ship in one module because they share one script identity, and with it
  // one GM storage area — that is the channel. So no `hosts` and no `pages`: the bundle's
  // @match already limits this to Gmail and the verify page, and init picks the half.
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    if (ctx.page.isGmail) initGmail(ctx);
    else if (ctx.page.isExtranet && ctx.page.is('verify_2fa')) initVerifyPage(ctx);
  },
};
