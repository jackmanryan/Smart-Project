// ==UserScript==
// @name         SC Auto Review (rereview batch)
// @namespace    strip-curtains.extranet
// @version      0.1.4
// @description  Drives the order-review page from a URL hash: sources, PO#, shipping email, price check vs ExtruFlex list, Generate PDF, Save, Yes, Send PO. Reports status in #sc-autoreview.
// @match        https://extranet.strip-curtains.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

/*
TRIGGER (Claude or Jack navigates to):
  https://extranet.strip-curtains.com/?p=orders-review&review=<ID>#autoreview=1&po=<ORDER#>&copyemail=1&ship=UPS%20Standard&rich=SKU1,SKU2&price=SKU~0.65,SKU~1.31&comment=<text>&dry=1

Params (all optional except autoreview=1):
  po=         fill #po_number only if it is empty
  copyemail=1 copy billing email into shipping email if shipping is empty
  set=        comma list of fieldId~value written into review-form fields, e.g. set=shipping_city~POST%20FALLS (address corrections from the order comments)
  ship=       option text prefix to select in #shipment_type (e.g. "UPS Standard"). Omit to keep.
  rich=       comma list of SKUs (substring match on the Handling row) that go to Richmond Warehouse; everything else -> ExtruFlex
  price=      comma list of SKU~unitprice overrides for ExtruFlex PO lines (substring match on PO row SKU)
  comment=    text appended to the ExtruFlex vendor comments before Generate PDF (only if not already present)
  cut=        comma list of substrings; comment lines containing one are removed first (e.g. cut=PREPAY%20AND%20ADD for customer-account shipments)
  strict=0    do not stop on ExtruFlex PVC lines with no known price (default: stop with status needs_price)
  dry=1       do everything except Generate PDF / Save / Yes / Send PO (for testing)

STATUS: read document.querySelector('#sc-autoreview').textContent -> JSON {stage, ok, done, steps[], warn[], error, sources, po}
Stages: prep -> saved (page reloads with popup=0) -> sent
*/

