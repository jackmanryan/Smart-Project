/**
 * Bubble Text — the pill treatment for table values, and the gated copy that rides on it.
 *
 * Every table on the page is scanned for things worth reading as a chip: label/value
 * rows, naked entities (long ids, hyphenated ids, ISO dates, money including the k/m/b
 * shorthand), emails and phone numbers even when they sit inline beside a button,
 * name/company cells split by a <br>, the message column, and order / PDF / tracking /
 * conversation links. Each becomes a `.tm-bubble`. Clicking one copies "Header: value",
 * double-clicking copies the whole row — but only while ExtraNav's "Copy Buttons"
 * switch is on. Loose form controls get the matching dark `.tm-field` skin.
 *
 * Ported from legacy/userscripts/bubble-text.user.js (v1.13.0). Differences from the
 * original are listed here rather than hidden in the code:
 *
 *  - The copy gate no longer digs ExtraNav's `#st_s2` checkbox out of the nav shadow
 *    root. It reads the switch grid's own store — `st:switches:v1`, key `s2` — through
 *    ctx.settings.json, picks flips up from the `nav:switch` event, and re-reads on
 *    every rescan (which is what the legacy re-query of the checkbox amounted to, since
 *    ExtraNav sets `.checked` programmatically and fires no `change` event). Nothing
 *    stored reads as off, the same as the missing checkbox did — but a stored `true`
 *    now arms copy even on a page where ExtraNav never mounted, where the legacy script
 *    would have found no checkbox and stayed off.
 *  - With the shadow-root hunt goes its five-second wait, so `data-tm-copy-enabled` —
 *    the copy cursor — is right from the first pass instead of once the navbar mounts.
 *  - Rescans ride ctx.observe.onChange: one shared observer for the bundle, batched into
 *    an animation frame, in place of the script's own MutationObserver plus
 *    requestIdleCallback pair.
 *  - Bubble tooltips are rewritten when the switch actually flips rather than on every
 *    rescan. A bubble is still born carrying the title for the current state.
 *  - Copying goes through ctx.dom.copyText, which prefers GM_setClipboard. The legacy
 *    fallback reported success even when `document.execCommand('copy')` threw, so a
 *    copy that fails outright no longer pulses the bubble.
 *  - The stylesheet is injected once by ctx.style; the legacy script appended its own
 *    <style id="tm-bubbles-style"> *and* passed the same text to GM_addStyle. Nothing
 *    referenced that id.
 *  - Light/dark still comes entirely from the `data-theme` attribute in styles.css —
 *    core's theme service owns that attribute now, so there is no theme code here.
 *  - The unused `containsEmail`, `containsPhone` and `splitKeyVal` helpers are dropped;
 *    nothing called them. The money and inline-entity regexes are built once at module
 *    scope instead of on every call (none of them are sticky or global).
 */

import { $$, norm } from '../../../core/dom.js';
import css from './styles.css';

/* ------------------------------------------------------------------ config */

const STYLE_ID = 'tables-bubbles';

/** ExtraNav's settings grid, verbatim: `s2` is the "Copy Buttons" switch. */
const NAV_SWITCH_KEY = 'st:switches:v1';
const COPY_SWITCH = 's2';

const COPY_ATTR = 'data-tm-copy-enabled';
const TITLE_ON = 'Click: copy value • Double-click: copy row';
const TITLE_OFF = 'Enable “Copy Buttons” in ExtraNav to copy';

const BUTTON_SEL = 'button, [role="button"], .tm-copy-btn, .btn, a.btn';
const CONTROL_SEL = ':scope > a, :scope > button, :scope > input, :scope > select, :scope > textarea';
const FIELD_SEL = 'input[type="text"], input:not([type]), input[type="number"], textarea, select';

const ORDER_LINK_SEL = [
  'a[href*="?p=orders-view"][href*="view="]',
  'a[href*="?p=orders-review"][href*="review="]',
  'a[href*="?p=3partyshipment"][href*="view="]',
].join(',');

/* Expanded link-bubble targets (ORDER_LINK_SEL stays on its own for the heuristics). */
const LINK_BUBBLE_SEL = [
  ORDER_LINK_SEL,
  /* Leads → MessageCenter */
  'a[href*="?p=leads_view2"][href*="#MessageCenter-Block"]',
  /* Direct PDF downloads */
  'a[href$=".pdf"]',
  /* Modal action links */
  'a[rel="modal:open"]',
  /* Accordion/Conversation toggles */
  'a[href^="#conversation"]',
  /* UPS tracking */
  'a[href*="ups.com/track"]',
].join(',');

