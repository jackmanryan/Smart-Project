/**
 * SC FAB — the bottom-right Message & Sales viewer.
 *
 * A round button pinned to the bottom-right corner opens a two-tab panel. "Messages"
 * looks a Message Center conversation up by id and renders the thread; "Orders" looks a
 * sales record up by id and renders its header fields and line items. Each tab keeps its
 * own recents list down the left-hand side. Everything lives in an open shadow root, so
 * the extranet's stylesheet cannot reach it and it cannot reach the page.
 *
 * Ported from legacy/userscripts/sc-fab-message-and-sales-viewer-scord-integrated.user.js
 * (v0.3.0). Differences from the original are listed here rather than hidden in the code:
 *
 *  - `window.SCORD` and `window.fetchMCThread` are gone. Both live in
 *    ../lib/orders-api.js as named exports (`getPopup`, `getOrder`, `fetchMCThread`,
 *    `setConfig`) and are imported. Nothing in the legacy set called them from anywhere
 *    else. The xhr-first transport, and the reason for it, are unchanged.
 *  - `window.showMCThread` is now the module-local `showThreadPopout`. The legacy script
 *    installed it only when nothing else had — nothing else ever did — and then called it
 *    through `window.showMCThread?.()`. Same popout, same `#mc-anywhere` host id, no
 *    global. Its close button is an event listener instead of an inline `onclick`
 *    attribute, which a CSP would refuse to run.
 *  - The `if (document.getElementById(HOST_ID)) return;` install guard is dropped: the
 *    registry starts a module once.
 *  - CSS lives in styles.css (injected into the shadow root) and host.css (the light-DOM
 *    host and popout). The `style="…"` attributes the legacy script wrote into the
 *    message and order views are the same declarations, now as classes; the Orders bar is
 *    hidden with a `.hide` class rather than an inline `display:none`.
 *  - Everything interpolated into markup goes through `ctx.dom.esc`. The legacy script
 *    interpolated ids, labels and order fields raw and escaped only `"` inside two title
 *    attributes, so a conversation description or an order field containing markup could
 *    rewrite the panel.
 *  - Thread labels are normalised with `ctx.dom.norm`, which folds non-breaking spaces
 *    as well as runs of whitespace; the legacy regex left `&nbsp;` in the label.
 *  - Copying an order's JSON goes through `ctx.dom.copyText` (GM_setClipboard first, then
 *    the async clipboard API, then execCommand) instead of `navigator.clipboard` alone.
 *    A failure still alerts "Clipboard unavailable".
 *  - The copy button's handler is bound once and copies whichever record is on screen,
 *    instead of `.onclick` being reassigned on every order load.
 *  - Recents are read and written through `ctx.settings.json` under the same keys,
 *    `mc:recent:v1` and `scord:recent:v1`, still capped at 30 entries.
 *  - `currentSalesId`, which the legacy script assigned and never read, is dropped, as is
 *    the redundant `renderRecents()` after `setTab('msg')` — `setTab` renders.
 *  - The legacy `@match` covered every extranet page. The bundle excludes
 *    `?p=quotes_editor` and `/quotepayment`, so the FAB no longer appears on those two.
 */

import css from './styles.css';
import hostCss from './host.css';
import { fetchMCThread, getOrder } from '../lib/orders-api.js';

/* ------------------------------------------------------------------ constants */

const HOST_ID = 'sc-fab-host';
const STYLE_ID = 'fab';
const POPOUT_ID = 'mc-anywhere';

/** Recents, one list per tab. Keys verbatim from the legacy script. */
const REC_MSG = 'mc:recent:v1';
const REC_ORD = 'scord:recent:v1';
const REC_MAX = 30;

/** Header fields shown above an order's line items, in order. */
const ORDER_FIELDS = [
  ['sales_id', (rec) => rec.id],
  ['order_number', (rec) => rec.order_number],
  ['status', (rec) => rec.sales_status],
  ['total', (rec) => rec.sales_total],
  ['billing_email', (rec) => rec.billing_email],
  ['shipping_email', (rec) => rec.shipping_email],
  ['date', (rec) => rec.sales_date],
  ['shipment_type', (rec) => rec.shipment_type],
];

/** Only the first 20 line items are rendered; the panel is a lookup, not a report. */
const MAX_ITEMS = 20;

const FAB_ICON = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 10h8M8 13h6"/></svg>`;

