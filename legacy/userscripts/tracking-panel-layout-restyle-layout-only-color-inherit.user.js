// ==UserScript==
// @name         Tracking Panel — Layout Restyle (layout-only; color-inherit)
// @namespace    scx.tracking.layout
// @version      1.1.0
// @description  Re-layout the Tracking panel (no colors). Fix overflow; auto-size with SideDock.
// @match        https://extranet.strip-curtains.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
  'use strict';

  const SEL = {
    block: '#Shipments-Block',
    table: '#Shipments-Block table',
    addBtn:  '#addtracking_btn',
    addForm: '#AddTrackingNumberForm'
  };

  const onReady = (fn) => (document.readyState !== 'loading')
    ? fn()
    : document.addEventListener('DOMContentLoaded', fn, { once:true });

  /* ---------------- CSS: layout-only; inherit colors ---------------- */
  GM_addStyle(`
/* Header pills */
${SEL.block} .trk-head{ display:flex; align-items:center; justify-content:space-between; gap:8px; flex-wrap:wrap; margin:6px 0 8px; }
${SEL.block} .trk-pills{ display:flex; gap:8px; flex-wrap:wrap; }
${SEL.block} .trk-pills .pill{ display:inline-flex; align-items:center; gap:6px; padding:4px 8px; border:1px solid currentColor; border-radius:14px; font-size:12px; line-height:1.1; }
${SEL.block} .trk-pills .pill .label{ opacity:.75; margin-right:2px; }

/* Actions area (keeps your existing button) */
${SEL.block} .trk-actions{ display:flex; gap:8px; align-items:center; }
${SEL.block} .trk-actions .btn{ font-size:12px; line-height:1.15; padding:4px 10px; }

/* Table wrapper and sizing */
${SEL.block} .trk-table-wrap{ overflow-x:auto; overflow-y:hidden; width:100%; }

/* Real colgroup widths (tighter than v1.0) */
${SEL.block} table.trk{ width:100%!important; table-layout:fixed; border-collapse:collapse; background:transparent!important; border:0!important; }
${SEL.block} table.trk col.trk-col-num     { width:18ch; }  /* Tracking # */
${SEL.block} table.trk col.trk-col-car     { width:18ch; }  /* Carrier · Method */
${SEL.block} table.trk col.trk-col-status  { width:18ch; }
${SEL.block} table.trk col.trk-col-update  { width:16ch; }
${SEL.block} table.trk col.trk-col-loc     { width:24ch; }
${SEL.block} table.trk col.trk-col-wt      { width:10ch; }
${SEL.block} table.trk col.trk-col-src     { width:16ch; }
${SEL.block} table.trk col.trk-col-act     { width:20ch; }

${SEL.block} table.trk thead:not(:first-of-type){ display:none!important; }
${SEL.block} table.trk th, ${SEL.block} table.trk td{ padding:6px 8px!important; vertical-align:middle; box-sizing:border-box; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
${SEL.block} table.trk th{ text-align:center; font-size:12px; font-weight:600; }

/* Clamp bubble widths so they don't force wide cells */
${SEL.block} .tm-bubble, ${SEL.block} .tm-bubble--order-link{ display:block; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
${SEL.block} .tm-bubble--order-link a{ display:block!important; max-width:100%; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }

/* Actions cell */
${SEL.block} td.trk-col-act .btn{ font-size:12px; padding:2px 8px; margin-right:6px; }
${SEL.block} td.trk-col-act .btn:last-child{ margin-right:0; }

/* Keep Location readable but clipped */
${SEL.block} td.trk-col-loc{ min-width:0; }

/* Manual Add-Tracking form should never overflow the drawer */
${SEL.block} ${SEL.addForm}{ max-width:100%!important; width:100%!important; }
${SEL.block} ${SEL.addForm} table{ width:100%!important; table-layout:fixed; }
${SEL.block} ${SEL.addForm} th, ${SEL.block} ${SEL.addForm} td{ padding:6px 8px!important; }
${SEL.block} ${SEL.addForm} select, ${SEL.block} ${SEL.addForm} input{ width:100%!important; }
`);

  /* ---------------- helpers ---------------- */
  const text = el => (el ? (el.textContent || '').trim() : '');
  const parseWeight = (w) => {
    if (!w) return 0;
    const m = String(w).match(/([\d.]+)/);
    return m ? parseFloat(m[1]) : 0;
  };
  const upsUrl = (num) =>
    `https://wwwapps.ups.com/WebTracking/track?track=yes&trackNums=${encodeURIComponent(num)}`;

  const aggregateStatus = (list) => {
    const anyAttention = list.some(s=>/returned|exception|void/i.test(s));
    const allDelivered = list.length>0 && list.every(s=>/delivered/i.test(s));
    if (anyAttention) return { label:'Attention', kind:'bad' };
    if (allDelivered) return { label:'Delivered', kind:'ok' };
    return { label:'In Transit / Pending', kind:'warn' };
  };

  const nudgeDrawer = () => {
    // Works with your SideDock (it recalculates on window 'resize')
    window.dispatchEvent(new Event('resize'));
  };

  function mapCols(table) {
    const ths = table.tHead?.rows?.[0]?.cells || table.querySelectorAll('thead th');
    const find = (label) =>
      Array.from(ths || []).findIndex(th =>
        new RegExp(`\\b${label}\\b`, 'i').test((th.textContent || '').trim())
      );
    return {
      source:   find('Source'),
      carrier:  find('Carrier'),
      method:   find('Method'),
      tracking: find('Tracking'),
      weight:   find('Weight'),
      updated:  find('Last\\s*Update'),
      status:   find('Last\\s*Activity'),
      location: find('Current\\s*Location')
    };
  }

  function ensureHead(container) {
    let head = container.querySelector('.trk-head');
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
    const addBtn = container.querySelector(SEL.addBtn);
    if (addBtn && !actions.querySelector('#addtracking_btn')) {
      addBtn.textContent = addBtn.textContent.replace(/\s+/g,' ').trim() || 'Add Tracking';
      addBtn.style.margin = '0';
      actions.appendChild(addBtn);
    }

    head.append(pills, actions);
    container.prepend(head);
    return head;
  }

  function refreshTotals(container, table) {
    const rows = Array.from(table.tBodies[0]?.rows || [])
      .filter(tr => !tr.querySelector('td[colspan]'));

    const w = rows.reduce((s, tr) => s + parseWeight(text(tr.querySelector('td.trk-col-wt'))), 0);
    const statuses = rows.map(tr => text(tr.querySelector('td.trk-col-status')));
    const agg = aggregateStatus(statuses);

    const pillTotal  = container.querySelector('#trk-pill-total .value');
    const pillPkg    = container.querySelector('#trk-pill-pkg .value');
    const pillStatus = container.querySelector('#trk-pill-status .value');

    if (pillTotal)  pillTotal.textContent  = w ? `${w.toFixed(2)} LBS` : '—';
    if (pillPkg)    pillPkg.textContent    = String(rows.length);
    if (pillStatus) pillStatus.textContent = agg.label;
  }

  function relayout(table) {
    table.classList.add('trk');

    // Canonical colgroup (header/body lock widths)
    let cg = table.querySelector('colgroup');
    if (cg) cg.remove();
    cg = document.createElement('colgroup');
    cg.innerHTML = `
      <col class="trk-col-num">
      <col class="trk-col-car">
      <col class="trk-col-status">
      <col class="trk-col-update">
      <col class="trk-col-loc">
      <col class="trk-col-wt">
      <col class="trk-col-src">
      <col class="trk-col-act">
    `;
    table.insertBefore(cg, table.firstChild);

    // Header in target order
    let thead = table.tHead || table.querySelector('thead');
    if (!thead) { thead = document.createElement('thead'); table.insertBefore(thead, cg.nextSibling); }
    thead.innerHTML = `
      <tr>
        <th>Tracking #</th>
        <th>Carrier / Method</th>
        <th>Status</th>
        <th>Last Update</th>
        <th>Location</th>
        <th>Weight</th>
        <th>Source</th>
        <th>Actions</th>
      </tr>
    `;

    const idx = mapCols(table);
    const tbody = table.tBodies[0] || table.querySelector('tbody');
    if (!tbody) return;

    Array.from(tbody.rows).forEach(tr => {
      if (tr.querySelector('td[colspan]')) { tr.dataset.trkTransformed = '1'; return; }
      if (tr.dataset.trkTransformed === '1') return;

      const tds = Array.from(tr.cells);
      const safe = (i) => (i >= 0 && i < tds.length) ? tds[i] : null;

      const tdSrc   = safe(idx.source);
      const tdCar   = safe(idx.carrier);
      const tdMeth  = safe(idx.method);
      const tdNum   = safe(idx.tracking);
      const tdWt    = safe(idx.weight);
      const tdUpd   = safe(idx.updated);
      const tdStat  = safe(idx.status);
      const tdLoc   = safe(idx.location);

      const numAnchor = tdNum ? tdNum.querySelector('a[href]') : null;
      const existingVoid = tdNum ? tdNum.querySelector('button[id^="voidups-"]') : null;
      if (existingVoid) { existingVoid.style.display = ''; existingVoid.style.margin='0'; }

      const mk = (cls, nodeOrHTML) => {
        const td = document.createElement('td');
        if (cls) td.className = cls;
        if (nodeOrHTML instanceof Node) td.appendChild(nodeOrHTML);
        else if (nodeOrHTML != null) td.innerHTML = nodeOrHTML;
        return td;
      };

      const tdTracking = mk('trk-col-num', tdNum ? tdNum.cloneNode(true) : document.createTextNode('—'));

      const carrierTxt = text(tdCar);
      const methodTxt  = text(tdMeth);
      const tdCarrier  = mk('trk-col-car', `${carrierTxt || '—'}${methodTxt ? ' · ' + methodTxt : ''}`);

      const tdStatus   = mk('trk-col-status', tdStat ? tdStat.innerHTML : '—');
      const tdUpdate   = mk('trk-col-update', tdUpd ? tdUpd.innerHTML : '—');
      const tdLocation = mk('trk-col-loc', tdLoc ? tdLoc.innerHTML : '—');
      const tdWeight   = mk('trk-col-wt', tdWt ? tdWt.innerHTML : '—');
      const tdSource   = mk('trk-col-src', tdSrc ? tdSrc.innerHTML : '—');

      const tdActions  = mk('trk-col-act trk-actions', '');
      const bTrack = document.createElement('button');
      bTrack.type='button'; bTrack.className='btn'; bTrack.textContent='Track';
      bTrack.addEventListener('click', () => {
        const tn = (numAnchor?.textContent || '').trim();
        const href = numAnchor?.getAttribute('href') || upsUrl(tn);
        if (href) window.open(href, '_blank', 'noopener,noreferrer');
      });
      const bCopy = document.createElement('button');
      bCopy.type='button'; bCopy.className='btn'; bCopy.textContent='Copy';
      bCopy.addEventListener('click', async () => {
        const tn = (numAnchor?.textContent || '').trim();
        if (tn) await navigator.clipboard.writeText(tn);
      });
      tdActions.append(bTrack, bCopy);
      if (existingVoid) tdActions.append(existingVoid);

      tr.innerHTML = '';
      tr.append(tdTracking, tdCarrier, tdStatus, tdUpdate, tdLocation, tdWeight, tdSource, tdActions);
      tr.dataset.trkTransformed = '1';
    });
  }

  function transformTrackingBlock(block) {
    if (!block || block.dataset.trkStyled === '1') return;
    const origTable = block.querySelector('table');
    if (!origTable) return;

    ensureHead(block);

    let wrap = block.querySelector('.trk-table-wrap');
    if (!wrap) {
      wrap = document.createElement('div');
      wrap.className = 'trk-table-wrap';
      origTable.before(wrap);
      wrap.appendChild(origTable);
    }

    relayout(origTable);
    refreshTotals(block, origTable);

    // Toggle original add form
    const addBtn  = block.querySelector(SEL.addBtn);
    const addForm = block.querySelector(SEL.addForm);
    if (addBtn && addForm && !addBtn.dataset.trkBound) {
      addBtn.addEventListener('click', (e) => {
        e.preventDefault();
        const st = (addForm.getAttribute('style') || '');
        if (/display\s*:\s*none/.test(st)) {
          addForm.setAttribute('style', st.replace(/display\s*:\s*none;?/,'').trim());
        } else {
          addForm.setAttribute('style', (st + '; display:none;').replace(/^;+\s*/,''));
        }
        requestAnimationFrame(nudgeDrawer);
      }, { passive:false });
      addBtn.dataset.trkBound = '1';
    }

    // Keep geometry synchronized (rows change, add form toggled, etc.)
    const tbody = origTable.tBodies[0] || origTable.querySelector('tbody');
    if (tbody && !tbody.dataset.trkObserved) {
      const mo = new MutationObserver(() => {
        relayout(origTable);
        refreshTotals(block, origTable);
        requestAnimationFrame(nudgeDrawer);
      });
      mo.observe(tbody, { childList:true, subtree:false });
      tbody.dataset.trkObserved = '1';
    }

    // ResizeObserver → tell SideDock when width changes
    if (!wrap._roBound) {
      const ro = new ResizeObserver(() => requestAnimationFrame(nudgeDrawer));
      ro.observe(wrap);
      if (addForm) ro.observe(addForm);
      wrap._roBound = true;
    }

    block.dataset.trkStyled = '1';
    requestAnimationFrame(nudgeDrawer);
  }

  function run() {
    document.querySelectorAll(SEL.block).forEach(transformTrackingBlock);
  }

  onReady(() => {
    run();
    new MutationObserver(run).observe(document.documentElement, { childList:true, subtree:true });
  });
})();