const CODES = /(?:USD|CAD|AUD|EUR|GBP|MXN|NZD|JPY|CNY|INR|CHF|SEK|NOK|DKK|ZAR)/i;
const MONEY_CORE = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d+)?`;
const MONEY_SUFFIX = /(?:k|m|b|bn|mm)/i; // 122k, 3.2m, 1bn, 250mm
const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
const PHONE_RE = /\+?\d[\d().\s\-]{7,}\d/;

/* Whole-cell money, with the code or symbol before or after the number. */
const MONEY_BEFORE_RE = new RegExp(`^(?:${CODES.source})\\s*${MONEY_CORE}(?:\\s*${MONEY_SUFFIX.source})?$`, 'i');
const MONEY_AFTER_RE = new RegExp(`^${MONEY_CORE}(?:\\s*${MONEY_SUFFIX.source})?\\s*(?:${CODES.source})$`, 'i');
const MONEY_SYMBOL_RE = new RegExp(`^[€£$]\\s*${MONEY_CORE}(?:\\s*${MONEY_SUFFIX.source})?$`);
/* Money anywhere inside a longer string, e.g. "$122k order". */
const MONEY_ANY_RE = new RegExp(
  `(?:[€£$]\\s*)?${MONEY_CORE}(?:\\s*${MONEY_SUFFIX.source})?(?:\\s*(?:${CODES.source}))?`,
  'i',
);

/** What tryInlineEntityBubbles looks for, in priority order. */
const INLINE_PATTERNS = [
  { re: EMAIL_RE, name: 'email' },
  { re: PHONE_RE, name: 'phone' },
  { re: MONEY_ANY_RE, name: 'money' },
  { re: /\b\d{4}-\d{2}-\d{2}\b/, name: 'date' },
  { re: /\b\d{4,}\b/, name: 'id' },
];

/**
 * Four cells the site renders with nothing detectable in them. The legacy script pinned
 * them by absolute XPath and they are still the only way to reach these values.
 */
const FORCE_XPATHS = [
  '/html/body/div[3]/div/div[2]/div/div/div[2]/table/tbody/tr[4]/td[5]',
  '/html/body/div[3]/div/div[2]/div/div/div[2]/table/tbody/tr[9]/td[5]',
  '/html/body/div[3]/div/div[2]/div/div/div[2]/div/div[2]/div/table/tbody/tr[1]/td[4]',
  '/html/body/div[3]/div/div[2]/div/div/div[2]/div/div[2]/div/table/tbody/tr[6]/td[2]',
];

/** NodeFilter and XPathResult read off window so the module stays lint-clean. */
const NF = window.NodeFilter || { SHOW_TEXT: 4, FILTER_ACCEPT: 1, FILTER_REJECT: 2, FILTER_SKIP: 3 };
const ORDERED_NODE_SNAPSHOT = window.XPathResult ? window.XPathResult.ORDERED_NODE_SNAPSHOT_TYPE : 7;

/* --------------------------------------------------------------- detection */

const isButtonLike = (node) =>
  !!node && node.nodeType === 1 && (
    node.matches?.(BUTTON_SEL) ||
    [...(node.classList || [])].some((c) => c === 'btn' || c.startsWith('btn-'))
  );

const targetHasButtonLike = (root) => !!root?.querySelector?.(BUTTON_SEL);

const looksLikeLabel = (text) => {
  const t = norm(text || '');
  if (!t) return false;
  if (t.endsWith(':')) return true;
  return (t.length <= 24 && /^[\w\s().#&/+\-]+:?$/i.test(t));
};

const isShortPlainLabelish = (txt) => {
  const t = norm(txt);
  if (!t) return false;
  if (t.length > 28) return false;
  if (/\r|\n/.test(t)) return false;
  if (/\d/.test(t)) return false;
  if (!/[A-Za-z]/.test(t)) return false;
  if (/^(?:View Items|popup|>|<)$/i.test(t)) return false;
  return true;
};

const isTokenish = (s) => /(\S{10,}|\d{8,})/.test(s || '');

const isMoneyish = (txt) => {
  const t = norm(txt);
  if (!t) return false;
  return MONEY_BEFORE_RE.test(t) || MONEY_AFTER_RE.test(t) || MONEY_SYMBOL_RE.test(t);
};

const containsMoneyish = (txt) => {
  const t = norm(txt);
  if (!t) return false;
  return MONEY_ANY_RE.test(t);
};

const isPureId = (t) => /^\d{4,}$/.test(t);
const isHyphId = (t) => /^\d[\d,]*-\d+$/.test(t);
const isIsoDate = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t);
const isZeroDate = (t) => /^0{4}-0{2}-0{2}$/.test(t);

const isNumericish = (txt) => {
  const t = norm(txt);
  if (!t) return false;
  if (/[A-Za-z]/.test(t)) return false;
  return /^[-+]?\d[\d,]*(?:\.\d+)?$/.test(t);
};

const isSentenceLike = (t) => {
  const s = norm(t);
  if (!s) return false;
  const words = s.split(' ').filter(Boolean).length;
  if (words < 4) return false;
  if (s.length < 20) return false;
  // avoid pure ids/money/date
  if (isMoneyish(s) || isPureId(s) || isIsoDate(s) || isZeroDate(s) || isNumericish(s)) return false;
  return /[A-Za-z]/.test(s);
};

/** A cell's text with the furniture (scripts, icons, buttons) taken out first. */
function cleanNodeText(node) {
  const clone = node.cloneNode(true);
  $$(`script,style,noscript,svg,[aria-hidden="true"],.tm-copy-wrap, ${BUTTON_SEL}`, clone).forEach((n) => n.remove());
  return norm(clone.innerText || clone.textContent || '');
}

/* --------------------------------------------------------- bubble builders */

/**
 * Long unbroken values (refs, hashes) would otherwise be clipped by the bubble's
 * fit-content width, so measure once painted and pin a max width when it overflows.
 */
function ensureUnbroken(bubble) {
  const capPx = Math.floor(Math.min(window.innerWidth * 0.92, 99999));
  const measureEl = bubble.querySelector('.tm-val') || bubble;
  bubble.style.maxInlineSize = '';
  bubble.style.maxWidth = '';
  requestAnimationFrame(() => {
    const cw = measureEl.clientWidth;
    const sw = measureEl.scrollWidth;
    if (sw > cw) {
      const target = Math.min(sw + 12, capPx);
      bubble.style.maxInlineSize = target + 'px';
      bubble.style.maxWidth = target + 'px';
    }
  });
}

/** If the value looks like an inline list, split into bullets (keeps things readable). */
function maybeSplitValList(valEl) {
  if (!valEl) return;
  if (valEl.querySelector('br, p, div, ul, ol, li')) return; // already multiline
  const raw = norm(valEl.textContent || '');
  if (!raw || raw.length < 40) return;

  // Heuristic: repeated item-like tokens (e.g., "1 unit", "15 strips", "15.000 ft")
  const tokenRe = /\b\d+(?:\.\d+)?\s*(?:unit|units|strips|ft)\b/gi;
  const hits = raw.match(tokenRe);
  if (!hits || hits.length < 2) return;

  // Insert a newline before each subsequent token to segment items
  let marked = raw.replace(tokenRe, (m, offset) => (offset > 0 ? '\n' : '') + m);
  // Also respect common trailers like "All from us"
  marked = marked.replace(/\s+(All\s+from\s+us)\b/i, '\n$1');

  const lines = marked.split('\n').map((s) => s.trim()).filter(Boolean);
  if (lines.length < 2) return;

  // Rebuild as a list
  valEl.textContent = '';
  const ul = document.createElement('ul');
  ul.className = 'tm-list';
  lines.forEach((t) => {
    const li = document.createElement('li');
    li.className = 'tm-li';
    li.textContent = t;
    ul.appendChild(li);
  });
  valEl.appendChild(ul);
}

/** Split "Key: Value" while PRESERVING markup (e.g., <br>) in the value. */
function decorateKeyVal(bubble) {
  if (bubble.dataset.tmDecorated === '1') return;
  if (bubble.classList.contains('tm-bubble--order-link')) return; // never split link bubbles
  if (bubble.querySelector('a')) return; // if links are inside, skip splitting

  const rawText = bubble.textContent || '';
  if (!rawText) return;
  const colonPos = rawText.indexOf(':');
  // only treat short labels like "Source (1):"
  if (colonPos < 1 || colonPos > 24) return;

  // Build label text
  const label = norm(rawText.slice(0, colonPos + 1));
  if (!label) return;

  // Remove label text from the leading text nodes only (preserve <br>, <div>, etc.)
  let remaining = label.length;
  const walker = document.createTreeWalker(bubble, NF.SHOW_TEXT, null);
  const toRemove = [];
  let node;
  while (remaining > 0 && (node = walker.nextNode())) {
    const s = node.nodeValue || '';
    if (!s.length) continue;
    if (s.length <= remaining) {
      remaining -= s.length;
      toRemove.push(node);
    } else {
      node.nodeValue = s.slice(remaining);
      remaining = 0;
    }
  }
  toRemove.forEach((n) => n.parentNode && n.parentNode.removeChild(n));

  // Create key/value shells and move the (now label-less) content into .tm-val
  const keyEl = document.createElement('span');
  keyEl.className = 'tm-key';
  keyEl.textContent = label;
  const valEl = document.createElement('span');
  valEl.className = 'tm-val';
  while (bubble.firstChild) valEl.appendChild(bubble.firstChild);
  bubble.append(keyEl, document.createTextNode(' '), valEl);

  maybeSplitValList(valEl);
  bubble.dataset.tmDecorated = '1';
}

/** Give every loose form control in root the dark field skin. */
function styleControlsIn(root) {
  root.querySelectorAll?.(FIELD_SEL).forEach((node) => {
    if (!node.classList.contains('tm-field')) node.classList.add('tm-field');
  });
}

function styleLooseControls(root = document) {
  root.querySelectorAll(FIELD_SEL).forEach((node) => {
    if (node.closest('table tbody tr')) return;
    if (!node.classList.contains('tm-field')) node.classList.add('tm-field');
  });
}

function newBubble(title) {
  const bubble = document.createElement('span');
  bubble.className = 'tm-bubble';
  bubble.title = title;
  return bubble;
}

/** Wrap a whole cell's contents in a bubble. Cells holding controls are skinned instead. */
function wrapValueCell(td, title) {
  if (!td || td.dataset.tmBubbled === '1') return null;
  if (targetHasButtonLike(td)) { td.dataset.tmBubbled = '1'; styleControlsIn(td); return null; }
  if (td.querySelector(':scope > input, :scope > textarea, :scope > select')) {
    td.dataset.tmBubbled = '1';
    styleControlsIn(td);
    return null;
  }
  const visibleText = norm(td.textContent);
  if (!visibleText) return null;
  if (td.querySelector(':scope > .tm-bubble')) return td.querySelector(':scope > .tm-bubble');

  const bubble = newBubble(title);
  while (td.firstChild) bubble.appendChild(td.firstChild);
  td.appendChild(bubble);
  td.dataset.tmBubbled = '1';
  // Preserve original multi-line cells; otherwise split "Key: Value"
  decorateKeyVal(bubble);
  if (isTokenish(bubble.textContent)) ensureUnbroken(bubble);
  return bubble;
}

function bubbleOrderLinkAnchor(a) {
  if (!a || a.dataset.tmLinkBubbled === '1' || isButtonLike(a)) return;
  // If the anchor is already inside a bubble, just promote that bubble to link style.
  const host = a.closest('.tm-bubble');
  if (host) {
    host.classList.add('tm-bubble--order-link');
    try { a.style.setProperty('float', 'none', 'important'); } catch { /* inline style is best effort */ }
    a.style.setProperty('color', 'inherit', 'important');
    a.dataset.tmLinkBubbled = '1';
    return;
  }
  const bubble = document.createElement('span');
  bubble.className = 'tm-bubble tm-bubble--order-link';
  try { a.style.setProperty('float', 'none', 'important'); } catch { /* inline style is best effort */ }
  a.style.setProperty('color', 'inherit', 'important');
  a.dataset.tmLinkBubbled = '1';
  a.replaceWith(bubble);
  bubble.appendChild(a);
}

/** Bubble inline entities when the cell also holds controls or buttons. */
function tryInlineEntityBubbles(td, title) {
  let found = false;

  // 1) wrap obvious inline elements
  $$(':scope > strong, :scope > b, :scope > span, :scope > i, :scope > em', td).forEach((node) => {
    const t = norm(node.textContent || '');
    if (!t || node.closest('.tm-bubble')) return;
    if (INLINE_PATTERNS.some((p) => p.re.test(t))) {
      const bubble = newBubble(title);
      node.replaceWith(bubble);
      bubble.appendChild(node);
      found = true;
    }
  });
  if (found) return true;

  // 2) split a text node once to wrap the first match
  const walker = document.createTreeWalker(td, NF.SHOW_TEXT, {
    acceptNode(node) {
      if (!node || !node.nodeValue) return NF.FILTER_REJECT;
      if (!node.parentElement) return NF.FILTER_REJECT;
      if (node.parentElement.closest('a,button,select,input,textarea,.tm-bubble')) return NF.FILTER_REJECT;
      const s = node.nodeValue;
      for (const p of INLINE_PATTERNS) if (p.re.test(s)) return NF.FILTER_ACCEPT;
      return NF.FILTER_SKIP;
    },
  });
  let textNode;
  while ((textNode = walker.nextNode())) {
    const s = textNode.nodeValue;
    const pattern = INLINE_PATTERNS.find((p) => p.re.test(s));
    if (!pattern) continue;
    const m = s.match(pattern.re);
    if (!m) continue;
    const idx = m.index;
    const before = s.slice(0, idx);
    const mid = m[0];
    const after = s.slice(idx + mid.length);
    const frag = document.createDocumentFragment();
    if (before) frag.appendChild(document.createTextNode(before));
    const bubble = newBubble(title);
    bubble.textContent = mid;
    frag.appendChild(bubble);
    if (after) frag.appendChild(document.createTextNode(after));
    textNode.replaceWith(frag);
    found = true;
    break;
  }
  return found;
}

/* ----------------------------------------------------------------- scanning */

function detectMessageColumnIndex(table) {
  // 1) Use header names when present
  const headers = Array.from(table.querySelectorAll('thead tr th')).map((th) => norm(cleanNodeText(th)));
  if (headers.length) {
    const idx = headers.findIndex((h) => /^(message|messages|note|notes|comment|comments|detail|details?)$/i.test(h));
    if (idx >= 0) return idx;
  }
  // 2) Fallback: if col-0 is an order link bubble/anchor and row has >=5 cols, assume col-4 is the message
  const firstRow = table.querySelector('tbody tr');
  if (firstRow) {
    const c0 = firstRow.querySelector(':scope > td:nth-child(1), :scope > th:nth-child(1)');
    const hasOrder = !!(c0 && (c0.querySelector('.tm-bubble--order-link') || c0.querySelector(ORDER_LINK_SEL)));
    const colCount = firstRow.querySelectorAll(':scope > td, :scope > th').length;
    if (hasOrder && colCount >= 5) return 4;
  }
  // 3) Heuristic: pick the column with longest average "sentence-like" content across first few rows
  const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 8);
  if (!rows.length) return -1;
  const colLen = Math.max(...rows.map((r) => r.querySelectorAll(':scope > td, :scope > th').length));
  const scores = new Array(colLen).fill(0);
  rows.forEach((r) => {
    const cells = Array.from(r.querySelectorAll(':scope > td, :scope > th'));
    cells.forEach((td, i) => {
      if (!td) return;
      if (td.querySelector(CONTROL_SEL)) return;
      const t = norm(td.textContent);
      if (!t) return;
      if (isSentenceLike(t)) scores[i] += Math.min(80, t.length) + t.split(' ').length * 2;
    });
  });
  const best = scores.reduce((bi, s, i) => (s > scores[bi] ? i : bi), 0);
  return scores[best] > 0 ? best : -1;
}

function scanTable(table, title) {
  const tbodyRows = $$(':scope > tbody > tr', table);
  const msgColIdx = detectMessageColumnIndex(table);

  tbodyRows.forEach((tr) => {
    const cells = Array.from(tr.querySelectorAll(':scope > td, :scope > th'));
    if (!cells.length) return;

    // Label:Value pattern → bubble the value cell
    if (cells.length >= 2) {
      const first = norm(cells[0].textContent);
      if (looksLikeLabel(first) && !cells[1].querySelector(':scope > .tm-bubble')) {
        const b = wrapValueCell(cells[1], title);
        if (b && isTokenish(b.textContent)) ensureUnbroken(b);
      }
    }

    cells.forEach((td, i) => {
      // Bubble order-link anchors
      const a = td.querySelector(LINK_BUBBLE_SEL);
      if (a) bubbleOrderLinkAnchor(a);

      // If interactive content present: attempt inline entity bubbling (emails/phones/money/date/id)
      if (td.querySelector(CONTROL_SEL)) {
        tryInlineEntityBubbles(td, title);
        return;
      }

      if (td.dataset.tmBubbled === '1' || td.querySelector(':scope > .tm-bubble')) return;

      const text = norm(td.textContent);
      if (!text) return;

      // Message column (explicit or heuristic)
      if (i === msgColIdx && isSentenceLike(text)) { wrapValueCell(td, title); return; }

      // Name <br> Company
      if (/<br\s*\/?>/i.test(td.innerHTML)) {
        const t = text;
        if (t.length >= 6 && t.length <= 72 && /[A-Za-z]/.test(t)) { wrapValueCell(td, title); return; }
      }

      // Naked entities (exact cell)
      if (isPureId(text) || isHyphId(text) || isIsoDate(text) || isZeroDate(text) || isMoneyish(text)) {
        wrapValueCell(td, title);
        return;
      }

      // Containing money (e.g., "$122k order")
      if (text.length <= 120 && containsMoneyish(text)) { wrapValueCell(td, title); return; }

      // Short human-ish chips (status/platform/etc.)
      if (isShortPlainLabelish(text)) { wrapValueCell(td, title); return; }

      // Long tokens (refs, hashes)
      if (text.length <= 64 && isTokenish(text)) {
        const b = wrapValueCell(td, title);
        if (b) ensureUnbroken(b);
      }
    });
  });
}

function scan(root, title) {
  // Bubble targeted hrefs anywhere (including inside existing text bubbles)
  $$(LINK_BUBBLE_SEL, root)
    .filter((a) => a && a.dataset.tmLinkBubbled !== '1')
    .forEach(bubbleOrderLinkAnchor);

  // Main tables
  $$('table', root).forEach((table) => scanTable(table, title));

  // Loose controls
  styleLooseControls(root);
}

const $x = (xpath, root = document) => {
  try {
    const snap = document.evaluate(xpath, root, null, ORDERED_NODE_SNAPSHOT, null);
    const out = [];
    for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));
    return out;
  } catch {
    return [];
  }
};

function forceBubbleTargets(title, root = document) {
  FORCE_XPATHS.forEach((xpath) => {
    $x(xpath, root).forEach((td) => {
      if (td && td.nodeType === 1 && td.matches?.('td,th')) wrapValueCell(td, title);
    });
  });
}

/* ------------------------------------------------------------- copy sources */

function labelForBubble(bubble) {
  const td = bubble.closest('td,th');
  const tr = td?.closest('tr');
  if (!td || !tr) return '';
  const idx = Array.from(tr.children).indexOf(td);
  const table = tr.closest('table');
  if (table) {
    const ths = table.querySelectorAll('thead tr th');
    if (ths && ths[idx]) {
      const h = norm(cleanNodeText(ths[idx]));
      if (h) return h.replace(/:$/, '');
    }
  }
  const first = tr.querySelector(':scope > td:first-child, :scope > th:first-child');
  return norm((first && cleanNodeText(first)) || '').replace(/:$/, '');
}

const valueForBubble = (bubble) => {
  const v = bubble.querySelector('.tm-val');
  return norm(cleanNodeText(v || bubble));
};

function formatRow(tr) {
  const tds = Array.from(tr.querySelectorAll(':scope > td, :scope > th'));
  const values = tds.map((td) => cleanNodeText(td)).filter(Boolean);
  if (!values.length) return '';
  const table = tr.closest('table');
  let headers = [];
  if (table) headers = Array.from(table.querySelectorAll('thead tr th')).map((th) => norm(cleanNodeText(th)));
  if (headers.length && headers.length >= values.length) {
    return values.map((v, i) => (headers[i] ? `${headers[i]}: ${v}` : v)).join(' | ');
  }
  if (values.length >= 2) {
    const lhs = values[0].replace(/:$/, '');
    const rhs = values[1];
    const tail = values.slice(2);
    return tail.length ? `${lhs}: ${rhs} | ${tail.join(' | ')}` : `${lhs}: ${rhs}`;
  }
  return values.join(' | ');
}

const pulse = (node) => {
  node.setAttribute('data-copied', '1');
  setTimeout(() => node.removeAttribute('data-copied'), 600);
};

/* ------------------------------------------------------------------- gate */

/**
 * Copy stays behind ExtraNav's "Copy Buttons" switch, off by default. The switch grid
 * writes `st:switches:v1` and announces flips on `nav:switch`; both are consulted, and
 * the stored value is re-read on every rescan because ExtraNav also sets the checkbox
 * programmatically, which fires no DOM event at all.
 */
function createGate(ctx) {
  let enabled = false;
  let painted = false;

  const read = () => {
    const saved = ctx.settings.json.get(NAV_SWITCH_KEY, null);
    return !!(saved && typeof saved === 'object' && saved[COPY_SWITCH]);
  };

  const paint = () => {
    document.documentElement.setAttribute(COPY_ATTR, enabled ? '1' : '0');
    const title = enabled ? TITLE_ON : TITLE_OFF;
    for (const bubble of $$('.tm-bubble')) bubble.title = title;
  };

  const api = {
    get title() {
      return enabled ? TITLE_ON : TITLE_OFF;
    },

    /** Re-read the switch, repaint when it moved, and report the live value. */
    isOn() {
      const next = read();
      if (next !== enabled || !painted) {
        enabled = next;
        painted = true;
        paint();
      }
      return enabled;
    },

    start() {
      api.isOn();
      ctx.events.on('nav:switch', (detail) => {
        if (!detail || detail.key === COPY_SWITCH) api.isOn();
      });
    },
  };

  return api;
}

/* -------------------------------------------------------------- copy events */

function installCopyHandlers(ctx, gate) {
  const clickTimers = new WeakMap();

  /** Buttons keep their own click. */
  const onAButton = (e) => !!(e.target && (isButtonLike(e.target) || e.target.closest(BUTTON_SEL)));

  document.addEventListener('click', (e) => {
    if (onAButton(e)) return;
    const bubble = e.target.closest?.('.tm-bubble');
    if (!bubble) return;
    // Let real links behave normally, even when copy mode is ON
    if (bubble.classList.contains('tm-bubble--order-link') && bubble.querySelector('a')) return;
    if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
    if (!gate.isOn()) return;
    const sel = window.getSelection?.();
    if (sel && sel.toString().length) return;
    e.preventDefault();
    e.stopPropagation();
    // Hold the single-click copy long enough for a double-click to cancel it.
    if (clickTimers.has(bubble)) clearTimeout(clickTimers.get(bubble));
    const t = setTimeout(async () => {
      const label = labelForBubble(bubble);
      const value = valueForBubble(bubble);
      const line = label ? `${label}: ${value}` : value;
      const ok = await ctx.dom.copyText(line);
      if (ok) pulse(bubble);
      clickTimers.delete(bubble);
    }, 220);
    clickTimers.set(bubble, t);
  }, true);

  document.addEventListener('dblclick', (e) => {
    if (onAButton(e)) return;
    const bubble = e.target.closest?.('.tm-bubble');
    if (!bubble) return;
    if (bubble.classList.contains('tm-bubble--order-link') && bubble.querySelector('a')) return;
    if (!gate.isOn()) return;
    e.preventDefault();
    e.stopPropagation();
    if (clickTimers.has(bubble)) {
      clearTimeout(clickTimers.get(bubble));
      clickTimers.delete(bubble);
    }
    const tr = bubble.closest('tr');
    if (!tr) return;
    const text = formatRow(tr);
    if (!text) return;
    ctx.dom.copyText(text).then((ok) => {
      if (ok) pulse(bubble);
    });
  }, true);
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'tables.bubbles',
  title: 'Bubble Text',
  runAt: 'idle',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    ctx.style.add(css, { id: STYLE_ID });

    const gate = createGate(ctx);
    gate.start();
    installCopyHandlers(ctx, gate);

    scan(document, gate.title);
    forceBubbleTargets(gate.title);

    // One shared observer, batched into a frame: every DataTables redraw, modal and
    // accordion expansion gets the same pass the legacy script ran from its own.
    ctx.observe.onChange(() => {
      gate.isOn();
      scan(document, gate.title);
    });

    // Bubbles pinned to a measured width need re-measuring when the viewport changes.
    window.addEventListener('resize', () => {
      for (const bubble of $$('.tm-bubble')) {
        if (isTokenish(bubble.textContent)) ensureUnbroken(bubble);
      }
    }, { passive: true });
  },
};