const PANEL_HTML = `
    <header class="hdr">
      <div class="tabs" role="tablist">
        <button class="tab" id="tabMsg" role="tab" aria-selected="true">Messages</button>
        <button class="tab" id="tabOrd" role="tab" aria-selected="false">Orders</button>
      </div>
      <span class="sp"></span>
      <button class="btn" id="btnClose" title="Close">×</button>
    </header>

    <!-- shared top bars for each tab -->
    <div class="bar" id="barMsg">
      <input class="inp" id="msgId" inputmode="numeric" pattern="\\d*" placeholder="Enter Message ID (e.g. 38492)" />
      <button class="go" id="btnMsgOpen">Open</button>
      <button class="go" id="btnMsgPop" title="Popout" disabled>↗</button>
      <button class="go" id="btnMsgRefresh" title="Refresh">⟳</button>
    </div>

    <div class="bar hide" id="barOrd">
      <input class="inp" id="salesId" inputmode="numeric" pattern="\\d*" placeholder="Enter Sales ID (e.g. 111483)" />
      <button class="go" id="btnOrdOpen">Open</button>
      <button class="go" id="btnOrdCopy" title="Copy JSON" disabled>⧉</button>
    </div>

    <div class="row-grid">
      <aside class="left">
        <div class="left-h"><strong id="recHdr">Recent (Messages)</strong><span class="sp"></span><button class="go" id="btnClearRec">Clear</button></div>
        <div class="rec" id="recList"><div class="empty">No recent items.</div></div>
      </aside>
      <div class="view" id="viewPane"><div class="empty">Choose a tab, enter an ID, then Open.</div></div>
    </div>
  `;

/* -------------------------------------------------------------------- helpers */

/** "just now" / "12m ago" / "3h ago" / "2d ago", then the absolute date past a week. */
function fmtTime(ts) {
  const d = new Date(ts);
  const diff = Math.max(0, Date.now() - ts);
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const days = Math.floor(h / 24);
  if (days < 7) return `${days}d ago`;
  return d.toLocaleString();
}

/** First run of digits in whatever was typed or pasted, so "#38492" and a URL both work. */
const parseId = (raw) => (raw && String(raw).match(/\d+/)?.[0]) || null;

/** The two recents lists, over the legacy localStorage keys. */
function createRecents(settings) {
  const read = (key) => settings.json.get(key, []) || [];
  const write = (key, list) => settings.json.set(key, list.slice(0, REC_MAX));

  return {
    read,
    /** Move an id to the top of its list, refreshing its label and timestamp. */
    touch(key, id, label) {
      const list = read(key);
      const i = list.findIndex((x) => x.id === String(id));
      if (i >= 0) list.splice(i, 1);
      list.unshift({ id: String(id), lab: label || '', ts: Date.now() });
      write(key, list);
    },
    remove(key, id) {
      write(key, read(key).filter((x) => x.id !== String(id)));
    },
    clear(key) {
      write(key, []);
    },
  };
}

/**
 * A one-line name for a thread when the server sends no description: its first heading,
 * else its leading text.
 */
function labelFromThread(html, norm) {
  const div = document.createElement('div');
  div.innerHTML = html;
  return norm(div.querySelector('strong,b,h1,h2,h3')?.textContent || div.textContent || '').slice(0, 90);
}

/**
 * The standalone conversation popout — `window.showMCThread` in the legacy script.
 * It sits in the light DOM on purpose: the thread HTML the server returns is styled by
 * the site's own stylesheet.
 */
async function showThreadPopout(ctx, convoId) {
  const { esc, el } = ctx.dom;
  const host = document.getElementById(POPOUT_ID) || document.body.appendChild(el('div', { id: POPOUT_ID }));

  host.innerHTML = `<div class="pop-msg">Loading conversation ${esc(convoId)}…</div>`;
  try {
    const { html } = await fetchMCThread(convoId);
    host.innerHTML = `
          <div class="pop-hdr">
            <div class="pop-title">Conversation ${esc(convoId)}</div>
            <button class="pop-x" aria-label="Close">×</button>
          </div>
          <div id="conversation_content_${esc(convoId)}"></div>
        `;
    host.querySelector('.pop-x').addEventListener('click', () => host.remove());
    host.querySelector('#conversation_content_' + convoId).innerHTML = html;
  } catch (e) {
    host.innerHTML = `<div class="pop-err">Failed to load: ${esc(e.message)}</div>`;
  }
}

/* ------------------------------------------------------------------- the panel */

