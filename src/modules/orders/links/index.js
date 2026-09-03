/**
 * Extra links.
 *
 * Four passes over the page, each turning something inert into a link somebody actually
 * wants to click:
 *
 *   - an internal shipment link (?p=shipment-fullprogress&shipment=1Z…) is rewritten to
 *     the UPS tracking page for that number
 *   - a bare UPS tracking number in text is autolinked to the same place
 *   - a ####CDS token becomes a Shopify Orders search on the US store
 *   - a ####CA token becomes the same search on the Canadian store
 *
 * The token searches query the first eligible email found on the page rather than the
 * token itself, so the customer's whole order history comes up. Our own domains are
 * excluded because staff addresses appear on nearly every page and would match first.
 * With no eligible email the search falls back to the token (CDS) or its digits (CA).
 *
 * Ported from legacy/userscripts/extralinks.user.js (v1.5). The legacy rAF-throttled
 * MutationObserver on documentElement is one ctx.observe.onChange subscription.
 */

/* ------------------------------------------------------------------ config */

const SHOPIFY_STORE = 'https://admin.shopify.com/store/f70388-f2';
const SHOPIFY_STORE_CA = 'https://admin.shopify.com/store/stripcurtainscanada';

const shopifySearchUrlFor = (storeBase, q) =>
  `${storeBase}/orders?query=${encodeURIComponent(String(q || '').trim())}&link_source=search`;

const EXCLUDED_EMAIL_DOMAINS = new Set(['strip-curtains.com', 'singersafety.com', 'extruflex.com']);

// ####CDS / ####CA tokens: 4 digits then the suffix, case-insensitive.
const CDS_TOKEN_RE = /\b(\d{4}CDS)\b/gi;
const CA_TOKEN_RE = /\b(\d{4}CA)\b/gi;

// pragmatic email matcher (avoid trailing punctuation with lookahead)
const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?=$|[^A-Z0-9._%+-])/gi;

const UPS_PREFIX = 'https://www.ups.com/track?tracknum=';
const TRACK_RE = /\b(1ZR5263W[0-9A-Z]{10}|1ZX8788Y[0-9A-Z]{10})\b/gi;

// internal shipments → UPS
const TARGET_HOST = 'extranet.strip-curtains.com';
const TARGET_PAGE = 'shipment-fullprogress';
const TARGET_PARAM = 'shipment';
const SHIPMENT_LINK_SEL =
  'a[href*="extranet.strip-curtains.com/"][href*="p=shipment-fullprogress"][href*="shipment="]';

// skip autolinking in these
const SKIP_TAGS = new Set(['A', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);

// flags, so a later pass leaves alone what an earlier one already linked
const FLAG_LINK_REWRITTEN = 'data-ups-rewritten';
const FLAG_TEXT_AUTOLINKED = 'data-ups-autolinked';
const FLAG_CDS_AUTOLINKED = 'data-shopify-cds-autolinked';
const FLAG_CA_AUTOLINKED = 'data-shopify-ca-autolinked';

/** NodeFilter constants, read off window so the module stays lint-clean. */
const SHOW_TEXT = window.NodeFilter ? window.NodeFilter.SHOW_TEXT : 4;
const FILTER_ACCEPT = window.NodeFilter ? window.NodeFilter.FILTER_ACCEPT : 1;
const FILTER_REJECT = window.NodeFilter ? window.NodeFilter.FILTER_REJECT : 2;

/* ------------------------------------------------------------------ helpers */

const toUPSUrl = (tracking) => UPS_PREFIX + encodeURIComponent(String(tracking || '').trim());

/**
 * Every regex here is /g and shared between passes, so lastIndex carries over from the
 * previous call. Always test from the start.
 */
function matches(regex, text) {
  regex.lastIndex = 0;
  const hit = regex.test(String(text == null ? '' : text));
  regex.lastIndex = 0;
  return hit;
}

function emailDomain(addr) {
  const at = String(addr || '').lastIndexOf('@');
  if (at < 0) return '';
  return String(addr.slice(at + 1)).replace(/[)\].,;:]+$/, '').toLowerCase();
}

const isExcludedEmail = (addr) => EXCLUDED_EMAIL_DOMAINS.has(emailDomain(addr));

/** First eligible email on the page: mailto: links first, then visible text. */
function findEligibleEmail(root) {
  // 1) mailto: links
  for (const a of root.querySelectorAll('a[href^="mailto:" i]')) {
    const addr = a.getAttribute('href').slice(7).split('?')[0]; // after 'mailto:'
    if (addr && matches(EMAIL_RE, addr) && !isExcludedEmail(addr)) return addr;
  }
  // 2) visible text
  const walker = document.createTreeWalker(root, SHOW_TEXT, null);
  let node;
  while ((node = walker.nextNode())) {
    const p = node.parentNode;
    if (!p || p.nodeType !== 1) continue;
    if (SKIP_TAGS.has(p.tagName)) continue;
    if (p.closest('a,[contenteditable="true"]')) continue;
    const t = node.nodeValue || '';
    EMAIL_RE.lastIndex = 0;
    let m;
    while ((m = EMAIL_RE.exec(t))) {
      const addr = m[0];
      if (!isExcludedEmail(addr)) return addr;
    }
  }
  return ''; // none found
}

/* ------------------------------------------------------------- text autolinker */

