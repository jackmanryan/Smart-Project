/**
 * Auto Review (rereview batch) — SAFETY CRITICAL, hash gated.
 *
 * Drives the order-review page from a URL: inventory sources, PO number, shipping email,
 * shipment type, the ExtruFlex price check, Generate PDF, Save Changes, the "Yes" on the
 * Continue Reviewing banner and finally Send PO. It clicks the buttons a reviewer would
 * otherwise click, so the gate below is the whole safety story.
 *
 * THE GATE — unchanged from the legacy script, do not widen:
 *   1. the page must be `?p=orders-review` (the `pages` declaration at the bottom), and
 *   2. the URL hash must carry `autoreview=1`  → stage A, prep, or
 *   3. sessionStorage must hold a `saved` record for this review id that is under ten
 *      minutes old *and* the URL must carry `popup=0` → stage B, the post-save resume.
 * Rule 3 deliberately has no hash of its own: Save reloads the page and the reload drops
 * the hash, so the pending record is what carries the arming across it. With neither 2
 * nor 3 satisfied this module reads the hash, finds nothing, and returns without adding
 * a node, a style or a listener.
 *
 * TRIGGER (Claude or Jack navigates to):
 *   https://extranet.strip-curtains.com/?p=orders-review&review=<ID>#autoreview=1&po=<ORDER#>
 *     &copyemail=1&ship=UPS%20Standard&rich=SKU1,SKU2&price=SKU~0.65,SKU~1.31&comment=<text>&dry=1
 *
 * SOURCING is rule-driven. orders/lib/sourcing.js decides each handling row — PVC and
 * Polymer Quick Snap to ExtruFlex, hardware to Richmond, GALV whole feet to ExtruFlex and
 * GALV partial footage to Richmond — and the flip is still verified against the PO table
 * before the run continues, because the page's updateInventorySource fires an $.ajax whose
 * result it never checks. A row the rule is unsure about is flagged in `warn`, never guessed.
 * PRICES come from orders/lib/extruflex.js, the same table the manual review screen uses.
 *
 * Params (all optional except autoreview=1):
 *   po=         fill #po_number only if it is empty
 *   copyemail=1 copy billing email into shipping email if shipping is empty
 *   set=        comma list of fieldId~value written into review-form fields, e.g.
 *               set=shipping_city~POST%20FALLS (address corrections from the order comments)
 *   ship=       option text prefix to select in #shipment_type (e.g. "UPS Standard"). Omit to keep.
 *   rich=       comma list of SKUs (substring match on the Handling row) that go to Richmond
 *               Warehouse; everything else -> ExtruFlex
 *   price=      comma list of SKU~unitprice overrides for ExtruFlex PO lines (substring match
 *               on PO row SKU)
 *   comment=    text appended to the ExtruFlex vendor comments before Generate PDF (only if
 *               not already present)
 *   cut=        comma list of substrings; comment lines containing one are removed first
 *               (e.g. cut=PREPAY%20AND%20ADD for customer-account shipments)
 *   strict=0    do not stop on ExtruFlex PVC lines with no known price (default: stop with
 *               status needs_price)
 *   dry=1       do everything except Generate PDF / Save / Yes / Send PO (for testing)
 *
 * STATUS: document.querySelector('#sc-autoreview').textContent is JSON
 *   {stage, ok, done, steps[], warn[], error, sources, po}
 * Stages: prep -> saved (page reloads with popup=0) -> sent. That element still holds the
 * JSON and nothing else — the armed pill is a separate node so textContent stays parseable.
 *
 * Ported from legacy/userscripts/sc-auto-review-rereview-batch.user.js (v0.1.4). What
 * changed, all of it outside the gate and none of it about when the automation fires:
 *   - a visible armed pill (#sc-autoreview-armed) says the page is under automation; it is
 *     informational and is only rendered once the gate has already passed;
 *   - the badge's inline cssText lives in styles.css, and its three status colours are a
 *     data-state attribute instead of an assignment to style.color;
 *   - badge and pill sit in one fixed dock in the same bottom-left corner as before;
 *   - the private sleep/txt helpers are ctx.dom.sleep / ctx.dom.norm, and the page test is
 *     the `pages` declaration instead of a regex over location.search;
 *   - rejections log through ctx.log.error rather than bare console.error.
 * The waits stay predicate polling rather than ctx.observe: they wait on values the page's
 * own scripts write (a recalculated price, a status line), not on elements appearing, and
 * the timings are what this automation was tuned against on the live site.
 *
 * Page-side globals this leans on (read, never assigned): window.jQuery, window.orderid_cp,
 * window.updateInventorySource, window.changeQuantity, window.addComments. The Shipment
 * Sources readout is taken from `#sc-host-shipment-sources`, the host `modules/dock` builds.
 */

