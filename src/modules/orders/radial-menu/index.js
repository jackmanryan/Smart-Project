/**
 * fileBUBBLE — the radial file menu on order pages.
 *
 * A floating FAB sits in the bottom-left corner; clicking it fans three items out of the
 * corner — Download Invoice at 12 o'clock, Download Quote at 1:30, Download Packing List
 * at 3. Everything lives in a shadow root on a 0x0 host so the site's stylesheet cannot
 * reach it and the host cannot swallow page clicks. Open/closed is a checkbox the CSS
 * reads, which is why the menu animates with no script behind it.
 *
 * The invoice link is whatever the page itself renders under /uploads/; only when the
 * page has none do we guess the filename from the order id and the Sage number. The
 * quote link comes from orders.info-panels. The Packing List item has no rule yet and
 * stays disabled.
 *
 * Ported from legacy/userscripts/filebubble.user.js (v0.5.0). Differences from the
 * original, all deliberate:
 *
 *  - `globalThis.Qlink` (the quote link another script froze onto window) is the
 *    `orders:quote-link` event that orders.info-panels publishes; we ask for a replay at
 *    startup in case it fired before we loaded.
 *  - The script's own MutationObserver + debounce, watching for a late invoice link, is
 *    `ctx.observe.each('a[href*="/uploads/"]')`. It fires once per new upload link
 *    rather than once per settled mutation batch, so the links are refreshed on the
 *    event that matters instead of on every DOM change for the rest of the session.
 *  - The `tm:route` listeners are `ctx.route.onChange`, which is what fires that event now.
 *  - Its own `onReady` wrapper and the `DOMContentLoaded` reset are gone: the module
 *    starts at idle, so both had already fired. The `pageshow` reset stays — that is the
 *    one that matters, for bfcache restores.
 *  - The host's inline position/z-index block is the `:host` rule in styles.css, and the
 *    inline opacity / pointer-events for a disabled item is the `.is-disabled` class.
 *  - `pages: ['orders-view']` where the legacy @match was `?p=orders-view&view=*`; a bare
 *    orders-view URL now gets the FAB too, with both links disabled.
 */

import css from './styles.css';
import { $$ } from '../../../core/dom.js';

/* ------------------------------------------------------------------ constants */

const HOST_ID = 'scx-radial-host';
const STYLE_ID = 'orders-radial-menu';
const EXTRANET_BASE = 'https://extranet.strip-curtains.com';

/** Published by orders.info-panels; the read-only `window.Qlink` global it replaced. */
const QUOTE_LINK_EVENT = 'orders:quote-link';

/** Accept Invoice_123.pdf, Invoice-123.pdf, or Invoice 123.pdf */
const INVOICE_RX = /\/uploads\/(\d+)\/Invoice[-_ ]?(\d+)\.pdf(?:$|\?)/i;

const UPLOAD_LINK_SEL = 'a[href*="/uploads/"]';

/** Icon markup, verbatim from the legacy menu. Every icon draws in currentColor. */
const ICON_FAB = `
  <!-- stylized file icon (uses currentColor) -->
  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none"
       stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
    <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
    <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/>
  </svg>
`;

const ICON_INVOICE = `
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
       xmlns="http://www.w3.org/2000/svg">
    <path d="M4 18.6V8.05C4 5.2 4 3.77 4.88 2.89C5.76 2 7.17 2 10 2H14C16.83 2 18.24 2 19.12 2.89C20 3.77 20 5.2 20 8.05V18.65C20 20.16 20 20.91 19.54 21.21C18.78 21.7 17.62 20.68 17.03 20.31C16.54 20 16.3 19.85 16.03 19.84C15.74 19.83 15.49 19.98 14.97 20.31L13.06 21.51C12.54 21.84 12.29 22 12 22C11.71 22 11.46 21.84 10.94 21.51L9.03 20.31C8.54 20 8.3 19.85 8.03 19.84C7.74 19.83 7.49 19.98 6.97 20.31C6.38 20.68 5.22 21.70 4.46 21.21C4 20.91 4 20.16 4 18.6Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
    <path d="M16 6H8M10 10H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
    <path d="M12 17V11M9.5 14.5L12 17L14.5 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
  </svg>
`;

