/**
 * Tracking panel — layout restyle.
 *
 * Ported from legacy/userscripts/tracking-panel-layout-restyle-layout-only-color-inherit.user.js (v1.1.0).
 *
 * The site renders Shipments as a wide free-width table that overflows SideDock's drawer.
 * This rebuilds it into a fixed eight-column grid — Tracking # / Carrier · Method /
 * Status / Last Update / Location / Weight / Source / Actions — puts a strip of
 * Total / Packages / Status pills above it, wraps the table so it scrolls sideways
 * instead of pushing the drawer wider, and nudges SideDock whenever the geometry moves.
 *
 * Layout only: every colour is inherited, in the JS as much as in styles.css.
 *
 * Differences from the original, rather than hidden in the code:
 *
 *  - The column map is read from the site's own header *before* that header is replaced,
 *    and cached per table. The legacy script mapped afterwards, against its own labels,
 *    which is why Status and Location always rendered "—" and Carrier read "UPS · UPS".
 *    This is the one intentional behaviour change; see `columnsFor` below.
 *  - The private MutationObserver on the table body is `ctx.observe.onChange`, throttled,
 *    and each step of the sweep is idempotent so our own writes settle as a no-op pass.
 *  - Copy goes through `ctx.dom.copyText` (GM_setClipboard first, then the async
 *    clipboard API) instead of calling `navigator.clipboard` directly.
 *  - The `wrap._roBound` element expando is a WeakSet in closure state. The ResizeObserver
 *    itself stays: nothing in core watches element geometry.
 *  - The drawer nudge is still a `resize` event dispatched at the window, because that is
 *    what SideDock listens for; it is coalesced to one dispatch per frame.
 */

import css from './styles.css';

const STYLE_ID = 'orders-tracking-panel';

const SEL = {
  block: '#Shipments-Block',
  addBtn: '#addtracking_btn',
  addForm: '#AddTrackingNumberForm',
};

/** The eight columns the panel is rebuilt into, in order. Drives colgroup and header. */
const COLUMNS = [
  { cls: 'trk-col-num', label: 'Tracking #' },
  { cls: 'trk-col-car', label: 'Carrier / Method' },
  { cls: 'trk-col-status', label: 'Status' },
  { cls: 'trk-col-update', label: 'Last Update' },
  { cls: 'trk-col-loc', label: 'Location' },
  { cls: 'trk-col-wt', label: 'Weight' },
  { cls: 'trk-col-src', label: 'Source' },
  { cls: 'trk-col-act', label: 'Actions' },
];

const COLGROUP_HTML = COLUMNS.map((c) => `<col class="${c.cls}">`).join('');
const HEAD_HTML = `<tr>${COLUMNS.map((c) => `<th>${c.label}</th>`).join('')}</tr>`;

/* ------------------------------------------------------------------ helpers */

/**
 * Trim only — deliberately not ctx.dom.norm, which also collapses inner whitespace.
 * These strings are read back out of cells the site wrote.
 */
const text = (node) => (node?.textContent || '').trim();

/**
 * First number in a weight cell. Deliberately not ctx.dom.toNum, which strips every
 * non-digit before parsing: "12 lbs 4 oz" is 12 here and would be 124 there. A cell with
 * no number at all is 0, so one unreadable row cannot poison the panel total.
 */
function parseWeight(w) {
  if (!w) return 0;
  const m = String(w).match(/([\d.]+)/);
  return m ? parseFloat(m[1]) : 0;
}

const upsUrl = (num) => `https://wwwapps.ups.com/WebTracking/track?track=yes&trackNums=${encodeURIComponent(num)}`;

/** One headline status for the whole shipment set. */
function aggregateStatus(list) {
  // Anything returned, excepted or voided outranks everything else on the panel.
  if (list.some((s) => /returned|exception|void/i.test(s))) return 'Attention';
  if (list.length > 0 && list.every((s) => /delivered/i.test(s))) return 'Delivered';
  return 'In Transit / Pending';
}

