/**
 * Gmail autolinks — turns Legacy tokens, invoice ids, SC order ids and PO numbers in
 * Gmail into chips that open the extranet search page with the token pre-filled.
 *
 * The link target is `?p=search#autosearch=1&q=<token>&extra=---`; the extranet side
 * reads that hash and submits the search on-page.
 *
 * Ported from legacy/userscripts/gmail-quote-search.user.js (v1.8). Differences from
 * the original, all deliberate:
 *
 *  - The legacy `@match` covered `https://*.google.com/*` as well as Gmail. The bundle
 *    matches only `mail.google.com`, and `hosts` below keeps this module off the other
 *    page in the bundle (the extranet `?p=verify_2fa` relay). Nothing re-checks
 *    `location` at runtime.
 *  - Rescans run off `ctx.observe.onChange` instead of a private MutationObserver, and
 *    `ctx.route.onChange` replaces the `hashchange` listener. Two consequences:
 *      * The legacy scheduler called `(window.requestAnimationFrame || setTimeout)(…)`
 *        with the function detached from `window`, which throws "Illegal invocation" in
 *        Chrome. Its `scheduled` flag was set before the call and cleared only in the
 *        callback, so after the first mutation it stayed latched and no further scan
 *        ever ran. Live rescanning actually works now.
 *      * The shared observer watches childList/subtree but not characterData, so a
 *        message whose text changes in place without any node being added no longer
 *        triggers a rescan. Gmail rebuilds nodes on every render, so this has not shown
 *        up in practice.
 *      * `route.onChange` also fires on pushState/replaceState and popstate, not just
 *        hashchange, so an SPA navigation that keeps the hash still rescans.
 *  - The stylesheet moved to styles.css and is injected once from `init` via
 *    `ctx.style.add` (as a `<style data-sc-style="gmail-links">`; the legacy marker
 *    attribute was `data-tmx-bubble-css`). The legacy injected it lazily on the first
 *    scan, which is the same moment — `init` scans immediately.
 *  - Text is normalised with `ctx.dom.norm`, which folds non-breaking spaces and trims
 *    exactly as the script's own `norm` did.
 *
 * No storage keys: this module reads and writes none.
 */

import css from './styles.css';

/* ------------------------------------------------------------------ config */

const STYLE_ID = 'gmail-links';

const SEARCH_ACTION = 'https://extranet.strip-curtains.com/?p=search';
const DEFAULT_EXTRA = '---';

/* ------------------------------------------------------------------ patterns */

// Legacy token: 6–7 digits - 4–6 digits - 3 digits - P/S (case-insensitive)
const DASH = String.raw`[-\u2010-\u2015\u2212]`;        // -, ‐–—― and minus sign
const ZW   = String.raw`[\u200B\u200C\u200D\uFEFF]*`;  // zero-widths Gmail sometimes injects
const WS   = String.raw`(?:[\s\u00A0]${ZW})+`;         // space/nbsp (+ optional zero-width)
const OWS  = String.raw`(?:[\s\u00A0]${ZW})*`;         // optional space(s)
const LEGACY_RE_SRC =
      String.raw`\b\d{6,7}${ZW}${DASH}${ZW}\d{4,6}${ZW}${DASH}${ZW}\d{3}${ZW}${DASH}${ZW}[PS]\b`;

// AKON ORDER PO in subject: "AKON ORDER 437429-00" → link just "437429-00"
// Always 6 digits, dash, 2 digits; tolerate fancy dashes/ZW and spacing.
const AKON_ORDER_PO_RE_SRC =
      String.raw`(?<=\bAKON${WS}ORDER${WS})\d{6}${ZW}${DASH}${ZW}\d{2}\b`;

// Invoice IDs (confirmed 6 digits starting with 1)
const INV_AFTER_PREFIX_RE_SRC = String.raw`(?<=\bInvoice\s*#\s*)1\d{5}`;
const INV_NEXTLINE_RE_SRC     = String.raw`(?<=\bInvoice\s*#[^\n\r]*[\r\n]+\s*)1\d{5}`;
const INV_AFTER_2363_RE_SRC   = String.raw`(?<=\b2363-)1\d{5}`;

// Subject-style: "1###### - anything"
const INV_SUBJECT_STYLE_RE_SRC = String.raw`(?<!\d)1\d{5}(?=\s*-)`;

// Watched-sender standalone invoice ids in body
const INV_STANDALONE_RE_SRC = String.raw`(?<!\d)1\d{5}(?!\d)`;

// SC order IDs: 'SC' + 12 digits (e.g., SC352022114699)
const SC_ORDER_RE_SRC = String.raw`\bSC\d{12}\b`;

// PO# <alnum/dash> … but only if it contains at least one digit.
// Examples: "PO# 450123-A", "PO#A1-23-BC", "PO#12345"
// Tolerates zero-width/nbsp around '#' and after it.
const PO_AFTER_HASH_RE_SRC =
      String.raw`(?<=\bPO${OWS}#${OWS})(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]+(?![A-Za-z0-9-])`;