const ICON_QUOTE = `
  <svg width="25" height="24" viewBox="0 0 25 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
    <path d="M7.45 18.18c-.23.11-.5.09-.72-.05a.75.75 0 0 1-.35-.63v-2.56C4.18 14.58 2.5 12.68 2.5 10.38 2.5 7.82 4.57 5.75 7.13 5.75s4.62 2.07 4.62 4.63c0 2.84-1.05 4.79-2.11 6.05-.53.61-1.06 1.05-1.47 1.33-.21.14-.38.24-.52.32l-.02.01-.03.01-.05.03Zm-3.45-7.80c0 1.73 1.40 3.13 3.13 3.13.41 0 .75.33.75.75v1.81c.20-.18.41-.39.62-.64.87-1 1.76-2.61 1.76-5 0-1.73-1.40-3.13-3.13-3.13S4 8.65 4 10.38z"/>
    <path d="M18.2 18.18c-.23.11-.5.09-.72-.05a.75.75 0 0 1-.35-.63v-2.56c-2.2-.36-3.88-2.27-3.88-4.57 0-2.56 2.07-4.63 4.62-4.63s4.62 2.07 4.62 4.63c0 2.84-1.05 4.79-2.12 6.05-.52.61-1.05 1.05-1.46 1.33-.22.14-.39.24-.53.32l-.02.01-.03.01-.05.03Zm-3.45-7.80c0 1.73 1.40 3.13 3.13 3.13.41 0 .75.33.75.75v1.81c.20-.18.41-.39.62-.64.87-1 1.76-2.61 1.76-5 0-1.73-1.40-3.13-3.13-3.13s-3.13 1.40-3.13 3.13Z"/>
  </svg>
`;

const ICON_PACKING = `
  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"
       xmlns="http://www.w3.org/2000/svg">
    <path fill-rule="evenodd" clip-rule="evenodd"
      d="M7.246 1.25H16.754c1.022 0 1.72-.0007 2.309.2043 1.113.3872 1.977 1.2829 2.348 2.4112.20.597.20 1.307.20 2.3616v14.0041c0 1.4652-1.727 2.3375-2.864 1.2967-.08-.0721-.19-.0721-.27 0l-.483.4421c-.928.8493-2.334.8493-3.262 0-.355-.3249-.882-.3249-1.237 0-.928.8493-2.334.8493-3.262 0-.355-.3249-.882-.3249-1.237 0-.928.8493-2.335.8493-3.263 0l-.483-.4421c-.079-.0721-.191-.0721-.271 0-1.137 1.0408-2.864.1685-2.864-1.2967V6.3701c0-1.2522-.0094-1.6983.1017-2.0366.2294-.6962.7568-1.233 1.4161-1.4624.3185-.1105.7391-.121 .9601-.121zM7 6.75h.5a.75.75 0 1 1 0 1.5H7a.75.75 0 0 1 0-1.5Zm3.5 0H17a.75.75 0 1 1 0 1.5h-6.5a.75.75 0 1 1 0-1.5ZM7 10.25h.5a.75.75 0 1 1 0 1.5H7a.75.75 0 1 1 0-1.5Zm3.5 0H17a.75.75 0 1 1 0 1.5h-6.5a.75.75 0 1 1 0-1.5ZM7 13.75h.5a.75.75 0 1 1 0 1.5H7a.75.75 0 0 1 0-1.5Z"/>
  </svg>
`;

