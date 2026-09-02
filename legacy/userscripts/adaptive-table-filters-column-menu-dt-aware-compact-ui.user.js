// ==UserScript==
// @name         Adaptive Table Filters + Column Menu (DT-aware, compact UI)
// @namespace    scx.tables.filters
// @version      3.5.0
// @description  DT-aware filters + column visibility with robust Reset / Full Reset. Numbers & dates = range; labels/IDs = multi-select (gated). Per-table persistence. Compact buttons. Works with hidden columns and DataTables redraws.
// @match        https://extranet.strip-curtains.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// @noframes
// ==/UserScript==

(() => {
  'use strict';

  /* ---------------- Config ---------------- */
  const TABLE_SELECTORS = [
    '#dataTable-orders',
    'table[id^="dataTable-"]',
    'table[data-colmenu]',
    'table.dataTable'
  ];

  // LocalStorage namespaces
  const LS_NS_COLS   = 'scx.colmenu.v1';
  const LS_NS_FILTER = 'scx.filters.v3';

  // Behavior
  const RESET_FILTERS_ON_LOAD = true; // clear filter modifiers on load; columns persist
  const DISABLE_TEXT_FILTER   = true; // enforce: no free-text UI

  // Categorical gating
  const CAT_MIN_COUNT         = 2; // “pair” = count >= 2
  const MIN_DUPLICATE_BUCKETS = 2; // require at least 2 such “pairs”
  const MIN_DISTINCT_FOR_MENU = 3; // and ≥3 distinct normalized values in the column

  // Normalization for categorical bucketing (case/whitespace-insensitive)
  const NORM = v => String(v ?? '').trim().replace(/\s+/g,' ').toLowerCase();

  /* ---------------- CSS ---------------- */
  const CSS = `
:root{ --scx-accent:#3b82f6; }
.scx-col-hidden,.scx-row-hidden,.scx-hidden{ display:none !important; }
.scx-slot{ display:inline-flex; align-items:center; gap:.25rem; margin-left:.35rem; }
.scx-anchor{ position:relative; display:inline-block; vertical-align:middle; }
.scx-btn{
  position:relative; display:inline-flex; align-items:center; justify-content:center;
  width:32px; height:32px; border-radius:8px; cursor:pointer; padding:0;
  border:1px solid rgba(0,0,0,.15); background:#fff; color:#222;
}
.scx-btn svg{ width:18px; height:18px; fill:currentColor; }
.scx-btn:focus{ outline:2px solid #6aa9ff; outline-offset:2px; }
.scx-btn[data-tip]:hover::after,.scx-btn[data-tip]:focus-visible::after{
  content:attr(data-tip); position:absolute; bottom:110%; left:50%; transform:translateX(-50%);
  background:#111; color:#fff; padding:.25rem .5rem; border-radius:.35rem; white-space:nowrap;
  font-size:.75rem; box-shadow:0 6px 18px rgba(0,0,0,.2); pointer-events:none; z-index:2147483001;
}
.scx-btn[data-tip]:hover::before,.scx-btn[data-tip]:focus-visible::before{
  content:''; position:absolute; bottom:100%; left:50%; transform:translateX(-50%);
  border:6px solid transparent; border-top-color:#111;
}
.scx-panel{
  position:absolute; right:0; top:110%; z-index:2147483000;
  min-width:280px; max-width:520px; padding:.6rem .6rem .7rem; border-radius:.6rem;
  border:1px solid rgba(0,0,0,.15); background:#fff; color:#111;
  box-shadow:0 12px 32px rgba(0,0,0,.18); display:none;
}
.scx-panel.open{ display:block; }
.scx-head{ display:flex; align-items:center; gap:.5rem; }
.scx-head h4{ margin:.15rem 0 .35rem; font-size:.92rem; font-weight:600; }
.scx-actions{ margin-left:auto; display:inline-flex; gap:.35rem; }
.scx-mini{
  border:1px solid rgba(0,0,0,.2); background:inherit; padding:.16rem .42rem;
  border-radius:.35rem; cursor:pointer; font-size:.82rem;
}
.scx-mini.danger{ border-color:rgba(220,38,38,.5); color:#b91c1c; }
.scx-subtle{ opacity:.8; font-size:.78rem; margin:.15rem 0 .35rem; }

.scx-filter-col{ border-top:1px solid rgba(0,0,0,.08); padding-top:.4rem; margin-top:.4rem; }
.scx-row{ display:flex; align-items:center; gap:.5rem; flex-wrap:wrap; }
.scx-flabel{ flex:0 1 auto; min-width:120px; font-size:.9rem; font-weight:600; line-height:1.1; }
.scx-ftype{ margin-left:auto; font-size:.75rem; opacity:.65; }

.scx-ctrl{ flex:0 0 auto; display:inline-flex; align-items:center; gap:.35rem; margin-left:.35rem; }
.scx-ctrl .mini{
  border:1px solid rgba(0,0,0,.2); background:inherit; padding:.18rem .5rem; border-radius:.4rem;
  cursor:pointer; font-size:.9rem; line-height:1;
}
.scx-ctrl .icon{
  width:28px; height:28px; display:inline-flex; align-items:center; justify-content:center;
  border:1px solid rgba(0,0,0,.2); border-radius:.45rem; cursor:pointer;
}
.scx-ctrl .icon svg{ width:16px; height:16px; }

.scx-search{ display:none; width:100%; margin-top:.35rem; }
.scx-filter-col.show-search .scx-search{ display:block; }
.scx-filter-col.collapsed .scx-chiplist{ display:none; }

.scx-chiplist{
  max-height:220px; overflow:auto; border:1px solid rgba(0,0,0,.12);
  border-radius:.35rem; padding:.25rem; margin-top:.35rem;
}
.scx-chip{ display:flex; align-items:center; gap:.35rem; padding:.2rem .35rem; border-radius:.35rem; }
.scx-chip input{ transform:translateY(1px); accent-color:var(--scx-accent); }

.scx-range{ display:flex; flex-direction:column; gap:.35rem; }
.scx-range .nums{ display:flex; gap:.5rem; }
.scx-range input[type="number"], .scx-range input[type="date"]{
  width:100%; padding:.25rem .45rem; border:1px solid rgba(0,0,0,.2); border-radius:.35rem;
}
.scx-range .track{ position:relative; height:24px; }
.scx-range .track input[type="range"]{
  position:absolute; left:0; right:0; width:100%; margin:0; background:transparent;
}
.scx-range .track input[type="range"]::-webkit-slider-runnable-track{
  height:6px; border-radius:999px; background:linear-gradient(90deg,
    rgba(127,127,127,.25) var(--lo,0%),
    var(--scx-accent)     var(--lo,0%),
    var(--scx-accent)     var(--hi,100%),
    rgba(127,127,127,.25) var(--hi,100%));
}
.scx-range .track input[type="range"]::-moz-range-track{
  height:6px; border-radius:999px; background:linear-gradient(90deg,
    rgba(127,127,127,.25) var(--lo,0%),
    var(--scx-accent)     var(--lo,0%),
    var(--scx-accent)     var(--hi,100%),
    rgba(127,127,127,.25) var(--hi,100%));
}
.scx-range .track .rlo{ z-index:2; } .scx-range .track .rhi{ z-index:3; }

@media (prefers-color-scheme: dark){
  .scx-btn{ background:#1f1f1f; color:#eaeaea; border-color:rgba(255,255,255,.18); }
  .scx-panel{ background:#1f1f1f; color:#eaeaea; border-color:rgba(255,255,255,.18); box-shadow:0 12px 32px rgba(0,0,0,.6); }
  .scx-btn[data-tip]:hover::after,.scx-btn[data-tip]:focus-visible::after{ background:#eaeaea; color:#111; }
  .scx-btn[data-tip]:hover::before,.scx-btn[data-tip]:focus-visible::before{ border-top-color:#eaeaea; }
  .scx-ctrl .mini,.scx-ctrl .icon,.scx-mini{ background:#1f1f1f; border-color:rgba(255,255,255,.18); }
  .scx-chiplist{ border-color:rgba(255,255,255,.18); }
  .scx-range input[type="number"], .scx-range input[type="date"]{ background:#1f1f1f; color:#eaeaea; border-color:rgba(255,255,255,.2); }
}
`;
  (typeof GM_addStyle === 'function'
    ? GM_addStyle
    : (s => { const el = document.createElement('style'); el.textContent = s; document.head.appendChild(el); })
  )(CSS);

  /* ---------------- Utils ---------------- */
  const $  = (s,r=document)=>{ try{ return r.querySelector(s); }catch{ return null; } };
  const $$ = (s,r=document)=>{ try{ return Array.from(r.querySelectorAll(s)); }catch{ return []; } };
  const on = (el,t,fn,opt)=>{ try{ el&&el.addEventListener(t,fn,opt||{passive:true}); }catch{} };
  const norm=(s)=>(s||'').replace(/\s+/g,' ').trim();
  const slug=(t)=>(t||'').toLowerCase().replace(/\s+/g,'-').replace(/[^a-z0-9\-]/g,'').replace(/\-+/g,'-').replace(/^-|-$/g,'')||'col';
  const debounce=(fn,ms=250)=>{ let to; return (...a)=>{ clearTimeout(to); to=setTimeout(()=>fn(...a),ms); }; };
  const djb2=str=>{ let h=5381; for(let i=0;i<str.length;i++) h=((h<<5)+h)^str.charCodeAt(i); return (h>>>0).toString(36); };
  const stripHTML=(s)=>(s==null?'':String(s).replace(/<[^>]*>/g,' '));

  const tableSignature = (t)=>{ const headers=(t?.tHead?.rows?.[0] ? Array.from(t.tHead.rows[0].cells) : []).map((th,i)=> slug(norm(th.textContent))||`col-${i}`); return djb2(headers.join('|')); };
  // This app selects pages with ?p=, not the path: location.pathname is always
  // '/', so the old key was identical on every page and column prefs bled
  // across them. Fold the page id in.
  const pageKey = ()=>{ try{ return new URLSearchParams(location.search).get('p') || ''; }catch{ return ''; } };
  // Two id-less tables with the same headers on one page hash to the same
  // signature, so they shared one entry. Disambiguate by document order,
  // cached on the element so repeat calls stay cheap.
  const tableOrdinal = (t)=>{
    if (t.dataset.scxTableOrd == null) {
      const sig = tableSignature(t);
      const peers = $$('table').filter(x => !x.id && tableSignature(x) === sig);
      const i = peers.indexOf(t);
      t.dataset.scxTableOrd = String(i > 0 ? i : 0);
    }
    return t.dataset.scxTableOrd;
  };
  const tableUID = (t)=>{
    const path = location.pathname.replace(/\/+$/,'');
    const base = `${location.hostname}${path}/${pageKey()}`;
    if (t.id) return `${base}:#${t.id}`;
    const ord = tableOrdinal(t);
    return `${base}:${tableSignature(t)}${ord === '0' ? '' : `~${ord}`}`;
  };

  const cacheKeyCols    = t => `${LS_NS_COLS}:${tableUID(t)}`;
  const cacheKeyFilters = t => `${LS_NS_FILTER}:${tableUID(t)}`;
  const readCache  = k => { try{ return JSON.parse(localStorage.getItem(k)||'{}'); }catch{ return {}; } };
  const writeCache = (k,v)=>{ try{ localStorage.setItem(k, JSON.stringify(v)); }catch{} };

  /* ---------------- Profiling ---------------- */
  const NUM_TH=.7, DATE_TH=.7, UNIQUE_TH=.8, SAMPLE_MAX=500, CATEG_MAX=60, DELIMS=[',','|',';','/'];
  const tryParseNumber=(s)=>{ if(s==null) return null; const c=(s+'').replace(/[^0-9.+\-eE]/g,''); if(!c||/^[-+.eE]+$/.test(c)) return null; const n=Number(c); return Number.isFinite(n)?n:null; };
  const tryParseDate  =(s)=>{ const t=Date.parse(s); return Number.isFinite(t)?t:null; };

  function sampleColumn(table, idx){
    if (window.jQuery?.fn?.dataTable?.isDataTable?.(table)) {
      try{
        const dt=jQuery(table).DataTable();
        const arr=dt.column(idx,{search:'none'}).data().toArray();
        return arr.slice(0,SAMPLE_MAX).map(v=> typeof v==='string'? v : (v?.toString?.()||''));
      }catch{}
    }
    const tb=table.tBodies?.[0]; if(!tb) return [];
    const out=[];
    for(const tr of Array.from(tb.rows||[])){
      out.push(norm(tr.cells?.[idx]?.textContent||'')); if(out.length>=SAMPLE_MAX) break;
    }
    return out;
  }

  function detectProfile(values){
    const nonEmpty=values.map(norm).filter(v=>v.length>0);
    const total=nonEmpty.length||1;

    let num=0,date=0; const rawFreq=new Map();
    for(const v of nonEmpty){
      if(tryParseNumber(v)!=null) num++;
      if(tryParseDate(v)!=null)   date++;
      rawFreq.set(v,(rawFreq.get(v)||0)+1);
    }
    const numericRatio=num/total, dateRatio=date/total, distinct=rawFreq.size, uniqueRatio=distinct/total;

    if(numericRatio>=NUM_TH){
      const nums=nonEmpty.map(tryParseNumber).filter(v=>v!=null);
      return {kind:'number', min:Math.min(...nums), max:Math.max(...nums)};
    }
    if(dateRatio>=DATE_TH){
      const tms=nonEmpty.map(tryParseDate).filter(v=>v!=null);
      const minTs=Math.min(...tms), maxTs=Math.max(...tms);
      return {kind:'date', minTs, maxTs, minISO:new Date(minTs).toISOString().slice(0,10), maxISO:new Date(maxTs).toISOString().slice(0,10)};
    }

    // tokenized (labels with delimiters)
    let tokenBest=null;
    for(const d of DELIMS){
      let rowsWithDelim=0; const tokens=new Map(); const repr=new Map();
      for(const v of nonEmpty){
        if(v.includes(d)) rowsWithDelim++;
        for(const pRaw of v.split(d).map(s=>norm(s)).filter(Boolean)){
          const k=NORM(pRaw);
          tokens.set(k,(tokens.get(k)||0)+1);
          if(!repr.has(k)) repr.set(k,pRaw);
        }
      }
      const top=[...tokens.entries()].sort((a,b)=>b[1]-a[1])[0]; if(!top) continue;
      const score=(rowsWithDelim/total)*(top[1]/total);
      if(!tokenBest||score>tokenBest.score) tokenBest={d,tokens,repr,rowsWithDelim,score,total};
    }
    const tokenized=tokenBest && tokenBest.rowsWithDelim/total>=0.25 && tokenBest.score>=0.08;

    // aggregate categorical with normalization + gating thresholds
    const buildCategorical = (pairs /* [key,count] */, reprMap) => {
      const distinctAll = pairs.length;
      if (distinctAll < MIN_DISTINCT_FOR_MENU) return {kind:'none'};
      const dupPairs = pairs.filter(([_,c]) => c >= CAT_MIN_COUNT);
      if (dupPairs.length < MIN_DUPLICATE_BUCKETS) return {kind:'none'};
      const list = dupPairs
        .sort((a,b)=> b[1]-a[1] || String(reprMap.get(a[0])||'').localeCompare(String(reprMap.get(b[0])||'')))
        .slice(0, CATEG_MAX)
        .map(([key,count])=>({ key, label: reprMap.get(key) || key, count }));
      return list.length ? {kind:'categorical', options:list, totalRows:total} : {kind:'none'};
    };

    if(tokenized){
      const pairs=[...tokenBest.tokens.entries()];
      const repr = tokenBest.repr;
      const cat = buildCategorical(pairs, repr);
      if (cat.kind === 'none') return cat;
      return { ...cat, tokenized:true, delim:tokenBest.d };
    }

    // Non-tokenized categorical: normalize variants, apply thresholds
    const agg=new Map(), repr=new Map();
    for(const [raw,cnt] of rawFreq.entries()){
      const k=NORM(raw); if(!k) continue;
      agg.set(k,(agg.get(k)||0)+cnt);
      if(!repr.has(k)) repr.set(k,raw);
    }
    if(!tokenized && uniqueRatio>=UNIQUE_TH && !DISABLE_TEXT_FILTER){
      return {kind:'text'}; // (disabled by flag)
    }
    return buildCategorical([...agg.entries()], repr);
  }

  const PROFILES=new WeakMap(), FILTERS=new WeakMap();
  const getHeadCells = t => t?.tHead?.rows?.[0] ? Array.from(t.tHead.rows[0].cells) : [];
  const getHead = t => getHeadCells(t);
  const getHeadRow=t=> t?.tHead?.rows?.[0] || null;

  function ensureProfiles(table){
    if(PROFILES.get(table)) return PROFILES.get(table);
    const profs=getHead(table).map((_,i)=>detectProfile(sampleColumn(table,i)));
    PROFILES.set(table,profs);
    return profs;
  }

  /* ---------------- Column visibility ---------------- */
  const setColumnVisible=(table, colIdx, visible)=>{
    if (window.jQuery?.fn?.dataTable?.isDataTable?.(table)) {
      try{
        const dt=jQuery(table).DataTable();
        dt.column(colIdx).visible(!!visible, false);
        dt.columns.adjust().responsive?.recalc().draw(false);
        return;
      }catch{}
    }
    const th=getHead(table)[colIdx]; if(th) th.classList.toggle('scx-col-hidden', !visible);
    const tb=table.tBodies?.[0]; if(!tb) return;
    Array.from(tb.rows||[]).forEach(tr=>{ const td=tr.cells?.[colIdx]; if(td) td.classList.toggle('scx-col-hidden', !visible); });
  };

  const applyVisibilityFromCache=(table, cache)=>{
    getHead(table).forEach((th,idx)=>{
      const key=th.dataset.scxSlug||(th.dataset.scxSlug=slug(norm(th.textContent)||`col-${idx}`));
      const visible = Object.prototype.hasOwnProperty.call(cache,key) ? !!cache[key] : true;
      setColumnVisible(table, idx, visible);
    });
  };

  /* ---------------- Filter evaluation ---------------- */
  function rowPasses(table, dataOrTr){
    const ths=getHead(table);
    const filters=FILTERS.get(table)||{};
    if(!Object.keys(filters).length) return true;

    const getCellText = (i)=> Array.isArray(dataOrTr)
      ? norm(stripHTML(dataOrTr[i] ?? ''))
      : norm(dataOrTr.cells?.[i]?.textContent || '');

    for(let i=0;i<ths.length;i++){
      const key=ths[i].dataset.scxSlug||(ths[i].dataset.scxSlug=slug(norm(ths[i].textContent)||`col-${i}`));
      const f=filters[key]; if(!f) continue;
      const v=getCellText(i);

      if(f.type==='number'){
        const n=tryParseNumber(v); if(n==null) return false;
        const lo = Number.isFinite(f.minSel) ? f.minSel : f.min;
        const hi = Number.isFinite(f.maxSel) ? f.maxSel : f.max;
        if(!(n>=lo && n<=hi)) return false;
      }
      else if(f.type==='date'){
        const t=tryParseDate(v); if(t==null) return false;
        const lo=f.minSelTs ?? f.minTs, hi=f.maxSelTs ?? f.maxTs;
        if(!(t>=lo && t<=hi)) return false;
      }
      else if(f.type==='categorical'){
        const want = f.selected; if (!want || !want.size) return false;
        if(f.tokenized){
          const parts=v.split(f.delim).map(s=>NORM(s)).filter(Boolean);
          if(!parts.some(p=>want.has(p))) return false;
        } else {
          const k=NORM(v);
          if(!want.has(k)) return false;
        }
      }
    }
    return true;
  }

  function applyFilters(table){
    const filters=FILTERS.get(table)||{};
    const anyActive = Object.values(filters).some(f=>{
      if(!f) return false;
      if(f.type==='categorical') return f.selected && f.selected.size>0;
      if(f.type==='number')     return (f.minSel!=null || f.maxSel!=null);
      if(f.type==='date')       return (f.minSelTs!=null || f.maxSelTs!=null);
      return false;
    });

    if (window.jQuery?.fn?.dataTable?.isDataTable?.(table)) {
      const dt=jQuery(table).DataTable();
      if(!applyFilters._installedDT){
        applyFilters._installedDT=true;
        jQuery.fn.dataTable.ext.search.push((settings,data)=>{
          const t=settings.nTable; const has=FILTERS.get(t);
          if(!has) return true; return rowPasses(t,data);
        });
      }
      dt.draw(false); return;
    }
    const tb=table.tBodies?.[0]; if(!tb) return;
    Array.from(tb.rows||[]).forEach(tr=>{
      tr.classList.toggle('scx-row-hidden', anyActive ? !rowPasses(table,tr) : false);
    });
  }

  /* Hide filter sections for hidden columns */
  function syncFilterSectionsVisibility(table){
    const ths=getHead(table);
    const slot = document.querySelector(`.scx-slot[data-scx-table-uid="${tableUID(table)}"]`);
    const panel = slot?.querySelector(`.scx-anchor[data-role="filters"] .scx-panel`); if(!panel) return;
    panel.querySelectorAll('.scx-filter-col').forEach(sec=>{
      const s = sec.getAttribute('data-slug');
      const idx = ths.findIndex(th => (th.dataset.scxSlug||(th.dataset.scxSlug=slug(norm(th.textContent)||'')))===s);
      if(idx<0) return;
      let hidden=false;
      if (window.jQuery?.fn?.dataTable?.isDataTable?.(table)) {
        try { hidden = !jQuery(table).DataTable().column(idx).visible(); } catch { hidden=false; }
      } else { hidden = ths[idx].classList.contains('scx-col-hidden'); }
      sec.style.display = hidden ? 'none' : '';
    });
  }

  /* ---------------- UI: shared ---------------- */
  function rightSlot(table){
    const uid=tableUID(table);
    const wrap = table.closest('.dataTables_wrapper') || table.parentElement || document.body;

    // Prefer a stable container inside wrapper so redraws don't eat our slot.
    let bar =
      wrap.querySelector('.dataTables_wrapper') ||
      wrap.querySelector('.dataTables_filter') ||
      wrap.querySelector('.dataTables_length') ||
      wrap;

    let slot = bar.querySelector(`.scx-slot[data-scx-table-uid="${uid}"]`);
    if(slot) return slot;

    slot=document.createElement('span');
    slot.className='scx-slot';
    slot.setAttribute('data-scx-table-uid', uid);
    bar.appendChild(slot);
    return slot;
  }

  function rebuildMenu(table, role, { reopen=false } = {}){
    const uid  = tableUID(table);
    const slot = rightSlot(table);
    if (!slot) return;

    const sel = `.scx-anchor[data-role="${role}"][data-scx-table-uid="${uid}"]`;
    slot.querySelector(sel)?.remove();

    if (role === 'filters') table.dataset.scxFiltersBuilt = '';
    if (role === 'cols')    table.dataset.scxColsBuilt   = '';

    // Defer to avoid tearing during current click handler
    setTimeout(() => {
      if (role === 'filters') buildFilterMenu(table, /*reopenAfterBuild*/ reopen);
      else                    buildColumnsMenu(table);
    }, 0);
  }

  function clearFilters(table, { rebuild=true } = {}){
    try { localStorage.removeItem(cacheKeyFilters(table)); } catch {}
    FILTERS.delete(table);

    if (rebuild) {
      rebuildMenu(table, 'filters', { reopen:true });
    } else {
      applyFilters(table);
    }
  }

  function fullReset(table){
    // clear caches
    try {
      localStorage.removeItem(cacheKeyFilters(table));
      localStorage.removeItem(cacheKeyCols(table));
    } catch {}
    FILTERS.delete(table);

    // show all columns immediately
    getHead(table).forEach((_, i) => setColumnVisible(table, i, true));

    // rebuild both menus safely; keep Filters panel open after rebuild
    rebuildMenu(table, 'cols');
    rebuildMenu(table, 'filters', { reopen:true });
  }

  /* ---------------- UI: Columns menu ---------------- */
  function buildColumnsMenu(table){
    const slot = rightSlot(table);
    const hasExisting = !!slot?.querySelector(`.scx-anchor[data-role="cols"][data-scx-table-uid="${tableUID(table)}"]`);
    if (table.dataset.scxColsBuilt === '1' && hasExisting) return;
    table.dataset.scxColsBuilt = '';

    const thead=getHeadRow(table); if(!thead) return;

    const anchor=document.createElement('span'); anchor.className='scx-anchor';
    anchor.setAttribute('data-role','cols'); anchor.setAttribute('data-scx-table-uid', tableUID(table));

    const btn=document.createElement('button'); btn.type='button'; btn.className='scx-btn'; btn.setAttribute('data-tip','Columns');
    btn.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h4v14H4V5zm6 0h4v14h-4V5zm6 0h4v14h-4V5z"/></svg>`;
    const panel=document.createElement('div'); panel.className='scx-panel'; panel.setAttribute('role','menu');
    panel.innerHTML=`<div class="scx-head"><h4>Show / Hide Columns</h4></div>`;
    anchor.appendChild(btn); anchor.appendChild(panel); slot.appendChild(anchor);

    const key=cacheKeyCols(table); const cache=readCache(key); const ths=getHead(table);
    ths.forEach((th, idx)=>{
      const label=norm(th.textContent)||`(Column ${idx+1})`;
      const s=th.dataset.scxSlug||(th.dataset.scxSlug=slug(label||`col-${idx}`));
      const checked = Object.prototype.hasOwnProperty.call(cache,s) ? !!cache[s] : true;
      const item=document.createElement('label'); item.className='scx-item';
      item.innerHTML=`<input type="checkbox" ${checked?'checked':''} data-col-idx="${idx}" data-slug="${s}"><span>${label}</span>`;
      panel.appendChild(item);
    });
    applyVisibilityFromCache(table, cache);
    syncFilterSectionsVisibility(table);

    const close=()=>{ panel.classList.remove('open'); };
    on(btn,'click',e=>{ e.stopPropagation?.(); panel.classList.toggle('open'); }, {passive:false});
    on(document,'click',e=>{ if(!panel.contains(e.target) && e.target!==btn) close(); });
    on(document,'keydown',e=>{ if(e.key==='Escape') close(); });

    on(panel,'change',e=>{
      const cb=e.target; if(!(cb instanceof HTMLInputElement)) return;
      const idx=parseInt(cb.dataset.colIdx||'-1',10); if(idx<0) return;
      setColumnVisible(table, idx, cb.checked);
      const map=readCache(key); map[cb.dataset.slug]=!!cb.checked; writeCache(key,map);
      syncFilterSectionsVisibility(table);
    });

    const mo=new MutationObserver(()=>{ try{ anchor.remove(); table.dataset.scxColsBuilt=''; buildColumnsMenu(table); }catch{} });
    mo.observe(thead,{childList:true,subtree:true});

    if (window.jQuery?.fn?.dataTable) try{
      jQuery(table).on('draw.dt', ()=>applyVisibilityFromCache(table, readCache(key)));
    }catch{}

    table.dataset.scxColsBuilt='1';
  }

  /* ---------------- UI: Filters menu ---------------- */
  function buildFilterMenu(table, reopenAfterBuild=false){
    const slot = rightSlot(table);
    const hasExisting = !!slot?.querySelector(`.scx-anchor[data-role="filters"][data-scx-table-uid="${tableUID(table)}"]`);
    if (table.dataset.scxFiltersBuilt === '1' && hasExisting) {
      if (reopenAfterBuild) slot.querySelector(`.scx-anchor[data-role="filters"] .scx-panel`)?.classList.add('open');
      return;
    }
    table.dataset.scxFiltersBuilt = '';

    const thead=getHeadRow(table); if(!thead) return;

    const profs=ensureProfiles(table);
    const filtersCacheKey = cacheKeyFilters(table);
    if (RESET_FILTERS_ON_LOAD) { try{ localStorage.removeItem(filtersCacheKey); }catch{} }
    const savedRaw = readCache(filtersCacheKey) || {};

    // Migrate saved state: drop text; normalize categorical selected -> selectedKeys
    const _saved = {};
    for (const [k,v] of Object.entries(savedRaw)){
      if (!v) continue;
      if (v.type === 'text') continue;
      if (v.type === 'categorical'){
        const keys = v.selectedKeys ? v.selectedKeys : (v.selected||[]).map(NORM);
        _saved[k] = { ...v, selectedKeys:[...new Set(keys)] };
        delete _saved[k].selected;
      } else {
        _saved[k] = v;
      }
    }

    // Helper: which profiles are actually filterable?
    const isFilterable = (p) =>
      p && (
        p.kind === 'number' ||
        p.kind === 'date'   ||
        (p.kind === 'categorical' && Array.isArray(p.options) && p.options.length > 0)
      );

    // Drop orphan saved entries that are not filterable anymore
    const ths = getHead(table);
    const saved = {};
    for (const [k,v] of Object.entries(_saved)){
      const idx = ths.findIndex(th => (th.dataset.scxSlug || (th.dataset.scxSlug = slug(norm(th.textContent)||'')))===k);
      const prof = profs[idx];
      if (isFilterable(prof)) saved[k]=v;
    }

    const anchor=document.createElement('span'); anchor.className='scx-anchor';
    anchor.setAttribute('data-role','filters'); anchor.setAttribute('data-scx-table-uid', tableUID(table));

    const btn=document.createElement('button'); btn.type='button'; btn.className='scx-btn'; btn.setAttribute('data-tip','Filters');
    btn.innerHTML=`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v2H3V5zm4 6h10v2H7v-2zm3 6h4v2h-4v-2z"/></svg>`;
    const panel=document.createElement('div'); panel.className='scx-panel'; panel.setAttribute('role','menu');
    panel.innerHTML=`
      <div class="scx-head">
        <h4>Filters</h4>
        <div class="scx-actions">
          <button type="button" class="scx-mini scx-reset">Reset</button>
          <button type="button" class="scx-mini danger scx-fullreset">Full</button>
        </div>
      </div>
      <div class="scx-subtle">numbers/dates → range · labels/IDs → multi-select</div>`;
    anchor.appendChild(btn); anchor.appendChild(panel); slot.appendChild(anchor);

    // panel-level reset buttons (keep panel open)
    on(panel.querySelector('.scx-reset'),     'click', () => clearFilters(table, { rebuild:true }) );
    on(panel.querySelector('.scx-fullreset'), 'click', () => fullReset(table) );

    const current={};
    const saveAndApply = debounce(() => {
      const toSave={};
      for (const [k,v] of Object.entries(current)) {
        if (!v) continue;
        if (v.type==='categorical'){
          toSave[k] = { ...v, selectedKeys:[...v.selected] };
          delete toSave[k].selected;
        } else {
          toSave[k] = { ...v };
        }
      }
      writeCache(filtersCacheKey, toSave);

      const hydrated={};
      for(const [k,v] of Object.entries(toSave)){
        if(v.type==='categorical'){
          hydrated[k] = { ...v, selected:new Set(v.selectedKeys||[]) };
        } else { hydrated[k] = { ...v }; }
      }
      FILTERS.set(table, hydrated);
      applyFilters(table);
    }, 120);

    // Build sections ONLY for filterable columns
    ths.forEach((th, idx)=>{
      const label=norm(th.textContent) || `(Column ${idx+1})`;
      const s = th.dataset.scxSlug || (th.dataset.scxSlug = slug(label||`col-${idx}`));
      const prof = profs[idx];

      if (!isFilterable(prof)) return; // skip non-filterable columns

      const wrap=document.createElement('div'); wrap.className='scx-filter-col collapsed'; wrap.setAttribute('data-slug', s);
      const header=document.createElement('div'); header.className='scx-row';
      header.innerHTML = `
        <div class="scx-flabel">${label}</div>
        <div class="scx-ctrl"></div>
        <div class="scx-ftype">${prof.kind}${prof.kind==='categorical' && prof.tokenized ? '·tags' : ''}</div>`;
      const ctrl = header.querySelector('.scx-ctrl');
      wrap.appendChild(header);

      /* --- NUMBER --- */
      if (prof.kind==='number'){
        const min=prof.min, max=prof.max;
        const asInt = v => Math.round(Number(v||0));
        const savedCol = saved[s];
        const state={ type:'number', min, max,
                      minSel: asInt(savedCol?.minSel ?? min),
                      maxSel: asInt(savedCol?.maxSel ?? max) };
        current[s]=state;

        const ui=document.createElement('div'); ui.className='scx-range';
        ui.innerHTML = `
          <div class="nums">
            <input type="number" class="nlo" step="1" inputmode="numeric" pattern="\\d*" value="${state.minSel}">
            <input type="number" class="nhi" step="1" inputmode="numeric" pattern="\\d*" value="${state.maxSel}">
          </div>
          <div class="track">
            <input type="range" class="rlo" min="${asInt(min)}" max="${asInt(max)}" step="1" value="${state.minSel}">
            <input type="range" class="rhi" min="${asInt(min)}" max="${asInt(max)}" step="1" value="${state.maxSel}">
          </div>`;
        wrap.appendChild(ui);

        const nlo=ui.querySelector('.nlo'), nhi=ui.querySelector('.nhi'),
              rlo=ui.querySelector('.rlo'), rhi=ui.querySelector('.rhi');
        const setTrackFill = ()=>{
          const pct=v=> ((v-min)/(max-min))*100;
          const loP=pct(Number(rlo.value)), hiP=pct(Number(rhi.value));
          ui.querySelector('.track').style.setProperty('--lo', `${Math.min(loP,hiP)}%`);
          ui.querySelector('.track').style.setProperty('--hi', `${Math.max(loP,hiP)}%`);
        };
        const clamp=()=>{
          let lo=asInt(nlo.value), hi=asInt(nhi.value);
          if(Number.isNaN(lo)) lo=min; if(Number.isNaN(hi)) hi=max; if(lo>hi) [lo,hi]=[hi,lo];
          lo=Math.max(asInt(min),Math.min(lo,asInt(max)));
          hi=Math.max(asInt(min),Math.min(hi,asInt(max)));
          nlo.value=lo; nhi.value=hi; rlo.value=lo; rhi.value=hi;
          state.minSel=lo; state.maxSel=hi; setTrackFill(); saveAndApply();
        };
        on(nlo,'input',debounce(clamp,100)); on(nhi,'input',debounce(clamp,100));
        on(rlo,'input',()=>{ nlo.value=rlo.value; clamp(); });
        on(rhi,'input',()=>{ nhi.value=rhi.value; clamp(); });
        setTrackFill();
      }

      /* --- DATE --- */
      else if (prof.kind==='date'){
        const savedCol = saved[s];
        const state={ type:'date',
                      minTs: prof.minTs, maxTs: prof.maxTs,
                      minSelTs: savedCol?.minSelTs ?? null,
                      maxSelTs: savedCol?.maxSelTs ?? null };
        current[s]=state;

        const toISO = ts => new Date(ts).toISOString().slice(0,10);
        const ui=document.createElement('div'); ui.className='scx-range';
        ui.innerHTML = `
          <div class="nums">
            <input type="date" class="dlo" value="${state.minSelTs?toISO(state.minSelTs):toISO(prof.minTs)}" min="${toISO(prof.minTs)}" max="${toISO(prof.maxTs)}">
            <input type="date" class="dhi" value="${state.maxSelTs?toISO(state.maxSelTs):toISO(prof.maxTs)}" min="${toISO(prof.minTs)}" max="${toISO(prof.maxTs)}">
          </div>`;
        wrap.appendChild(ui);

        const dlo=ui.querySelector('.dlo'), dhi=ui.querySelector('.dhi');
        const clamp=()=>{
          const loTs = Date.parse(dlo.value), hiTs = Date.parse(dhi.value);
          let lo = Number.isFinite(loTs) ? loTs : prof.minTs;
          let hi = Number.isFinite(hiTs) ? hiTs : prof.maxTs;
          if(lo>hi) [lo,hi]=[hi,lo];
          state.minSelTs=lo; state.maxSelTs=hi; saveAndApply();
        };
        on(dlo,'input',debounce(clamp,120)); on(dhi,'input',debounce(clamp,120));
      }

      /* --- CATEGORICAL --- */
      else if (prof.kind==='categorical'){
        const opts=(prof.options||[]);
        if (!opts.length) return;

        const savedCol = saved[s];
        const initial = new Set(savedCol?.selectedKeys || opts.map(o=>o.key));
        const state={ type:'categorical', tokenized:!!prof.tokenized, delim:prof.delim, selected:initial };
        current[s]=state;

        ctrl.innerHTML = `
          <button type="button" class="mini all">All</button>
          <button type="button" class="mini none">None</button>
          <button type="button" class="icon toggle-search" aria-label="Search">
            <svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79L20 21.5 21.5 20l-6-6zM4 9.5C4 6.46 6.46 4 9.5 4S15 6.46 15 9.5 12.54 15 9.5 15 4 12.54 4 9.5z"/></svg>
          </button>`;

        const ui=document.createElement('div');
        ui.innerHTML=`
          <div class="scx-search"><input type="text" class="q" placeholder="search options…"></div>
          <div class="scx-chiplist"></div>`;
        wrap.appendChild(ui);

        const list=ui.querySelector('.scx-chiplist'), q=ui.querySelector('.q');
        let collapsed=true; wrap.classList.add('collapsed');

        const render=()=>{
          const needle=NORM(q?.value||''); list.innerHTML='';
          opts.forEach(o=>{
            if(needle && !NORM(o.label).includes(needle)) return;
            const id=`${s}-${o.key}`.replace(/[^a-z0-9\-_:.]/gi,'');
            const row=document.createElement('label'); row.className='scx-chip';
            row.innerHTML=`<input type="checkbox" id="${id}" ${state.selected.has(o.key)?'checked':''} data-key="${o.key}">
                           <span>${o.label}</span><span style="opacity:.6;font-size:.75rem;">(${o.count})</span>`;
            list.appendChild(row);
          });
        };
        render();

        on(ctrl.querySelector('.all'),'click',e=>{ e.stopPropagation(); state.selected=new Set(opts.map(o=>o.key)); render(); saveAndApply(); });
        on(ctrl.querySelector('.none'),'click',e=>{ e.stopPropagation(); state.selected=new Set(); render(); saveAndApply(); });
        on(ctrl.querySelector('.toggle-search'),'click',e=>{ e.stopPropagation(); wrap.classList.toggle('show-search'); if(wrap.classList.contains('show-search')) q.focus(); });
        on(q,'input',debounce(()=>{ if(q.value && collapsed){ collapsed=false; wrap.classList.remove('collapsed'); } render(); },120));
        on(header,'click', (e)=>{ if(e.target.closest('.scx-ctrl')) return; collapsed=!collapsed; wrap.classList.toggle('collapsed', collapsed); });
        on(list,'change',e=>{
          const cb=e.target; if(!(cb instanceof HTMLInputElement)) return;
          const k=cb.dataset.key; if(cb.checked) state.selected.add(k); else state.selected.delete(k);
          saveAndApply();
        });
      }

      panel.appendChild(wrap);
    });

    // hydrate + apply existing (may be none)
    const hydrated={};
    for (const [k,v] of Object.entries(saved)){
      if (v.type === 'categorical'){
        hydrated[k] = { ...v, selected:new Set(v.selectedKeys||[]) };
      } else {
        hydrated[k] = { ...v };
      }
    }
    FILTERS.set(table,hydrated);
    applyFilters(table);
    syncFilterSectionsVisibility(table);

    const close=()=>{ panel.classList.remove('open'); };
    on(btn,'click',e=>{ e.stopPropagation?.(); panel.classList.toggle('open'); },{passive:false});
    on(document,'click',e=>{ if(!panel.contains(e.target) && e.target!==btn) close(); });
    on(document,'keydown',e=>{ if(e.key==='Escape') close(); });

    const mo=new MutationObserver(()=>{ try{ anchor.remove(); table.dataset.scxFiltersBuilt=''; buildFilterMenu(table); }catch{} });
    mo.observe(getHeadRow(table),{childList:true,subtree:true});

    if (window.jQuery?.fn?.dataTable) { try{
      jQuery(table).on('draw.dt', ()=>{ applyFilters(table); syncFilterSectionsVisibility(table); });
    }catch{} }

    const tb=table.tBodies?.[0];
    if (tb){
      const mo2 = new MutationObserver(debounce(()=>{ applyFilters(table); },120));
      mo2.observe(tb, { childList:true, subtree:true, characterData:true });
    }

    table.dataset.scxFiltersBuilt='1';
    if (reopenAfterBuild) setTimeout(()=> panel.classList.add('open'), 60);
  }

  /* ---------------- Wire tables ---------------- */
  function wireTable(table){
    if (!table) return;
    const uid = tableUID(table);
    if ((table.dataset.scxWired==='1') && document.querySelector(`.scx-slot[data-scx-table-uid="${uid}"]`)) return;
    buildColumnsMenu(table);
    buildFilterMenu(table);
    table.dataset.scxWired='1';
  }

  function scan(){
    const seen=new Set();
    TABLE_SELECTORS.forEach(sel => $$(sel).forEach(t=> seen.add(t)));
    Array.from(seen).forEach(wireTable);
  }

  const ready = ()=> document.readyState==='complete' || document.readyState==='interactive';
  if (ready()) setTimeout(scan,150); else on(document,'DOMContentLoaded',()=>setTimeout(scan,150));
  on(window,'tm:route',()=> setTimeout(scan,60));
  try{ new MutationObserver(()=>scan()).observe(document.documentElement,{childList:true,subtree:true}); }catch{}

  /* ---------------- Console helpers ---------------- */
  function _tables(){ const list=Array.from(new Set([].concat(...TABLE_SELECTORS.map(s=> $$(s))))); return list.map((t,i)=>({ index:i, uid:tableUID(t), el:t, headers:getHead(t).map((th,idx)=>({idx,text:norm(th.textContent)})) })); }
  function _resolve(target){ const list=Array.from(new Set([].concat(...TABLE_SELECTORS.map(s=> $$(s))))); if (typeof target==='number') return list[target]||null; if (typeof target==='string') return list.find(t=>tableUID(t)===target)||null; return list[0]||null; }
  function _inspect(target){ const t=_resolve(target); if(!t) return null; const profs=ensureProfiles(t); return profs.map((p,i)=>({col:i,label:norm(getHead(t)[i]?.textContent||''),profile:p})); }
  function _reset(target, what={cols:true,filters:true}){ const t=_resolve(target); if(!t) return false; if(what.cols){ localStorage.removeItem(cacheKeyCols(t)); getHead(t).forEach((_,i)=> setColumnVisible(t,i,true)); } if(what.filters){ localStorage.removeItem(cacheKeyFilters(t)); FILTERS.delete(t); } applyFilters(t); scan(); return true; }
  function _reapply(target){ const t=_resolve(target); if(!t) return false; applyFilters(t); return true; }
  function _dump(target){ const t=_resolve(target); if(!t) return null; return { uid: tableUID(t), cols: readCache(cacheKeyCols(t)), filters: readCache(cacheKeyFilters(t)) }; }
  function _load(target, payload){ const t=_resolve(target); if(!t||!payload) return false;
    if(payload.cols) writeCache(cacheKeyCols(t), payload.cols);
    if(payload.filters) writeCache(cacheKeyFilters(t), payload.filters);
    const hydrated={};
    for(const [k,v] of Object.entries(payload.filters||{})){
      if(v.type==='categorical'){
        const keys = v.selectedKeys ? v.selectedKeys : (v.selected||[]).map(NORM);
        hydrated[k]={...v, selected:new Set(keys)};
      } else { hydrated[k]={...v}; }
    }
    if(Object.keys(hydrated).length) FILTERS.set(t,hydrated);
    applyVisibilityFromCache(t, readCache(cacheKeyCols(t))); applyFilters(t); scan(); return true;
  }

  window.__scxFilters = Object.assign(window.__scxFilters||{}, {
    tables : _tables, inspect: _inspect, reset:_reset, reapply:_reapply, dump:_dump, load:_load,
    clearFilters, fullReset
  });
})();