import css from './styles.css';
import { EFFECTIVE_DATE, LIST_NAME, priceFor, isZeroPriced } from '../../orders/lib/extruflex.js';
import { classify, RICHMOND } from '../../orders/lib/sourcing.js';

const STYLE_ID = 'automation-auto-review';

/** The status contract other tooling reads. Both ids are load bearing. */
const BADGE_ID = 'sc-autoreview';
const DOCK_ID = 'sc-autoreview-dock';
const ARMED_ID = 'sc-autoreview-armed';

/** sessionStorage key prefix, verbatim from the legacy script. */
const SS_PREFIX = 'sc-autoreview-';

/** How long a `saved` record may sit before a reload is no longer treated as our reload. */
const RESUME_WINDOW_MS = 10 * 60 * 1000;

/** Save banner handling: the server sometimes answers the Yes with the same banner again. */
const SAVE_WINDOW_MS = 90000;
const YES_GAP_MS = 12000;
const YES_MAX = 5;

/** If Save does not reload the page, stage B is tried in place after this long. */
const RELOAD_GRACE_MS = 60000;

// The price list and the SKU aliases live in orders/lib/extruflex.js, so the manual
// review screen and this automation check against the same rows and the same effective
// date. Extend the list there, not here.

/* ------------------------------------------------------------------ pure helpers */