/** The three items, in the order they fan out of the corner. */
const ITEMS = [
  { key: 'invoice', tip: 'Download Invoice', angle: '-90deg', icon: ICON_INVOICE }, // 12 o'clock
  { key: 'quote', tip: 'Download Quote', angle: '-45deg', icon: ICON_QUOTE }, // 1:30
  { key: 'packing', tip: 'Download Packing List', angle: '0deg', icon: ICON_PACKING }, // 3 o'clock
];

/* ------------------------------------------------------------------ link logic */

/** The invoice PDF the page already links to — the authoritative one when it exists. */
function findInvoiceInDom() {
  const a = $$(UPLOAD_LINK_SEL).find((node) => INVOICE_RX.test(node.href));
  if (!a) return null;
  const m = a.href.match(INVOICE_RX);
  return m ? { url: a.href, id: m[1], sage: m[2] } : null;
}

/**
 * Minimal best-effort order probe: the site and the older scripts each parked the
 * current order on one of a handful of globals, and none of them is guaranteed.
 */
function getOrderBrief(ctx) {
  const idFromUrl = ctx.page.param('view');
  const guesses = [
    globalThis.order,
    globalThis.currentOrder,
    globalThis.ORDER,
    globalThis.ExtraNav?.order,
    globalThis.ExtraNav?.state?.order,
    globalThis.pageState?.order,
  ].filter(Boolean);
  const o = guesses.find((x) => typeof x === 'object' && ('id' in x || 'sage_sales_number' in x)) || {};
  return {
    id: o.id ?? idFromUrl ?? null,
    sage_sales_number: o.sage_sales_number ?? null,
  };
}

function extractOrderLinks(ctx, order, quoteLink) {
  // Prefer the authoritative invoice link the page itself renders.
  const dom = findInvoiceInDom();

  // Fill missing fields from the DOM match when available.
  const id = order?.id ?? dom?.id ?? ctx.page.param('view');
  const sage = order?.sage_sales_number ?? dom?.sage ?? null;

  // Construct fallback candidates (first will be used).
  const candidates =
    id && sage
      ? [
          `${EXTRANET_BASE}/uploads/${id}/Invoice_${sage}.pdf`,
          `${EXTRANET_BASE}/uploads/${id}/Invoice-${sage}.pdf`,
          `${EXTRANET_BASE}/uploads/${id}/Invoice ${sage}.pdf`,
        ]
      : [];

  return {
    invoiceUrl: dom?.url || candidates[0] || null,
    quoteUrl: quoteLink || null,
  };
}

/** Point an item at a URL, or grey it out when there is nothing to open. */
function setAnchor(a, url) {
  if (!a) return;
  if (url) {
    a.setAttribute('href', url);
    a.setAttribute('target', '_blank');
    a.setAttribute('rel', 'noopener');
    a.removeAttribute('aria-disabled');
    a.classList.remove('is-disabled');
  } else {
    a.removeAttribute('href');
    a.setAttribute('aria-disabled', 'true');
    a.classList.add('is-disabled');
  }
}

/* ------------------------------------------------------------------ the menu */