(function () {
  'use strict';
  if (!/p=orders-review/.test(location.search)) return;

  // ---------- ExtruFlex 2026 price list (effective 2026-04-13), keyed on extranet SKU substrings ----------
  // Net $/ft for cut strips. Cut charge ($0.09/ft) is a separate PO line and is left alone.
  // Extend as new extranet SKUs are matched. Matching is case-insensitive substring, first hit wins, so keep specific keys first.
  const PRICE_MAP = [
    ['SC-08-08-RIBBED-LOW-TEMP', 0.69],   // Low Temp DuraRib 8" x .072"
    ['SC-08-.08 - FROSTED',      0.65],   // Standard Frosted (Matte) 8" x .080"
    ['SC-12IN-0120IN-STANDARD',  1.31],   // Standard Smooth 12" x .120"
    ['HARD-GALV',                3.00],   // Bolt-On Galvanized hardware, per ft
  ];
  const IGNORE_PRICE = [/cutting charge/i, /^MISCSERVICE/i];

  // ---------- helpers ----------
  const $ = window.jQuery;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const txt = sel => { const e = document.querySelector(sel); return e ? e.innerText.replace(/\s+/g, ' ').trim() : ''; };
  const reviewId = (location.search.match(/review=(\d+)/) || [])[1];
  const SS_KEY = 'sc-autoreview-' + reviewId;

  const state = { stage: 'prep', ok: true, done: false, steps: [], warn: [], error: null, sources: '', po: [] };
  let badge;
  function report(extra) {
    Object.assign(state, extra || {});
    if (!badge) {
      badge = document.createElement('div');
      badge.id = 'sc-autoreview';
      badge.style.cssText = 'position:fixed;left:8px;bottom:8px;z-index:99999;max-width:520px;font:12px/1.3 monospace;background:#111;color:#0f0;padding:6px 8px;border-radius:6px;white-space:pre-wrap;opacity:.92';
      document.body.appendChild(badge);
    }
    badge.style.color = state.error ? '#f66' : (state.done ? '#0f0' : '#ff0');
    badge.textContent = JSON.stringify(state);
  }
  const step = s => { state.steps.push(s); report(); };
  const fail = msg => { state.ok = false; state.error = msg; report(); throw new Error('autoreview: ' + msg); };

  async function waitFor(fn, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { let v; try { v = fn(); } catch (e) {} if (v) return v; await sleep(300); }
    fail('timeout waiting for ' + label);
  }
  function parseHash() {
    const h = location.hash.replace(/^#/, '');
    const o = {}; h.split('&').forEach(kv => { const i = kv.indexOf('='); if (i < 0) return; o[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' ')); });
    return o;
  }
  function poRows() {
    return [...document.querySelectorAll('#po tr')].filter(tr => tr.querySelector('#unit_price')).map(tr => {
      const tds = tr.querySelectorAll('td');
      return { tr, sku: (tds[0] ? tds[0].innerText : '').trim(), unit: tr.querySelector('#unit_price'), price: tr.querySelector('#price'),
               src: (tr.innerText.match(/ExtruFlex|Richmond Warehouse/) || [''])[0] };
    });
  }
  const sourcesText = () => txt('#sc-host-shipment-sources').replace(/^Shipment Sources.*?Func /, '').slice(0, 400);
  function lookupPrice(sku, overrides) {
    for (const [k, v] of overrides) if (sku.toUpperCase().includes(k.toUpperCase())) return v;
    for (const [k, v] of PRICE_MAP) if (sku.toUpperCase().includes(k.toUpperCase())) return v;
    return null;
  }

  // ---------- stage A: prep on the review page ----------
  async function prep(p) {
    report({ stage: 'prep' });
    await waitFor(() => document.querySelector('#richmondForAll') && document.querySelectorAll('select.sourceCombo').length && document.querySelector('#savechanges'), 30000, 'page');
    await sleep(1500);

    const country = document.querySelector('#shipping_country, [name=shipping_country]');
    if (country && country.value && !/^(US|USA|UNITED STATES)$/i.test(country.value)) fail('shipping country is ' + country.value);

    if (p.copyemail === '1') {
      const s = document.querySelector('#shipping_email'), b = document.querySelector('#billing_email');
      if (s && b && !s.value.trim() && b.value.trim()) { s.value = b.value.trim(); step('shipping email copied from billing'); }
    }
    // set= : comma list of fieldId~value, written into #fieldId on the review form (e.g. set=shipping_city~POST%20FALLS for an address correction from the order comments)
    for (const kv of (p.set || '').split(',').map(s => s.trim()).filter(Boolean)) {
      const i = kv.indexOf('~'); if (i < 0) continue;
      const id = kv.slice(0, i), val = kv.slice(i + 1);
      const el = document.querySelector('#' + id);
      if (!el) fail('set: field not found #' + id);
      if (el.value !== val) { el.value = val; $(el).trigger('change'); step('set ' + id + ' -> ' + val); } else step(id + ' already ' + val);
    }
    if (p.po) {
      const po = document.querySelector('#po_number');
      if (po && !po.value.trim()) { po.value = p.po; step('PO# set ' + p.po); } else step('PO# already ' + (po ? po.value : '?'));
    }
    if (p.ship) {
      const st = document.querySelector('#shipment_type');
      const opt = [...st.options].find(o => o.text.toLowerCase().startsWith(p.ship.toLowerCase()));
      if (!opt) fail('shipment option not found: ' + p.ship);
      if (st.value !== opt.value) { st.value = opt.value; $(st).trigger('change'); step('shipment type -> ' + opt.text); } else step('shipment type already ' + opt.text);
    }
    const cb = document.querySelector('#createboxes');
    if (cb && !cb.checked) { cb.click(); step('Do not create boxes checked'); }

    // Set For All -> ExtruFlex
    $('#inventorySources').val('ExtruFlex');
    document.querySelector('#richmondForAll').click();
    await waitFor(() => [...document.querySelectorAll('select.sourceCombo')].every(s => s.value === 'ExtruFlex') && document.querySelector('#source_ExtruFlex'), 20000, 'Set For All');
    step('all rows -> ExtruFlex');

    // Richmond rows: every handling row whose text contains one of the substrings (an order can carry several rows of the same hardware SKU)
    const rich = (p.rich || '').split(',').map(s => s.trim()).filter(Boolean);
    const flipped = [];
    for (const sku of rich) {
      const sels = [...document.querySelectorAll('select.sourceCombo')].filter(s => s.closest('tr').innerText.toUpperCase().includes(sku.toUpperCase()));
      if (!sels.length) fail('rich SKU not found in handling table: ' + sku);
      for (const sel of sels) if (!flipped.includes(sel)) flipped.push(sel);
    }
    const rowSku = sel => { const tds = sel.closest('tr').querySelectorAll('td'); return (tds[2] ? tds[2].innerText : sel.closest('tr').innerText).trim(); };
    // Expected Richmond PO rows per SKU; the page's updateInventorySource is async and can be lost, so apply, verify against the PO table, and re-apply (up to 3 rounds).
    const expected = {}; flipped.forEach(s => { const k = rowSku(s); expected[k] = (expected[k] || 0) + 1; });
    const richOk = () => Object.keys(expected).every(k => poRows().filter(r => r.src === 'Richmond Warehouse' && r.sku.toUpperCase().includes(k.toUpperCase())).length >= expected[k]);
    for (let round = 0; round < 3 && flipped.length; round++) {
      for (const sel of flipped) {
        sel.value = 'Richmond Warehouse';
        window.updateInventorySource(sel.id.split('_').pop(), 0);
        await sleep(2500);
      }
      const t0 = Date.now(); while (Date.now() - t0 < 15000 && !richOk()) await sleep(500);
      if (richOk()) break;
      state.warn.push('richmond flip round ' + (round + 1) + ' incomplete, retrying');
    }
    if (flipped.length && !richOk()) fail('Richmond rows did not stick in PO table: ' + JSON.stringify(expected));
    if (flipped.length) step('rows -> Richmond: ' + Object.entries(expected).map(([k, n]) => k + ' x' + n).join(', '));
    await waitFor(() => poRows().some(r => r.src === 'ExtruFlex'), 20000, 'PO table');
    await sleep(1500);
    $('#po').show();

    // Price check on ExtruFlex lines
    const overrides = (p.price || '').split(',').map(s => s.trim()).filter(Boolean).map(s => { const [k, v] = s.split('~'); return [k, parseFloat(v)]; });
    const unmapped = [];
    for (const r of poRows()) {
      if (r.src !== 'ExtruFlex') continue;
      if (IGNORE_PRICE.some(re => re.test(r.sku))) continue;
      const want = lookupPrice(r.sku, overrides);
      const have = parseFloat(r.unit.value) || 0;
      if (want == null) { unmapped.push(r.sku + '@' + have); continue; }
      if (Math.abs(have - want) > 0.0001) {
        r.unit.value = want.toFixed(2);
        window.changeQuantity(r.unit, window.orderid_cp);
        await waitFor(() => Math.abs(parseFloat(r.price.value) - want * parseFloat(r.tr.querySelector('#quantity').value)) < 0.05, 15000, 'price recalc ' + r.sku);
        step('price ' + r.sku + ' ' + have + ' -> ' + want);
      } else step('price ok ' + r.sku + ' ' + have);
    }
    if (unmapped.length) { state.warn.push('no list price for: ' + unmapped.join(' | ')); if (p.strict !== '0') { report({ stage: 'needs_price' }); fail('needs_price'); } }
    state.po = poRows().map(r => r.sku.slice(0, 28) + ' ' + r.unit.value + ' ' + r.src);

    // Vendor comment
    if (p.comment || p.cut) {
      const btn = [...document.querySelectorAll('#po button[id^=ad_comments_]')].find(b => /ExtruFlex/.test(b.getAttribute('onclick') || ''));
      if (!btn) fail('ExtruFlex comments button not found');
      const n = btn.id.split('_').pop();
      const ta = document.querySelector('#po_comments_' + n);
      let v = ta.value, changed = false;
      // cut= : comma list of substrings; every comment line containing one is removed (stale text, e.g. "PREPAY AND ADD")
      const cuts = (p.cut || '').split(',').map(s => s.trim()).filter(Boolean);
      if (cuts.length) { const kept = v.split('\n').filter(l => !cuts.some(c => l.toUpperCase().includes(c.toUpperCase()))); if (kept.length !== v.split('\n').length) { v = kept.join('\n'); changed = true; } }
      if (p.comment && !v.includes(p.comment)) { v = v.replace(/\s*$/, '\n') + p.comment + '\n'; changed = true; }
      if (changed) {
        ta.value = v.replace(/^\n+/, '');
        window.addComments(window.orderid_cp, 'ExtruFlex', n);
        await sleep(2500);
        step('comments updated: ' + ta.value.replace(/\s+/g, ' ').slice(0, 120));
      } else step('comments unchanged');
    }

    if (p.dry === '1') { report({ stage: 'dry-done', done: true }); return; }

    // Existing ExtruFlex PDF -> Delete PDF (never Cancel)
    const del = [...document.querySelectorAll('#po button[id^=delete_]')].find(b => /ExtruFlex/.test(b.getAttribute('onclick') || ''));
    if (del) { del.click(); await waitFor(() => !document.querySelector('#po button[id^=delete_]'), 15000, 'delete pdf'); step('old PDF deleted'); }

    // Generate PDF for ExtruFlex
    const gen = [...document.querySelectorAll('#po button[id^=generate_]')].find(b => /ExtruFlex/.test(b.getAttribute('onclick') || ''));
    if (!gen) fail('Generate PDF for ExtruFlex button not found');
    gen.click();
    await waitFor(() => /PDF generated for ExtruFlex/i.test(txt('#pdf_msg')), 30000, 'pdf generated');
    step('PDF generated');

    // Save Changes -> banner Yes -> reload (popup=0)
    sessionStorage.setItem(SS_KEY, JSON.stringify({ stage: 'saved', t: Date.now(), steps: state.steps, warn: state.warn, po: state.po }));
    document.querySelector('#savechanges').click();
    step('Save clicked');
    // The server sometimes answers the Yes with the same banner again; click Yes up to 5 times, ~12s apart.
    const t0 = Date.now(); let yesClicks = 0, lastYes = 0;
    while (Date.now() - t0 < 90000) {
      if (/Continue Reviewing/i.test(txt('#printErrors_show')) && Date.now() - lastYes > 12000 && yesClicks < 5) {
        const y = [...document.querySelectorAll('#printErrors_show button')].find(b => /^Yes$/.test(b.innerText.trim()));
        if (y) { y.click(); yesClicks++; lastYes = Date.now(); step('Yes clicked #' + yesClicks); }
      }
      if (/Order reviewed/i.test(txt('#printSuccessMSG_show')) || /popup=0/.test(location.search)) break;
      const err = txt('#printErrors_show');
      if (err && !/Continue Reviewing/i.test(err)) fail('save error: ' + err.slice(0, 160));
      await sleep(500);
    }
    report({ stage: 'saved' });
    // page normally reloads here (stage B runs from sessionStorage); if it does not within 60s, try stage B in place
    await sleep(60000);
    await send();
  }

  // ---------- stage B: after reload, send the PO ----------
  async function send() {
    const saved = JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
    if (saved.steps) { state.steps = saved.steps.concat(state.steps); state.warn = saved.warn || []; state.po = saved.po || []; }
    report({ stage: 'send' });
    await waitFor(() => /Order reviewed/i.test(txt('#printSuccessMSG_show')), 40000, 'Order reviewed');
    step('Order reviewed confirmed');
    state.sources = sourcesText();
    if (!/ExtruFlex/.test(state.sources)) fail('no ExtruFlex source after save');
    const btn = await waitFor(() => [...document.querySelectorAll('#po button')].find(b => /^Send PO$/.test(b.innerText.trim()) && /ExtruFlex/.test(b.getAttribute('onclick') || '')), 40000, 'Send PO button');
    const again = [...document.querySelectorAll('*')].some(e => e.children.length < 3 && /Send it again/.test(e.innerText || '') && e.offsetParent);
    if (again) fail('duplicate guard visible: PO already sent');
    if (/PO sent/i.test(txt('#pdf_msg'))) fail('pdf_msg already says PO sent');
    $('#po').show();
    btn.click();
    await waitFor(() => /PO sent to ExtruFlex/i.test(txt('#pdf_msg')), 40000, 'PO sent');
    step('PO sent to ExtruFlex');
    sessionStorage.removeItem(SS_KEY);
    report({ stage: 'sent', done: true });
  }

  // ---------- entry ----------
  const p = parseHash();
  const pending = JSON.parse(sessionStorage.getItem(SS_KEY) || 'null');
  const fresh = pending && (Date.now() - pending.t) < 10 * 60 * 1000;
  if (pending && !fresh) sessionStorage.removeItem(SS_KEY);
  if (fresh && pending.stage === 'saved' && /popup=0/.test(location.search)) {
    send().catch(e => console.error(e));
  } else if (p.autoreview === '1') {
    prep(p).catch(e => console.error(e));
  }
})();