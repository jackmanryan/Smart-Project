/**
 * Rereview batch queue.
 *
 * A rereview batch starts as a list of Sage invoice numbers in an email and ends as a
 * per-invoice reply. Between those two the reviewer was doing three things by hand: a
 * search hop per invoice, a run log, and the summary at the end. This holds all three.
 *
 * The search hop exists because the Sage invoice number has no relation to the extranet
 * `view=` id, so an invoice is resolved through the autosearch route:
 *
 *   /?p=search#autosearch=1&q=<INVOICE>&extra=---   ->   /?p=orders-review&review=<id>
 *
 * Once a review page is open the mapping is no longer a guess: the page carries the
 * invoice in #sage_sales_number, so the queue records invoice -> view id the first time
 * it sees one and can go straight there afterwards.
 *
 * Status is read from the page where the page says it — "Order reviewed" and "PO sent to
 * ExtruFlex" are the site's own words — and can always be set by hand. Findings from
 * `orders/review-assist` arrive over ctx.events as `rereview:finding`, so the price
 * corrections and warnings a reviewer saw are already in the summary without retyping.
 *
 * Nothing here drives the page. It navigates when asked and records what it is told.
 */

import css from './styles.css';

const STYLE_ID = 'automation-rereview-queue';
const PANEL_ID = 'sc-rereview-queue';
const STORE_KEY = 'sc:rereview:queue:v1';

/** The statuses a row can hold, in the order the summary lists them. */
const STATUSES = ['pending', 'reviewed', 'po_sent', 'skipped'];
const LABEL = {
  pending: 'pending',
  reviewed: 'reviewed',
  po_sent: 'PO sent',
  skipped: 'skipped',
};

/* ------------------------------------------------------------------ the store */

function createStore(ctx) {
  const read = () => {
    const raw = ctx.settings.json.get(STORE_KEY, null);
    return raw && Array.isArray(raw.rows) ? raw : { rows: [], openedAt: null };
  };
  let state = read();

  const write = () => ctx.settings.json.set(STORE_KEY, state);

  return {
    get rows() {
      return state.rows;
    },
    reload() {
      state = read();
    },
    /** Add invoice numbers, keeping any row that is already there. */
    addAll(invoices) {
      const have = new Set(state.rows.map((r) => r.invoice));
      for (const invoice of invoices) {
        if (!invoice || have.has(invoice)) continue;
        have.add(invoice);
        state.rows.push({ invoice, viewId: null, status: 'pending', notes: [], po: null });
      }
      write();
    },
    find: (invoice) => state.rows.find((r) => r.invoice === invoice) || null,
    findByView: (viewId) => state.rows.find((r) => String(r.viewId) === String(viewId)) || null,
    update(invoice, patch) {
      const row = state.rows.find((r) => r.invoice === invoice);
      if (!row) return null;
      Object.assign(row, patch);
      write();
      return row;
    },
    addNote(invoice, note) {
      const row = state.rows.find((r) => r.invoice === invoice);
      if (!row || !note) return;
      if (!row.notes.includes(note)) {
        row.notes.push(note);
        write();
      }
    },
    clear() {
      state = { rows: [], openedAt: null };
      write();
    },
  };
}

/* ------------------------------------------------------------------ the summary */

/**
 * The end-of-batch reply, one terse line per invoice.
 *
 * The batch reply is a draft: this builds the text and puts it on the clipboard, and
 * never sends anything.
 */
export function buildSummary(rows) {
  if (!rows.length) return '(no invoices in the queue)';
  const line = (r) => {
    const bits = [r.invoice];
    bits.push(LABEL[r.status] || r.status);
    if (r.po) bits.push(`PO ${r.po}`);
    if (r.notes.length) bits.push(r.notes.join('; '));
    return `${bits.join(' — ')}`;
  };
  const order = (r) => STATUSES.indexOf(r.status);
  return [...rows].sort((a, b) => order(a) - order(b) || a.invoice.localeCompare(b.invoice)).map(line).join('\n');
}

/** The autosearch route that turns an invoice number into its review page. */
export const searchUrlFor = (invoice) =>
  `${location.origin}/?p=search#autosearch=1&q=${encodeURIComponent(invoice)}&extra=---`;

/* ------------------------------------------------------------------ module */

