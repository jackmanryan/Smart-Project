// ==UserScript==
// @name         Order Products Panel (layout-only fixes)
// @namespace    scx.order.products
// @version      1.0
// @description  Apply panel/product formatting fixes without altering color schemes (layout/spacing/structure only).
// @match        https://extranet.strip-curtains.com/*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor&priceCheck=true*
// @run-at       document-idle
// ==/UserScript==

(function () {
  // ---------- CSS (layout/structure only — no colors) ----------
  const CSS = `
  /* Inline title row: name · weight — toggle (no colors) */
  #products-list .op-titlebar{
    display:flex; align-items:center; gap:.6rem; flex-wrap:wrap; line-height:1.3;
  }
  #products-list .op-titlebar .name{ font-weight:700; }
  #products-list .op-titlebar .sep{ opacity:.6; } /* readability, not color change */
  #products-list .fixsku-toggle{ display:inline-flex; align-items:center; gap:.4em; }

  /* Use native checkbox (no custom colors) */
  #products-list .fixsku-label{ font-size:12px; user-select:none; }

  /* Fix SKU panel card: spacing only (no visible color) */
  #products-list .fixsku-panel{
    width:auto !important; float:none !important;
    padding:10px 12px !important; margin:8px 0 0 0 !important;
    border-radius:6px; border:1px solid transparent; /* reserve geometry without color */
  }

  /* Nested subparts table: wrapping & sizing only */
  #products-list td { overflow: visible; } /* avoid clipping children */
  #products-list .subparts-table{
    width:100%; max-width:100%; table-layout:auto;
    border-collapse:collapse; margin:6px 0 0;
  }
  #products-list .subparts-table th,
  #products-list .subparts-table td{
    white-space:normal !important; word-break:normal; overflow-wrap:break-word;
    hyphens:none; vertical-align:top; line-height:1.25;
  }
  /* Column minimums to prevent collapse (layout only) */
  #products-list .subparts-table th:nth-child(1),
  #products-list .subparts-table td:nth-child(1){ min-width:3.5ch; }  /* Qty */
  #products-list .subparts-table th:nth-child(2),
  #products-list .subparts-table td:nth-child(2){ min-width:16ch; }   /* SKU */
  #products-list .subparts-table th:nth-child(3),
  #products-list .subparts-table td:nth-child(3){ min-width:28ch; width:auto; } /* Desc */
  #products-list .subparts-table th:nth-child(4),
  #products-list .subparts-table td:nth-child(4){ min-width:12ch; }   /* Totals */
  #products-list .subparts-table th:nth-child(5),
  #products-list .subparts-table td:nth-child(5){ min-width:12ch; }   /* Price */

  @media (max-width: 540px){
    #products-list .subparts-table{ display:block; overflow-x:auto; }
  }

  /* Panel headings: centered & clickable (typography only) */
  .panel-heading._tm-enhanced{
    display:flex; align-items:center; justify-content:center; text-align:center;
    gap:.5rem; min-height:38px; font-size:16px; font-weight:700;
  }
  .panel-heading._tm-enhanced > *{ float:none !important; margin:0 !important; }
  .panel-heading.sc-clickable{ cursor:pointer; }
  .panel-heading._tm-enhanced .sc-titlewrap{ display:inline-flex; align-items:center; gap:.35rem; white-space:nowrap; }
  .panel-heading._tm-enhanced .sc-title, .panel-heading._tm-enhanced .sc-meta{ white-space:nowrap; }
  `;

  function injectCss(id, css){
    if (!document.getElementById(id)){
      const s = document.createElement('style'); s.id = id; s.textContent = css;
      document.head.appendChild(s);
    }
  }
  injectCss('op-layout-only-css', CSS);

  // ---------- helpers ----------
  const $  = (sel, root=document) => root.querySelector(sel);
  const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
  const hasCollapse = () => !!(window.jQuery && jQuery.fn && jQuery.fn.collapse);
  const txt = el => (el?.textContent || '').trim();

  function removeImmediateNextBR(node){
    const n = node.nextSibling;
    if (n && n.nodeType === 1 && n.tagName === 'BR') n.remove();
  }

  function extractWeightFromDetails(td) {
    // Prefer existing span.weight
    const wEl = td.querySelector('.op-titlebar .weight, .weight');
    if (wEl) return txt(wEl);

    // Fallback: parse subparts header "Total weight (97.748)"
    const sub = td.querySelector('table.subparts-table thead');
    if (sub) {
      const ths = Array.from(sub.rows?.[0]?.cells || []);
      const i = ths.findIndex(th => /total\s*weight/i.test(th.textContent));
      if (i >= 0) {
        const m = ths[i].textContent.match(/\(([^)]+)\)/);
        if (m && m[1]) return m[1].trim() + ' lbs';
      }
    }
    return '';
  }

  function findNameNode(td){
    // Prefer an existing titlebar .name
    const nameNode = td.querySelector('.op-titlebar .name, .name');
    if (nameNode) return nameNode;

    // Legacy: sometimes product name was in <strong>
    const legacy = td.querySelector('strong');
    if (legacy) return legacy;

    return null;
  }

  // Build or enhance inline titlebar (Name · Weight — [Fix SKU])
  function ensureTitleBar(tr){
    const td = tr.cells?.[0]; if (!td) return null;

    let bar = td.querySelector('.op-titlebar');
    const nameNode = findNameNode(td);
    if (!nameNode) return null;

    const weightText = extractWeightFromDetails(td);

    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'op-titlebar';
      nameNode.replaceWith(bar);
      removeImmediateNextBR(bar);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = txt(nameNode);
      bar.appendChild(nameSpan);
    }

    // Add weight if missing
    if (weightText && !bar.querySelector('.weight')) {
      const sep = document.createElement('span'); sep.className = 'sep'; sep.textContent = '·';
      const w = document.createElement('span'); w.className = 'weight'; w.textContent = weightText;
      bar.appendChild(sep); bar.appendChild(w);
    }

    // Add Fix SKU toggle if missing
    if (!bar.querySelector('.fixsku-toggle')) {
      const chkId = 'fixsku_chk_' + (tr.id || Math.random().toString(36).slice(2));
      const toggleWrap = document.createElement('span');
      toggleWrap.className = 'fixsku-toggle';
      toggleWrap.innerHTML = `
        <label for="${chkId}" class="fixsku-label-wrap" title="Show/Hide Fix Product controls">
          <input type="checkbox" id="${chkId}" />
          <span class="fixsku-label">Fix SKU</span>
        </label>`;
      bar.appendChild(document.createTextNode(' — '));
      bar.appendChild(toggleWrap);
      return toggleWrap.querySelector('input');
    }
    return bar.querySelector('.fixsku-toggle input[type="checkbox"]');
  }

  function moveEditButtonIntoPanel(tdDetails, panel){
    const triggerBtn = $$('.btn.btn-primary.btn-sm', tdDetails)
      .find(b=>/Edit Product Description/i.test(b.textContent));
    if (triggerBtn) panel.insertAdjacentElement('afterbegin', triggerBtn);
  }

  function cleanSkuPanel(panel){
    const input = panel.querySelector('input[type="text"]');
    if (input && !input.placeholder) input.placeholder = 'Fix Product SKU';
    const first = panel.firstChild;
    if (first && first.nodeType===3 && /Fix\s*Product\s*SKU/i.test(first.nodeValue||'')) first.remove();
  }

  function wireRow(tr){
    if (tr.dataset.opWired==='1') return;
    const tdDetails = tr.cells?.[0]; if (!tdDetails) return;
    const panel = tdDetails.querySelector('[id^="fixskubox_"]'); if (!panel) return;

    panel.classList.add('fixsku-panel');
    panel.setAttribute('aria-hidden','true');
    if (hasCollapse()) panel.classList.add('collapse'); else panel.hidden = true;

    moveEditButtonIntoPanel(tdDetails, panel);
    cleanSkuPanel(panel);

    const inputToggle = ensureTitleBar(tr);
    if (inputToggle){
      inputToggle.addEventListener('change', ()=>{
        const open = inputToggle.checked;
        panel.setAttribute('aria-hidden', String(!open));
        if (hasCollapse()) jQuery(panel).collapse(open ? 'show' : 'hide');
        else panel.hidden = !open;
      });
    }
    tr.dataset.opWired='1';
  }

  const PRODUCTS_SEL = '#products-list:not(.scx-activity-log)';

  function isActivityLogTable(tbl){
    const ths = Array.from(tbl.tHead?.rows?.[0]?.cells || [])
      .map(th => (th.textContent || '').trim().toLowerCase());
    return ths.includes('description') && (ths.includes('author') || ths.includes('date'));
  }

  function removeFedExChaseKeepUPS(){
    $$('table.table').forEach(tbl=>{
      const txtAll = tbl.textContent || '';
      const headThs = $$('thead th', tbl).map(th=>th.textContent.trim());
      if (headThs.length && /Total\s*FedEx\s*Weight/i.test(headThs[0])){
        (tbl.closest('.col-xs-4') || tbl.closest('.row') || tbl).remove(); return;
      }
      if (/UPS\s*Benchmark/i.test(txtAll) || /FedEx\s*Benchmark/i.test(txtAll) || /Chase\s*Price/i.test(txtAll)){
        const rows = $$('tr', tbl);
        for (let i=0;i<rows.length;i++){
          const t = rows[i].textContent.trim();
          if (/^Chase\s*Price/i.test(t)){ rows[i].remove(); if (rows[i+1]) rows[i+1].remove(); i++; continue; }
          if (/^FedEx\s*Benchmark/i.test(t) || /^FedEx/i.test(t.replace(/\s+/g,''))){ rows[i].remove(); if (rows[i+1]) rows[i+1].remove(); i++; continue; }
        }
      }
    });
  }

  function removePackageDetailsTable(){
    $$('table').forEach(tbl=>{
      const firstTh = $('thead th', tbl);
      if (firstTh && /^\s*Package\s*#\s*$/i.test(firstTh.textContent)){
        (tbl.closest('.col-xs-7') || tbl.closest('.row') || tbl).remove();
      }
    });
  }

  function removeWeightColumnFromProducts(){
    const products = document.querySelector(PRODUCTS_SEL);
    if (!products) return;
    if (products.classList.contains('scx-activity-log') || isActivityLogTable(products)) return;

    const headRow = products.tHead?.rows?.[0]; if (!headRow) return;
    let weightIdx = -1;
    Array.from(headRow.cells).forEach((th,i)=>{
      if (/^\s*Weight\s*$/i.test(th.textContent)) weightIdx=i;
    });
    if (weightIdx < 0) return;

    headRow.cells[weightIdx]?.remove();
    Array.from(products.tBodies || []).forEach(tb=>{
      Array.from(tb.rows || []).forEach(tr=> tr.cells[weightIdx]?.remove());
    });
  }

  // Fold the last subtotal row into header labels as "(value)"
  function foldInnerSubtotalsIntoHeaders(){
    $$(PRODUCTS_SEL + ' td:first-child table').forEach(tbl=>{
      if (tbl.dataset.folded==='1') return;
      const thead = tbl.tHead, tbody = tbl.tBodies?.[0];
      if (!thead || !tbody) return;
      const hdrRow = thead.rows?.[0]; if (!hdrRow) return;
      const ths = Array.from(hdrRow.cells);
      const rows = Array.from(tbody.rows);
      if (rows.length < 2) return;

      const last = rows[rows.length-1];
      const idxWeight = ths.findIndex(th=>/total\s*weight/i.test(th.textContent));
      const idxPrice  = ths.findIndex(th=>/part\s*price/i.test(th.textContent));

      const getCellTxt = i => (i>=0 && last.cells[i]) ? txt(last.cells[i]) : '';

      const wVal = getCellTxt(idxWeight);
      const pVal = getCellTxt(idxPrice);

      const setHdr = (i,val)=>{
        if (i<0 || !val) return;
        const base = ths[i].textContent.replace(/\s*\(.*\)\s*$/,'').trim();
        ths[i].textContent = `${base} (${val})`;
      };
      setHdr(idxWeight, wVal);
      setHdr(idxPrice,  pVal);

      last.remove();
      tbl.dataset.folded='1';
    });
  }

  // Panel headings: centered & clickable; also normalize crude titles
  function centerAndMakePanelHeadersClickable(){
    document.querySelectorAll('.panel-heading').forEach(hdr=>{
      if (hdr.dataset.scHdrDone==='1') return;
      hdr.classList.add('_tm-enhanced');

      // Normalize: extract a title + optional meta (remove trailing colon)
      const rawTextNodes = Array.from(hdr.childNodes).filter(n=>n.nodeType===3 && n.nodeValue.trim());
      if (rawTextNodes.length){
        const combined = rawTextNodes.map(n=>n.nodeValue).join(' ').replace(/\s+/g,' ').trim();
        rawTextNodes.forEach(n=>n.remove());
        let title = combined, meta = '';
        const m = combined.match(/^(.+?):\s*(.*)$/);
        if (m){ title = m[1].trim(); meta = m[2].trim(); }

        const wrap = document.createElement('span'); wrap.className='sc-titlewrap';
        const tSpan = document.createElement('span'); tSpan.className='sc-title'; tSpan.textContent = title;
        wrap.appendChild(tSpan);
        if (meta){
          const metaSpan = document.createElement('span'); metaSpan.className='sc-meta'; metaSpan.textContent = meta;
          wrap.appendChild(metaSpan);
        }
        const firstEl = hdr.querySelector('i,svg')?.nextSibling;
        if (firstEl) hdr.insertBefore(wrap, firstEl); else hdr.appendChild(wrap);
      }

      const hasOwnOnclick = !!hdr.getAttribute('onclick');
      const childToggle = hdr.querySelector('a[data-toggle], [data-target], [onclick], a[href], button[data-toggle], button[onclick]');
      if (hasOwnOnclick || childToggle){
        hdr.classList.add('sc-clickable');
        hdr.addEventListener('click',(ev)=>{
          const interactive = ev.target.closest('a,button,input,select,textarea,label');
          if (interactive) return;
          if (hasOwnOnclick) return;
          if (childToggle){
            childToggle.dispatchEvent(new MouseEvent('click',{bubbles:true, cancelable:true}));
          }
        });
      }
      hdr.dataset.scHdrDone='1';
    });
  }

  // Make the “Order Products” panel collapsible
  function wireOrderProductsCollapsible() {
    const productsTbl = document.getElementById('products-list');
    if (!productsTbl) return;

    const panel = productsTbl.closest('.panel');
    const header = panel?.querySelector('.panel-heading');
    const body   = panel?.querySelector('.panel-body');
    if (!panel || !header || !body || header.dataset.opCollapseWired === '1') return;

    if (!body.id) body.id = 'order-products-body';

    const canCollapse = !!(window.jQuery && jQuery.fn && jQuery.fn.collapse);
    if (canCollapse) {
      body.classList.add('collapse');
      jQuery(body).collapse({ toggle: false });
    } else {
      body.hidden = false; // default open
    }

    header.classList.add('_tm-enhanced', 'sc-clickable');
    header.addEventListener('click', (ev) => {
      if (ev.target.closest('a,button,input,select,textarea,label')) return;
      if (canCollapse) jQuery(body).collapse('toggle');
      else body.hidden = !body.hidden;
    }, { passive: true });

    header.dataset.opCollapseWired = '1';
  }

  // Auto-collapse certain panels by title (closed by default)
  function wirePanelsCollapsibleByTitles(titles = []) {
    const canCollapse = !!(window.jQuery && jQuery.fn && jQuery.fn.collapse);
    document.querySelectorAll('.panel').forEach(panel => {
      const heading = panel.querySelector(':scope > .panel-heading');
      const body    = panel.querySelector(':scope > .panel-body');
      if (!heading || !body) return;
      if (heading.dataset.scCollapseWired === '1') return;

      const textBits = [];
      heading.childNodes.forEach(n => {
        if (n.nodeType === 3) { const t = n.nodeValue.trim(); if (t) textBits.push(t); }
        else if (n.nodeType === 1 && n.matches('.sc-title,.sc-titlewrap,span,a')) {
          const t = (n.textContent || '').trim(); if (t) textBits.push(t);
        }
      });
      const headingText = textBits.join(' ').replace(/\s+/g,' ').trim().toLowerCase();

      const matched = titles.some(t => headingText.includes(t.toLowerCase()));
      if (!matched) return;

      if (!body.id) body.id = 'panel-body-' + Math.random().toString(36).slice(2);
      if (canCollapse) {
        body.classList.add('collapse');
        jQuery(body).collapse({ toggle: false });
        jQuery(body).collapse('hide');
      } else {
        body.hidden = true;
      }

      heading.classList.add('_tm-enhanced', 'sc-clickable');
      heading.addEventListener('click', (ev) => {
        if (ev.target.closest('a,button,input,select,textarea,label')) return;
        if (canCollapse) jQuery(body).collapse('toggle'); else body.hidden = !body.hidden;
      }, { passive: true });

      heading.dataset.scCollapseWired = '1';
    });
  }

  // Detect & normalize subparts tables (adds .subparts-table; removes width locks)
  function normalizeSubpartsTables(){
    $$('#products-list tbody tr td:first-child table').forEach(tbl=>{
      if (tbl.classList.contains('subparts-table')) return;

      const thead = tbl.tHead; if (!thead) return;
      const ths = Array.from(thead.rows?.[0]?.cells || []).map(th => th.textContent.trim().toLowerCase());

      const hasQty   = ths.some(t=>/^qty$/.test(t));
      const hasSku   = ths.some(t=>/^sku$/.test(t));
      const hasDesc  = ths.some(t=>/^description$/.test(t));
      const hasTw    = ths.some(t=>/^total\s*weight/i.test(t));
      const hasPrice = ths.some(t=>/^part\s*price/i.test(t));
      if (!(hasQty && hasSku && hasDesc && hasTw && hasPrice)) return;

      tbl.classList.add('subparts-table');
      tbl.querySelectorAll('[width], [style*="width"]').forEach(el=>{
        el.removeAttribute('width');
        if (el.style) el.style.width = '';
      });
    });
  }

  // ---------- run ----------
  function run(){
    // Products table rows
    $$('#products-list:not(.scx-activity-log) tbody tr').forEach(wireRow);
    removeWeightColumnFromProducts();
    foldInnerSubtotalsIntoHeaders();
    normalizeSubpartsTables();

    // side cleanups
    removeFedExChaseKeepUPS();
    removePackageDetailsTable();

    // headers + collapsers
    centerAndMakePanelHeadersClickable();
    wireOrderProductsCollapsible();
    wirePanelsCollapsibleByTitles(['Emails sent recently','Email Archives','Packages']);
  }

  run();
  new MutationObserver(()=>run()).observe(document.body, {childList:true, subtree:true});
})();