/** `#autoreview=1&po=123` -> { autoreview: '1', po: '123' }. */
function parseHash() {
  const out = {};
  location.hash
    .replace(/^#/, '')
    .split('&')
    .forEach((kv) => {
      const i = kv.indexOf('=');
      if (i < 0) return;
      out[decodeURIComponent(kv.slice(0, i))] = decodeURIComponent(kv.slice(i + 1).replace(/\+/g, ' '));
    });
  return out;
}

/** The review id from the query string, and the per-review sessionStorage key built from it. */
const reviewId = () => (location.search.match(/review=(\d+)/) || [])[1];
const sessionKey = () => SS_PREFIX + reviewId();

/** `a, b ,` -> ['a','b']. Used for every comma-list hash param. */
const csv = (value) =>
  (value || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);

/** `SKU~0.65,OTHER~1.31` -> [['SKU', 0.65], ['OTHER', 1.31]]. */
const parseOverrides = (value) =>
  csv(value).map((s) => {
    const [k, v] = s.split('~');
    return [k, parseFloat(v)];
  });

/**
 * What a PO line should cost. A `price=` override always wins — it is the reviewer
 * saying they have read the printed list — otherwise the shared price table answers.
 */
function lookupPrice(sku, overrides, { unitPrice = null } = {}) {
  for (const [k, v] of overrides) {
    if (sku.toUpperCase().includes(k.toUpperCase())) return { kind: 'price', price: v, part: 'override' };
  }
  return priceFor({ sku, unitPrice });
}

/**
 * The PO lines. Every row repeats the same element ids (#unit_price, #price, #quantity),
 * so each field is looked up inside its own row rather than by id on the document.
 */
function poRows($$) {
  return $$('#po tr')
    .filter((tr) => tr.querySelector('#unit_price'))
    .map((tr) => {
      const tds = tr.querySelectorAll('td');
      return {
        tr,
        sku: (tds[0] ? tds[0].innerText : '').trim(),
        unit: tr.querySelector('#unit_price'),
        price: tr.querySelector('#price'),
        src: (tr.innerText.match(/ExtruFlex|Richmond Warehouse/) || [''])[0],
      };
    });
}

/** The PO block's per-vendor buttons are keyed by a numeric suffix; find ExtruFlex's. */
const extruFlexButton = ($$, idPrefix) =>
  $$(`#po button[id^=${idPrefix}_]`).find((b) => /ExtruFlex/.test(b.getAttribute('onclick') || ''));

/** The handling row's SKU cell, falling back to the whole row when the table is narrower. */
function rowSku(sel) {
  const tds = sel.closest('tr').querySelectorAll('td');
  return (tds[2] ? tds[2].innerText : sel.closest('tr').innerText).trim();
}

/**
 * One handling row as the sourcing rule wants to see it.
 *
 * The footage comes from the row's own #cut_length input — that id repeats per row, so it
 * is looked up inside the row rather than on the document. GALV lines are the only ones
 * where it changes the answer, and a missing length makes the rule answer Richmond.
 */
function rowInfo(sel) {
  const tr = sel.closest('tr');
  const cut = tr.querySelector('#cut_length');
  const raw = cut ? cut.value : '';
  const lengthFt = raw !== '' && Number.isFinite(parseFloat(raw)) ? parseFloat(raw) : null;
  return { sel, sku: rowSku(sel), description: tr.innerText, lengthFt, vendor: sel.value };
}

/* ------------------------------------------------------------------ the run */

/**
 * One armed run. Owns the status state, the badge, the armed pill, and the two stages.
 * Nothing here is constructed until the gate in init() has passed.
 */
function createRun(ctx) {
  const { $, $$, norm, el, sleep } = ctx.dom;
  const jq = window.jQuery; // the page's own jQuery: change events the site listens for
  const SS_KEY = sessionKey();

  // Key order here is the key order in the reported JSON. Keep it.
  const state = { stage: 'prep', ok: true, done: false, steps: [], warn: [], error: null, sources: '', po: [] };

  let dock = null;
  let badge = null;
  let armed = null;
  let armedLabel = '';

  const ARMED_TEXT = { running: 'Autoreview armed', done: 'Autoreview done', error: 'Autoreview failed' };

  const txt = (sel) => {
    const node = $(sel);
    return node ? norm(node.innerText) : '';
  };

  function ensureDock() {
    if (!dock) {
      dock = el('div', { id: DOCK_ID });
      (document.body || document.documentElement).append(dock);
    }
    return dock;
  }

  function paint() {
    const status = state.error ? 'error' : state.done ? 'done' : 'running';
    if (badge) badge.dataset.state = status;
    if (armed) {
      armed.dataset.state = status;
      armed.textContent = `${ARMED_TEXT[status]} · ${armedLabel}`;
    }
  }

  /** The visible "this page is being driven" pill. Informational only; it gates nothing. */
  function arm(label) {
    armedLabel = label;
    armed = el('div', { id: ARMED_ID, role: 'status' });
    ensureDock().append(armed);
    paint();
  }

  function report(extra) {
    Object.assign(state, extra || {});
    if (!badge) {
      badge = el('div', { id: BADGE_ID });
      ensureDock().append(badge);
    }
    paint();
    badge.textContent = JSON.stringify(state); // the whole contract: this element is the JSON
  }

  const step = (s) => {
    state.steps.push(s);
    report();
  };

  const fail = (msg) => {
    state.ok = false;
    state.error = msg;
    report();
    throw new Error('autoreview: ' + msg);
  };

  /** Poll a predicate the page's own scripts satisfy; fail with `label` on timeout. */
  async function waitFor(fn, ms, label) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      let v;
      try {
        v = fn();
      } catch {
        /* the page is mid-render; try again on the next tick */
      }
      if (v) return v;
      await sleep(300);
    }
    return fail('timeout waiting for ' + label);
  }

  const sourcesText = () => txt('#sc-host-shipment-sources').replace(/^Shipment Sources.*?Func /, '').slice(0, 400);

  /* ---------- stage A: prep on the review page ---------- */

  async function prep(p) {
    report({ stage: 'prep' });
    await waitFor(
      () => $('#richmondForAll') && $$('select.sourceCombo').length && $('#savechanges'),
      30000,
      'page',
    );
    await sleep(1500);

    const country = $('#shipping_country, [name=shipping_country]');
    if (country && country.value && !/^(US|USA|UNITED STATES)$/i.test(country.value)) {
      fail('shipping country is ' + country.value);
    }

    if (p.copyemail === '1') {
      const s = $('#shipping_email');
      const b = $('#billing_email');
      if (s && b && !s.value.trim() && b.value.trim()) {
        s.value = b.value.trim();
        step('shipping email copied from billing');
      }
    }

    // set= : comma list of fieldId~value, written into #fieldId on the review form
    // (e.g. set=shipping_city~POST%20FALLS for an address correction from the order comments)
    for (const kv of csv(p.set)) {
      const i = kv.indexOf('~');
      if (i < 0) continue;
      const id = kv.slice(0, i);
      const val = kv.slice(i + 1);
      const field = $('#' + id);
      if (!field) fail('set: field not found #' + id);
      if (field.value !== val) {
        field.value = val;
        jq(field).trigger('change');
        step('set ' + id + ' -> ' + val);
      } else step(id + ' already ' + val);
    }

    if (p.po) {
      const po = $('#po_number');
      if (po && !po.value.trim()) {
        po.value = p.po;
        step('PO# set ' + p.po);
      } else step('PO# already ' + (po ? po.value : '?'));
    }

    if (p.ship) {
      const st = $('#shipment_type');
      const opt = [...st.options].find((o) => o.text.toLowerCase().startsWith(p.ship.toLowerCase()));
      if (!opt) fail('shipment option not found: ' + p.ship);
      if (st.value !== opt.value) {
        st.value = opt.value;
        jq(st).trigger('change');
        step('shipment type -> ' + opt.text);
      } else step('shipment type already ' + opt.text);
    }

    const cb = $('#createboxes');
    if (cb && !cb.checked) {
      cb.click();
      step('Do not create boxes checked');
    }

    // Set For All -> ExtruFlex
    jq('#inventorySources').val('ExtruFlex');
    $('#richmondForAll').click();
    await waitFor(
      () => $$('select.sourceCombo').every((s) => s.value === 'ExtruFlex') && $('#source_ExtruFlex'),
      20000,
      'Set For All',
    );
    step('all rows -> ExtruFlex');

    // Richmond rows. Two sources, in this order:
    //   1. `rich=` — the reviewer naming SKUs explicitly, which always wins;
    //   2. the sourcing rule in orders/lib/sourcing.js, unless `norule=1` turns it off.
    // The rule is what removes the per-row hand-flipping; naming a SKU is the override.
    const flipped = [];
    for (const sku of csv(p.rich)) {
      const sels = $$('select.sourceCombo').filter((s) =>
        s.closest('tr').innerText.toUpperCase().includes(sku.toUpperCase()),
      );
      if (!sels.length) fail('rich SKU not found in handling table: ' + sku);
      for (const sel of sels) if (!flipped.includes(sel)) flipped.push(sel);
    }

    if (p.norule !== '1') {
      const ruled = [];
      const unsure = [];
      for (const sel of $$('select.sourceCombo')) {
        if (flipped.includes(sel)) continue;
        const info = rowInfo(sel);
        const verdict = classify(info);
        if (verdict.vendor !== RICHMOND) continue;
        flipped.push(sel);
        ruled.push(`${info.sku.slice(0, 24)} (${verdict.reason})`);
        if (verdict.uncertain || verdict.needsLength) unsure.push(`${info.sku.slice(0, 24)}: ${verdict.reason}`);
      }
      if (ruled.length) step('rule -> Richmond: ' + ruled.join(', '));
      // Surfaced rather than silent: these are the rows a reviewer should look at.
      if (unsure.length) state.warn.push('sourcing rule unsure: ' + unsure.join(' | '));
    }

    // Expected Richmond PO rows per SKU; the page's updateInventorySource is async and can be
    // lost, so apply, verify against the PO table, and re-apply (up to 3 rounds).
    const expected = {};
    flipped.forEach((s) => {
      const k = rowSku(s);
      expected[k] = (expected[k] || 0) + 1;
    });
    const richOk = () =>
      Object.keys(expected).every(
        (k) =>
          poRows($$).filter((r) => r.src === 'Richmond Warehouse' && r.sku.toUpperCase().includes(k.toUpperCase()))
            .length >= expected[k],
      );

    for (let round = 0; round < 3 && flipped.length; round++) {
      for (const sel of flipped) {
        sel.value = 'Richmond Warehouse';
        window.updateInventorySource(sel.id.split('_').pop(), 0);
        await sleep(2500);
      }
      const t0 = Date.now();
      while (Date.now() - t0 < 15000 && !richOk()) await sleep(500);
      if (richOk()) break;
      state.warn.push('richmond flip round ' + (round + 1) + ' incomplete, retrying');
    }
    if (flipped.length && !richOk()) fail('Richmond rows did not stick in PO table: ' + JSON.stringify(expected));
    if (flipped.length) {
      step('rows -> Richmond: ' + Object.entries(expected).map(([k, n]) => k + ' x' + n).join(', '));
    }

    await waitFor(() => poRows($$).some((r) => r.src === 'ExtruFlex'), 20000, 'PO table');
    await sleep(1500);
    jq('#po').show();

    // Price check on ExtruFlex lines, against the shared list
    step(`price list: ${LIST_NAME}, effective ${EFFECTIVE_DATE}`);
    const overrides = parseOverrides(p.price);
    const unmapped = [];
    const zeroed = [];
    for (const r of poRows($$)) {
      if (r.src !== 'ExtruFlex') continue;
      const have = parseFloat(r.unit.value) || 0;
      const verdict = lookupPrice(r.sku, overrides, { unitPrice: have });

      if (verdict.kind === 'ignore') continue;
      // A positive MISCSERVICE line means someone hand-wrote notes onto the PO.
      if (verdict.kind === 'stop') fail(verdict.reason);
      if (verdict.kind === 'unknown') {
        unmapped.push(r.sku + '@' + have);
        continue;
      }
      // A zero on a priced line reaches the vendor as a free item. Never sign that off.
      if (isZeroPriced(have) && verdict.price > 0) zeroed.push(r.sku);

      const want = verdict.price;
      if (Math.abs(have - want) > 0.0001) {
        r.unit.value = want.toFixed(2);
        window.changeQuantity(r.unit, window.orderid_cp);
        await waitFor(
          () => Math.abs(parseFloat(r.price.value) - want * parseFloat(r.tr.querySelector('#quantity').value)) < 0.05,
          15000,
          'price recalc ' + r.sku,
        );
        step('price ' + r.sku + ' ' + have + ' -> ' + want);
      } else step('price ok ' + r.sku + ' ' + have);
    }
    if (zeroed.length) {
      // Not overridable by strict=0: a $0.00 line on a PO is always wrong.
      report({ stage: 'zero_price' });
      fail('zero-priced ExtruFlex lines: ' + zeroed.join(' | '));
    }
    if (unmapped.length) {
      state.warn.push('no list price for: ' + unmapped.join(' | '));
      if (p.strict !== '0') {
        report({ stage: 'needs_price' });
        fail('needs_price');
      }
    }
    state.po = poRows($$).map((r) => r.sku.slice(0, 28) + ' ' + r.unit.value + ' ' + r.src);

    // Vendor comment
    if (p.comment || p.cut) {
      const btn = extruFlexButton($$, 'ad_comments');
      if (!btn) fail('ExtruFlex comments button not found');
      const n = btn.id.split('_').pop();
      const ta = $('#po_comments_' + n);
      let v = ta.value;
      let changed = false;
      // cut= : comma list of substrings; every comment line containing one is removed
      // (stale text, e.g. "PREPAY AND ADD")
      const cuts = csv(p.cut);
      if (cuts.length) {
        const kept = v.split('\n').filter((l) => !cuts.some((c) => l.toUpperCase().includes(c.toUpperCase())));
        if (kept.length !== v.split('\n').length) {
          v = kept.join('\n');
          changed = true;
        }
      }
      if (p.comment && !v.includes(p.comment)) {
        v = v.replace(/\s*$/, '\n') + p.comment + '\n';
        changed = true;
      }
      if (changed) {
        ta.value = v.replace(/^\n+/, '');
        window.addComments(window.orderid_cp, 'ExtruFlex', n);
        await sleep(2500);
        step('comments updated: ' + ta.value.replace(/\s+/g, ' ').slice(0, 120));
      } else step('comments unchanged');
    }

    if (p.dry === '1') {
      report({ stage: 'dry-done', done: true });
      return;
    }

    // Existing ExtruFlex PDF -> Delete PDF (never Cancel)
    const del = extruFlexButton($$, 'delete');
    if (del) {
      del.click();
      await waitFor(() => !$('#po button[id^=delete_]'), 15000, 'delete pdf');
      step('old PDF deleted');
    }

    // Generate PDF for ExtruFlex
    const gen = extruFlexButton($$, 'generate');
    if (!gen) fail('Generate PDF for ExtruFlex button not found');
    gen.click();
    await waitFor(() => /PDF generated for ExtruFlex/i.test(txt('#pdf_msg')), 30000, 'pdf generated');
    step('PDF generated');

    // Save Changes -> banner Yes -> reload (popup=0)
    sessionStorage.setItem(
      SS_KEY,
      JSON.stringify({ stage: 'saved', t: Date.now(), steps: state.steps, warn: state.warn, po: state.po }),
    );
    $('#savechanges').click();
    step('Save clicked');

    // The server sometimes answers the Yes with the same banner again; click Yes up to 5
    // times, ~12s apart.
    const t0 = Date.now();
    let yesClicks = 0;
    let lastYes = 0;
    while (Date.now() - t0 < SAVE_WINDOW_MS) {
      if (/Continue Reviewing/i.test(txt('#printErrors_show')) && Date.now() - lastYes > YES_GAP_MS && yesClicks < YES_MAX) {
        const y = $$('#printErrors_show button').find((b) => /^Yes$/.test(b.innerText.trim()));
        if (y) {
          y.click();
          yesClicks++;
          lastYes = Date.now();
          step('Yes clicked #' + yesClicks);
        }
      }
      if (/Order reviewed/i.test(txt('#printSuccessMSG_show')) || /popup=0/.test(location.search)) break;
      const err = txt('#printErrors_show');
      if (err && !/Continue Reviewing/i.test(err)) fail('save error: ' + err.slice(0, 160));
      await sleep(500);
    }
    report({ stage: 'saved' });

    // page normally reloads here (stage B runs from sessionStorage); if it does not within
    // 60s, try stage B in place
    await sleep(RELOAD_GRACE_MS);
    await send();
  }

  /* ---------- stage B: after reload, send the PO ---------- */

  async function send() {
    const saved = JSON.parse(sessionStorage.getItem(SS_KEY) || '{}');
    if (saved.steps) {
      state.steps = saved.steps.concat(state.steps);
      state.warn = saved.warn || [];
      state.po = saved.po || [];
    }
    report({ stage: 'send' });
    await waitFor(() => /Order reviewed/i.test(txt('#printSuccessMSG_show')), 40000, 'Order reviewed');
    step('Order reviewed confirmed');

    state.sources = sourcesText();
    if (!/ExtruFlex/.test(state.sources)) fail('no ExtruFlex source after save');

    const btn = await waitFor(
      () =>
        $$('#po button').find(
          (b) => /^Send PO$/.test(b.innerText.trim()) && /ExtruFlex/.test(b.getAttribute('onclick') || ''),
        ),
      40000,
      'Send PO button',
    );

    // Two duplicate guards, because a second PO to the vendor cannot be taken back.
    const again = $$('*').some((e) => e.children.length < 3 && /Send it again/.test(e.innerText || '') && e.offsetParent);
    if (again) fail('duplicate guard visible: PO already sent');
    if (/PO sent/i.test(txt('#pdf_msg'))) fail('pdf_msg already says PO sent');

    jq('#po').show();
    btn.click();
    await waitFor(() => /PO sent to ExtruFlex/i.test(txt('#pdf_msg')), 40000, 'PO sent');
    step('PO sent to ExtruFlex');
    sessionStorage.removeItem(SS_KEY);
    report({ stage: 'sent', done: true });
  }

  return { arm, prep, send };
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'automation.auto-review',
  title: 'Auto Review (rereview batch)',
  runAt: 'idle',
  pages: ['orders-review'],
  enabledByDefault: true,

  init(ctx) {
    const params = parseHash();
    const key = sessionKey();

    const pending = JSON.parse(sessionStorage.getItem(key) || 'null');
    const fresh = pending && Date.now() - pending.t < RESUME_WINDOW_MS;
    if (pending && !fresh) sessionStorage.removeItem(key);

    // Stage B resumes on the reload Save triggers, which is why it keys off the pending
    // record and popup=0 rather than the hash. Stage A needs the hash.
    const resuming = Boolean(fresh && pending.stage === 'saved' && /popup=0/.test(location.search));
    const arming = params.autoreview === '1';
    if (!resuming && !arming) return; // not armed: no styles, no nodes, no listeners

    ctx.style.add(css, { id: STYLE_ID });
    const run = createRun(ctx);

    if (resuming) {
      run.arm('send PO');
      run.send().catch((err) => ctx.log.error(err));
    } else {
      run.arm(params.dry === '1' ? 'prep · dry run' : 'prep');
      run.prep(params).catch((err) => ctx.log.error(err));
    }
  },
};