function replaceMatchesInTextNode(textNode, regex, makeNode, containerFlagAttr) {
  const text = textNode.nodeValue;
  if (!text) return;
  if (!matches(regex, text)) return;

  const parent = textNode.parentNode;
  if (!parent) return;

  const frag = document.createDocumentFragment();
  let lastIndex = 0;
  let m;
  regex.lastIndex = 0;
  while ((m = regex.exec(text)) !== null) {
    const start = m.index;
    const end = start + m[0].length;
    if (start > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
    frag.appendChild(makeNode(m[0]));
    lastIndex = end;
  }
  if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
  parent.replaceChild(frag, textNode);
  if (containerFlagAttr) parent.setAttribute(containerFlagAttr, '1');
}

/**
 * Walk the text nodes under root and swap every match for whatever makeNode builds.
 * The flag attribute lands on the container so the next pass skips that subtree.
 */
function autolinkByRegex(root, regex, makeNode, containerFlagAttr) {
  const walker = document.createTreeWalker(root, SHOW_TEXT, {
    acceptNode(node) {
      const p = node.parentNode;
      if (!p || p.nodeType !== 1) return FILTER_REJECT;
      if (SKIP_TAGS.has(p.tagName)) return FILTER_REJECT;
      if (p.closest('a,button,[role="button"]')) return FILTER_REJECT;
      if (p.closest('[contenteditable="true"]')) return FILTER_REJECT;
      if (containerFlagAttr && p.closest(`[${containerFlagAttr}="1"]`)) return FILTER_REJECT;
      return matches(regex, node.nodeValue) ? FILTER_ACCEPT : FILTER_REJECT;
    },
  });
  const nodes = [];
  while (walker.nextNode()) nodes.push(walker.currentNode);
  nodes.forEach((n) => replaceMatchesInTextNode(n, regex, makeNode, containerFlagAttr));
}

/* ------------------------------------------------------- internal shipment links */

function isTargetShipmentLink(a) {
  let url;
  try {
    url = new URL(a.href);
  } catch {
    return false;
  }
  if (url.hostname !== TARGET_HOST) return false;
  const page = (url.searchParams.get('p') || '').toLowerCase();
  if (page !== TARGET_PAGE) return false;
  const shipment = url.searchParams.get(TARGET_PARAM);
  return Boolean(shipment && shipment.trim());
}

function rewriteShipmentLink(a) {
  if (!a || a.getAttribute(FLAG_LINK_REWRITTEN) === '1') return;
  if (!isTargetShipmentLink(a)) return;
  let url;
  try {
    url = new URL(a.href);
  } catch {
    return;
  }
  const tracking = url.searchParams.get(TARGET_PARAM);
  if (!tracking) return;
  a.href = toUPSUrl(tracking);
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  a.setAttribute(FLAG_LINK_REWRITTEN, '1');
}

/* ------------------------------------------------------------------ the passes */

function createExtraLinks(ctx) {
  const { $$, el, norm } = ctx.dom;

  const link = (href, text, flagAttr) =>
    el('a', { href, target: '_blank', rel: 'noopener noreferrer', [flagAttr]: '1' }, text);

  // Cached per page so a rescan does not walk the whole document for an email again.
  let cachedEmail = '';
  function searchEmail() {
    if (!cachedEmail) cachedEmail = findEligibleEmail(document.body || document);
    return cachedEmail || null; // null signals no eligible email
  }

  const processExistingLinks = (root) => $$(SHIPMENT_LINK_SEL, root).forEach(rewriteShipmentLink);

  function autolinkTrackingNumbers(root) {
    autolinkByRegex(
      root,
      TRACK_RE,
      (raw) => link(toUPSUrl(norm(raw)), raw, FLAG_LINK_REWRITTEN),
      FLAG_TEXT_AUTOLINKED,
    );
  }

  function autolinkCdsTokens(root) {
    const email = searchEmail(); // may be null
    autolinkByRegex(
      root,
      CDS_TOKEN_RE,
      (tokenRaw) => {
        const query = email || norm(tokenRaw); // fallback to the token if no email
        // Display the ####CDS exactly as found.
        return link(shopifySearchUrlFor(SHOPIFY_STORE, query), tokenRaw, 'data-shopify-cds');
      },
      FLAG_CDS_AUTOLINKED,
    );
  }

  function autolinkCaTokens(root) {
    const email = searchEmail();
    autolinkByRegex(
      root,
      CA_TOKEN_RE,
      (tokenRaw) => {
        // The Canadian fallback searches digits only (2146 from "2146CA").
        const digitsOnly = norm(tokenRaw).replace(/\D+/g, '');
        const query = email && email.length ? email : digitsOnly;
        return link(shopifySearchUrlFor(SHOPIFY_STORE_CA, query), tokenRaw, 'data-shopify-ca');
      },
      FLAG_CA_AUTOLINKED,
    );
  }

  return function scan() {
    const root = document.body || document;
    processExistingLinks(document);
    autolinkTrackingNumbers(root);
    autolinkCdsTokens(root);
    autolinkCaTokens(root);
  };
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'orders.links',
  title: 'UPS & Shopify links',
  runAt: 'idle',
  pages: [], // the legacy @match was the whole extranet
  enabledByDefault: true,

  init(ctx) {
    const scan = createExtraLinks(ctx);
    scan();

    // One subscription in place of the legacy MutationObserver on documentElement — the
    // same "rescan after any DOM change", batched into a single frame.
    ctx.observe.onChange(scan);
  },
};