function buildPanel(ctx) {
  const { esc, el, norm } = ctx.dom;
  const recents = createRecents(ctx.settings);

  const host = el('div', { id: HOST_ID });
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });
  ctx.style.addToShadow(root, css, { id: STYLE_ID });

  const qs = (sel) => root.querySelector(sel);
  const on = (node, ev, fn) => node && node.addEventListener(ev, fn);

  const fab = el('button', { class: 'fab ui', 'aria-label': 'Open SC Hub' });
  fab.innerHTML = FAB_ICON;

  const panel = el('section', { class: 'panel ui' });
  panel.innerHTML = PANEL_HTML;

  root.append(fab, panel);

  const recList = qs('#recList');
  const viewPane = qs('#viewPane');
  const msgInput = qs('#msgId');
  const btnMsgOpen = qs('#btnMsgOpen');
  const btnMsgPop = qs('#btnMsgPop');
  const ordInput = qs('#salesId');
  const btnOrdOpen = qs('#btnOrdOpen');
  const btnOrdCopy = qs('#btnOrdCopy');

  const setOpen = (v) => panel.setAttribute('data-open', v ? '1' : '0');
  const isOpen = () => panel.getAttribute('data-open') === '1';

  let tab = 'msg'; // 'msg' | 'ord'
  let currentMsgId = null;
  let currentOrder = null;

  const recKey = () => (tab === 'msg' ? REC_MSG : REC_ORD);

  function setTab(t) {
    tab = t;
    qs('#tabMsg').setAttribute('aria-selected', String(t === 'msg'));
    qs('#tabOrd').setAttribute('aria-selected', String(t === 'ord'));
    qs('#barMsg').classList.toggle('hide', t !== 'msg');
    qs('#barOrd').classList.toggle('hide', t !== 'ord');
    qs('#recHdr').textContent = t === 'msg' ? 'Recent (Messages)' : 'Recent (Orders)';
    renderRecents();
  }

  function renderRecents() {
    const list = recents.read(recKey());
    if (!list.length) {
      recList.innerHTML = `<div class="empty">No recent items.</div>`;
      return;
    }
    recList.innerHTML = list
      .map(
        (it) => `
      <div class="item" data-id="${esc(it.id)}">
        <div class="id">#${esc(it.id)}</div>
        <div class="lab" title="${esc(it.lab || '')}">${esc(it.lab || '(no label)')}</div>
        <div class="time" title="${esc(new Date(it.ts).toLocaleString())}">${esc(fmtTime(it.ts))}</div>
        <button class="x" data-x="${esc(it.id)}" title="Remove">×</button>
      </div>
    `,
      )
      .join('');
  }

  /* ------------------------------------------------------------ messages tab */

  async function loadMessage(id) {
    if (!id) return;
    currentMsgId = id;
    btnMsgOpen.disabled = true;
    btnMsgPop.disabled = true;
    viewPane.innerHTML = `<div class="empty">Loading conversation ${esc(id)}…</div>`;
    try {
      const { html, description } = await fetchMCThread(id);
      const label = description || labelFromThread(html, norm);
      recents.touch(REC_MSG, id, label);

      viewPane.innerHTML = `
        <div class="pane-hdr">
          <strong class="pane-id">#${esc(id)}</strong>
          <span class="pane-lab" title="${esc(label)}">${esc(label)}</span>
          <span class="push"></span>
          <button class="go" id="btnMsgRefreshInline" title="Refresh">⟳</button>
          <button class="go" id="btnMsgPopInline" title="Popout">↗</button>
        </div>
        <div class="pane-body" id="conversation_content_${esc(id)}"></div>
      `;
      // Server-rendered thread markup, inserted as-is the way the site's own page does.
      qs('#conversation_content_' + id).innerHTML = html;
      btnMsgPop.disabled = false;
      on(qs('#btnMsgPopInline'), 'click', () => showThreadPopout(ctx, id));
      on(qs('#btnMsgRefreshInline'), 'click', () => loadMessage(currentMsgId));
      renderRecents();
    } catch (e) {
      viewPane.innerHTML = `<div class="empty err">Failed to load: ${esc(e.message)}</div>`;
    } finally {
      btnMsgOpen.disabled = false;
    }
  }

  /* -------------------------------------------------------------- orders tab */

  function renderOrder(rec) {
    const items = Array.isArray(rec.review_partsHandling) ? rec.review_partsHandling : [];

    const kv = ORDER_FIELDS.map(
      ([label, pick]) => `<div class="kv-k">${esc(label)}</div><div>${esc(pick(rec) ?? '')}</div>`,
    ).join('');

    const rows = items
      .slice(0, MAX_ITEMS)
      .map(
        (p) =>
          `<tr><td>${esc(p.sku || '')}</td><td>${esc(p.qty || '')}</td><td>${esc(p.length || '')}</td><td>${esc(
            (p.productionAttr || []).map((a) => `${a.name}:${a.value}`).join('; '),
          )}</td></tr>`,
      )
      .join('');

    viewPane.innerHTML = `
      <div class="pane-hdr">
        <strong class="pane-id">#${esc(rec.id)}</strong>
        <span class="pane-lab" title="${esc(rec.order_number || '')}">${esc(rec.order_number || '')}</span>
        <span class="pane-status">${esc(rec.sales_status || '')}</span>
      </div>
      <div class="kv">${kv}</div>
      ${
        items.length
          ? `
        <div class="items-h"><strong>Items (${items.length})</strong></div>
        <table class="tbl">
          <thead><tr><th>SKU</th><th>Qty</th><th>Len</th><th>Attrs</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      `
          : `<div class="empty">No items found on this record.</div>`
      }
    `;
  }

  async function loadOrder(id) {
    if (!id) return;
    btnOrdOpen.disabled = true;
    btnOrdCopy.disabled = true;
    viewPane.innerHTML = `<div class="empty">Loading order ${esc(id)}…</div>`;
    try {
      // XHR-first to avoid patched fetch races.
      const rec = await getOrder(id, { transport: 'xhr' });
      currentOrder = rec;
      recents.touch(REC_ORD, id, `${rec.order_number || ''} • ${rec.sales_status || ''}`);
      renderOrder(rec);
      btnOrdCopy.disabled = false;
      renderRecents();
    } catch (e) {
      viewPane.innerHTML = `<div class="empty err">Failed to load: ${esc(e.message)}</div>`;
    } finally {
      btnOrdOpen.disabled = false;
    }
  }

  /* ------------------------------------------------------------------ wiring */

  on(fab, 'click', () => setOpen(!isOpen()));
  on(qs('#btnClose'), 'click', () => setOpen(false));
  on(qs('#tabMsg'), 'click', () => setTab('msg'));
  on(qs('#tabOrd'), 'click', () => setTab('ord'));

  on(btnMsgOpen, 'click', () => {
    const id = parseId(msgInput.value);
    if (id) loadMessage(id);
  });
  on(qs('#btnMsgRefresh'), 'click', () => {
    if (currentMsgId) loadMessage(currentMsgId);
  });
  on(btnMsgPop, 'click', () => {
    if (currentMsgId) showThreadPopout(ctx, currentMsgId);
  });
  on(msgInput, 'keydown', (e) => {
    if (e.key !== 'Enter') return;
    const id = parseId(msgInput.value);
    if (id) loadMessage(id);
  });

  on(btnOrdOpen, 'click', () => {
    const id = parseId(ordInput.value);
    if (id) loadOrder(id);
  });
  on(ordInput, 'keydown', (e) => {
    if (e.key !== 'Enter') return;
    const id = parseId(ordInput.value);
    if (id) loadOrder(id);
  });
  on(btnOrdCopy, 'click', async () => {
    if (!currentOrder) return;
    if (!(await ctx.dom.copyText(JSON.stringify(currentOrder, null, 2)))) {
      window.alert('Clipboard unavailable');
      return;
    }
    btnOrdCopy.textContent = '✓';
    setTimeout(() => {
      btnOrdCopy.textContent = '⧉';
    }, 900);
  });

  on(qs('#btnClearRec'), 'click', () => {
    recents.clear(recKey());
    renderRecents();
  });

  on(recList, 'click', (e) => {
    const x = e.target.closest('[data-x]');
    if (x) {
      recents.remove(recKey(), x.getAttribute('data-x'));
      renderRecents();
      return;
    }
    const row = e.target.closest('.item');
    if (!row) return;
    const id = row.getAttribute('data-id');
    if (tab === 'msg') {
      msgInput.value = id;
      loadMessage(id);
    } else {
      ordInput.value = id;
      loadOrder(id);
    }
  });

  setTab('msg');

  return {
    openMessage(id) {
      setOpen(true);
      setTab('msg');
      msgInput.value = id;
      loadMessage(id);
    },
    openOrder(id) {
      setOpen(true);
      setTab('ord');
      ordInput.value = id;
      loadOrder(id);
    },
  };
}

/* --------------------------------------------------------------------- module */

export default {
  id: 'fab',
  title: 'Message & Sales FAB',
  runAt: 'idle',
  pages: [], // every extranet page the bundle runs on, as the legacy @match had it
  enabledByDefault: true,

  init(ctx) {
    ctx.style.add(hostCss, { id: `${STYLE_ID}-host` });
    const panel = buildPanel(ctx);

    // Alt+M / Alt+O: ask for an id and open the matching tab on it.
    document.addEventListener('keydown', (e) => {
      if (!e.altKey) return;
      const key = String(e.key || '').toLowerCase();
      if (key === 'm') {
        const id = parseId(window.prompt('Open Message Center conversation ID:'));
        if (id) panel.openMessage(id);
      }
      if (key === 'o') {
        const id = parseId(window.prompt('Open Sales (Order) ID:'));
        if (id) panel.openOrder(id);
      }
    });
  },
};
