// ==UserScript==
// @name         SC FAB — Message & Sales Viewer (SCORD integrated)
// @namespace    sc-anywhere
// @version      0.3.0
// @description  Bottom-right FAB with two tabs: Message by ID and Sales (Order) by ID. Uses SCORD (xhr-first) for orders.
// @match        https://extranet.strip-curtains.com/*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';
  /* ---------------------------------------------------------------------
   * 1) SCORD v3.1 HOTFIX CORE  — xhr-first transport, no forbidden headers
   * ------------------------------------------------------------------- */
  if (!window.SCORD) {
    const NS = (window.SCORD = { __version: '3.1-hotfix' });

    // --- helpers shared by popup parsing ---
    const decodeEntities = (s) => (Object.assign(document.createElement('textarea'), { innerHTML: s }).value);
    function extractJSONArray(html, salesId) {
      const s = decodeEntities(html);
      let idx = s.indexOf(`"id":"${salesId}"`);
      if (idx === -1) idx = s.indexOf(`"id":${salesId}`);
      if (idx === -1) for (const a of ['"billing_firstname"','"payment_gateway"','"sales_total"','"order_number"']) { idx = s.indexOf(a); if (idx !== -1) break; }
      if (idx === -1) idx = s.indexOf('[');
      if (idx === -1) throw new Error('No likely JSON anchor found');
      const start = s.lastIndexOf('[', idx); if (start === -1) throw new Error('Opening "[" not found near anchor');
      let depth=0, inStr=false, esc=false;
      for (let i=start;i<s.length;i++){
        const ch=s[i];
        if (inStr){ if (esc){esc=false;continue;} if (ch==='\\'){esc=true;continue;} if (ch === '"') inStr=false; continue; }
        if (ch === '"'){ inStr=true; continue; }
        if (ch === '[') depth++;
        if (ch === ']'){ depth--; if (depth===0) return s.slice(start,i+1); }
      }
      throw new Error('Balanced JSON array not found');
    }
    const isJSONish = (x) => typeof x === 'string' && (x.trim().startsWith('[') || x.trim().startsWith('{'));
    const decodeKnownFields = (rec) => {
      const maybe = v => isJSONish(v) ? (()=>{ try{return JSON.parse(v);}catch{return v;} })() : v;
      if ('review_partsHandling' in rec) rec.review_partsHandling = maybe(rec.review_partsHandling);
      return rec;
    };

    // --- transports: xhr-first path to dodge patched fetch/global-scope races ---
    async function fetch_xhr(url, { timeoutMs=15000, headers={}, rangeBytes=null } = {}) {
      return await new Promise((resolve, reject) => {
        const x = new XMLHttpRequest();
        x.open('GET', url, true);
        x.withCredentials = true;
        Object.entries(headers).forEach(([k,v]) => x.setRequestHeader(k, v));
        if (rangeBytes!=null) x.setRequestHeader('Range', `bytes=0-${rangeBytes}`);
        x.timeout = timeoutMs;
        const t0 = performance.now();
        x.onload = () => resolve({ ok:x.status>=200 && x.status<300, status:x.status, ttfb_ms: Math.round(performance.now()-t0), text:x.responseText });
        x.onerror = () => reject(new Error('network error'));
        x.ontimeout = () => reject(new Error('timeout'));
        x.send();
      });
    }

    NS.config = { transport:'xhr', timeoutMs:15000, useRange:false, rangeBytes:65535 };
    NS.setConfig = (p={}) => Object.assign(NS.config, p);

    NS.getPopup = async function(viewId, opts={}) {
      const cfg = Object.assign({}, NS.config, opts);
      const q = encodeURIComponent(String(viewId));
      const variants = [
        { n:'GET ?json=1',      u:`/?p=orders-products-list-popup&view=${q}&json=1`,      h:{} },
        { n:'GET ?format=json', u:`/?p=orders-products-list-popup&view=${q}&format=json`,  h:{} },
        { n:'GET ?ajax=1',      u:`/?p=orders-products-list-popup&view=${q}&ajax=1`,      h:{} },
        { n:'GET + XRW',        u:`/?p=orders-products-list-popup&view=${q}`,             h:{'X-Requested-With':'XMLHttpRequest'} },
        { n:'GET base',         u:`/?p=orders-products-list-popup&view=${q}`,             h:{} },
      ];
      let lastErr;
      for (const v of variants) {
        try {
          const r = await fetch_xhr(v.u, { timeoutMs: cfg.timeoutMs, headers: v.h, rangeBytes: cfg.useRange ? cfg.rangeBytes : null });
          if (cfg.useRange && r.status !== 206) console.log('[SCORD] Range not honored:', r.status);
          let arr;
          const looksJSON = r.text.slice(0,200).includes('"aaData"') || r.text.trim().startsWith('{');
          if (looksJSON) { arr = JSON.parse(r.text); }
          else { arr = JSON.parse(extractJSONArray(r.text, viewId)); }
          console.log('[SCORD:getPopup]', viewId, { variant:v.n, status:r.status, ttfb_ms:r.ttfb_ms });
          return { data: arr, meta: { variant:v.n, status:r.status, ttfb_ms:r.ttfb_ms, url:v.u } };
        } catch (e) { lastErr = e; }
      }
      // fallback scrape
      const r = await fetch_xhr(`/?p=orders-view&view=${q}`, { timeoutMs: cfg.timeoutMs });
      const arr = JSON.parse(extractJSONArray(r.text, viewId));
      console.log('[SCORD:getPopup:fallback-view]', viewId, { status:r.status, ttfb_ms:r.ttfb_ms });
      return { data: arr, meta: { variant:'orders-view scrape', status:r.status, ttfb_ms:r.ttfb_ms } };
    };

    NS.getOrder = async function(salesId, opts={}) {
      const { data } = await NS.getPopup(salesId, opts);
      const rec = Array.isArray(data) ? (data.find(r => String(r?.id) === String(salesId)) || data[0]) : data;
      if (!rec) throw new Error('Record not found for view='+salesId);
      return decodeKnownFields(rec);
    };
  }

  /* ---------------------------------------------------------------------
   * 2) Ensure the same fetch-by-MessageID you already rely on
   *    (kept as-is from your FAB script)
   * ------------------------------------------------------------------- */
  if (!window.fetchMCThread) {
    const THREAD_ENDPOINT = new URL('/ajax/sales/loadMessages.php', location.origin).href;
    window.fetchMCThread = async function fetchMCThread(id, { timeoutMs = 10_000, signal } = {}) {
      if (!id) throw new Error('fetchMCThread: "id" is required');
      const ownCtrl = !signal ? new AbortController() : null;
      const finalSignal = signal || ownCtrl.signal;
      const timer = ownCtrl ? setTimeout(() => ownCtrl.abort('timeout'), timeoutMs) : null;
      try {
        const fd = new FormData();
        fd.append('id', String(id));
        const res = await fetch(THREAD_ENDPOINT, {
          method: 'POST',
          body: fd,
          credentials: 'include',
          signal: finalSignal,
          headers: { 'X-Requested-With': 'XMLHttpRequest' }
        });
        const text = await res.text();
        let data; try { data = JSON.parse(text); } catch {}
        if (!data || data.type !== 'success' || typeof data.html !== 'string') {
          throw new Error(`Unexpected response (${res.status}): ${text.slice(0, 240)}…`);
        }
        return { id: data.id ?? String(id), html: data.html, description: data.description || '' };
      } finally {
        if (timer) clearTimeout(timer);
      }
    };
  }

  /* ---------------------------------------------------------------------
   * 3) Shadow-DOM Panel with two tabs: Messages | Orders
   *    (borrows structure/feel from your current FAB viewer)
   * ------------------------------------------------------------------- */
  const HOST_ID = 'sc-fab-host';
  if (document.getElementById(HOST_ID)) return;

  // host + shadow root
  const host = document.createElement('div');
  host.id = HOST_ID;
  Object.assign(host.style, { position:'fixed', inset:'auto 0 0 auto', width:'0', height:'0', zIndex:'2147483646' });
  document.body.appendChild(host);
  const root = host.attachShadow({ mode: 'open' });

  // tiny utils
  const qs = (s, r = root) => r.querySelector(s);
  const on = (el, ev, fn, opts) => el && el.addEventListener(ev, fn, opts);
  const fmtTime = (ts) => {
    const d = new Date(ts), diff = Math.max(0, Date.now() - ts), m = Math.floor(diff / 60000);
    if (m < 1) return 'just now'; if (m < 60) return `${m}m ago`;
    const h = Math.floor(m/60); if (h < 24) return `${h}h ago`;
    const dys = Math.floor(h/24); if (dys < 7) return `${dys}d ago`;
    return d.toLocaleString();
  };
  const parseId = (raw) => (raw && String(raw).match(/\d+/)?.[0]) || null;

  // recents (messages + orders)
  const REC_MSG = 'mc:recent:v1';
  const REC_ORD = 'scord:recent:v1';
  const getRec = (k) => { try { return JSON.parse(localStorage.getItem(k)) || []; } catch { return []; } };
  const setRec = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v.slice(0, 30))); } catch {} };
  const touchRec = (k, id, label) => { id=String(id); const L=getRec(k); const i=L.findIndex(x=>x.id===id); const item={id, lab:label||'', ts:Date.now()}; if(i>=0) L.splice(i,1); L.unshift(item); setRec(k,L); };
  const rmRec = (k, id) => setRec(k, getRec(k).filter(x=>x.id!==String(id)));
  const clearRec = (k) => setRec(k, []);

  // CSS + markup
  const style = document.createElement('style');
  style.textContent = `
:host{
  --edge-x: 19px; --edge-y: 19px;
  --fab: 56px; --w: 880px; --left: 300px;
  --maxh: min(70dvh, calc(100dvh - (env(safe-area-inset-bottom) + var(--edge-y) + var(--fab) + 28px)));
}
*{ box-sizing: border-box; }
.ui { font: 13px/1.4 -apple-system, system-ui, Segoe UI, Roboto, Inter, Arial, sans-serif; }
.fab{
  position:fixed; right:calc(env(safe-area-inset-right) + var(--edge-x)); bottom:calc(env(safe-area-inset-bottom) + var(--edge-y));
  width:var(--fab); height:var(--fab); border-radius:999px; border:1px solid #2a3460; background:#5353ff; color:#fff;
  display:inline-flex; align-items:center; justify-content:center; cursor:pointer; box-shadow:0 6px 10px rgba(0,0,0,.30);
}
.panel{
  position:fixed; right:calc(env(safe-area-inset-right) + var(--edge-x)); bottom:calc(env(safe-area-inset-bottom) + var(--edge-y) + var(--fab) + 10px);
  width:var(--w); max-height:var(--maxh); display:flex; flex-direction:column; background:#fff; border:1px solid #e5e7eb; border-radius:10px;
  box-shadow:0 8px 30px rgba(0,0,0,.20); overflow:hidden; opacity:0; visibility:hidden; transform: translateY(8px) scale(.98);
  transition: .18s ease; z-index:2147483647;
}
.panel[data-open="1"]{ opacity:1; visibility:visible; transform: translateY(0) scale(1); }
.hdr{ display:flex; gap:8px; align-items:center; padding:8px 10px; border-bottom:1px solid #eee; background:#fafafa; }
.tabs{ display:flex; gap:6px; }
.tab{ border:1px solid #e5e7eb; padding:4px 8px; border-radius:8px; background:#fff; cursor:pointer; }
.tab[aria-selected="true"]{ background:#eef2ff; border-color:#c7d2fe; }
.sp{ flex:1; }
.btn{ border:0; background:transparent; cursor:pointer; padding:4px 6px; border-radius:6px; }
.row-grid{ display:grid; grid-template-columns: var(--left) 1fr; min-height:0; flex:1; }
.left{ display:flex; flex-direction:column; min-width:0; border-right:1px solid #f1f5f9; }
.left-h{ display:flex; align-items:center; gap:6px; padding:6px 8px; border-bottom:1px solid #f8fafc; background:#fff; position:sticky; top:0; z-index:1; }
.rec{ overflow:auto; min-height:0; }
.item{ display:grid; grid-template-columns:auto 1fr auto; gap:6px; align-items:center; padding:8px 10px; border-bottom:1px solid #f8fafc; cursor:pointer; }
.item:hover{ background:#f8fafc; }
.id{ color:#64748b; font-variant-numeric: tabular-nums; }
.lab{ white-space:nowrap; overflow:hidden; text-overflow:ellipsis; font-weight:600; }
.time{ color:#6b7280; font-size:12px; white-space:nowrap; }
.x{ border:0; background:transparent; cursor:pointer; padding:2px 6px; border-radius:6px; }
.view{ overflow:auto; min-height:160px; }
.bar{ padding:6px 8px; border-bottom:1px solid #f1f5f9; display:flex; gap:6px; align-items:center; }
.inp{ flex:1; padding:6px 8px; border:1px solid #e5e7eb; border-radius:8px; }
.go{ padding:6px 10px; border:1px solid #e5e7eb; border-radius:8px; background:#fff; cursor:pointer; }
.empty{ padding:12px 10px; color:#6b7280; }
.kv{ display:grid; grid-template-columns: 180px 1fr; gap:6px 12px; padding:10px; }
.tbl{ width:100%; border-collapse: collapse; margin:8px 0; }
.tbl th,.tbl td{ border:1px solid #e5e7eb; padding:6px 8px; text-align:left; }
@media (max-width: 920px){
  .panel{ width:min(96vw, var(--w)); right:min(calc(env(safe-area-inset-right) + var(--edge-x)), 3vw); }
  .row-grid{ grid-template-columns: 1fr; }
  .left{ border-right:0; border-bottom:1px solid #f1f5f9; }
}
`.trim();

  const fab = document.createElement('button');
  fab.className = 'fab ui';
  fab.setAttribute('aria-label','Open SC Hub');
  fab.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15a4 4 0 0 1-4 4H8l-5 4V7a4 4 0 0 1 4-4h10a4 4 0 0 1 4 4z"/><path d="M8 10h8M8 13h6"/></svg>`;

  const panel = document.createElement('section');
  panel.className = 'panel ui';
  panel.innerHTML = `
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

    <div class="bar" id="barOrd" style="display:none;">
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

  root.append(style, fab, panel);

  const setOpen = (v) => panel.setAttribute('data-open', v ? '1' : '0');
  const isOpen  = () => panel.getAttribute('data-open') === '1';

  // tab state
  let tab = 'msg';  // 'msg' | 'ord'
  let currentMsgId = null;
  let currentSalesId = null;
  const setTab = (t) => {
    tab = t;
    qs('#tabMsg').setAttribute('aria-selected', String(t==='msg'));
    qs('#tabOrd').setAttribute('aria-selected', String(t==='ord'));
    qs('#barMsg').style.display = t==='msg' ? '' : 'none';
    qs('#barOrd').style.display = t==='ord' ? '' : 'none';
    qs('#recHdr').textContent = t==='msg' ? 'Recent (Messages)' : 'Recent (Orders)';
    renderRecents();
  };

  // Recents rendering
  const recList = qs('#recList');
  function renderRecents(){
    const K = tab==='msg' ? REC_MSG : REC_ORD;
    const list = getRec(K);
    if (!list.length) { recList.innerHTML = `<div class="empty">No recent items.</div>`; return; }
    recList.innerHTML = list.map(it=>`
      <div class="item" data-id="${it.id}">
        <div class="id">#${it.id}</div>
        <div class="lab" title="${(it.lab||'').replaceAll('"','&quot;')}">${it.lab || '(no label)'}</div>
        <div class="time" title="${new Date(it.ts).toLocaleString()}">${fmtTime(it.ts)}</div>
        <button class="x" data-x="${it.id}" title="Remove">×</button>
      </div>
    `).join('');
  }

  // Message tab behavior
  const msgInput   = qs('#msgId');
  const btnMsgOpen = qs('#btnMsgOpen');
  const btnMsgPop  = qs('#btnMsgPop');
  const btnMsgRef  = qs('#btnMsgRefresh');
  const viewPane   = qs('#viewPane');

  async function loadMessage(id){
    if (!id) return;
    currentMsgId = id;
    btnMsgOpen.disabled = true; btnMsgPop.disabled = true;
    viewPane.innerHTML = `<div class="empty">Loading conversation ${id}…</div>`;
    try {
      const { html, description } = await window.fetchMCThread(id);
      const label = description || (() => {
        const div = document.createElement('div'); div.innerHTML = html;
        return (div.querySelector('strong,b,h1,h2,h3')?.textContent || div.textContent || '').replace(/\s+/g,' ').trim().slice(0,90);
      })();
      touchRec(REC_MSG, id, label);

      viewPane.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #f1f5f9;background:#fff;position:sticky;top:0;">
          <strong style="margin-right:8px;">#${id}</strong>
          <span style="color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${(label||'').replaceAll('"','&quot;')}">${label||''}</span>
          <span style="margin-left:auto"></span>
          <button class="go" id="btnMsgRefreshInline" title="Refresh">⟳</button>
          <button class="go" id="btnMsgPopInline" title="Popout">↗</button>
        </div>
        <div id="conversation_content_${id}" style="padding:8px 10px;"></div>
      `;
      qs('#conversation_content_'+id).innerHTML = html;
      btnMsgPop.disabled = false;
      on(qs('#btnMsgPopInline'), 'click', () => window.showMCThread?.(id));
      on(qs('#btnMsgRefreshInline'), 'click', () => loadMessage(currentMsgId));
      renderRecents();
    } catch (e) {
      viewPane.innerHTML = `<div class="empty" style="color:#b91c1c">Failed to load: ${e.message}</div>`;
    } finally {
      btnMsgOpen.disabled = false;
    }
  }

  // Provide the same popout from your existing script if present
  if (!window.showMCThread) {
    window.showMCThread = async function showMCThread(convoId) {
      const host = document.getElementById('mc-anywhere') || Object.assign(document.body.appendChild(document.createElement('div')), { id:'mc-anywhere' });
      Object.assign(host.style, { position:'fixed', right:'12px', bottom:'12px', width:'420px', maxHeight:'60vh', overflow:'auto', background:'#fff', border:'1px solid #e5e7eb', borderRadius:'8px', boxShadow:'0 8px 30px rgba(0,0,0,.2)', padding:'10px', zIndex:2147483647, font:'13px/1.4 system-ui,Segoe UI,Roboto,Inter,Arial,sans-serif' });
      host.innerHTML = `<div style="color:#6b7280">Loading conversation ${convoId}…</div>`;
      try {
        const { html } = await window.fetchMCThread(convoId);
        host.innerHTML = `
          <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
            <div style="font-weight:600">Conversation ${convoId}</div>
            <button aria-label="Close" style="border:0;background:transparent;font-size:18px;cursor:pointer" onclick="this.closest('#mc-anywhere').remove()">×</button>
          </div>
          <div id="conversation_content_${convoId}"></div>
        `;
        host.querySelector('#conversation_content_'+convoId).innerHTML = html;
      } catch (e) {
        host.innerHTML = `<div style="color:#b91c1c">Failed to load: ${e.message}</div>`;
      }
    };
  }

  // Orders tab behavior (SCORD)
  const ordInput   = qs('#salesId');
  const btnOrdOpen = qs('#btnOrdOpen');
  const btnOrdCopy = qs('#btnOrdCopy');

  function renderOrder(rec){
    const items = Array.isArray(rec.review_partsHandling) ? rec.review_partsHandling : [];
    const kv = [
      ['sales_id', rec.id],
      ['order_number', rec.order_number],
      ['status', rec.sales_status],
      ['total', rec.sales_total],
      ['billing_email', rec.billing_email],
      ['shipping_email', rec.shipping_email],
      ['date', rec.sales_date],
      ['shipment_type', rec.shipment_type],
    ].map(([k,v]) => `<div style="color:#6b7280">${k}</div><div>${v ?? ''}</div>`).join('');

    const rows = items.slice(0, 20).map(p =>
      `<tr><td>${p.sku||''}</td><td>${p.qty||''}</td><td>${p.length||''}</td><td>${(p.productionAttr||[]).map(a=>`${a.name}:${a.value}`).join('; ')}</td></tr>`
    ).join('');

    viewPane.innerHTML = `
      <div style="display:flex;align-items:center;gap:8px;padding:8px 10px;border-bottom:1px solid #f1f5f9;background:#fff;position:sticky;top:0;">
        <strong style="margin-right:8px;">#${rec.id}</strong>
        <span style="color:#334155;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;" title="${(rec.order_number||'').replaceAll('"','&quot;')}">${rec.order_number||''}</span>
        <span style="margin-left:auto;color:#475569">${rec.sales_status||''}</span>
      </div>
      <div class="kv">${kv}</div>
      ${items.length ? `
        <div style="padding:0 10px;"><strong>Items (${items.length})</strong></div>
        <table class="tbl">
          <thead><tr><th>SKU</th><th>Qty</th><th>Len</th><th>Attrs</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      ` : `<div class="empty">No items found on this record.</div>`}
    `;
  }

  async function loadOrder(id){
    if (!id) return;
    currentSalesId = id;
    btnOrdOpen.disabled = true; btnOrdCopy.disabled = true;
    viewPane.innerHTML = `<div class="empty">Loading order ${id}…</div>`;
    try {
      // XHR-first to avoid patched fetch races
      const rec = await SCORD.getOrder(id, { transport: 'xhr' });
      touchRec(REC_ORD, id, `${rec.order_number || ''} • ${rec.sales_status || ''}`);
      renderOrder(rec);
      // enable copy
      btnOrdCopy.disabled = false;
      btnOrdCopy.onclick = async () => {
        try { await navigator.clipboard.writeText(JSON.stringify(rec, null, 2)); btnOrdCopy.textContent='✓'; setTimeout(()=>btnOrdCopy.textContent='⧉', 900); }
        catch { alert('Clipboard unavailable'); }
      };
      renderRecents();
    } catch (e) {
      viewPane.innerHTML = `<div class="empty" style="color:#b91c1c">Failed to load: ${e.message}</div>`;
    } finally {
      btnOrdOpen.disabled = false;
    }
  }

  // wire events
  on(fab, 'click', () => setOpen(!isOpen()));
  on(qs('#btnClose'), 'click', () => setOpen(0));
  on(qs('#tabMsg'), 'click', () => setTab('msg'));
  on(qs('#tabOrd'), 'click', () => setTab('ord'));

  on(btnMsgOpen, 'click', () => { const id = parseId(msgInput.value); if (id) loadMessage(id); });
  on(btnMsgRef,  'click', () => { if (currentMsgId) loadMessage(currentMsgId); });
  on(btnMsgPop,  'click', () => { if (currentMsgId) window.showMCThread?.(currentMsgId); });
  on(msgInput, 'keydown', (e) => { if (e.key === 'Enter') { const id = parseId(msgInput.value); if (id) loadMessage(id); } });

  on(btnOrdOpen, 'click', () => { const id = parseId(ordInput.value); if (id) loadOrder(id); });
  on(ordInput, 'keydown', (e) => { if (e.key === 'Enter') { const id = parseId(ordInput.value); if (id) loadOrder(id); } });

  on(qs('#btnClearRec'), 'click', () => { clearRec(tab==='msg' ? REC_MSG : REC_ORD); renderRecents(); });

  // click recent
  on(recList, 'click', (e) => {
    const x = e.target.closest('[data-x]'); if (x) { rmRec(tab==='msg'?REC_MSG:REC_ORD, x.getAttribute('data-x')); return renderRecents(); }
    const row = e.target.closest('.item'); if (!row) return;
    const id = row.getAttribute('data-id');
    if (tab === 'msg') { msgInput.value = id; loadMessage(id); }
    else { ordInput.value = id; loadOrder(id); }
  });

  // hotkeys parity + new order hotkey
  document.addEventListener('keydown', (e) => {
    const key = e.key.toLowerCase();
    if (e.altKey && key === 'm') {
      const id = prompt('Open Message Center conversation ID:');
      const parsed = parseId(id);
      if (parsed) { setOpen(1); setTab('msg'); msgInput.value = parsed; loadMessage(parsed); }
    }
    if (e.altKey && key === 'o') {
      const id = prompt('Open Sales (Order) ID:');
      const parsed = parseId(id);
      if (parsed) { setOpen(1); setTab('ord'); ordInput.value = parsed; loadOrder(parsed); }
    }
  });

  // initial recents + ensure tab looks right
  setTab('msg'); renderRecents();
})();
