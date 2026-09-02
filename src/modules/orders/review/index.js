/**
 * Orders Review workspace — layout only, on ?p=orders-review&review=… :
 *
 *   1. a "Back to top" button beside Save, wearing Save's own classes;
 *   2. the red "Warning" panels are lifted out of the form into a fixed bottom sheet so
 *      they stay on screen while the reviewer scrolls;
 *   3. panel, table and form-control compaction so the review form fits on a screen.
 *
 * Ported from legacy/userscripts/orders-review.user.js (v1.2.1).
 *
 * The legacy MutationObserver over documentElement is one ctx.observe subscription now.
 * The re-scan is not defensive padding: both the warning panels and the compact-panel
 * tagging key off markup `orders.products-panel` writes (`.panel-heading._tm-enhanced`,
 * `.sc-title`), and that lands after this module's first pass.
 */

import css from './styles.css';

const STYLE_ID = 'orders-review';
const POP_ID = 'sc-warning-pop';

/** Panels compacted by name, matched on the title span the products panel writes. */
const COMPACT_TITLES = ['billing info', 'shipping info', 'lead time notification'];

/* ------------------------------------------------------------------ back to top */

function addBackToTop(ctx) {
  const { $, el } = ctx.dom;

  const saveBtn = $('#savechanges.btn');
  if (!saveBtn || $('#backtotop')) return;

  const backBtn = el(
    'button',
    {
      type: 'button',
      id: 'backtotop',
      class: saveBtn.className, // clone look: "btn btn-outline btn-primary btn-lg"
      onclick: (e) => {
        e.preventDefault();
        window.scrollTo({ top: 0, left: 0, behavior: 'auto' }); // snap, not smooth
      },
    },
    'Back to top',
  );

  // Ensure both buttons share the same parent line.
  const parent =
    saveBtn.parentElement || saveBtn.closest('.form-group') || saveBtn.closest('div') || document.body;
  parent.appendChild(backBtn);
}

/* ------------------------------------------------------------------ warning sheet */

/**
 * Move every "Warning" panel into a fixed bottom sheet.
 *
 * `_tm-enhanced` is written onto panel headings by orders.products-panel, so this only
 * matches once that module has been over them — hence the re-scan on every DOM change.
 */
function buildWarningPop(ctx) {
  const { $, $$, el } = ctx.dom;

  const warningHeadings = $$('.panel-heading._tm-enhanced').filter((h) => /warning/i.test(h.textContent || ''));
  if (!warningHeadings.length) return;

  // Create the bottom popup shell once.
  let pop = $(`#${POP_ID}`);
  if (!pop) {
    pop = el(
      'div',
      { id: POP_ID, role: 'dialog', 'aria-label': 'Warning' },
      el('div', { class: 'sc-pop-body' }),
    );
    document.body.appendChild(pop);
  }

  const body = pop.querySelector('.sc-pop-body');

  // Move each warning panel into the popup (once).
  for (const h of warningHeadings) {
    const panel = h.closest('.panel');
    if (!panel || panel.dataset.popified === '1') continue;
    panel.dataset.popified = '1';
    body.appendChild(panel); // keep existing heading + body intact
  }
}

/* ------------------------------------------------------------------ compact marker */

/** Tag the named panels, so compaction can be scoped to them later if it needs to be. */
function tagCompactPanel(title) {
  const name = (title.textContent || '').trim().toLowerCase();
  if (!COMPACT_TITLES.includes(name)) return;
  const panel = title.closest('.panel');
  if (panel) panel.classList.add('sc-compact-panel');
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'orders.review',
  title: 'Orders review layout',
  runAt: 'idle',
  pages: ['orders-review'],
  enabledByDefault: true,

  init(ctx) {
    // The legacy @match was ?p=orders-review&review=* — the page id is the `pages` array
    // above, the record parameter is the half it cannot express.
    if (!ctx.page.param('review')) return;

    ctx.style.add(css, { id: STYLE_ID });

    const scan = () => {
      addBackToTop(ctx);
      buildWarningPop(ctx);
    };

    scan();
    ctx.observe.onChange(scan);

    // The legacy script tagged these panels once at document-idle, which raced
    // orders.products-panel writing the `.sc-title` spans it looks for; ctx.observe.each
    // catches them whenever they land.
    ctx.observe.each('.panel-heading .sc-title', tagCompactPanel);
  },
};