/** Where the site's own header put each field. -1 for a field the site does not show. */
function mapCols(table) {
  const ths = table.tHead?.rows?.[0]?.cells || table.querySelectorAll('thead th');
  const find = (label) =>
    Array.from(ths || []).findIndex((th) => new RegExp(`\\b${label}\\b`, 'i').test((th.textContent || '').trim()));
  return {
    source: find('Source'),
    carrier: find('Carrier'),
    method: find('Method'),
    tracking: find('Tracking'),
    weight: find('Weight'),
    updated: find('Last\\s*Update'),
    status: find('Last\\s*Activity'),
    location: find('Current\\s*Location'),
  };
}

/** Has this thead already been replaced with ours? */
function headIsOurs(thead) {
  const cells = thead.rows?.[0]?.cells;
  if (!cells || cells.length !== COLUMNS.length) return false;
  return COLUMNS.every((c, i) => (cells[i].textContent || '').trim() === c.label);
}

/* ------------------------------------------------------------------ the panel */

function createTrackingPanel(ctx) {
  const { $, $$, el, copyText } = ctx.dom;

  /** Column order per table, captured before we overwrite the header. */
  const columnMaps = new WeakMap();
  /** Wrappers already under a ResizeObserver — was the `wrap._roBound` expando. */
  const sized = new WeakSet();

  let nudgeQueued = false;

  /**
   * SideDock recalculates the drawer width on window `resize`; dispatching one is the
   * whole handshake. Coalesced to a frame, as the legacy rAF calls were.
   */
  function nudgeDrawer() {
    if (nudgeQueued) return;
    nudgeQueued = true;
    requestAnimationFrame(() => {
      nudgeQueued = false;
      window.dispatchEvent(new Event('resize'));
    });
  }

  /**
   * The site's column order, cached per table.
   *
   * It has to be read before `relayout` replaces the header, or the lookups run against
   * our own labels: "Last Activity" and "Current Location" would never match and both
   * "Carrier" and "Method" would resolve to the single "Carrier / Method" column. The
   * cache also keeps rows the site appends *after* the rewrite mapping the same way as
   * the rows that were there first.
   */
  function columnsFor(table) {
    const cached = columnMaps.get(table);
    if (cached) return cached;
    const map = mapCols(table);
    // A table whose header has not rendered yet maps to nothing; do not cache that.
    if (Object.values(map).some((i) => i >= 0)) columnMaps.set(table, map);
    return map;
  }

  /* --- header strip --------------------------------------------------------- */

  function ensureHead(container) {
    let head = $('.trk-head', container);
    if (head) return head;

    head = document.createElement('div');
    head.className = 'trk-head';

    const pills = document.createElement('div');
    pills.className = 'trk-pills';
    pills.innerHTML = `
      <span class="pill" id="trk-pill-total"><span class="label">Total:</span><span class="value">—</span></span>
      <span class="pill" id="trk-pill-pkg"><span class="label">Packages:</span><span class="value">—</span></span>
      <span class="pill" id="trk-pill-status"><span class="label">Status:</span><span class="value">—</span></span>
    `;

    const actions = document.createElement('div');
    actions.className = 'trk-actions';

    // The site's own Add Tracking button is moved, not copied, so its handlers come with it.
    const addBtn = $(SEL.addBtn, container);
    if (addBtn) {
      addBtn.textContent = addBtn.textContent.replace(/\s+/g, ' ').trim() || 'Add Tracking';
      addBtn.style.margin = '0';
      actions.appendChild(addBtn);
    }

    head.append(pills, actions);
    container.prepend(head);
    return head;
  }

  /**
   * Recompute the three pills. Returns true when a value actually changed.
   *
   * The writes are conditional because this runs on every mutation batch: an
   * unconditional `textContent =` is itself a childList mutation and would keep the
   * sweep re-triggering itself.
   */
  function refreshTotals(container, table) {
    const rows = Array.from(table.tBodies[0]?.rows || []).filter((tr) => !$('td[colspan]', tr));
    const weight = rows.reduce((sum, tr) => sum + parseWeight(text($('td.trk-col-wt', tr))), 0);
    const statuses = rows.map((tr) => text($('td.trk-col-status', tr)));

    let changed = false;
    const setPill = (sel, value) => {
      const node = $(sel, container);
      if (!node || node.textContent === value) return;
      node.textContent = value;
      changed = true;
    };

    setPill('#trk-pill-total .value', weight ? `${weight.toFixed(2)} LBS` : '—');
    setPill('#trk-pill-pkg .value', String(rows.length));
    setPill('#trk-pill-status .value', aggregateStatus(statuses));
    return changed;
  }

  /* --- rows ----------------------------------------------------------------- */

  function actionButton(label, onClick) {
    return el('button', { type: 'button', class: 'btn', onClick }, label);
  }

  /** Rebuild one shipment row into the eight canonical cells. */
  function transformRow(tr, idx) {
    const tds = Array.from(tr.cells);
    const safe = (i) => (i >= 0 && i < tds.length ? tds[i] : null);

    const tdSrc = safe(idx.source);
    const tdCar = safe(idx.carrier);
    const tdMeth = safe(idx.method);
    const tdNum = safe(idx.tracking);
    const tdWt = safe(idx.weight);
    const tdUpd = safe(idx.updated);
    const tdStat = safe(idx.status);
    const tdLoc = safe(idx.location);

    const numAnchor = tdNum ? $('a[href]', tdNum) : null;

    // The site's Void button lives in the tracking cell and moves to Actions below. The
    // tracking cell is cloned before that move, so the clone keeps an inert copy of the
    // button; only the moved original stays wired to the site's handler. Kept as the
    // legacy script had it — changing it would change what the panel shows.
    const existingVoid = tdNum ? $('button[id^="voidups-"]', tdNum) : null;
    if (existingVoid) {
      existingVoid.style.display = '';
      existingVoid.style.margin = '0';
    }

    const mk = (cls, nodeOrHtml) => {
      const td = document.createElement('td');
      if (cls) td.className = cls;
      if (nodeOrHtml instanceof Node) td.appendChild(nodeOrHtml);
      else if (nodeOrHtml != null) td.innerHTML = nodeOrHtml;
      return td;
    };

    // A clone of the whole original <td>, nested inside the new one, exactly as the
    // legacy script left it: the site puts links and badges in there and this keeps them.
    const tdTracking = mk('trk-col-num', tdNum ? tdNum.cloneNode(true) : document.createTextNode('—'));

    const carrierTxt = text(tdCar);
    const methodTxt = text(tdMeth);
    const tdCarrier = mk('trk-col-car', `${carrierTxt || '—'}${methodTxt ? ' · ' + methodTxt : ''}`);

    const tdStatus = mk('trk-col-status', tdStat ? tdStat.innerHTML : '—');
    const tdUpdate = mk('trk-col-update', tdUpd ? tdUpd.innerHTML : '—');
    const tdLocation = mk('trk-col-loc', tdLoc ? tdLoc.innerHTML : '—');
    const tdWeight = mk('trk-col-wt', tdWt ? tdWt.innerHTML : '—');
    const tdSource = mk('trk-col-src', tdSrc ? tdSrc.innerHTML : '—');

    const tdActions = mk('trk-col-act trk-actions', '');
    tdActions.append(
      actionButton('Track', () => {
        // The anchor is the detached original, kept alive by this closure.
        const tn = text(numAnchor);
        const href = numAnchor?.getAttribute('href') || upsUrl(tn);
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
      }),
      actionButton('Copy', async () => {
        const tn = text(numAnchor);
        if (tn) await copyText(tn);
      }),
    );
    if (existingVoid) tdActions.append(existingVoid);

    tr.innerHTML = '';
    tr.append(tdTracking, tdCarrier, tdStatus, tdUpdate, tdLocation, tdWeight, tdSource, tdActions);
    tr.dataset.trkTransformed = '1';
  }

  /**
   * Bring a table up to the canonical layout. Returns true when anything was written.
   *
   * Every step is guarded, so calling this on an already-laid-out table touches nothing.
   * The legacy version rebuilt the colgroup and the header unconditionally, which was
   * safe under its tbody-scoped observer and would loop under the shared one.
   */
  function relayout(table) {
    let changed = false;

    if (!table.classList.contains('trk')) {
      table.classList.add('trk');
      changed = true;
    }

    // Canonical colgroup: header and body lock to the same widths.
    let colgroup = $('colgroup', table);
    if (!colgroup?.firstElementChild?.classList.contains(COLUMNS[0].cls)) {
      colgroup?.remove();
      colgroup = document.createElement('colgroup');
      colgroup.innerHTML = COLGROUP_HTML;
      table.insertBefore(colgroup, table.firstChild);
      changed = true;
    }

    // Read the site's column order before the header that describes it is replaced.
    const idx = columnsFor(table);

    let thead = table.tHead || $('thead', table);
    if (!thead) {
      thead = document.createElement('thead');
      table.insertBefore(thead, colgroup.nextSibling);
      changed = true;
    }
    if (!headIsOurs(thead)) {
      thead.innerHTML = HEAD_HTML;
      changed = true;
    }

    const tbody = table.tBodies[0] || $('tbody', table);
    if (!tbody) return changed;

    for (const tr of Array.from(tbody.rows)) {
      if (tr.dataset.trkTransformed === '1') continue;
      // "No shipments" and other full-width rows are left exactly as the site wrote them.
      if ($('td[colspan]', tr)) {
        tr.dataset.trkTransformed = '1';
        continue;
      }
      transformRow(tr, idx);
      changed = true;
    }
    return changed;
  }

  /* --- block wiring --------------------------------------------------------- */

  /** Toggle the site's manual Add Tracking form by flipping display in its style attr. */
  function bindAddForm(block) {
    const addBtn = $(SEL.addBtn, block);
    const addForm = $(SEL.addForm, block);
    if (!addBtn || !addForm || addBtn.dataset.trkBound) return;

    addBtn.addEventListener(
      'click',
      (e) => {
        e.preventDefault();
        const st = addForm.getAttribute('style') || '';
        if (/display\s*:\s*none/.test(st)) {
          addForm.setAttribute('style', st.replace(/display\s*:\s*none;?/, '').trim());
        } else {
          addForm.setAttribute('style', (st + '; display:none;').replace(/^;+\s*/, ''));
        }
        // A style attribute change is not a childList change, so the shared observer
        // never sees this: the drawer has to be told about it here.
        nudgeDrawer();
      },
      { passive: false },
    );
    addBtn.dataset.trkBound = '1';
  }

  /** Tell SideDock when the table or the add form changes size. */
  function watchSize(block, wrap) {
    if (sized.has(wrap)) return;
    sized.add(wrap);
    const ro = new ResizeObserver(nudgeDrawer);
    ro.observe(wrap);
    const addForm = $(SEL.addForm, block);
    if (addForm) ro.observe(addForm);
  }

  /** One-time setup for a Tracking block. Returns its table, or null if not rendered. */
  function setUp(block) {
    const table = $('table', block);
    if (!table) return null;

    ensureHead(block);

    let wrap = $('.trk-table-wrap', block);
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'trk-table-wrap';
      table.before(wrap);
      wrap.appendChild(table);
    }

    relayout(table);
    refreshTotals(block, table);
    bindAddForm(block);
    watchSize(block, wrap);

    block.dataset.trkStyled = '1';
    nudgeDrawer();
    return table;
  }

  /**
   * Set the block up on first sight, keep it in step afterwards.
   *
   * A block whose table has not rendered yet stays unmarked and is retried on the next
   * sweep — the legacy script got that for free by re-running on every mutation.
   */
  function handleBlock(block) {
    if (block.dataset.trkStyled !== '1') {
      setUp(block);
      return;
    }
    const table = $('table.trk', block);
    if (!table) return;
    const rowsChanged = relayout(table);
    const totalsChanged = refreshTotals(block, table);
    if (rowsChanged || totalsChanged) nudgeDrawer();
  }

  return {
    handleBlock,
    sweep: () => $$(SEL.block).forEach(handleBlock),
  };
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'orders.tracking-panel',
  title: 'Tracking panel layout',
  runAt: 'idle',
  pages: [], // the legacy @match was the whole extranet; its excludes are ctx.page.isExcluded
  enabledByDefault: true,

  init(ctx) {
    ctx.style.add(css, { id: STYLE_ID });

    const panel = createTrackingPanel(ctx);

    // Present now, rendered later, or moved into the drawer by SideDock.
    ctx.observe.each(SEL.block, panel.handleBlock);

    // Was a MutationObserver on the table body. Rows arrive after the panel renders and
    // the site re-renders them after an add or a void, so the sweep has to repeat; it is
    // throttled because it runs on every mutation batch in the document, and it is a
    // no-op once the panel is settled.
    ctx.observe.onChange(ctx.dom.throttle(panel.sweep, 120));
  },
};
