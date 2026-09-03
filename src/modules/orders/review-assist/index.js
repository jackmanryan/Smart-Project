/**
 * Review assist — the manual half of the rereview workflow.
 *
 * `automation/auto-review` drives the page when it is armed. This module is what a human
 * reviewer gets on every review screen: the same rules, applied as advice rather than as
 * clicks, plus the page rearrangement the workflow kept asking for.
 *
 * What it does, each item traceable to friction recorded in the 08-31 batch:
 *
 *   Comments beside the address   order comments carry address corrections and are easy
 *                                 to miss where the page puts them; they are pinned next
 *                                 to the shipping fields with an acknowledge flag.
 *   Nothing hidden                Set For All, the PO table and the vendor comments box
 *                                 are expanded on load instead of behind a tab.
 *   Blank-only autofill           PO number from the order number, shipping email from
 *                                 billing. Both only ever fill an EMPTY field, which is
 *                                 the rule as written; a customer PO already there stays.
 *   Shipment type                 the freight rule is shown with its reason and applied
 *                                 by a click, never automatically — it would overwrite a
 *                                 field the customer chose.
 *   Sourcing                      every handling row carries the vendor the rule wants
 *                                 and why, so the reviewer flips exceptions only.
 *   Flip confirmation             a flip is watched until the PO table agrees. Until it
 *                                 does the row reads "pending" and Save is blocked — the
 *                                 page's updateInventorySource fires an $.ajax it never
 *                                 checks, which is how a 5.33 ft GALV line reached a sent
 *                                 ExtruFlex PO on invoice 150712.
 *   Prices                        each ExtruFlex PO line is compared with the list, with
 *                                 the effective date shown. Zero-priced lines are called
 *                                 out loudly; they reach the vendor as free items.
 *
 * It writes to the form only through `fill()`, which refuses a non-empty field and logs
 * every write into the panel. Set `sc.tools.orders.review-assist.autofill` to "false" to
 * turn even that off and leave the module purely advisory.
 */

import css from './styles.css';
import { EFFECTIVE_DATE, LIST_NAME, priceFor, isZeroPriced, aliasFor } from '../lib/extruflex.js';
import { classify, EXTRUFLEX } from '../lib/sourcing.js';
import { shipmentFor, parseMoney } from '../lib/freight.js';

const STYLE_ID = 'orders-review-assist';
const PANEL_ID = 'sc-review-assist';
const ACK_KEY_PREFIX = 'sc:review:ack:';

/** How long to wait for a source flip to show up in the PO table before calling it stuck. */
const FLIP_TIMEOUT_MS = 15000;

/* ------------------------------------------------------------------ page readers */

/** The PO lines, keyed inside their own row: every row repeats the same element ids. */
function poRows($$) {
  return $$('#po tr')
    .filter((tr) => tr.querySelector('#unit_price'))
    .map((tr) => {
      const tds = tr.querySelectorAll('td');
      return {
        tr,
        sku: (tds[0] ? tds[0].innerText : '').trim(),
        unit: tr.querySelector('#unit_price'),
        src: (tr.innerText.match(/ExtruFlex|Richmond Warehouse/) || [''])[0],
      };
    });
}

/** The handling rows, as the sourcing rule wants to see them. */
function handlingRows($$) {
  return $$('select.sourceCombo').map((sel) => {
    const tr = sel.closest('tr');
    const tds = tr ? tr.querySelectorAll('td') : [];
    const cut = tr && tr.querySelector('#cut_length');
    const raw = cut ? cut.value : '';
    return {
      sel,
      tr,
      sku: (tds[2] ? tds[2].innerText : tr ? tr.innerText : '').trim(),
      description: tr ? tr.innerText : '',
      lengthFt: raw !== '' && Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : null,
    };
  });
}

/**
 * The freight charge.
 *
 * The site's own JS has no named field for it, so this reads the labelled row instead and
 * returns NaN when it cannot find one — freight.js turns that into an explicit "unknown"
 * rather than a guessed shipment type.
 */
function freightCharge($$) {
  const row = $$('tr, .form-group, .row').find((el) => /\b(freight|shipping)\s*(charge|cost)?\s*:/i.test(el.innerText || ''));
  if (!row) return NaN;
  const money = (row.innerText.match(/\$\s*-?[\d,]+\.?\d*/g) || []).pop();
  return money ? parseMoney(money) : NaN;
}

/** The source order number, e.g. 2977CDS, for the PO field. */
function orderNumber($, $$) {
  const direct = $('#order_number');
  if (direct && direct.value) return direct.value.trim();
  const text = ($$('.panel').map((p) => p.innerText).join('\n').match(/\b(\d{3,6}CDS)\b/) || [])[1];
  return text || '';
}

/* ------------------------------------------------------------------ the panel */

