/**
 * ExtraRight — the right-click action menu on order pages.
 *
 * Right-clicking anywhere in the page body opens a compact menu at the pointer instead
 * of the browser's own: a toolbar of three openers (account Orders, account Quotes,
 * Gmail search) over a short list (Copy Tracking, Shipping Address, and a Copy Sets
 * flyout holding the five templated blocks plus the Packing List). Shift+right-click is
 * left alone, so the native menu is always one modifier away. The menu lives in a closed
 * shadow root on a host attached to <html>, which is also why right-clicking the menu
 * itself gives you the browser menu — the host is outside <body>.
 *
 * Ported from legacy/userscripts/extraright.user.js (v1.0). Differences from the
 * original, all deliberate:
 *
 *  - The order helpers are imported from ../lib/order-data.js (the old `window.SCX`)
 *    rather than re-declared here. That swaps this script's narrower `takeInlineJSON`
 *    key list for the shared one, which matches on shipping/address fields too, so an
 *    order page whose JSON blob leads with an address field is now found.
 *  - `window.__AID_CACHE__` is a closure variable, cleared on ctx.route change so a
 *    client-side navigation cannot serve the previous order's account id.
 *  - `window.Qlink` (the quote link another script froze onto window) is the
 *    `orders:quote-link` event that orders.info-panels publishes; we ask for a replay at
 *    startup in case it fired before we loaded.
 *  - The legacy script built the menu with every item in it, then deleted three items
 *    and moved the toolbar. The markup here is the shape it ended up in.
 *  - Packing List inside the Copy Sets flyout ran twice per click: the flyout's own
 *    handler and the root delegate both matched it. The flyout handler stops the event.
 *  - The flyout's four extra global close hooks are gone; hiding the menu closes the
 *    flyout, so both close on the same click / blur / scroll / resize. The one visible
 *    difference: clicking dead space inside the flyout no longer closes it.
 *  - Clipboard writes go through ctx.dom.copyText (which prefers GM_setClipboard, then
 *    the async clipboard API, then execCommand). The rich-HTML Packing List copy still
 *    uses ClipboardItem directly, because no core helper writes text/html, and falls
 *    back to ctx.dom.copyText with the TSV.
 *  - The unused `uniq` helper and the never-called `toast()` are dropped.
 *  - `pages: ['orders-view']` where the legacy @match was `?p=orders-view&view=*`; a
 *    bare orders-view URL now gets the menu too, and its actions find nothing.
 */

import css from './styles.css';
import hostCss from './host.css';
import { S, norm, toNum, takeInlineJSON } from '../lib/order-data.js';

/* ------------------------------------------------------------------ constants */

const HOST_ID = 'extranet-ctx-host';
const STYLE_ID = 'orders-context-menu';
const FLY_ID = 'copysets-flyout';

/** Published by orders.info-panels; the read-only `window.Qlink` global it replaced. */
const QUOTE_LINK_EVENT = 'orders:quote-link';

const EXTRANET_BASE = 'https://extranet.strip-curtains.com/';

/** Toolbar icon paths. Edit these to change the icons. */
const ICONS = {
  orders: 'M3 5h18v2H3zM3 11h18v2H3zM3 17h12v2H3z', // list
  quotes: 'M7 7h6v4H9v6H7zM15 7h6v4h-4v6h-2z', // quotation marks
  gmail: 'M2 6h20v12H2zM2 6l10 7 10-7', // envelope
};

const TOOLBAR = [
  { action: 'open-orders', icon: 'orders', aria: 'Account Orders', tip: 'Orders' },
  { action: 'open-quotes', icon: 'quotes', aria: 'Account Quotes', tip: 'Quotes' },
  { action: 'gmail', icon: 'gmail', aria: 'Gmail Search', tip: 'Email' },
];

const MENU_ITEMS = [
  { action: 'copy-tracks', tone: 'i-green', label: 'Copy Tracking', meta: 'copy' },
  { action: 'copy-ship', tone: 'i-amber', label: 'Shipping Address', meta: 'copy' },
];