/** Build the host, its shadow root and everything in it; wire the closing rules. */
function createMenu(ctx) {
  const { el } = ctx.dom;

  const host = el('div', { id: HOST_ID });
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  ctx.style.addToShadow(root, css, { id: STYLE_ID });

  // The checkbox is the state driver: the CSS opens the menu off :checked, so nothing
  // here has to script the animation.
  const toggle = el('input', {
    id: 'rm-toggle',
    class: 'radial-menu__toggle',
    type: 'checkbox',
    autocomplete: 'off',
  });

  const fabIcon = el('span', { class: 'rm-icon', 'aria-hidden': 'true' });
  fabIcon.innerHTML = ICON_FAB;
  const fab = el('label', { for: 'rm-toggle', class: 'radial-menu__fab', 'aria-label': 'Open menu' }, fabIcon);

  /** key -> anchor, so the link logic never has to re-query the shadow root. */
  const anchors = new Map();
  const items = ITEMS.map((item) => {
    const a = el('a', {
      class: 'radial-menu__item',
      'data-tip': item.tip,
      style: `--angle:${item.angle}`,
      href: '#',
    });
    a.innerHTML = item.icon;
    anchors.set(item.key, a);
    return a;
  });

  const nav = el('nav', { class: 'radial-menu__items', 'aria-hidden': 'true' }, items);

  // Sibling order is load-bearing: the CSS reaches the FAB with + and the items with ~.
  const wrap = el('div', { class: 'radial-menu rm-theme', 'aria-label': 'Quick actions' }, toggle, fab, nav);
  root.appendChild(wrap);

  const closeAll = () => {
    toggle.checked = false;
  };

  const closeDistance = () => parseFloat(getComputedStyle(host).getPropertyValue('--rm-close-distance')) || 200;

  const fabCenter = () => {
    const r = fab.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };

  // Click-away: a pointer landing further than --rm-close-distance from the FAB centre
  // closes the menu. Capture, so a page handler stopping the event cannot strand it open.
  window.addEventListener(
    'pointerdown',
    (e) => {
      if (!toggle.checked) return;
      const { x, y } = fabCenter();
      if (Math.hypot(e.clientX - x, e.clientY - y) > closeDistance()) closeAll();
    },
    true,
  );

  // Close on item click, after the navigation it starts is initiated.
  for (const a of anchors.values()) {
    a.addEventListener('click', () => setTimeout(closeAll, 0), { capture: true });
  }

  return {
    closeAll,
    setAnchor: (key, url) => setAnchor(anchors.get(key), url),
  };
}

/** Keeps the two live items pointed at the current order. */
function createLinks(ctx, menu) {
  let quoteLink = '';

  function apply() {
    const { invoiceUrl, quoteUrl } = extractOrderLinks(ctx, getOrderBrief(ctx), quoteLink);
    menu.setAnchor('invoice', invoiceUrl);
    menu.setAnchor('quote', quoteUrl);
    // Packing List: leave as-is until a rule/pattern is provided.
  }

  return {
    apply,

    /** First quote link wins, exactly as the frozen global did. */
    setQuoteLink(href) {
      if (!href || quoteLink) return;
      quoteLink = String(href);
      apply();
    },
  };
}

/* --------------------------------------------------------------------------- module */

export default {
  id: 'orders.radial-menu',
  title: 'Radial file menu',
  runAt: 'idle',
  pages: ['orders-view'], // legacy @match: ?p=orders-view&view=*
  enabledByDefault: true,

  init(ctx) {
    // The legacy script bailed on its own host id; keep the guard so a leftover copy of
    // fileBUBBLE in Tampermonkey does not stack a second FAB in the same corner.
    if (document.getElementById(HOST_ID)) {
      ctx.log.warn(`#${HOST_ID} is already in the page; not mounting a second menu`);
      return;
    }

    const menu = createMenu(ctx);
    const links = createLinks(ctx, menu);
    links.apply();

    // Start closed with fresh links, which is what a bfcache restore needs.
    window.addEventListener('pageshow', () => {
      menu.closeAll();
      links.apply();
    });

    // SPA navigation: the menu belongs to the order that was on screen when it opened.
    ctx.route.onChange(() => {
      menu.closeAll();
      links.apply();
    });

    // React when the page injects the invoice link after we mounted.
    ctx.observe.each(UPLOAD_LINK_SEL, (a) => {
      if (INVOICE_RX.test(a.href)) links.apply();
    });

    // The quote link, if orders.info-panels already found the Quote # row.
    ctx.events.on(QUOTE_LINK_EVENT, (href) => links.setQuoteLink(href));
    ctx.events.emit(`${QUOTE_LINK_EVENT}:request`);

    // Light re-check shortly after load to catch late globals like window.order.
    setTimeout(() => links.apply(), 800);
  },
};
