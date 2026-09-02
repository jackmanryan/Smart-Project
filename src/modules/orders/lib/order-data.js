/**
 * Order-page data harvesting.
 *
 * This is the "SCX mini-core" ExtraClaims used to build and hang on `window.SCX`. A
 * call-site scan of the legacy set found nothing outside ExtraClaims ever read it, so it
 * becomes a plain module-local library instead of a global: named exports, no side
 * effects on import.
 *
 * Everything here reads the server-rendered orders-view page. The page states the same
 * fact in three places — an inline JSON blob the site's own scripts eval, the label
 * tables in the info panels, and the products/packages tables — and they disagree often
 * enough that each getter tries them in that order.
 *
 * Ported from legacy/userscripts/extraclaims.user.js (v3.3).
 */

import { S, norm, toNum } from '../../../core/dom.js';

// SCX exported these three alongside the getters and call sites still expect them here,
// so they are re-exported rather than copied — the implementations live in core/dom.
export { S, norm, toNum };

/* ------------------------------------------------------- inline JSON + panels */

/**
 * The order page prints its record as a JSON object literal inside an inline <script>.
 * There is no id to hang off, so we look for a script mentioning one of the known field
 * names and then brace-match outwards from it.
 */
export function takeInlineJSON() {
  const keys =
    /(po_number|sage_sales_number|order_number|quote_number|shipping_email|billing_email|shipping_firstname|shipping_lastname|shipping_phone1|billing_phone1|shipping_company|shipping_address1|shipping_address2|shipping_city|shipping_state|shipping_zipcode|shipping_country|sales_shipping_type|expected_shippingdate)/i;
  for (const sc of document.scripts) {
    const txt = sc?.textContent || '';
    if (sc.src || txt.length < 80) continue;
    const idx = txt.search(keys);
    if (idx < 0) continue;
    const i = txt.lastIndexOf('{', idx);
    let o = 0;
    let s = -1;
    let e = -1;
    for (let p = i; p < txt.length; p++) {
      const c = txt[p];
      if (c === '{') {
        if (o === 0) s = p;
        o++;
      } else if (c === '}') {
        o--;
        if (o === 0) {
          e = p + 1;
          break;
        }
      }
    }
    if (s >= 0 && e > s) {
      try {
        return JSON.parse(txt.slice(s, e));
      } catch { /* not the blob we were after; keep looking */ }
    }
  }
  return null;
}

/** Two-column label/value table → { 'label': 'value' }, keys lowercased and de-colonned. */
export function mapLabelTable(root) {
  const m = Object.create(null);
  (root ? root.querySelectorAll('tr') : []).forEach((tr) => {
    const t = tr.querySelectorAll('td,th');
    if (t.length >= 2) {
      const k = norm(t[0].textContent).replace(/[:：]\s*$/, '').toLowerCase();
      const v = norm(t[1].textContent);
      if (k) m[k] = v;
    }
  });
  return m;
}

/** The .panel whose heading matches, e.g. findPanelByHeading(/shipping info/i). */
export function findPanelByHeading(re) {
  const h = [...document.querySelectorAll('.panel-heading')].find((x) => re.test(norm(x.textContent || '')));
  return h ? h.closest('.panel') : null;
}

/* --------------------------------------------- currency / invoice / consignee */

export function getCurrency() {
  let cur = 'USD';
  const row = [...document.querySelectorAll('tr.gradeX')].find((x) => /currency\s*:/i.test(x.textContent || ''));
  if (row) {
    const td = row.querySelector('td:nth-child(2)');
    const c = norm(td?.textContent || '');
    if (c) cur = c;
  }
  return cur;
}

export function getInvoice() {
  const j = takeInlineJSON() || {};
  if (j.sage_sales_number) return S(j.sage_sales_number);
  const rows = [...document.querySelectorAll('.panel .table tr')];
  const getVal = (label) =>
    (rows.find((tr) => norm(tr.children?.[0]?.textContent || '') === label)?.children?.[1]?.textContent || '').trim();
  return (
    getVal('Sage Sale/Invoice #:') ||
    getVal('Invoice #:') ||
    getVal('Invoice Number:') ||
    getVal('Sage Invoice:') ||
    getVal('Sage Sale:') ||
    'NA'
  );
}