export default {
  id: 'automation.rereview-queue',
  title: 'Rereview batch queue',
  runAt: 'idle',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    const { $, el } = ctx.dom;
    const store = createStore(ctx);
    ctx.style.add(css, { id: STYLE_ID });

    let open = false;
    const body = el('div', { class: 'sc-rq-body' });
    const count = el('span', { class: 'sc-rq-count' });
    const toggle = el(
      'button',
      {
        type: 'button',
        class: 'sc-rq-toggle',
        onClick: () => {
          open = !open;
          panel.classList.toggle('sc-rq-open', open);
          render();
        },
      },
      'Rereview ',
      count,
    );
    const panel = el('section', { id: PANEL_ID, 'aria-label': 'Rereview batch queue' }, toggle, body);

    /* --- which invoice is this page? ------------------------------------- */
    const currentInvoice = () => {
      const field = $('#sage_sales_number');
      const fromPage = field && String(field.value || '').trim();
      if (fromPage) return fromPage;
      const row = store.findByView(ctx.page.recordId);
      return row ? row.invoice : null;
    };

    /** Record invoice -> view id the first time this page is seen. */
    const learnMapping = () => {
      if (!ctx.page.is('orders-review')) return;
      const invoice = currentInvoice();
      const viewId = ctx.page.recordId;
      if (!invoice || !viewId) return;
      const row = store.find(invoice);
      if (row && String(row.viewId) !== String(viewId)) store.update(invoice, { viewId });
    };

    /** Read the status the page states in its own words. */
    const learnStatus = () => {
      const invoice = currentInvoice();
      if (!invoice) return;
      const text = document.body?.innerText || '';
      if (/PO sent to ExtruFlex/i.test(text)) store.update(invoice, { status: 'po_sent' });
      else if (/Order reviewed/i.test(text)) {
        const row = store.find(invoice);
        if (row && row.status === 'pending') store.update(invoice, { status: 'reviewed' });
      }
      const po = $('#po_number');
      if (po && po.value) store.update(invoice, { po: po.value.trim() });
    };

    /* --- rendering -------------------------------------------------------- */
    function render() {
      const rows = store.rows;
      const done = rows.filter((r) => r.status !== 'pending').length;
      count.textContent = rows.length ? `${done}/${rows.length}` : '—';
      if (!open) {
        body.replaceChildren();
        return;
      }

      const here = currentInvoice();
      const list = el('div', { class: 'sc-rq-list' });

      for (const row of rows) {
        const isHere = here && row.invoice === here;
        const item = el(
          'div',
          { class: `sc-rq-row sc-rq-${row.status}${isHere ? ' sc-rq-here' : ''}` },
          el('span', { class: 'sc-rq-inv' }, row.invoice),
          el('span', { class: 'sc-rq-status' }, LABEL[row.status]),
        );

        item.append(
          el(
            'button',
            {
              type: 'button',
              class: 'sc-rq-btn',
              title: row.viewId ? `open review ${row.viewId}` : 'find this invoice',
              onClick: () => {
                location.href = row.viewId
                  ? ctx.page.url('orders-review', { review: row.viewId })
                  : searchUrlFor(row.invoice);
              },
            },
            row.viewId ? 'open' : 'find',
          ),
        );

        const next = el('select', { class: 'sc-rq-sel', onChange: (e) => { store.update(row.invoice, { status: e.target.value }); render(); } });
        for (const s of STATUSES) {
          const opt = el('option', { value: s }, LABEL[s]);
          if (s === row.status) opt.selected = true;
          next.append(opt);
        }
        item.append(next);

        if (row.notes.length) item.append(el('div', { class: 'sc-rq-notes' }, row.notes.join(' · ')));
        list.append(item);
      }

      const paste = el('textarea', {
        class: 'sc-rq-paste',
        rows: '2',
        placeholder: 'Paste invoice numbers (any separator), then Add',
      });

      const actions = el(
        'div',
        { class: 'sc-rq-actions' },
        el('button', { type: 'button', class: 'sc-rq-btn', onClick: () => {
          const found = (paste.value.match(/\d{4,}/g) || []);
          store.addAll(found);
          paste.value = '';
          render();
        } }, 'Add'),
        el('button', { type: 'button', class: 'sc-rq-btn', onClick: async () => {
          const next = store.rows.find((r) => r.status === 'pending');
          if (!next) return;
          location.href = next.viewId ? ctx.page.url('orders-review', { review: next.viewId }) : searchUrlFor(next.invoice);
        } }, 'Next pending'),
        el('button', { type: 'button', class: 'sc-rq-btn', onClick: async () => {
          const ok = await ctx.dom.copyText(buildSummary(store.rows));
          ctx.log.info(ok ? 'summary copied' : 'could not copy the summary');
        } }, 'Copy summary'),
        el('button', { type: 'button', class: 'sc-rq-btn sc-rq-danger', onClick: () => {
          if (window.confirm('Clear the whole rereview queue?')) {
            store.clear();
            render();
          }
        } }, 'Clear'),
      );

      body.replaceChildren(list, paste, actions);
    }

    /* --- findings from review-assist -------------------------------------- */
    ctx.events.on('rereview:finding', (detail) => {
      const invoice = currentInvoice();
      if (!invoice || !detail || !detail.text) return;
      store.addNote(invoice, detail.text);
      if (open) render();
    });

    const mount = () => {
      if (!document.body || document.getElementById(PANEL_ID)) return;
      document.body.append(panel);
    };

    mount();
    learnMapping();
    learnStatus();
    render();

    ctx.observe.onChange(() => {
      mount();
      learnMapping();
      learnStatus();
      if (open) render();
    });
  },
};
