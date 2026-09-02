/**
 * Order Timeline & Overview — two header rearrangements on the order screen:
 *
 *   1. the order action buttons move out of the padded row above the panels and into the
 *      "Order Overview" <h1>, right-aligned;
 *   2. the "Shipment Control:" block is mirrored inline in the "Order Timeline" panel
 *      heading and the original body block is removed, so the control value and its
 *      status lines read at a glance without scrolling the panel.
 *
 * Ported from legacy/userscripts/order-timeline-and-overview.user.js (v1.4).
 *
 * The legacy script ran its own MutationObserver over documentElement and re-scanned on
 * every mutation. That is one ctx.observe.onChange subscription now, batched into a
 * frame, and the scan itself is unchanged: it is what keeps the mirror in step when the
 * site re-renders the Shipment Control block after an update.
 */

import css from './styles.css';

const STYLE_ID = 'orders-timeline';

/* ------------------------------------------------------------------ helpers */

/**
 * Buttons the container owns directly. Anything nested deeper belongs to a widget of the
 * site's own and is left where it is.
 */
const directChildButtons = (node) => Array.from(node.children).filter((child) => child.classList?.contains('btn'));

/**
 * Wrap whatever the heading already holds in a `._tm-title` span, so the flex layout has
 * one left-hand child to push the right-hand block away from. Must run before the right
 * container is added, or that container would be swallowed into the wrapper too.
 */
function ensureTitleWrap(host) {
  const existing = host.querySelector('._tm-title');
  if (existing) return existing;
  const wrap = document.createElement('span');
  wrap.className = '_tm-title';
  while (host.firstChild) wrap.appendChild(host.firstChild);
  host.appendChild(wrap);
  return wrap;
}

/** Get, or create, the right-hand container of a heading. */
function ensureRight(host, className) {
  const existing = host.querySelector(`.${className}`);
  if (existing) return existing;
  const right = document.createElement('div');
  right.className = className;
  host.appendChild(right);
  return right;
}

/* ------------------------------------------------------------------ the scan */

function createTimeline(ctx) {
  const { $, $$, norm, el } = ctx.dom;

  /* --- Shipment Control ---------------------------------------------------- */

  /** The body block holding the "Shipment Control:" h4, or null when it is not rendered. */
  function findLegacyShipmentBlock() {
    for (const body of $$('.panel-body')) {
      for (const h4 of $$('h4', body)) {
        if (/^Shipment\s*Control\s*:/i.test(norm(h4.textContent))) {
          // The nearest div ancestor is the block: it is what gets mirrored and removed.
          return h4.closest('div') || h4.parentElement || null;
        }
      }
    }
    return null;
  }

  /** Rebuild the header mirror from the live block: the control value plus its h5 lines. */
  function populateShipmentRight(container, legacyBlock) {
    if (!container) return;
    container.innerHTML = '';

    const h4 = legacyBlock?.querySelector('h4');
    const controlVal = norm(h4?.querySelector('strong')?.textContent) || norm((h4?.textContent || '').split(':')[1]);

    // Only the value is dynamic — the label is always "Shipment Control:".
    if (controlVal) container.appendChild(el('h4', {}, 'Shipment Control: ', el('strong', {}, controlVal)));

    // Clone the h5 lines wholesale: they carry the site's colours and onclick handlers.
    for (const h5 of legacyBlock ? $$('h5', legacyBlock) : []) container.appendChild(h5.cloneNode(true));
  }

  /**
   * Turn the site's inline-coloured status spans (Shipped, Pending, …) into pills: the
   * colour becomes the background and the text goes white so it reads at heading size.
   */
  function badgeifyStatuses(root = document) {
    // The selector is anchored on ._tm-right, and passing that container itself as the
    // root still matches — querySelectorAll resolves ancestors against the whole document.
    for (const node of $$('._tm-right h5 strong span, ._tm-right h5 span[onclick]', root)) {
      if (node.dataset.tmBadge === '1') continue;
      // Prefer the inline colour; fall back to the computed one.
      const orig = (node.style.color && node.style.color.trim()) || getComputedStyle(node).color;
      if (!orig) continue;
      node.classList.add('_tm-badge');
      node.style.setProperty('background-color', orig, 'important');
      node.style.setProperty('color', '#fff', 'important');
      node.style.setProperty('cursor', 'pointer'); // preserve pointer affordance
      node.dataset.tmBadge = '1';
    }
  }

  function buildOrUpdateShipmentRight() {
    const legacy = findLegacyShipmentBlock();
    if (!legacy) return null;

    // The Order Timeline heading. The legacy loop kept scanning after a hit, so the last
    // matching heading in document order wins; that is preserved here.
    let header = null;
    for (const h of $$('.panel-heading')) {
      const titleText = h.querySelector('._tm-title')?.textContent || '';
      const headingText = (h.textContent || '').trim();
      if (/^Order\s*Timeline/i.test(headingText) || /^Order\s*Timeline/i.test(titleText)) header = h;
    }
    if (!header) return null;

    ensureTitleWrap(header);
    const right = ensureRight(header, '_tm-right');

    populateShipmentRight(right, legacy); // dynamic values and colours
    badgeifyStatuses(right);
    header.classList.add('_tm-enhanced');

    // The block now lives in the header, so drop the body copy.
    try {
      legacy.remove();
    } catch { /* already detached */ }

    return right;
  }

  /* --- buttons into the Order Overview header ------------------------------ */

  /**
   * The order action bar. The site gives it no id or class of its own, so it is found by
   * the inline 10px padding it carries plus the fact that it holds buttons.
   */
  function findActionBar() {
    return (
      $$('div.col-lg-12[style]').find(
        (div) => /padding\s*:\s*10px/i.test(div.getAttribute('style') || '') && div.querySelector('button.btn, a.btn'),
      ) || null
    );
  }

  function moveButtonsIntoPageHeader() {
    const h1 = $('h1.page-header');
    if (!h1 || !/Order\s*Overview/i.test((h1.textContent || '').trim())) return;

    ensureTitleWrap(h1);
    const right = ensureRight(h1, '_tm-header-right');

    const bar = findActionBar();
    if (bar) {
      for (const btn of directChildButtons(bar)) {
        if (btn.dataset.tmMoved === '1') continue;
        right.appendChild(btn);
        btn.dataset.tmMoved = '1';
        btn.style.float = 'none';
        btn.style.margin = '0';
      }
      // Collapse the now-empty bar rather than removing it: the site writes into it.
      bar.style.padding = '0';
      bar.style.minHeight = '0';
    }

    h1.classList.add('_tm-enhanced');
  }

  function scan() {
    const right = buildOrUpdateShipmentRight();
    // Re-assert badge styling in case the status text changed without the body block
    // being re-rendered, in which case there is nothing to rebuild the mirror from.
    badgeifyStatuses(right || document);
    moveButtonsIntoPageHeader();
  }

  return { scan };
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'orders.timeline',
  title: 'Order timeline & overview',
  runAt: 'idle',
  pages: [], // the legacy @match was the whole extranet
  enabledByDefault: true,

  init(ctx) {
    // Legacy @exclude list: quotes_editor (with or without priceCheck) is already covered
    // by ctx.page.isExcluded; the review workspace (?p=orders-review&review=…) is not.
    if (ctx.page.is('orders-review') && ctx.page.param('review')) return;

    ctx.style.add(css, { id: STYLE_ID });

    const timeline = createTimeline(ctx);
    timeline.scan();

    // One subscription in place of the legacy MutationObserver on documentElement — the
    // same "re-scan after any DOM change" contract, batched into a single frame.
    ctx.observe.onChange(timeline.scan);
  },
};