/** Templated clipboard blocks. `{{field}}` is looked up in the page's inline order JSON. */
const COPY_SETS = [
  {
    key: 'SHIP_TO_BLOCK',
    label: 'Ship To (Block)',
    template: `{{shipping_company}}
{{shipping_firstname}} {{shipping_lastname}}
{{shipping_address1}}
{{shipping_address2}}
{{shipping_city}}, {{shipping_state}} {{shipping_zipcode}}
{{shipping_country}}
Phone: {{shipping_phone1}}
Email: {{shipping_email}}`,
    post: (s) => s.split('\n').map(norm).filter(Boolean).join('\n'),
  },
  {
    key: 'BILL_TO_BLOCK',
    label: 'Bill To (Block)',
    template: `{{billing_company}}
{{billing_firstname}} {{billing_lastname}}
{{billing_address1}}
{{billing_address2}}
{{billing_city}}, {{billing_state}} {{billing_zipcode}}
{{billing_country}}
Phone: {{billing_phone1}}
Email: {{billing_email}}`,
    post: (s) => s.split('\n').map(norm).filter(Boolean).join('\n'),
  },
  {
    key: 'ORDER_SNAPSHOT',
    label: 'Order Snapshot (Inline)',
    template: `Order {{order_number}} | Acct {{account_id}} | Sage {{sage_sales_number}} | {{site_source}} | Status {{sales_status}} ({{sales_status_id}}) | {{sales_date}} | {{currency}} {{sales_total}} [Sub {{sales_subtotal}} • Disc {{sales_discount}} • Ship {{sales_shipping_amount}} • Tax {{sales_tax_total}}] | Ship Via {{shipment_type}} • Control {{shipment_control}} | Lead {{expected_leadtime}} | ETA Ship {{expected_shippingdate}}`,
    post: (s) => norm(s),
  },
  {
    key: 'PAYMENT_SUMMARY',
    label: 'Payment Summary (Inline)',
    template: `{{payment_gateway}} | {{payment_type}} {{payment_mcardtype}} | {{payment_status}} | {{currency}} {{payment_mtransamount}} | Receipt {{payment_mreceiptid}} | Ref {{payment_referencenum}} | Resp {{payment_responsecode}} | Auth {{payment_mauthcode}} | {{payment_mtransdate}} {{payment_mtranstime}}`,
    post: (s) => norm(s),
  },
  {
    key: 'FULFILLMENT_OPS',
    label: 'Fulfillment Ops (Inline)',
    template: `Ship {{shipment_type}} • Control {{shipment_control}} | Lead {{expected_leadtime}} | ETA Ship {{expected_shippingdate}} | Flags: {{flag}} {{flag_lateshipment}} {{flag_needsattention}} {{flag_lostpackage}} {{flag_customerservice_level2}} {{flag_shipmentweight_inconsistent}} | PU {{pick_up}} | Pkgs {{packages_added}} | Docs: PS {{packingslip_printed}} • Sticker {{packingsticker_printed}} • P&P {{pickandpack_printed}}`,
    post: (s) =>
      norm(s.replace(/\s+/g, ' ').replace(/\s\|\s/g, ' | ').replace(/\s•\s/g, ' • ')).replace(/\s{2,}/g, ' '),
  },
];

/* ------------------------------------------------------------------- text helpers */

/** Table noise that looks like a SKU column but is not one. */
const isBadSku = (v) => {
  const t = S(v).toUpperCase();
  return !t || /^(QTY|AMOUNT|DESCRIPTION|TOTAL|SUBTOTAL|WEIGHT)\b/.test(t) || /\b(LB|LBS|KG|G)\b/.test(t);
};

/**
 * Product descriptions land in an ERP that only accepts plain ASCII, 300 chars.
 * Curly quotes and dashes are folded rather than dropped so words stay readable.
 */