// Combine (global)
const BASE_GLOBAL_RE_SRC =
      `${LEGACY_RE_SRC}|${INV_AFTER_PREFIX_RE_SRC}|${INV_NEXTLINE_RE_SRC}|${INV_AFTER_2363_RE_SRC}|${INV_SUBJECT_STYLE_RE_SRC}|${SC_ORDER_RE_SRC}|${AKON_ORDER_PO_RE_SRC}|${PO_AFTER_HASH_RE_SRC}`;

// In bodies from a watched sender, a bare 1###### is an invoice id too.
const EXTENDED_RE_SRC = `${BASE_GLOBAL_RE_SRC}|${INV_STANDALONE_RE_SRC}`;

// Watched senders whose bodies should also auto-link any standalone 1######
const WATCHED_SENDERS = ['peter@strip-curtains.com', 'shipping@strip-curtains.com'];

const SKIP_TAGS = new Set(['A', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);
const FLAG_AUTOLINKED = 'data-legacynum-autolinked';

// NodeFilter constants, inlined because NodeFilter is not one of the bundle's lint globals.
const SHOW_TEXT = 4;
const FILTER_ACCEPT = 1;
const FILTER_REJECT = 2;

/* ------------------------------------------------------------------ helpers */

/** Try to decide if a message body belongs to one of the watched senders. */
function bodyIsFromWatchedSender(bodyEl) {
  if (!bodyEl) return false;

  let el = bodyEl;
  for (let i = 0; el && i < 8; i++) {
    for (const email of WATCHED_SENDERS) {
      try {
        if (el.querySelector && el.querySelector(`span[email="${email}"]`)) {
          return true;
        }
      } catch { /* ignore */ }
    }
    el = el.parentElement;
  }
  return false;
}

/* ------------------------------------------------------------------ linker */

function createAutolinker(ctx) {
  const { $$, norm } = ctx.dom;

  function buildLegacyUrl(q, extra = DEFAULT_EXTRA) {
    const url = new URL(SEARCH_ACTION);
    url.hash = new URLSearchParams({ autosearch: '1', q: norm(q), extra }).toString();
    return url.toString();
  }

  function openLegacySearch(q) {
    window.open(buildLegacyUrl(q), '_blank', 'noopener,noreferrer');
  }

  function replaceMatchesInTextNode(textNode, reSrc) {
    const text = textNode.nodeValue;
    if (!text) return;

    const TEST_RE = new RegExp(reSrc, 'i');
    if (!TEST_RE.test(text)) return;

    const re = new RegExp(reSrc, 'gi');
    let m;
    let last = 0;
    const frag = document.createDocumentFragment();

    while ((m = re.exec(text)) !== null) {
      const start = m.index;
      const matched = m[0];
      const end = start + matched.length;

      if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));

      const tokenOrId = matched;
      const a = document.createElement('a');
      a.textContent = matched;
      a.href = buildLegacyUrl(tokenOrId);
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.setAttribute('data-legacy-number', '1');
      a.addEventListener('click', (e) => {
        e.preventDefault();
        openLegacySearch(tokenOrId);
      });

      frag.appendChild(a);
      last = end;
    }

    if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));

    const parent = textNode.parentNode;
    if (parent) {
      parent.replaceChild(frag, textNode);
      parent.setAttribute(FLAG_AUTOLINKED, '1');
    }
  }

  function autolink(root, reSrc) {
    const ANY_RE_TEST = new RegExp(reSrc, 'i');

    const walker = document.createTreeWalker(root, SHOW_TEXT, {
      acceptNode(node) {
        const p = node.parentNode;
        if (!p || p.nodeType !== 1) return FILTER_REJECT;
        if (SKIP_TAGS.has(p.tagName)) return FILTER_REJECT;
        if (p.closest('a,button,[role="button"],[contenteditable="true"]')) return FILTER_REJECT;

        // Skip anything the user cannot see: hidden Gmail scaffolding is full of ids.
        const cs = p.ownerDocument.defaultView.getComputedStyle(p);
        if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return FILTER_REJECT;

        return ANY_RE_TEST.test(node.nodeValue) ? FILTER_ACCEPT : FILTER_REJECT;
      },
    });

    // Collect first: replacing a node while the walker is on it invalidates the walk.
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    nodes.forEach((n) => replaceMatchesInTextNode(n, reSrc));
  }

  function scan() {
    // Pass 1 (GLOBAL)
    autolink(document.body || document.documentElement, BASE_GLOBAL_RE_SRC);

    // Pass 2 (SENDER-SCOPED): in bodies from peter@ / shipping@ also link any standalone 1######
    for (const body of $$('div.a3s')) {   // Gmail message bodies
      if (bodyIsFromWatchedSender(body)) {
        autolink(body, EXTENDED_RE_SRC);
      }
    }
  }

  return {
    scan,
    start() {
      scan();                        // initial
      ctx.observe.onChange(scan);    // Gmail renders everything after load
      ctx.route.onChange(scan);      // and navigates by hash
    },
  };
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'gmail.links',
  title: 'Gmail autolinks',
  runAt: 'end',
  hosts: ['mail.google.com'],
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    ctx.style.add(css, { id: STYLE_ID });
    createAutolinker(ctx).start();
  },
};