/**
 * Ship-to block for the claim form. The inline JSON is authoritative; when any one of
 * the five fields is missing we fall back to the visible panels for the whole block,
 * because a half-JSON half-panel address reads worse than a consistent one.
 */
export function getConsignee() {
  const j = takeInlineJSON() || {};
  const fn = S(j.shipping_firstname);
  const ln = S(j.shipping_lastname);
  const contact = [fn, ln].filter(Boolean).join(' ');
  const company = S(j.shipping_company);
  const phone = S(j.shipping_phone1) || S(j.billing_phone1);
  const email = S(j.shipping_email) || S(j.billing_email);
  const a1 = S(j.shipping_address1);
  const a2 = S(j.shipping_address2);
  const city = S(j.shipping_city);
  const st = S(j.shipping_state);
  const zip = S(j.shipping_zipcode);
  const ctry = S(j.shipping_country);
  const address = [a1, a2, [city, [st, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), ctry]
    .filter(Boolean)
    .join(', ');

  if (!company || !address || !email || !phone || !contact) {
    const other = mapLabelTable(findPanelByHeading(/other info/i) || document);
    const ship = mapLabelTable(findPanelByHeading(/shipping info/i) || document);
    const name2 = [ship['first name'], ship['last name']].filter(Boolean).join(' ');
    return {
      company: company || ship['shipping company'] || other['company'] || '',
      contact: contact || name2 || ship['name'] || other['name'] || '',
      phone: phone || ship['phone'] || other['billing phone'] || '',
      email: email || ship['email'] || other['billing email'] || '',
      address:
        address ||
        [
          ship['address 1'] || other['address 1'] || '',
          ship['address 2'] || other['address 2'] || '',
          [
            ship['city'] || '',
            [
              ship['state'] || ship['province'] || '',
              ship['zip code'] || ship['postal code'] || ship['zip'] || '',
            ]
              .filter(Boolean)
              .join(' '),
          ]
            .filter(Boolean)
            .join(', '),
          ship['country'] || ship['country/region'] || '',
        ]
          .filter(Boolean)
          .join(', '),
    };
  }
  return { company, contact, phone, address, email };
}

/* ------------------------------------------------------- product harvesting */

/**
 * The per-item tables have no stable column order and their headers are sometimes
 * blank, so headers are used when they exist and the column contents are scored when
 * they do not.
 */
function detectProductCols(table) {
  const clean = (s) => norm(s).toLowerCase().replace(/[^a-z]/g, '');
  const ths = [...table.querySelectorAll('thead th, thead td')].map((th) => clean(th.textContent));
  const iQtyHead = ths.findIndex((h) => h === 'qty' || h.startsWith('qty'));
  const iSkuHead = ths.findIndex((h) => h.startsWith('sku'));
  const iLenHead = ths.findIndex((h) => /length/.test(h));
  const iPriceHead = ths.findIndex((h) => /partprice|price|total|amount|amt/.test(h));

  const rows = [...table.querySelectorAll('tbody tr')].slice(0, 8);
  const width = rows.reduce((m, r) => Math.max(m, r.querySelectorAll('td').length), 0) || Math.max(ths.length, 3);

  const score = Array.from({ length: width }, () => ({ sku: 0, qty: 0, len: 0, money: 0 }));
  const numOnly = (t) => /^\s*\d+(?:\.\d+)?\s*$/.test(t);
  const looksSku = (t) => {
    const u = S(t).toUpperCase();
    if (!u) return false;
    if (/\b(QTY|AMOUNT|DESCRIPTION|TOTAL|SUBTOTAL|WEIGHT|LB|LBS|KG|G)\b/.test(u)) return false;
    return /[A-Z]/.test(u) && /[-_]/.test(u) && !numOnly(u);
  };
  const looksLen = (t) => /(?:^|\s)(\d+(?:\.\d+)?)\s*(ft|feet)\b/i.test(t) || (numOnly(t) && !/\$|€|£|₹/.test(t));
  const looksMoney = (t) => /[$€£₹]\s*\d/.test(t) || (/\d\.\d{2}\b/.test(t) && !/\b(lb|lbs|kg|g)\b/i.test(t));

  rows.forEach((r) => {
    const tds = [...r.querySelectorAll('td')];
    for (let j = 0; j < width; j++) {
      const txt = norm(tds[j]?.textContent || '');
      if (!txt) continue;
      if (looksSku(txt)) score[j].sku++;
      if (numOnly(txt)) score[j].qty++;
      if (looksLen(txt)) score[j].len++;
      if (looksMoney(txt)) score[j].money++;
    }
  });

  const pickMax = (arr, key) => {
    let best = 0;
    for (let i = 1; i < arr.length; i++) if (arr[i][key] > arr[best][key]) best = i;
    return best;
  };

  const iSku = iSkuHead >= 0 ? iSkuHead : pickMax(score, 'sku');
  const iQty = iQtyHead >= 0 ? iQtyHead : pickMax(score, 'qty');
  const iLen = iLenHead >= 0 ? iLenHead : pickMax(score, 'len');
  const iPrice = iPriceHead >= 0 ? iPriceHead : pickMax(score, 'money');

  const clamp = (i) => Math.max(0, Math.min(i, width - 1));
  return { iSku: clamp(iSku), iQty: clamp(iQty), iLen: clamp(iLen), iPrice: clamp(iPrice) };
}

/**
 * Pull the most description-shaped string out of an expanded product row: the notes
 * textarea if the row has one, else the longest prose-looking cell.
 */
function extractDescFromDetail(detail) {
  const isLabelish = (s) => /\b(qty|quantity|price|amount|total|subtotal|weight|lbs?|kg|g|sku|length|ft|feet)\b/i.test(s);
  const isLikelySku = (s) => /[A-Z]/.test(s) && /[-_]/.test(s) && !/\s/.test(s.replace(/[-_]/g, ''));

  // 1) textarea first
  const ta = detail.querySelector('textarea[id^="textarea-"]');
  if (ta && norm(ta.value)) return norm(ta.value);

  // 2) table cells
  const candidates = [];
  const tbl = detail.querySelector('table.table-striped.table-bordered');
  if (tbl) {
    [...tbl.querySelectorAll('tbody tr')].forEach((tr) => {
      [...tr.querySelectorAll('td')].forEach((td) => {
        const t = norm(td.textContent || '');
        if (t) candidates.push(t);
      });
    });
  }
  // 3) fallback: detail block
  if (!candidates.length) {
    const raw = (detail.innerText || '').split('\n').map(norm).filter(Boolean);
    candidates.push(...raw);
  }

  const cleaned = candidates
    .filter((t) => t.length >= 4)
    .filter((t) => !isLabelish(t))
    .filter((t) => !/^\d+(\.\d+)?$/.test(t))
    .filter((t) => !isLikelySku(t))
    .filter((t) => !/https?:\/\//i.test(t));

  const rank = (s) => {
    let score = 0;
    if (/[A-Za-z]/.test(s) && /\s/.test(s)) score += 3;
    if (s.length >= 20) score += 2;
    if (s.length >= 50) score += 1;
    if (s.toUpperCase() !== s) score += 1;
    return score;
  };
  cleaned.sort((A, B) => rank(B) - rank(A) || B.length - A.length);

  let out = cleaned[0] || '';
  out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
  if (out.length > 300) out = out.slice(0, 300);
  return out;
}

/** Line items for the order: the site's own `window.parts` JSON when it exists, else the table. */
export function getPartsList() {
  const out = [];
  // Prefer window.parts JSON when present
  const parts = Array.isArray(window.parts) ? window.parts : [];
  if (parts.length) {
    parts.forEach((p) =>
      out.push({
        sku: norm(p.sku || ''),
        qty: Number.isFinite(+p.qty) ? +p.qty : toNum(p.qty),
        description: norm(p.description || ''),
        lb_per_unit: toNum(p.lb_per_unit),
        length_ft_each: NaN,
        line_total_from_ui: NaN,
      }),
    );
    return out;
  }

  // Fallback: parse products table
  document.querySelectorAll('#products-list tbody>tr[id^="item-id-"]').forEach((tr) => {
    const detail = tr.children[0];
    const table = detail?.querySelector('table.table-striped.table-bordered');
    if (!table) return;

    const { iSku, iQty, iLen, iPrice } = detectProductCols(table);
    [...table.querySelectorAll('tbody tr')].forEach((r) => {
      const td = r.querySelectorAll('td');
      if (td.length < 3) return;

      const rawSku = norm(td[iSku]?.textContent || '');
      if (!rawSku) return;

      const sku = rawSku;
      const qty = toNum(td[iQty]?.textContent);
      const lenFt = toNum(td[iLen]?.textContent); // may be NaN
      const pTotal = toNum(td[iPrice]?.textContent); // line total if present
      const description = extractDescFromDetail(detail);

      out.push({
        sku,
        qty,
        description,
        lb_per_unit: NaN,
        length_ft_each: lenFt,
        line_total_from_ui: pTotal,
      });
    });
  });

  return out;
}

/* --------------------------------------------------------------- price context */

/** Cached for the life of the page, the way the legacy `window.PRICE_CTX` global was. */
let priceCtxCache = null;

/**
 * Per-SKU aggregate built from the products table — the single source of truth for
 * "what is one unit / one foot of this worth", so the packages table can be priced
 * without a second guess at which column held money.
 *
 * An empty result is not treated as cached, so a build that ran before the products
 * table rendered does not poison the page.
 */
export function buildPriceCtx() {
  if (priceCtxCache && Object.keys(priceCtxCache).length) return priceCtxCache;

  const items = getPartsList();
  const priceCtx = {}; // SKU -> { qtySum, lenSumFt, partTotal, ppu, ppf, descs[] }

  items.forEach((it) => {
    const key = norm(it.sku).toUpperCase();
    if (!key) return;
    const a = (priceCtx[key] ||= { qtySum: 0, lenSumFt: 0, partTotal: 0, descs: [] });

    if (Number.isFinite(it.qty)) a.qtySum += it.qty;
    if (Number.isFinite(it.qty) && Number.isFinite(it.length_ft_each) && it.length_ft_each > 0) {
      a.lenSumFt += it.qty * it.length_ft_each;
    }
    if (Number.isFinite(it.line_total_from_ui) && it.line_total_from_ui > 0) {
      a.partTotal += it.line_total_from_ui;
    }
    if (!a._gotDesc && it.description) {
      a.descs.push(it.description);
      a._gotDesc = true;
    }
  });

  Object.values(priceCtx).forEach((a) => {
    a.ppu = a.qtySum > 0 ? a.partTotal / a.qtySum : NaN;
    a.ppf = a.lenSumFt > 0 ? a.partTotal / a.lenSumFt : NaN;
    delete a._gotDesc;
  });

  priceCtxCache = priceCtx;
  return priceCtx;
}

/** Drop the cached price context, e.g. after the products table is re-rendered. */
export function resetPriceCtx() {
  priceCtxCache = null;
}

/* ------------------------------------------------------- packages by tracking */

/** Column layout of one package's item table, plus what its amount column actually holds. */
function detectPkgCols(tbl) {
  const H = [...tbl.querySelectorAll('thead th, thead td')].map((c) =>
    norm(c.textContent).toLowerCase().replace(/[^a-z]/g, ''),
  );
  const iSku = H.findIndex((h) => h.startsWith('sku'));
  const iQty = H.findIndex((h) => h === 'qty' || h.startsWith('qty'));
  const iAmt = H.findIndex((h) => /(length|price|total|amount|weight|lb|lbs)/.test(h));
  const head = H[iAmt] || '';
  let amtKind = 'unknown';
  if (/length|ft|feet/.test(head)) amtKind = 'length';
  else if (/price|total|amount|amt/.test(head)) amtKind = 'price';
  else if (/weight|lb|lbs|kg|g/.test(head)) amtKind = 'weight';
  return { iSku: Math.max(0, iSku), iQty: Math.max(0, iQty), iAmt: Math.max(0, iAmt), amtKind };
}

/**
 * Value and goods description per tracking number, priced off the products table.
 * A package listing several trackings credits the whole package to each of them —
 * the claim is filed per tracking and UPS wants the package value, not a share of it.
 *
 * @returns {Record<string, {valueSum:number, descs:Set<string>}>}
 */
export function getClaimsByTracking() {
  const priceCtx = buildPriceCtx();
  const up = (s) => S(s).trim().toUpperCase();

  function valueFromAgg(sku, qty, len, amtKind) {
    const a = priceCtx[up(sku)];
    const q = Number(qty);
    const L = Number(len);
    if (amtKind === 'length' && Number.isFinite(q) && Number.isFinite(L) && L > 0 && a && Number.isFinite(a.ppf)) {
      return a.ppf * (q * L);
    }
    if (Number.isFinite(q) && a && Number.isFinite(a.ppu)) return a.ppu * q;
    return 0;
  }

  const byTrk = {}; // trk -> { valueSum:number, descs:Set<string> }
  const ensure = (trk) => (byTrk[trk] ||= { valueSum: 0, descs: new Set() });

  const block = document.querySelector('#Packages-Block');
  if (!block) return byTrk;

  block.querySelectorAll('tbody > tr.gradeX').forEach((row) => {
    const tds = row.querySelectorAll(':scope > td');
    if (tds.length < 6) return;
    const category = norm(tds[2]?.textContent || '');
    const itemsTable = tds[3]?.querySelector('table');
    const tCell = tds[5];

    // tracking(s)
    let trackings = [...tCell.querySelectorAll('a')].map((a) => norm(a.textContent)).filter(Boolean);
    if (!trackings.length) {
      const raw = norm(tCell.textContent || '').replace(/[()]/g, '');
      trackings = raw ? raw.split('|').map(norm).filter(Boolean) : [];
    }
    if (!trackings.length) trackings = [''];

    if (itemsTable) {
      const { iSku, iQty, iAmt, amtKind: headKind } = detectPkgCols(itemsTable);
      itemsTable.querySelectorAll('tbody tr').forEach((r) => {
        const cs = r.querySelectorAll('td');
        if (cs.length < 3) return;
        const sku = norm(cs[iSku]?.textContent || '');
        const qtyTxt = norm(cs[iQty]?.textContent || '');
        const qty = (function parseQty(t) {
          if (!t) return NaN;
          if (/[A-Za-z]/.test(t) || (t.match(/-/g) || []).length >= 2) return NaN;
          const m = t.match(/\b(?:qty[:\s]*)?(\d+(?:\.\d+)?)\b/i);
          return m ? Number(m[1]) : NaN;
        })(qtyTxt);
        const amtText = norm(cs[iAmt]?.textContent || '');
        let kind = headKind;
        if (/\b(lb|lbs|kg|g)\b/i.test(amtText)) kind = 'weight';
        else if (/[₹£€$]/.test(amtText)) kind = 'price';
        const lenOrMoney = toNum(amtText);

        const v = valueFromAgg(sku, qty, lenOrMoney, kind);

        trackings.forEach((trk) => {
          const a = ensure(trk);
          a.valueSum += v;

          // Prefer rich description from PRICE_CTX, then category, then SKU
          const agg = priceCtx[up(sku)];
          if (agg && agg.descs && agg.descs.length) agg.descs.forEach((d) => d && a.descs.add(d));
          else if (category) a.descs.add(category);
          else if (sku) a.descs.add(sku);
        });
      });
    } else if (category) {
      trackings.forEach((trk) => ensure(trk).descs.add(category));
    }
  });

  return byTrk;
}

/* ------------------------------------------------------------------ order bits */

/** Invoice / order / quote / PO / email for the current order, JSON first, panels second. */
export function getOrderBits() {
  const j = takeInlineJSON() || {};
  const out = {
    invoice: S(j.sage_sales_number || ''),
    order: S(j.order_number || ''),
    quote: S(j.quote_number || ''),
    po: S(j.po_number || ''),
    email: S(j.shipping_email || j.billing_email || ''),
  };
  const other = mapLabelTable(findPanelByHeading(/other info/i) || document);
  const ship = mapLabelTable(findPanelByHeading(/shipping info/i) || document);
  out.invoice ||=
    other['sage sale/invoice #'] ||
    other['invoice #'] ||
    other['invoice number'] ||
    other['sage invoice'] ||
    other['sage sale'] ||
    '';
  out.order ||= other['order #'] || other['order number'] || '';
  out.quote ||= other['quote #'] || other['quote number'] || '';
  out.po ||=
    other['p.o. number'] ||
    other['po number'] ||
    other['customer po'] ||
    other['purchase order'] ||
    other['p.o.'] ||
    other['po'] ||
    '';
  out.email ||= ship['email'] || ship['e-mail'] || ship['shipping email'] || other['billing email'] || '';
  return out;
}