function createPanel(ctx) {
  const { el } = ctx.dom;
  const list = el('div', { class: 'sc-ra-items' });
  const panel = el(
    'section',
    { id: PANEL_ID, 'aria-label': 'Review assist' },
    el(
      'header',
      {},
      el('span', { class: 'sc-ra-title' }, 'Review assist'),
      el('span', { class: 'sc-ra-list' }, `${LIST_NAME} · ${EFFECTIVE_DATE}`),
    ),
    list,
  );

  const add = (level, text, action = null) => {
    const row = el('div', { class: `sc-ra-item sc-ra-${level}` }, el('span', { class: 'sc-ra-dot' }), el('span', { class: 'sc-ra-text' }, text));
    if (action) {
      row.append(el('button', { type: 'button', class: 'sc-ra-btn', onClick: action.run }, action.label));
    }
    list.append(row);
    return row;
  };

  return { panel, add, list };
}

/* ------------------------------------------------------------------ the checks */

/** Fill a field only when it is empty. Returns what happened, for the panel. */
function fill(field, value, { enabled }) {
  if (!field) return { done: false, why: 'field not on the page' };
  if (!enabled) return { done: false, why: 'autofill off' };
  if (String(field.value || '').trim() !== '') return { done: false, why: 'already filled, left alone' };
  if (!value) return { done: false, why: 'nothing to copy' };
  field.value = value;
  // The page recalculates on real events, not on assignment.
  field.dispatchEvent(new Event('input', { bubbles: true }));
  field.dispatchEvent(new Event('change', { bubbles: true }));
  return { done: true };
}