function sanitizeAscii300(input) {
  let s = S(input);
  s = s
    .replace(/[\u2018\u2019\u201B]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2013\u2014\u2212]/g, '-')
    .replace(/\u2026/g, '...')
    .replace(/_x000a_/gi, ' ');
  s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
  s = s.replace(/[^A-Za-z0-9`~!@#$%^&*\-_=+,.\/\?;:'\[\]\{\}\\\|\(\)\s]/g, '');
  s = s.replace(/\s+/g, ' ').trim();
  return s.length > 300 ? s.slice(0, 300) : s;
}

/** Fill `{{field}}` from the order JSON; unknown or empty fields collapse to ''. */
const render = (tpl, data) => tpl.replace(/{{\s*([^}]+)\s*}}/g, (_, k) => S(data && data[k]) || '');

/* -------------------------------------------------------------------- page readers */

/**
 * Every label/value row in the side panels, under canonical keys — the panels label the
 * same field half a dozen ways depending on the order type.
 */
function panelKV() {
  const map = Object.create(null);
  const canon = (k) => {
    const t = String(k || '').replace(/[:：]\s*$/, '').trim().toLowerCase();
    if (
      t === 'sage sale/invoice #' ||
      t === 'sage invoice #' ||
      t === 'invoice #' ||
      t === 'invoice number' ||
      t === 'sage invoice' ||
      t === 'sage sale'
    )
      return 'sage-invoice';
    if (t === 'order #' || t === 'order number') return 'order';
    if (t === 'zip code' || t === 'zipcode' || t === 'zip' || t === 'postal code' || t === 'post code') return 'zip';
    if (t === 'country/region' || t === 'country') return 'country';
    if (t === 'state' || t === 'province') return 'state';
    if (t === 'email' || t === 'shipping email' || t === 'e-mail' || t === 'billing email') return 'email';
    if (t === 'address' || t === 'address 1') return 'address1';
    if (t === 'address 2') return 'address2';
    if (t === 'shipping company' || t === 'company') return 'company';
    if (t === 'phone' || t === 'phone 1') return 'phone1';
    if (t === 'phone 2') return 'phone2';
    if (t === 'city') return 'city';
    return t;
  };
  document.querySelectorAll('.panel .table tr').forEach((tr) => {
    const tds = tr.querySelectorAll('td,th');
    if (tds.length < 2) return;
    const k = canon(norm(tds[0].textContent || ''));
    const v = norm(tds[1].textContent || '');
    if (!k || !v) return;
    if (!(k in map)) map[k] = v; // first row wins
  });
  return map;
}

/** The order JSON, with the one field the page ships as an embedded JSON string parsed. */
function getOrderData() {
  let j = takeInlineJSON();
  if (!j || typeof j !== 'object') j = {};
  if (typeof j.review_partsHandling === 'string') {
    try {
      j.review_partsHandling = JSON.parse(j.review_partsHandling);
    } catch { /* leave the raw string in place */ }
  }
  return j;
}

/** Invoice / order / quote / PO / email, JSON first and the panels after. */
function extractBitsForGmail(quoteLink) {
  const out = { invoice: '', order: '', quote: '', po: '', email: '' };
  const j = takeInlineJSON();
  const jf = (k) => (j && j[k] != null ? S(j[k]) : '');

  out.invoice = jf('sage_sales_number') || out.invoice;
  out.order = jf('order_number') || out.order;
  out.quote = jf('quote_number') || out.quote;
  out.po = jf('po_number') || out.po;
  out.email = jf('shipping_email') || jf('billing_email') || out.email;

  // panel fallbacks
  const kv = panelKV();
  out.invoice ||= kv['sage-invoice'] || '';
  out.order ||= kv['order'] || '';
  out.email ||= kv['email'] || '';

  // if the Quote row was removed by another module, use the link it published
  if (!out.quote && quoteLink) {
    const m = String(quoteLink).match(/(\d{4,})/);
    if (m) out.quote = m[1];
  }
  return out;
}

/** An OR of every identifier we found, plus the customer's domain when it is theirs. */
function buildGmailQuery(quoteLink) {
  const bits = extractBitsForGmail(quoteLink);
  const qtok = (v) => {
    v = norm(v);
    if (!v) return '';
    return /[^A-Za-z0-9]/.test(v) ? `"${v}"` : v;
  };
  const SKIP = new Set(['gmail.com', 'google.com', 'yahoo.com', 'aol.com', 'strip-curtains.com']);
  let domain = '';
  const m = S(bits.email).match(/@([^>\s"'();:,]+)$/);
  if (m) {
    domain = m[1].toLowerCase().replace(/[),.;]+$/, '');
    if (SKIP.has(domain)) domain = '';
  }
  const terms = [];
  if (bits.invoice) terms.push(qtok(bits.invoice));
  if (bits.order) terms.push(qtok(bits.order));
  if (bits.quote) terms.push(qtok(bits.quote));
  if (bits.po) terms.push(qtok(bits.po));
  if (domain) terms.push(`from:*@${domain}`);
  if (!terms.length) return '';
  return `(${terms.join(' OR ')})`;
}

/** Mailing-label form of the shipping contact, JSON first and the panels as a top-up. */
function buildShippingBlock() {
  const j = takeInlineJSON();
  const fn = S(j?.shipping_firstname);
  const ln = S(j?.shipping_lastname);
  const name = [fn, ln].filter(Boolean).join(' ');

  const lines = [];
  if (name) lines.push(name);
  if (j?.shipping_company) lines.push(S(j.shipping_company));
  if (j?.shipping_address1) lines.push(S(j.shipping_address1));
  if (j?.shipping_address2) lines.push(S(j.shipping_address2));

  const city = S(j?.shipping_city);
  const st = S(j?.shipping_state);
  const zip = S(j?.shipping_zipcode);
  const line4 = [city, [st, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
  if (line4) lines.push(line4);

  if (j?.shipping_country) lines.push(S(j.shipping_country));
  if (j?.shipping_phone1) lines.push('Phone: ' + S(j.shipping_phone1));
  if (j?.shipping_email) lines.push('Email: ' + S(j.shipping_email));

  // Name plus one line is not an address; the page must be rendering it in the panels.
  if (lines.length <= 2) {
    const kv = panelKV();
    const extra = [
      kv['company'],
      kv['address1'],
      kv['address2'],
      [kv['city'], [kv['state'], kv['zip']].filter(Boolean).join(' ')].filter(Boolean).join(', '),
      kv['country'],
      kv['email'] ? 'Email: ' + kv['email'] : '',
      kv['phone1'] ? 'Phone: ' + kv['phone1'] : '',
    ].filter(Boolean);
    if (extra.length) lines.push(...extra);
  }
  return lines.filter(Boolean).join('\n');
}

/** UPS / FedEx / USPS numbers anywhere in the shipment and package blocks. */
function collectUniqueTrackings() {
  const trackingSet = new Set();
  ['#shipmentsRow', '#Packages-Block', '#dataTables-example'].forEach((sel) => {
    const container = document.querySelector(sel);
    if (!container) return;
    (container.innerText || '').split(/\s+/).forEach((tok) => {
      let t = (tok || '').trim();
      if (!t) return;
      if (t.includes('-')) return; // dashed tokens are order/part numbers, not tracking
      t = t.replace(/^[^\w]+|[^\w]+$/g, '');
      const isUPS = /^1Z[0-9A-Z]{16}$/i.test(t);
      const isFedEx = /^[0-9]{12,15}$/.test(t);
      const isUSPS = /^[0-9]{20,22}$/.test(t);
      if (isUPS || isFedEx || isUSPS) trackingSet.add(t.toUpperCase());
    });
  });
  return [...trackingSet];
}

/**
 * Rows for the packing list: the page's own `window.parts` when it has one, else the
 * subparts tables. Deliberately not the shared getPartsList — this one skips the
 * activity log, drops header-ish SKUs and wants the row's edit textarea as description.
 */
function getPackingParts() {
  const out = [];
  const parts = Array.isArray(window.parts) ? window.parts : [];
  if (parts.length) {
    parts.forEach((p) =>
      out.push({
        sku: norm(p.sku || ''),
        qty: Number.isFinite(+p.qty) ? +p.qty : toNum(p.qty),
        description: norm(p.description || ''),
      }),
    );
    return out;
  }
  document.querySelectorAll('#products-list:not(.scx-activity-log) tbody>tr[id^="item-id-"]').forEach((tr) => {
    const detail = tr.children[0];
    const table = detail?.querySelector('table.subparts-table, table.table-striped.table-bordered');
    if (!table) return;
    const ths = [...table.querySelectorAll('thead th')].map((th) => norm(th.textContent).toLowerCase());
    const iQty = ths.indexOf('qty');
    const iSku = ths.indexOf('sku');
    const ix = (i, d) => (i >= 0 ? i : d);
    [...table.querySelectorAll('tbody tr')].forEach((r) => {
      const td = r.querySelectorAll('td');
      if (td.length < 3) return;
      const sku = norm(td[ix(iSku, 2)]?.textContent || '');
      if (!sku || isBadSku(sku)) return;

      let description = '';
      const ta = detail.querySelector('textarea[id^="textarea-"]');
      if (ta) description = norm(ta.value);
      if (!description) {
        // no textarea: the longest line of the detail block is the product name
        const lines = (detail.innerText || '')
          .split('\n')
          .map(norm)
          .filter(Boolean)
          .sort((A, B) => B.length - A.length);
        description = lines[0] || '';
      }

      out.push({ sku, qty: toNum(td[ix(iQty, 0)]?.textContent), description });
    });
  });
  return out;
}

/* -------------------------------------------------------------------- account popups */

/** Popup URLs for an account's lists. Deliberately without &lpid / &lid. */
function buildAccountPopupLinks(aid) {
  const AID = String(aid || '').trim();
  if (!/^\d+$/.test(AID)) return { quotes: '', orders: '' };
  return {
    quotes: `${EXTRANET_BASE}?p=quotes_list_popup&aid=${encodeURIComponent(AID)}`,
    orders: `${EXTRANET_BASE}?p=orders_list_popup&aid=${encodeURIComponent(AID)}`,
  };
}

function openPopup(url, titleBase = 'Popup') {
  if (!url) return window.alert('Missing URL.');
  const w = Math.min(window.screen?.availWidth || 1920, 1920);
  const h = Math.min(window.screen?.availHeight || 1080, 1032);
  const feats = `width=${w},height=${h},menubar=0,toolbar=0,resizable=1,location=0,scrollbars=1`;
  return window.open(url, titleBase, feats);
}

/* ------------------------------------------------------------------------ clipboard */

/**
 * Put the table on the clipboard as HTML so it pastes into Gmail as a table, with the
 * TSV as the plain-text flavour. Without ClipboardItem only the TSV goes.
 */
async function copyHTMLWithFallback(copyText, html, plaintext) {
  const PLAIN = String(plaintext || '');
  const HTML = String(html || '');
  if (navigator.clipboard && window.ClipboardItem) {
    try {
      const item = new window.ClipboardItem({
        'text/html': new Blob([HTML], { type: 'text/html' }),
        'text/plain': new Blob([PLAIN], { type: 'text/plain' }),
      });
      await navigator.clipboard.write([item]);
      return;
    } catch { /* no rich clipboard here; plain text still works */ }
  }
  await copyText(PLAIN);
}

function packingListMarkup(rows) {
  const cellStyle = 'border:1px solid #cbd5e1;padding:6px 8px;vertical-align:top;font-size:13px;line-height:1.35;';
  const thStyle = `${cellStyle}background:#f1f5f9;font-weight:600;`;
  const tblStyle = 'border-collapse:collapse;border:1px solid #cbd5e1;table-layout:auto;';
  return (
    `<table style="${tblStyle}"><thead><tr>` +
    `<th style="${thStyle}">SKU</th>` +
    `<th style="${thStyle}">Description</th>` +
    `<th style="${thStyle};text-align:right;">Qty</th>` +
    `</tr></thead><tbody>` +
    rows
      .map(
        (r) =>
          `<tr><td style="${cellStyle}">${r[0]}</td>` +
          `<td style="${cellStyle}">${sanitizeAscii300(r[1])}</td>` +
          `<td style="${cellStyle};text-align:right;">${r[2]}</td></tr>`,
      )
      .join('') +
    `</tbody></table>`
  );
}

/* -------------------------------------------------------------------------- actions */

function createActions(ctx) {
  const { copyText } = ctx.dom;

  /** Account id for the popups, and the quote link, both found once per page. */
  let aidCache = '';
  let quoteLink = '';

  /** Six increasingly desperate places the account id hides. No typing required. */
  function accountId() {
    if (aidCache) return aidCache;
    const remember = (v) => (aidCache = v);

    // 1) URL ?aid=
    const aidQS = new URL(location.href).searchParams.get('aid');
    if (aidQS && /^\d+$/.test(aidQS)) return remember(aidQS);

    // 2) Visible "Account #123"
    const txt = document.body.innerText || '';
    const mHead = txt.match(/Account\s*#\s*([0-9]+)/i);
    if (mHead) return remember(mHead[1]);

    // 3) Any link/form containing aid=
    for (const node of document.querySelectorAll('a[href],form[action]')) {
      const h = node.getAttribute('href') || node.getAttribute('action') || '';
      const m = h.match(/[?&#]aid=(\d+)/i);
      if (m) return remember(m[1]);
    }

    // 4) Inputs that might hold it
    const inp = document.querySelector(
      'input[name="account_id"],input[id="account_id"],input[name="aid"],input[id="aid"]',
    );
    const val = inp && (inp.value || inp.getAttribute('value'));
    if (val && /^\d+$/.test(val)) return remember(val);

    // 5) Inline scripts first (cheap scan)
    const re = /account[_-]?id["']?\s*[:=]\s*["']?(\d+)/i;
    for (const sc of document.scripts) {
      const t = sc && sc.textContent;
      if (!t || sc.src || t.length < 40) continue;
      const m = t.match(re);
      if (m) return remember(m[1]);
    }

    // 6) Last resort: a narrow innerHTML window around the first match
    const H = document.documentElement.innerHTML;
    const i = H.search(/account[_-]?id["']?\s*[:=]\s*["']?\d+/i);
    if (i >= 0) {
      const c = H.slice(Math.max(0, i - 1500), i + 1500);
      const m = c.match(re);
      if (m) return remember(m[1]);
    }

    return '';
  }

  function openAccountList(which) {
    const aid = accountId();
    if (!aid) return window.alert('Account # not found on this page.');
    const links = buildAccountPopupLinks(aid);
    const title = which === 'orders' ? `Orders — Account #${aid}` : `Quotes — Account #${aid}`;
    return openPopup(links[which], title);
  }

  const handlers = {
    'open-orders': () => openAccountList('orders'),
    'open-quotes': () => openAccountList('quotes'),

    gmail() {
      const q = buildGmailQuery(quoteLink);
      if (!q) {
        window.alert('No Invoice/Order/Quote/PO/email domain found to build Gmail search.');
        return;
      }
      window.open(`https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`, '_blank', 'noopener,noreferrer');
    },

    async 'copy-tracks'() {
      const tracks = collectUniqueTrackings();
      if (!tracks.length) {
        window.alert('No tracking numbers found.');
        return;
      }
      await copyText(tracks.join('\n'));
    },

    async 'copy-ship'() {
      const block = buildShippingBlock();
      if (!block) {
        window.alert('No shipping contact found.');
        return;
      }
      await copyText(block);
    },

    async 'copy-skus'() {
      const items = getPackingParts();
      if (!items.length) {
        window.alert('No parts found.');
        return;
      }
      const rows = items.map((p) => [
        (p.sku || '').trim(),
        (p.description || '').replace(/"/g, '""'),
        Number.isFinite(p.qty) ? String(p.qty) : '',
      ]);
      const tsv = ['SKU\tDescription\tQty'].concat(rows.map((r) => r.join('\t'))).join('\n');
      await copyHTMLWithFallback(copyText, packingListMarkup(rows), tsv);
    },
  };

  return {
    run: (name) => handlers[name]?.(),

    async copySet(cs) {
      const data = getOrderData();
      let out = render(cs.template, data);
      out = cs.post ? cs.post(out) : out;
      // tidy the separators the empty fields left behind
      out = out
        .replace(/\|\s*(\||$)/g, '| ')
        .replace(/\|\s*\|/g, '| ')
        .replace(/\s*\|\s*$/, '')
        .trim();
      await copyText(out);
    },

    /** First quote link wins, exactly as the frozen global did. */
    setQuoteLink(href) {
      if (href && !quoteLink) quoteLink = String(href);
    },

    /** A client-side navigation means a different order; forget what we cached. */
    forgetPageCache() {
      aidCache = '';
      quoteLink = '';
    },
  };
}

/* ----------------------------------------------------------------------- the menu */

function svgIcon(d) {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('aria-hidden', 'true');
  const path = document.createElementNS(NS, 'path');
  path.setAttribute('d', d);
  svg.appendChild(path);
  return svg;
}

/**
 * Build the host, its closed shadow root and everything in it.
 * Returns the show/hide handles the page listeners drive.
 */
function buildMenu(ctx, actions) {
  const { el } = ctx.dom;

  const item = ({ tone, label, meta, action = null, sub = null, key = null }) =>
    el(
      'li',
      { class: sub ? 'item has-sub' : 'item', 'data-action': action, 'data-sub': sub, 'data-key': key },
      el('span', { class: `icon ${tone}` }),
      el('span', { class: 'label' }, label),
      el('span', { class: 'meta' }, meta),
      el('span', { class: 'chev', 'aria-hidden': 'true' }),
    );

  // The host hangs off <html>, not <body>: a right-click on the menu itself then falls
  // outside the interception test below and gives you the browser's own menu.
  const host = el('div', { id: HOST_ID });
  (document.documentElement || document.head || document.body).appendChild(host);
  const shadow = host.attachShadow({ mode: 'closed' });
  ctx.style.addToShadow(shadow, css, { id: STYLE_ID });

  const root = el('div', { class: 'cd-root' });
  shadow.appendChild(root);

  const toolbar = el(
    'div',
    { class: 'toolbar', role: 'toolbar', 'aria-label': 'Quick actions' },
    TOOLBAR.map((b) => {
      const btn = el('button', {
        class: 'tbtn',
        type: 'button',
        'aria-label': b.aria,
        'data-icon': b.icon,
        'data-tip': b.tip,
        title: b.tip,
        'data-action': b.action,
      });
      btn.appendChild(svgIcon(ICONS[b.icon]));
      return btn;
    }),
  );

  const list = el('ul', { class: 'menu' }, MENU_ITEMS.map(item));
  const parent = item({ tone: 'i-amber', label: 'Copy Sets', meta: 'flyout', sub: 'copysets' });
  list.appendChild(parent);

  const menu = el(
    'nav',
    { class: 'menu-wrap', role: 'menu', 'aria-hidden': 'true' },
    el(
      'div',
      { class: 'flyout flyout--creator' },
      toolbar,
      el('div', { class: 'body', role: 'region', 'aria-label': 'Extranet Tools' }, el('div', { class: 'group' }, list)),
    ),
  );
  root.appendChild(menu);

  /* --- the Copy Sets flyout ------------------------------------------------- */

  const setList = el('ul', { class: 'menu', id: 'copysets-list' }, [
    ...COPY_SETS.map((cs) => item({ tone: 'i-green', label: cs.label, meta: 'copy', key: cs.key })),
    item({ tone: 'i-pink', label: 'Packing List', meta: 'copy', action: 'copy-skus' }),
  ]);
  const flyInner = el(
    'div',
    { class: 'flyout flyout--creator' },
    el(
      'div',
      { class: 'body', role: 'region', 'aria-label': 'Copy Sets' },
      el('div', { class: 'group' }, el('div', { class: 'kicker' }, 'Copy Sets'), setList),
    ),
  );
  const fly = el('div', { id: FLY_ID, role: 'menu' }, flyInner);
  root.appendChild(fly);

  const closeFly = () => fly.classList.remove('is-open');

  function openFly() {
    const rect = parent.getBoundingClientRect();
    const pad = 8;
    fly.classList.add('is-open');
    let x = rect.right + 10;
    let y = rect.top;
    const fRect = flyInner.getBoundingClientRect();
    // flip to the left / lift off the bottom edge rather than run off screen
    if (x + fRect.width + pad > window.innerWidth) x = Math.max(pad, rect.left - fRect.width - 10);
    if (y + fRect.height + pad > window.innerHeight) y = Math.max(pad, window.innerHeight - fRect.height - pad);
    fly.style.left = `${x}px`;
    fly.style.top = `${y}px`;
  }

  /* --- show / hide ---------------------------------------------------------- */

  function hide() {
    closeFly();
    host.classList.remove('is-open');
    menu.setAttribute('aria-hidden', 'true');
  }

  function showAt(x, y) {
    host.classList.add('is-open');
    menu.setAttribute('aria-hidden', 'false');
    host.style.left = `${x}px`;
    host.style.top = `${y}px`;
    // nudge if the menu would overflow the viewport
    const rect = menu.getBoundingClientRect();
    const pad = 8;
    let left = x;
    let top = y;
    if (x + rect.width + pad > window.innerWidth) left = Math.max(pad, window.innerWidth - rect.width - pad);
    if (y + rect.height + pad > window.innerHeight) top = Math.max(pad, window.innerHeight - rect.height - pad);
    host.style.left = `${left}px`;
    host.style.top = `${top}px`;
  }

  const isOpen = () => host.classList.contains('is-open');

  /* --- wiring --------------------------------------------------------------- */

  async function fire(name) {
    try {
      await actions.run(name);
    } catch (err) {
      ctx.log.error('action error:', err);
      window.alert('Action error: ' + (err?.message || err));
    } finally {
      hide();
    }
  }

  // Toolbar buttons and menu rows carry the action; the Copy Sets row has none and is
  // handled by its own listener below.
  root.addEventListener('click', (e) => {
    const node = e.target.closest?.('.tbtn[data-action], .item[data-action]');
    if (!node) return;
    e.preventDefault();
    e.stopPropagation();
    fire(node.dataset.action);
  });

  parent.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (fly.classList.contains('is-open')) closeFly();
    else openFly();
  });

  // Stops here: without it the root delegate above would run Packing List a second time.
  setList.addEventListener('click', async (e) => {
    const li = e.target.closest?.('.item');
    if (!li) return;
    e.stopPropagation();
    if (li.dataset.action === 'copy-skus') {
      await fire('copy-skus');
      return;
    }
    const cs = COPY_SETS.find((x) => x.key === li.dataset.key);
    if (!cs) return;
    try {
      await actions.copySet(cs);
    } catch (err) {
      ctx.log.error('copy set failed:', err);
    }
    closeFly(); // the menu itself stays up, as it did in the legacy script
  });

  return { host, showAt, hide, isOpen };
}

/* --------------------------------------------------------------------------- module */

export default {
  id: 'orders.context-menu',
  title: 'Right-click actions',
  runAt: 'end',
  pages: ['orders-view'], // legacy @match: ?p=orders-view&view=*
  enabledByDefault: true,

  init(ctx) {
    ctx.style.add(hostCss, { id: `${STYLE_ID}-host` });

    const actions = createActions(ctx);
    const menu = buildMenu(ctx, actions);

    // The quote link, if orders.info-panels already took the Quote # row away.
    ctx.events.on(QUOTE_LINK_EVENT, (href) => actions.setQuoteLink(href));
    ctx.events.emit(`${QUOTE_LINK_EVENT}:request`);
    ctx.route.onChange(() => actions.forgetPageCache());

    document.addEventListener(
      'contextmenu',
      (e) => {
        if (e.shiftKey) return; // Shift+Right-Click => native menu
        // Our own host lives outside <body>, so right-clicking the menu is native too.
        if (!document.body.contains(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation(); // avoid other global menus
        menu.showAt(e.clientX, e.clientY);
      },
      { capture: true },
    );

    document.addEventListener(
      'click',
      (e) => {
        if (!menu.isOpen()) return;
        const path = e.composedPath?.() || [];
        if (!path.includes(menu.host)) menu.hide();
      },
      true,
    );
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') menu.hide(); }, true);
    window.addEventListener('blur', () => menu.hide(), true);
    window.addEventListener('scroll', () => menu.hide(), true);
    window.addEventListener('resize', () => menu.hide(), true);
  },
};