/** Watch one flipped row until the PO table agrees, or give up and say so. */
function watchFlip(ctx, row, wanted, onSettled) {
  const started = Date.now();
  const { $$ } = ctx.dom;
  row.tr?.classList.add('sc-ra-pending');

  const tick = () => {
    const landed = poRows($$).some(
      (r) => r.src === wanted && r.sku.toUpperCase().includes(row.sku.toUpperCase().slice(0, 12)),
    );
    if (landed) {
      row.tr?.classList.remove('sc-ra-pending');
      row.tr?.classList.add('sc-ra-settled');
      onSettled(true);
      return;
    }
    if (Date.now() - started > FLIP_TIMEOUT_MS) {
      row.tr?.classList.remove('sc-ra-pending');
      row.tr?.classList.add('sc-ra-stuck');
      onSettled(false);
      return;
    }
    setTimeout(tick, 700);
  };
  setTimeout(tick, 700);
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'orders.review-assist',
  title: 'Review assist',
  runAt: 'idle',
  pages: ['orders-review'],
  enabledByDefault: true,

  init(ctx) {
    // The legacy @match was ?p=orders-review&review=* — presence, not truthiness, so an
    // empty value still counts.
    if (ctx.page.param('review') === null) return;

    const { $, $$, el } = ctx.dom;
    const autofill = ctx.settings.raw.get('sc.tools.orders.review-assist.autofill') !== 'false';

    ctx.style.add(css, { id: STYLE_ID });

    const { panel, add: addRow } = createPanel(ctx);
    const pending = new Set();

    // Anything worth carrying into the end-of-batch reply also goes to the queue, which
    // keeps the per-invoice notes. Plain information stays local to the panel.
    const add = (level, text, action = null) => {
      if (level === 'warn' || level === 'bad') ctx.events.emit('rereview:finding', { level, text });
      return addRow(level, text, action);
    };

    const mount = () => {
      if (!document.body || document.getElementById(PANEL_ID)) return;
      document.body.append(panel);
    };
    mount();

    /* --- nothing hidden: expand what the page collapses ------------------ */
    for (const sel of ['#po', '#inventorySources', '#shipmentSourcesBody']) {
      const node = $(sel);
      if (node && node.offsetParent === null) {
        node.style.display = '';
        add('info', `expanded ${sel}`);
      }
    }

    /* --- comments pinned beside the shipping address --------------------- */
    const commentsPanel = $$('.panel').find((p) => /\bcomments\b/i.test(p.querySelector('.panel-heading')?.innerText || ''));
    const shippingAnchor = $('#shipping_address1')?.closest('.panel') || $('#shipping_city')?.closest('.panel');
    if (commentsPanel && shippingAnchor && commentsPanel !== shippingAnchor) {
      const ackKey = ACK_KEY_PREFIX + ctx.page.recordId;
      const acked = ctx.settings.raw.get(ackKey) === '1';
      const clone = el('div', { class: `sc-ra-comments${acked ? ' sc-ra-acked' : ''}` });
      clone.append(
        el('div', { class: 'sc-ra-comments-head' }, 'Order comments', el(
          'button',
          {
            type: 'button',
            class: 'sc-ra-btn',
            onClick: () => {
              ctx.settings.raw.set(ackKey, '1');
              clone.classList.add('sc-ra-acked');
            },
          },
          'Acknowledge',
        )),
        el('div', { class: 'sc-ra-comments-body' }, commentsPanel.innerText.trim()),
      );
      shippingAnchor.parentNode.insertBefore(clone, shippingAnchor);
      add(acked ? 'info' : 'warn', acked ? 'comments pinned (acknowledged)' : 'comments pinned — read before generating');
    }

    /* --- blank-only autofill --------------------------------------------- */
    const po = fill($('#po_number'), orderNumber($, $$), { enabled: autofill });
    add(po.done ? 'ok' : 'info', po.done ? `PO # filled from the order number` : `PO #: ${po.why}`);

    const email = fill($('#shipping_email'), $('#billing_email')?.value?.trim(), { enabled: autofill });
    add(email.done ? 'ok' : 'info', email.done ? 'shipping email copied from billing' : `shipping email: ${email.why}`);

    const boxes = $('#createboxes');
    if (boxes && !boxes.checked && autofill) {
      boxes.click();
      add('ok', 'Do not create boxes checked');
    }

    /* --- shipment type: advise, never overwrite -------------------------- */
    const freight = freightCharge($$);
    const verdict = shipmentFor(freight);
    const shipField = $('#shipment_type');
    if (verdict.action === 'set' && shipField) {
      const option = Array.from(shipField.options).find((o) => verdict.match.some((re) => re.test(o.text)));
      add(
        'warn',
        `shipment type: ${verdict.reason}`,
        option
          ? {
              label: `Set ${option.text.trim()}`,
              run: () => {
                shipField.value = option.value;
                shipField.dispatchEvent(new Event('change', { bubbles: true }));
              },
            }
          : null,
      );
    } else {
      add('info', `shipment type: ${verdict.reason}`);
    }

    /* --- sourcing advice + flip confirmation ----------------------------- */
    const rows = handlingRows($$);
    let unsure = 0;
    for (const row of rows) {
      const want = classify(row);
      const tag = el('span', { class: `sc-ra-tag sc-ra-${want.vendor === EXTRUFLEX ? 'ef' : 'rw'}` }, `${want.vendor} — ${want.reason}`);
      row.tr?.querySelector('td:last-child')?.append(tag);
      if (want.uncertain || want.needsLength) unsure += 1;

      row.sel.addEventListener('change', () => {
        const wanted = row.sel.value;
        pending.add(row.sku);
        add('warn', `${row.sku.slice(0, 24)} → ${wanted}: waiting for the PO table`);
        watchFlip(ctx, row, wanted, (ok) => {
          pending.delete(row.sku);
          add(ok ? 'ok' : 'bad', ok ? `${row.sku.slice(0, 24)} → ${wanted} confirmed` : `${row.sku.slice(0, 24)} → ${wanted} DID NOT STICK — re-flip before saving`);
        });
      });
    }
    if (rows.length) add('info', `${rows.length} handling row(s) checked against the sourcing rule`);
    if (unsure) add('warn', `${unsure} row(s) the rule is unsure about — check them by hand`);

    /* --- price check ------------------------------------------------------ */
    const checkPrices = () => {
      for (const r of poRows($$)) {
        if (r.src !== EXTRUFLEX) continue;
        if (r.tr.dataset.scPriced === '1') continue;
        r.tr.dataset.scPriced = '1';
        const have = parseFloat(r.unit?.value) || 0;
        const want = priceFor({ sku: r.sku, unitPrice: have });
        const alias = aliasFor(r.sku);
        const label = alias ? `${r.sku.slice(0, 22)} (${alias})` : r.sku.slice(0, 28);

        if (want.kind === 'ignore') continue;
        if (want.kind === 'stop') add('bad', `${label}: ${want.reason}`);
        else if (want.kind === 'unknown') add('warn', `${label}: no list price — look it up before sending`);
        else if (isZeroPriced(have)) add('bad', `${label}: $0.00 on the PO — never send this`);
        else if (Math.abs(have - want.price) > 0.0001) add('warn', `${label}: ${have} should be ${want.price}`);
        else add('ok', `${label}: ${have} matches the list`);
      }
    };
    checkPrices();
    ctx.observe.onChange(checkPrices);

    /* --- block Save while a flip is unconfirmed --------------------------- */
    const save = $('#savechanges');
    if (save) {
      save.addEventListener(
        'click',
        (e) => {
          if (!pending.size) return;
          e.preventDefault();
          e.stopImmediatePropagation();
          add('bad', `Save blocked: ${pending.size} source flip(s) not confirmed in the PO table yet`);
        },
        true,
      );
    }

    /* --- after a PO is sent, stop offering to send it again --------------- */
    ctx.observe.onChange(() => {
      if (!/PO sent to ExtruFlex/i.test(document.body?.innerText || '')) return;
      for (const btn of $$('button, a')) {
        if (/^\s*send po\b/i.test(btn.innerText || '')) btn.classList.add('sc-ra-hidden');
      }
    });

    ctx.observe.onChange(mount);
  },
};
