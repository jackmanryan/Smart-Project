// ==UserScript==
// @name         Message Center
// @namespace    mc-inline-refined
// @version      3.8.1
// @description  Inline Message Center overlay with fast thread index, caching, simulated progress, and inline Reply/New modals above the MC overlay. Conversation list uses clean row cards (no vertical text), header has Reply/New actions.
// @match        https://extranet.strip-curtains.com/?p=messagecenter
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(() => {
    'use strict';

    // ------------------------------------------------------------------
    // SAFETY: don't double-install
    // ------------------------------------------------------------------
    if (window.__mcInlineInstalledFastInlineCompose_3_8_1) return;
    window.__mcInlineInstalledFastInlineCompose_3_8_1 = true;

    // ------------------------------------------------------------------
    // CONFIG
    // ------------------------------------------------------------------
    const CFG = {
        THREAD_ENDPOINT: '/ajax/sales/loadMessages.php',
        CACHE_TTL_MS: 2 * 60 * 1000,  // cache freshness 2 min
        TIMEOUT_MS: 10 * 1000,
        PREFETCH_COUNT: 4,
        HOVER_PREFETCH_DELAY: 250,

        // simulated progress bar timing
        PROGRESS_FULL_MS: 22000,
        PROGRESS_TICK_MIN: 200,
        PROGRESS_TICK_RAND: 200,
        PROGRESS_CAP_BEFORE_FINISH: 92,

        // layout sizing
        CARD_MAX_W: 1000,  // px
        LEFT_COL_W: 320    // px
    };

    const DEBUG = true;
    const now = () => (performance?.now?.() ?? Date.now());

    function log(...args){ if(DEBUG) console.log('[MC]', ...args); }
    function warn(...args){ if(DEBUG) console.warn('[MC]', ...args); }

    const T = new Map();
    function makeOpId(label){ return label+'#'+Math.random().toString(36).slice(2,8); }
    function tStart(id,info={}){ if(!DEBUG)return; T.set(id,performance.now()); console.time('[MC] '+id); console.log('[MC]',id,'START',info); }
    function tEnd(id,extra={}){ if(!DEBUG)return; const t0=T.get(id); const nowp=performance.now(); console.timeEnd('[MC] '+id); console.log('[MC]',id,'Δ',t0?(nowp-t0).toFixed(1)+'ms':'(?)',extra); T.delete(id); }

    // ------------------------------------------------------------------
    // GLOBAL STATE
    // ------------------------------------------------------------------
    // orderTableCache: Map(orderUrl -> { ts, threadsArr[], newHrefAbs?, inflight?, iframeTried? })
    const orderTableCache = new Map();
    // threadCache: Map(convoId -> { ts, html, inflight?, ctrl? })
    const threadCache = new Map();

    const MC_STATE = {
        overlayBuilt: false,
        composeBuilt: false,

        currentOrderUrl: null,
        currentOrderId: null,
        currentInvoiceText: null,

        latestShownThreadId: null,

        // these drive header actions "Reply / New"
        activeThreadReplyHrefAbs: null, // reply for currently selected convo
        newConvHrefAbs: null,           // "Add Conversation" for the order

        // progress bar controller
        progressSim: null
    };

    // ------------------------------------------------------------------
    // UTILS
    // ------------------------------------------------------------------
    function absUrl(href){
        try { return new URL(href, location.origin).href; }
        catch { return href || ''; }
    }

    function $(sel,root=document){ return root.querySelector(sel); }
    function $all(sel,root=document){ return [...root.querySelectorAll(sel)]; }

    function cleanupCellText(td){
        if(!td) return '';
        return (td.textContent||'').trim().replace(/\s+/g,' ');
    }

    function escapeHTML(s){
        return (s ?? '').toString().replace(/[&<>"]/g, m => ({
            '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'
        }[m]));
    }

    // ------------------------------------------------------------------
    // CSS
    // light theme, rounded cards, flex row threads, header actions with Reply/New
    // compose overlay sits on higher z-index than main MC overlay
    // ------------------------------------------------------------------
    function injectStylesOnce(){
        if (document.getElementById('mc-inline-style')) return;
        const css = `
body.mc-no-scroll { overflow:hidden !important; }

/* MAIN MESSAGE CENTER OVERLAY */
#mc-inline-overlay{
  --mc-bg-card:#ffffff;
  --mc-bg-body:#f7f8fb;
  --mc-pane-bg:#ffffff;
  --mc-bd:#e5e7eb;
  --mc-ink:#111827;
  --mc-muted:#6b7280;
  --mc-accent:#0B66FF;
  --mc-chip-bg:#f9fafb;
  --mc-chip-bd:#e5e7eb;
  --mc-shadow:0 24px 60px rgba(0,0,0,.28);
  --mc-radius-card:12px;
  --mc-radius-block:10px;
  --mc-font:-apple-system,system-ui,"Segoe UI",Roboto,Inter,Arial,sans-serif;

  position:fixed;
  inset:0;
  z-index:2147483646; /* below compose */
  display:none;
  font-family:var(--mc-font);
  color:var(--mc-ink);
}
#mc-inline-overlay.mc-open{display:block;}

#mc-inline-overlay .mc-backdrop{
  position:absolute;
  inset:0;
  background:rgba(0,0,0,.25);
}

#mc-inline-overlay .mc-card{
  position:absolute;
  left:50%;
  top:50%;
  transform:translate(-50%,-50%);
  width:min(${CFG.CARD_MAX_W}px,92vw);
  max-height:80vh;
  min-height:420px;
  background:var(--mc-bg-card);
  border:1px solid var(--mc-bd);
  border-radius:var(--mc-radius-card);
  box-shadow:var(--mc-shadow);
  display:flex;
  flex-direction:column;
  overflow:hidden;
}

/* HEADER */
#mc-inline-overlay .mc-head{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  flex-wrap:nowrap;
  column-gap:12px;
  row-gap:8px;
  padding:12px 16px;
  background:var(--mc-bg-card);
  border-bottom:1px solid var(--mc-bd);
  position:relative;
  z-index:1;
  font-size:13px;
  line-height:1.4;
}
#mc-inline-overlay .mc-head-left{
  min-width:0;
  display:flex;
  flex-direction:column;
}
#mc-inline-overlay .mc-head-row1{
  display:flex;
  flex-wrap:nowrap;
  align-items:center;
  column-gap:6px;
  min-width:0;
}
#mc-inline-overlay .mc-head-icon{
  width:10px;
  height:10px;
  border-radius:2px;
  background:#1e40af;
  flex-shrink:0;
}
#mc-inline-overlay .mc-head-title{
  font-weight:600;
  color:var(--mc-ink);
  font-size:13px;
  line-height:1.4;
}
#mc-inline-overlay .mc-order-link{
  font-size:11px;
  line-height:1.3;
  color:var(--mc-accent);
  text-decoration:underline;
  max-width:60vw;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
#mc-inline-overlay .mc-order-link:hover{
  color:#000;
}
#mc-inline-overlay .mc-close-btn{
  border:0;
  background:transparent;
  font-size:18px;
  line-height:1;
  cursor:pointer;
  color:#666;
  padding:4px 6px;
  flex-shrink:0;
}
#mc-inline-overlay .mc-close-btn:hover{color:#000;}

/* BODY GRID */
#mc-inline-overlay .mc-body{
  flex:1 1 auto;
  min-height:0;
  padding:16px;
  background:var(--mc-bg-body);

  display:grid;
  grid-template-columns:${CFG.LEFT_COL_W}px 1fr;
  column-gap:16px;
  row-gap:16px;
  max-height:calc(80vh - 58px);
}
@media(max-width:800px){
  #mc-inline-overlay .mc-body{
    grid-template-columns:1fr;
    max-height:none;
  }
}

/* PANEL WRAPPER STYLE (the minimal white card look from .mc-pane) */
#mc-inline-overlay .mc-thread-pane,
#mc-inline-overlay .mc-chat-pane{
  background:#fff;
  border:1px solid var(--mc-bd);
  border-radius:10px;
  min-height:0;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}

/* LEFT PANE HEADER */
#mc-inline-overlay .mc-pane-head{
  flex-shrink:0;
  padding:8px 10px;
  font-size:12px;
  font-weight:600;
  border-bottom:1px solid var(--mc-bd);
  background:#fff;
  color:var(--mc-ink);
}

/* LEFT PANE LIST AREA */
#mc-inline-overlay .mc-threads-list{
  flex:1 1 auto;
  min-height:0;
  max-height:100%;
  overflow-y:auto;
  overflow-x:hidden;
  background:#fff;
  font-size:12px;
  line-height:1.4;
  color:var(--mc-ink);
  padding:0;
}

/* THREAD ROW CARD STYLE */
#mc-inline-overlay .mc-thread-row{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  column-gap:12px;
  padding:10px 12px;
  border-bottom:1px solid var(--mc-bd);
  background:#fff;
  cursor:pointer;
}
#mc-inline-overlay .mc-thread-row:last-child{
  border-bottom:none;
}
#mc-inline-overlay .mc-thread-row:hover{
  background:#f9fafb;
}
#mc-inline-overlay .mc-thread-main{
  min-width:0;
  flex:1 1 auto;
}
#mc-inline-overlay .mc-thread-subj{
  font-weight:600;
  color:var(--mc-ink);
  font-size:12px;
  line-height:1.4;
  margin-bottom:2px;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
#mc-inline-overlay .mc-thread-route{
  color:var(--mc-muted);
  font-size:11px;
  line-height:1.4;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
#mc-inline-overlay .mc-thread-side{
  flex-shrink:0;
  min-width:max-content;
  text-align:right;
  font-size:11px;
  line-height:1.4;
  color:var(--mc-muted);
  display:flex;
  flex-direction:column;
  align-items:flex-end;
  row-gap:6px;
}
#mc-inline-overlay .mc-thread-date{
  color:var(--mc-muted);
  font-size:11px;
  line-height:1.4;
  white-space:nowrap;
}

/* skeleton lines for initial loading */
@keyframes mcShine{0%{background-position:200% 0;}100%{background-position:-200% 0;}}
#mc-inline-overlay .mc-skel-line{
  background:linear-gradient(90deg,#eee,#f6f6f6,#eee);
  background-size:200% 100%;
  animation:mcShine 1s linear infinite;
  height:10px;
  border-radius:4px;
  margin:10px 12px;
}

/* RIGHT PANE (CHAT) */
#mc-inline-overlay .mc-chat-head{
  flex-shrink:0;
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  flex-wrap:nowrap;
  gap:12px;

  padding:12px;
  border-bottom:1px solid var(--mc-bd);
  background:#fff;
  font-size:13px;
  line-height:1.4;
}
#mc-inline-overlay .mc-chat-head-main{
  flex:1 1 auto;
  min-width:0;
}
#mc-inline-overlay .mc-chat-subject{
  font-weight:700;
  color:var(--mc-ink);
  font-size:13px;
  line-height:1.4;
  white-space:nowrap;
  overflow:hidden;
  text-overflow:ellipsis;
}
#mc-inline-overlay .mc-chat-meta{
  font-size:12px;
  margin-top:2px;
  color:var(--mc-muted);
  word-break:break-word;
}

/* progress bar during initial scrape */
#mc-inline-overlay .mc-progress-wrap{
  height:4px;
  background:var(--mc-bd);
  border-radius:9999px;
  overflow:hidden;
  margin-top:8px;
  display:none;
}
#mc-inline-overlay .mc-progress-bar{
  height:100%;
  background:var(--mc-accent);
  width:0%;
  transition:width .2s linear;
}

/* header actions (Reply/New) */
#mc-inline-overlay .mc-chat-head-actions{
  flex-shrink:0;
  display:flex;
  flex-wrap:wrap;
  gap:6px;
  align-items:flex-start;
  max-width:40%;
}
#mc-inline-overlay .mc-btn{
  display:inline-block;
  font-size:12px;
  line-height:1.2;
  font-weight:600;
  padding:6px 8px;
  border-radius:6px;
  border:1px solid var(--mc-accent);
  background:var(--mc-accent);
  color:#fff;
  text-decoration:none;
  cursor:pointer;
  white-space:nowrap;
}
#mc-inline-overlay .mc-btn:hover{
  filter:brightness(.95);
}
#mc-inline-overlay .mc-btn-secondary{
  background:#fff;
  color:var(--mc-accent);
}
#mc-inline-overlay .mc-btn-secondary:hover{
  background:#eef4ff;
  filter:none;
}
#mc-inline-overlay .mc-btn-disabled{
  opacity:.4;
  cursor:default;
  pointer-events:none;
}

/* chat history */
#mc-inline-overlay .mc-chat-history{
  flex:1 1 auto;
  min-height:0;
  max-height:100%;
  overflow-y:auto;
  overflow-x:hidden;
  padding:12px;
  background:#fff;

  font-size:13px;
  line-height:1.4;
  color:var(--mc-ink);
  word-break:break-word;
  display:grid;
  row-gap:12px;
}
#mc-inline-overlay .mc-bubble{
  background:var(--mc-chip-bg);
  border:1px solid var(--mc-chip-bd);
  border-radius:8px;
  padding:10px 12px;
  white-space:pre-wrap;
  word-break:break-word;
  font-size:13px;
  line-height:1.4;
  color:var(--mc-ink);
}
#mc-inline-overlay .mc-bubble-head{
  display:flex;
  flex-wrap:wrap;
  gap:8px;
  font-size:12px;
  color:#374151;
  margin-bottom:4px;
}
#mc-inline-overlay .mc-bubble-from{
  font-weight:700;
  color:#111827;
}
#mc-inline-overlay .mc-bubble-time{
  color:#6b7280;
}
#mc-inline-overlay .mc-bubble-body{
  color:#111827;
  font-size:13px;
  line-height:1.4;
}
#mc-inline-overlay .mc-bubble-loading{
  background:transparent;
  border:1px dashed var(--mc-bd);
  color:#6b7280;
  text-align:center;
  font-size:12px;
  line-height:1.4;
  padding:24px 12px;
}

/* ===========================================================
   COMPOSE OVERLAY  (Reply / Add Conversation) ABOVE main MC
   =========================================================== */
#mc-compose-overlay{
  --mc-bg-card:#fff;
  --mc-bd:#e5e7eb;
  --mc-ink:#111827;
  --mc-muted:#6b7280;
  --mc-font:-apple-system,system-ui,"Segoe UI",Roboto,Inter,Arial,sans-serif;

  position:fixed;
  inset:0;
  z-index:2147483647; /* above message center overlay */
  display:none;
  font-family:var(--mc-font);
  color:var(--mc-ink);
}
#mc-compose-overlay.mc-open{display:block;}
#mc-compose-overlay .mc-compose-backdrop{
  position:absolute;
  inset:0;
  background:rgba(0,0,0,.4);
}
#mc-compose-overlay .mc-compose-card{
  position:absolute;
  left:50%;
  top:50%;
  transform:translate(-50%,-50%);
  background:#fff;
  border:1px solid var(--mc-bd);
  border-radius:12px;
  box-shadow:0 24px 60px rgba(0,0,0,.45);
  width:min(700px,90vw);
  max-height:80vh;
  min-height:300px;
  display:flex;
  flex-direction:column;
  overflow:hidden;
}

/* compose header */
#mc-compose-overlay .mc-compose-head{
  display:flex;
  justify-content:space-between;
  align-items:flex-start;
  padding:12px 16px;
  border-bottom:1px solid var(--mc-bd);
  background:#fff;
  font-size:13px;
  line-height:1.4;
  font-weight:600;
  color:#111827;
}
#mc-compose-overlay .mc-compose-title{
  font-weight:600;
  font-size:13px;
  line-height:1.4;
}
#mc-compose-overlay .mc-compose-close{
  border:0;
  background:transparent;
  font-size:18px;
  line-height:1;
  cursor:pointer;
  color:#666;
  padding:4px 6px;
}
#mc-compose-overlay .mc-compose-close:hover{color:#000;}

/* compose body */
#mc-compose-overlay .mc-compose-body{
  flex:1 1 auto;
  min-height:0;
  overflow:auto;
  background:#fff;
  padding:16px;
  font-size:13px;
  line-height:1.4;
  color:#111827;
}

/* normalize legacy modal markup inside compose overlay */
#mc-compose-overlay .panel.panel-default{
  border:0 !important;
  box-shadow:none !important;
  background:transparent !important;
  margin:0 !important;
}
#mc-compose-overlay .panel-heading{
  display:none !important;
}
#mc-compose-overlay .panel-body{
  background:#fff !important;
  border:0 !important;
  padding:0 !important;
  color:#111827 !important;
  font-size:13px !important;
  line-height:1.4 !important;
}
#mc-compose-overlay .form-group{
  margin-bottom:12px !important;
  font-size:13px !important;
  line-height:1.4 !important;
  color:#111827 !important;
}
#mc-compose-overlay label{
  font-weight:600 !important;
  color:#374151 !important;
  display:block !important;
  margin-bottom:4px !important;
  font-size:12px !important;
  line-height:1.4 !important;
}
#mc-compose-overlay .form-control,
#mc-compose-overlay textarea.form-control,
#mc-compose-overlay input.form-control,
#mc-compose-overlay select.form-control{
  width:100% !important;
  max-width:100% !important;
  display:block !important;
  border:1px solid #d1d5db !important;
  border-radius:6px !important;
  font-size:13px !important;
  line-height:1.4 !important;
  padding:6px 8px !important;
  background:#fff !important;
  color:#111827 !important;
  box-shadow:none !important;
}
#mc-compose-overlay textarea.form-control{
  min-height:140px !important;
  height:140px !important;
  max-height:260px !important;
  overflow-y:auto !important;
}
#mc-compose-overlay #cc_list{
  border:1px solid #d1d5db !important;
  border-radius:6px !important;
  margin-top:6px !important;
  max-height:140px !important;
  overflow-y:auto !important;
  padding-top:8px !important;
  padding-left:8px !important;
  font-size:13px !important;
  line-height:1.4 !important;
}
#mc-compose-overlay .btn.btn-success{
  background:#10b981 !important;
  border:1px solid #059669 !important;
  border-radius:6px !important;
  font-size:13px !important;
  line-height:1.4 !important;
  font-weight:600 !important;
  color:#fff !important;
  padding:6px 10px !important;
  cursor:pointer;
}
#mc-compose-overlay .btn.btn-success:hover{
  filter:brightness(.95);
}
`;
        try { GM_addStyle?.(css); }
        catch {
            const st = document.createElement('style');
            st.id = 'mc-inline-style';
            st.textContent = css;
            document.head.appendChild(st);
        }
    }
    injectStylesOnce();

    // ------------------------------------------------------------------
    // BUILD MAIN OVERLAY DOM
    // ------------------------------------------------------------------
    function buildMainOverlayIfNeeded(){
        if (MC_STATE.overlayBuilt) return;
        MC_STATE.overlayBuilt = true;

        const overlay = document.createElement('div');
        overlay.id = 'mc-inline-overlay';
        overlay.innerHTML = `
      <div class="mc-backdrop"></div>
      <div class="mc-card" role="dialog" aria-modal="true" aria-label="Message Center">
        <header class="mc-head">
          <div class="mc-head-left">
            <div class="mc-head-row1">
              <div class="mc-head-icon"></div>
              <div class="mc-head-title">Message Center</div>
            </div>
            <a class="mc-order-link" id="mc-order-link" href="#" target="_blank" rel="noopener noreferrer">Invoice #</a>
          </div>
          <button class="mc-close-btn" id="mc-close-btn" aria-label="Close">×</button>
        </header>

        <div class="mc-body">
          <!-- LEFT COLUMN -->
          <section class="mc-thread-pane">
            <div class="mc-pane-head">Conversations</div>
            <div class="mc-threads-list" id="mc-thread-list">
              <!-- skeleton placeholder -->
              <div class="mc-skel-line" style="width:80%"></div>
              <div class="mc-skel-line" style="width:40%"></div>
              <div class="mc-skel-line" style="width:60%"></div>
            </div>
          </section>

          <!-- RIGHT COLUMN -->
          <section class="mc-chat-pane">
            <header class="mc-chat-head">
              <div class="mc-chat-head-main">
                <div class="mc-chat-subject" id="mc-chat-subject">Loading…</div>
                <div class="mc-chat-meta" id="mc-chat-meta"></div>
                <div class="mc-progress-wrap" id="mc-progress-wrap">
                  <div class="mc-progress-bar" id="mc-progress-bar" style="width:0%"></div>
                </div>
              </div>

              <div class="mc-chat-head-actions" id="mc-chat-head-actions">
                <!-- Reply / New get injected here -->
              </div>
            </header>

            <div class="mc-chat-history" id="mc-chat-history">
              <div class="mc-bubble mc-bubble-loading">
                <div class="mc-skel-line" style="width:90%"></div>
                <div class="mc-skel-line" style="width:70%"></div>
                <div class="mc-skel-line" style="width:60%"></div>
              </div>
            </div>
          </section>
        </div>
      </div>
    `;
        document.body.appendChild(overlay);

        // events
        $('#mc-close-btn', overlay)?.addEventListener('click', closeMainOverlay);
        overlay.addEventListener('click',(e)=>{
            if(e.target===overlay.querySelector('.mc-backdrop')) closeMainOverlay();
        });
        document.addEventListener('keydown',(e)=>{
            if(e.key==='Escape'){
                if (isComposeOpen()) {
                    closeComposeOverlay();
                } else if (isMainOpen()) {
                    closeMainOverlay();
                }
            }
        });
    }

    function isMainOpen(){
        return $('#mc-inline-overlay')?.classList.contains('mc-open');
    }
    function openMainOverlay(orderUrl, invoiceText){
        buildMainOverlayIfNeeded();

        MC_STATE.currentOrderUrl    = orderUrl;
        MC_STATE.currentOrderId     = parseOrderIdFromUrl(orderUrl);
        MC_STATE.currentInvoiceText = invoiceText || ('Invoice #'+(MC_STATE.currentOrderId||''));

        MC_STATE.activeThreadReplyHrefAbs = null;
        MC_STATE.newConvHrefAbs = null;
        renderChatHeadActions(); // clears header buttons initially

        const overlay = $('#mc-inline-overlay');
        overlay.classList.add('mc-open');
        document.body.classList.add('mc-no-scroll');

        // header link
        const linkEl = $('#mc-order-link');
        if(linkEl){
            linkEl.textContent = MC_STATE.currentInvoiceText;
            linkEl.href = orderUrl;
        }

        // reset right pane placeholders
        $('#mc-chat-subject').textContent = 'Loading…';
        $('#mc-chat-meta').textContent = '';
        $('#mc-chat-history').innerHTML = `
      <div class="mc-bubble mc-bubble-loading">
        <div class="mc-skel-line" style="width:90%"></div>
        <div class="mc-skel-line" style="width:70%"></div>
        <div class="mc-skel-line" style="width:60%"></div>
      </div>
    `;

        // reset progress bar & start ticking immediately
        startProgressSimulation();

        // reset left pane skeleton
        $('#mc-thread-list').innerHTML = `
      <div class="mc-skel-line" style="width:80%"></div>
      <div class="mc-skel-line" style="width:40%"></div>
      <div class="mc-skel-line" style="width:60%"></div>
    `;

        // load convos for this order
        loadOrderMessageTableProgressive(orderUrl);
    }
    function closeMainOverlay(){
        const overlay = $('#mc-inline-overlay');
        if(!overlay) return;
        overlay.classList.remove('mc-open');
        document.body.classList.remove('mc-no-scroll');
        // also close compose if it's up
        closeComposeOverlay();
    }

    // ------------------------------------------------------------------
    // BUILD COMPOSE OVERLAY DOM (Reply / New) - sits ABOVE MC overlay
    // ------------------------------------------------------------------
    function buildComposeOverlayIfNeeded(){
        if (MC_STATE.composeBuilt) return;
        MC_STATE.composeBuilt = true;

        const comp = document.createElement('div');
        comp.id = 'mc-compose-overlay';
        comp.innerHTML = `
      <div class="mc-compose-backdrop"></div>
      <div class="mc-compose-card" role="dialog" aria-modal="true" aria-label="Compose Message">
        <header class="mc-compose-head">
          <div class="mc-compose-title" id="mc-compose-title">Compose</div>
          <button class="mc-compose-close" id="mc-compose-close" aria-label="Close">×</button>
        </header>
        <div class="mc-compose-body" id="mc-compose-body">
          <div style="font-size:13px;line-height:1.4;color:#6b7280;">
            Loading…
          </div>
        </div>
      </div>
    `;
        document.body.appendChild(comp);

        $('#mc-compose-close', comp)?.addEventListener('click', closeComposeOverlay);
        comp.addEventListener('click',(e)=>{
            if(e.target===comp.querySelector('.mc-compose-backdrop')){
                closeComposeOverlay();
            }
        });
    }

    function isComposeOpen(){
        return $('#mc-compose-overlay')?.classList.contains('mc-open');
    }
    function openComposeOverlay(){
        buildComposeOverlayIfNeeded();
        $('#mc-compose-overlay').classList.add('mc-open');
    }
    function closeComposeOverlay(){
        const c = $('#mc-compose-overlay');
        if(!c) return;
        c.classList.remove('mc-open');
    }

    async function openComposeOverlayAbsUrl(absHref, fallbackTitle){
        openComposeOverlay();

        const titleEl = $('#mc-compose-title');
        const bodyEl  = $('#mc-compose-body');

        titleEl.textContent = fallbackTitle || 'Compose';
        bodyEl.innerHTML = `<div style="font-size:13px;line-height:1.4;color:#6b7280;">Loading…</div>`;

        let htmlText = '';
        try{
            const res = await fetch(absHref,{credentials:'include'});
            htmlText = await res.text();
        }catch(err){
            warn('compose fetch failed', err);
            bodyEl.innerHTML = `<div style="color:#b91c1c;font-size:13px;">Failed to load.</div>`;
            return;
        }

        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlText,'text/html');

        // try to find panel markup
        let panel = doc.querySelector('.panel.panel-default');
        if(!panel){
            panel = doc.body || doc.documentElement;
        }

        // update title from remote heading if present
        const ph = panel.querySelector('.panel-heading');
        if(ph){
            const t = ph.textContent.trim();
            if(t) titleEl.textContent = t;
        }

        // inject cloned panel body into our compose-body
        bodyEl.innerHTML = '';
        bodyEl.appendChild(panel.cloneNode(true));

        // also run their inline scripts (ajax submit, etc)
        const scripts = $all('script', doc);
        scripts.forEach(orig=>{
            const s = document.createElement('script');
            if (orig.src){
                s.src = orig.src;
            } else {
                s.textContent = orig.textContent || '';
            }
            bodyEl.appendChild(s);
        });
    }

    // ------------------------------------------------------------------
    // THREAD INDEX PARSING / RENDER
    // ------------------------------------------------------------------
    function parseThreadsFromHTML(rawHTML){
        const doc = new DOMParser().parseFromString(rawHTML,'text/html');
        const block = doc.querySelector('#MessageCenter-Block, #MessageCentre-Block');
        if(!block){
            return { threadsArr:[], newHrefAbs:null };
        }

        // detect "new conversation" link in the fetched HTML
        // look for /views/modal/add_conversation.php?id=...
        let newHrefAbs = null;
        const newCand = block.querySelector('a[href*="add_conversation"]')
        || block.querySelector('a[href*="add_sales_messagecenter"]');
        if(newCand){
            newHrefAbs = absUrl(newCand.getAttribute('href'));
        }

        const trs = block.querySelectorAll('tbody tr');
        const threadsArr = [];
        trs.forEach(tr=>{
            const tds = tr.children;
            if(!tds || tds.length < 5) return;

            // subject anchor with grabMessages()
            const subjA = tr.querySelector('a[onclick*="grabMessages"]');
            if(!subjA) return;
            const onClick = subjA.getAttribute('onclick')||'';
            const m = onClick.match(/grabMessages\s*\(\s*(\d+)\s*\)/);
            if(!m) return;
            const convoId = m[1];

            const fromTxt    = cleanupCellText(tds[1]);
            const toTxt      = cleanupCellText(tds[2]);
            const ccTxt      = cleanupCellText(tds[3]); // not currently shown but we keep it
            const subjectTxt = (subjA.textContent||'').trim().replace(/\s+/g,' ');
            const dateTxt    = cleanupCellText(tds[5]);

            // reply link for this thread
            let replyHrefAbs = null;
            const replyA = tr.querySelector('a[href*="reply_message.php"]');
            if(replyA){
                replyHrefAbs = absUrl(replyA.getAttribute('href')||'');
            }

            threadsArr.push({
                id: convoId,
                subject: subjectTxt,
                from: fromTxt,
                to: toTxt,
                cc: ccTxt,
                date: dateTxt,
                replyHrefAbs
            });
        });

        return { threadsArr, newHrefAbs };
    }

    function renderThreadListFromArr(threadsArr){
        const listPane = $('#mc-thread-list');
        if(!listPane) return;

        if(!threadsArr || !threadsArr.length){
            listPane.innerHTML = `<div style="font-size:12px;color:#6b7280;padding:12px;">No conversations.</div>`;
            return;
        }

        let html = '';
        for(const th of threadsArr){
            html += `
        <div class="mc-thread-row"
             data-id="${escapeHTML(th.id||'')}"
             data-subj="${escapeHTML(th.subject||'')}"
             data-from="${escapeHTML(th.from||'')}"
             data-to="${escapeHTML(th.to||'')}"
             data-date="${escapeHTML(th.date||'')}">
          <div class="mc-thread-main">
            <div class="mc-thread-subj">${escapeHTML(th.subject||'(no subject)')}</div>
            <div class="mc-thread-route">
              ${escapeHTML(th.from||'')} → ${escapeHTML(th.to||'')}
            </div>
          </div>
          <div class="mc-thread-side">
            <div class="mc-thread-date">${escapeHTML(th.date||'')}</div>
            ${th.replyHrefAbs ? `<a class="mc-btn" data-mc-inline-reply="1" data-href="${escapeHTML(th.replyHrefAbs)}">Reply</a>`:''}
          </div>
        </div>
      `;
        }

        listPane.innerHTML = html;
        installListDelegationOnce(); // make sure click/hover listeners are bound
    }

    // auto-open first (most recent) thread in the list after we render it
    function autoSelectFirstThreadAfterList(threadsArr){
        if (!threadsArr || !threadsArr.length) return;

        const first = threadsArr[0];
        if (!first) return;

        // set active reply link so header actions (Reply/New) are correct
        MC_STATE.activeThreadReplyHrefAbs = first.replyHrefAbs || null;
        renderChatHeadActions();

        // build the tiny header meta string for right pane
        const routeText = `From: ${first.from || ''} → ${first.to || ''}` +
              (first.date ? ` · ${first.date}` : '');

        // actually load that thread into the chat pane
        loadThread(first.id, {
            subject: first.subject || '',
            route: routeText,
            replyHrefAbs: first.replyHrefAbs || null
        });
    }


    // cache helpers for order table
    function freshOrderTable(orderUrl){
        const entry = orderTableCache.get(orderUrl);
        if(!entry) return null;
        if((Date.now()-entry.ts)<CFG.CACHE_TTL_MS && entry.threadsArr && entry.threadsArr.length){
            return entry;
        }
        return null;
    }
    function saveOrderTable(orderUrl, data){
        // data: {threadsArr,newHrefAbs}
        orderTableCache.set(orderUrl,{
            threadsArr: data.threadsArr || [],
            newHrefAbs: data.newHrefAbs || null,
            ts: Date.now()
        });
    }

    async function loadOrderMessageTableProgressive(orderUrl){
        const opId = makeOpId('fetchOrderThreads:'+parseOrderIdFromUrl(orderUrl));
        tStart(opId,{orderUrl});

        const cached = freshOrderTable(orderUrl);
        if(cached){
            renderThreadListFromArr(cached.threadsArr);

            // store new-convo href in state
            MC_STATE.newConvHrefAbs = cached.newHrefAbs || buildAddConvFallback();
            renderChatHeadActions(); // refresh New button

            // immediately open newest thread
            autoSelectFirstThreadAfterList(cached.threadsArr);

            finishProgressEarly();
            prefetchTopNThreads();
            tEnd(opId,{cache:true});
            return;
        }


        let existing = orderTableCache.get(orderUrl);
        if(existing?.inflight){
            const pack = await existing.inflight;
            if (pack?.threadsArr){
                renderThreadListFromArr(pack.threadsArr);

                MC_STATE.newConvHrefAbs = pack.newHrefAbs || buildAddConvFallback();
                renderChatHeadActions();

                // immediately open newest thread
                autoSelectFirstThreadAfterList(pack.threadsArr);

                finishProgressEarly();
                prefetchTopNThreads();
            }
            tEnd(opId,{joined:true});
            return;
        }


        const inflight = (async ()=>{
            let rawHTML = '';
            try{
                const res = await fetch(orderUrl,{credentials:'include'});
                rawHTML = await res.text();
            }catch(err){
                warn('orderUrl fetch fail', orderUrl, err);
            }

            // parse final
            let finalPack = {threadsArr:[],newHrefAbs:null};
            if(rawHTML){
                finalPack = parseThreadsFromHTML(rawHTML);
            }

            // if we still didn't get a "new conversation" link in the HTML, build fallback
            if(!finalPack.newHrefAbs){
                finalPack.newHrefAbs = buildAddConvFallback();
            }

            if(!finalPack.threadsArr.length){
                // fallback: iframe attempt (rare)
                if(!existing?.iframeTried){
                    existing = existing || {};
                    existing.iframeTried = true;
                    orderTableCache.set(orderUrl, existing);

                    const iframeHTML = await iframeExtractMessageTable(orderUrl);
                    if(iframeHTML){
                        finalPack = parseThreadsFromHTML(`<div>${iframeHTML}</div>`);
                        if(!finalPack.newHrefAbs){
                            finalPack.newHrefAbs = buildAddConvFallback();
                        }
                    }
                }
            }

            // paint
            renderThreadListFromArr(finalPack.threadsArr);
            MC_STATE.newConvHrefAbs = finalPack.newHrefAbs || buildAddConvFallback();
            renderChatHeadActions();

            // immediately open newest thread
            autoSelectFirstThreadAfterList(finalPack.threadsArr);

            finishProgressEarly();
            saveOrderTable(orderUrl, finalPack);
            prefetchTopNThreads();


            return finalPack;
        })();

        orderTableCache.set(orderUrl,{
            ...(existing||{}),
            inflight,
            ts: Date.now()
        });

        await inflight;
        tEnd(opId);
    }

    // iframe fallback used above
    function iframeExtractMessageTable(orderUrl){
        return new Promise(resolve=>{
            const frame = document.createElement('iframe');
            frame.style.position='absolute';
            frame.style.left='-99999px';
            frame.style.top='-99999px';
            frame.style.width='800px';
            frame.style.height='600px';
            frame.style.visibility='hidden';
            frame.onload = ()=>{
                try{
                    const b = frame.contentDocument.querySelector('#MessageCenter-Block, #MessageCentre-Block');
                    resolve(b ? b.innerHTML : null);
                }catch{
                    resolve(null);
                }finally{
                    frame.remove();
                }
            };
            frame.src = orderUrl;
            document.body.appendChild(frame);
        });
    }

    // fallback new-convo href if HTML didn't expose one
    function buildAddConvFallback(){
        // /views/modal/add_conversation.php?id=<orderId>
        if(MC_STATE.currentOrderId){
            return absUrl(`/views/modal/add_conversation.php?id=${MC_STATE.currentOrderId}`);
        }
        return null;
    }

    // ------------------------------------------------------------------
    // THREAD FETCH / RENDER (RIGHT PANE)
    // ------------------------------------------------------------------
    function cacheGetFreshThread(id){
        const e = threadCache.get(id);
        if(!e) return null;
        if((Date.now()-e.ts)<CFG.CACHE_TTL_MS && e.html) return e;
        return null;
    }

    function saveThread(id, html){
        threadCache.set(id,{html,ts:Date.now()});
    }

    function abortInFlightThreadOthers(exceptId){
        threadCache.forEach((v,k)=>{
            if(k===exceptId) return;
            if(v?.ctrl){
                try{ v.ctrl.abort('superseded'); }catch{}
            }
        });
    }

    async function fetchThreadHTML(id,{revalidate=false}={}){
        const cached = threadCache.get(id);
        if(cached?.inflight) return cached.inflight;

        const ctrl = new AbortController();
        const timer = setTimeout(()=>ctrl.abort('timeout'), CFG.TIMEOUT_MS);

        const inflight = (async ()=>{
            try{
                const fd = new FormData();
                fd.append('id', id);
                const res = await fetch(CFG.THREAD_ENDPOINT,{
                    method:'POST',
                    body:fd,
                    credentials:'include',
                    signal:ctrl.signal
                });
                const raw = await res.text();
                let data;
                try { data = JSON.parse(raw); } catch(e){ data=null; }
                if(data?.type==='success'){
                    saveThread(id, data.html);
                    return data.html;
                }
                throw new Error((data && data.description)||'Server error');
            }finally{
                clearTimeout(timer);
                const ent = threadCache.get(id);
                if(ent){
                    delete ent.inflight;
                    delete ent.ctrl;
                }
            }
        })();

        threadCache.set(id,{...(cached||{}),inflight,ctrl});
        return inflight;
    }

    async function prefetchThread(id){
        if(cacheGetFreshThread(id)) return;
        try{ await fetchThreadHTML(id); }catch{/* ignore */ }
    }

    async function loadThread(convoId, meta={}){
        MC_STATE.latestShownThreadId = String(convoId);
        abortInFlightThreadOthers(convoId);

        const subjectEl = $('#mc-chat-subject');
        const metaEl    = $('#mc-chat-meta');
        const histEl    = $('#mc-chat-history');

        // Fill header right away from clicked row
        if(meta){
            if(meta.subject) subjectEl.textContent = meta.subject;
            metaEl.textContent = meta.route || '';
            if(meta.replyHrefAbs){
                MC_STATE.activeThreadReplyHrefAbs = meta.replyHrefAbs;
            }
            renderChatHeadActions();
        }

        // show cached immediately if any
        const fresh = cacheGetFreshThread(convoId);
        if(fresh){
            histEl.innerHTML = fresh.html;
            // background refresh (SWR)
            fetchThreadHTML(convoId,{revalidate:true})
                .then(html=>{
                if(MC_STATE.latestShownThreadId===String(convoId)){
                    histEl.innerHTML = html;
                }
            })
                .catch(()=>{});
            return;
        }

        // skeleton while loading
        histEl.innerHTML = `
      <div class="mc-bubble mc-bubble-loading">
        <div class="mc-skel-line" style="width:90%"></div>
        <div class="mc-skel-line" style="width:70%"></div>
        <div class="mc-skel-line" style="width:60%"></div>
      </div>
    `;

        try{
            const html = await fetchThreadHTML(convoId);
            if(MC_STATE.latestShownThreadId===String(convoId)){
                histEl.innerHTML = html;
            }
            log('thread rendered', convoId);
        }catch(err){
            if(MC_STATE.latestShownThreadId===String(convoId)){
                histEl.innerHTML = `<div style="font-size:12px;color:#b91c1c;">Failed to load conversation.</div>`;
            }
            warn('thread load failed', convoId, err);
        }
    }

    // Prefetch first few
    function prefetchTopNThreads(){
        const listPane = $('#mc-thread-list');
        if(!listPane) return;
        const ids = [...listPane.querySelectorAll('.mc-thread-row')]
        .slice(0, CFG.PREFETCH_COUNT)
        .map(row => row.getAttribute('data-id'))
        .filter(Boolean);

        ids.forEach((id,i)=>{
            setTimeout(()=>prefetchThread(id), 150 + i*150);
        });
    }

    // ------------------------------------------------------------------
    // CLICK / HOVER DELEGATION IN LEFT PANE
    //  - click on .mc-thread-row loads that convo
    //  - click on inline Reply button opens compose overlay
    //  - hover prefetch
    // ------------------------------------------------------------------
    function installListDelegationOnce(){
        const listPane = $('#mc-thread-list');
        if(!listPane || listPane.__mcDelegated) return;
        listPane.__mcDelegated = true;

        let hoverTimer = null;

        listPane.addEventListener('click',(ev)=>{
            // handle inline Reply in list
            const replyBtn = ev.target.closest('[data-mc-inline-reply]');
            if(replyBtn){
                ev.preventDefault();
                ev.stopPropagation();
                const hrefAbs = absUrl(replyBtn.getAttribute('data-href')||'');
                openComposeOverlayAbsUrl(hrefAbs,'Reply');
                return;
            }

            // otherwise, load convo on row click
            const row = ev.target.closest('.mc-thread-row');
            if(!row) return;

            ev.preventDefault();
            ev.stopPropagation();

            const convoId = row.getAttribute('data-id');
            if(!convoId) return;

            const subjectText = row.getAttribute('data-subj') || '';
            const fromTxt     = row.getAttribute('data-from') || '';
            const toTxt       = row.getAttribute('data-to') || '';
            const dateTxt     = row.getAttribute('data-date') || '';
            const routeText   = `From: ${fromTxt} → ${toTxt}${dateTxt?` · ${dateTxt}`:''}`;

            const replyHrefAbs = row.querySelector('[data-mc-inline-reply]')?.getAttribute('data-href') || null;
            MC_STATE.activeThreadReplyHrefAbs = replyHrefAbs;
            renderChatHeadActions();

            loadThread(convoId,{
                subject: subjectText,
                route: routeText,
                replyHrefAbs
            });
        }, {capture:true});

        listPane.addEventListener('mouseenter',(ev)=>{
            const row = ev.target.closest('.mc-thread-row');
            if(!row) return;
            const id = row.getAttribute('data-id');
            if(!id) return;
            clearTimeout(hoverTimer);
            hoverTimer = setTimeout(()=>prefetchThread(id), CFG.HOVER_PREFETCH_DELAY);
        }, true);
    }

    // ------------------------------------------------------------------
    // HEADER ACTIONS (Reply/New buttons in chat header)
    // ------------------------------------------------------------------
    function renderChatHeadActions(){
        const act = $('#mc-chat-head-actions');
        if(!act) return;

        const replyHref = MC_STATE.activeThreadReplyHrefAbs;
        const newHref   = MC_STATE.newConvHrefAbs;

        let html = '';
        if(replyHref){
            html += `<a class="mc-btn" data-mc-action="reply" data-href="${escapeHTML(replyHref)}">Reply</a>`;
        }
        if(newHref){
            html += `<a class="mc-btn mc-btn-secondary" data-mc-action="new" data-href="${escapeHTML(newHref)}">New</a>`;
        }
        act.innerHTML = html;

        // wire clicks
        $all('a[data-mc-action="reply"]', act).forEach(a=>{
            a.addEventListener('click',(ev)=>{
                ev.preventDefault();
                ev.stopPropagation();
                const hrefAbs = absUrl(a.getAttribute('data-href')||'#');
                openComposeOverlayAbsUrl(hrefAbs,'Reply');
            });
        });

        $all('a[data-mc-action="new"]', act).forEach(a=>{
            a.addEventListener('click',(ev)=>{
                ev.preventDefault();
                ev.stopPropagation();
                const hrefAbs = absUrl(a.getAttribute('data-href')||'#');
                openComposeOverlayAbsUrl(hrefAbs,'Add Conversation');
            });
        });
    }

    // ------------------------------------------------------------------
    // PROGRESS BAR SIM
    // ------------------------------------------------------------------
    function startProgressSimulation(){
        const wrap = $('#mc-progress-wrap');
        const bar  = $('#mc-progress-bar');
        if(!wrap||!bar) return;

        wrap.style.display = 'block';
        bar.style.transition = 'width .2s linear';
        bar.style.width = '0%';

        const t0 = performance.now();
        let done = false;

        function tick(){
            if(done) return;
            const elapsed = performance.now() - t0;
            const pctTarget = Math.min(
                CFG.PROGRESS_CAP_BEFORE_FINISH,
                (elapsed/CFG.PROGRESS_FULL_MS)*CFG.PROGRESS_CAP_BEFORE_FINISH
            );
            const cur = parseFloat(bar.style.width)||0;
            if(pctTarget>cur){
                bar.style.width = pctTarget.toFixed(2)+'%';
            }
            setTimeout(tick, CFG.PROGRESS_TICK_MIN + Math.random()*CFG.PROGRESS_TICK_RAND);
        }
        tick();

        MC_STATE.progressSim = {
            completeEarly(){
                if(done) return;
                done = true;
                bar.style.transition = 'width .15s linear';
                bar.style.width = '100%';
                setTimeout(()=>{ wrap.style.display='none'; },300);
            }
        };
    }
    function finishProgressEarly(){
        if(MC_STATE.progressSim){
            MC_STATE.progressSim.completeEarly();
            MC_STATE.progressSim = null;
        }
    }

    // ------------------------------------------------------------------
    // PAGE-LEVEL INTERCEPT (clicking "Invoice #123456" link etc)
    // ------------------------------------------------------------------
    function parseOrderIdFromUrl(u){
        try{
            const urlObj = new URL(u, location.origin);
            return urlObj.searchParams.get('view');
        }catch{
            const m = u.match(/view=(\d+)/);
            return m?m[1]:null;
        }
    }

    function deriveInvoiceTextFromAnchor(a){
        const raw = (a.textContent||'').trim();
        if(raw) return raw;
        const id = parseOrderIdFromUrl(a.href||'');
        return id ? `Invoice #${id}` : 'Invoice';
    }

    function shouldInterceptOrderLink(href){
        return href && href.includes('?p=orders-view');
    }
    // Try to infer the relevant invoice link for a click that wasn't directly
    // on the <a>. We look for the closest row and then scan inside it.
    function findOrderRowAnchor(target){
        // don't hijack clicks that happened inside the MC overlay
        if (target.closest && target.closest('#mc-inline-overlay')) {
            return null;
        }

        // go up to a row-like container (table row or anything)
        const row = target.closest?.('tr, .order-row, .orderRow, .row');
        if(!row) return null;

        // inside that row, find the anchor that would normally open the order view
        const cand = row.querySelector?.('a[href*="?p=orders-view"]');
        if(!cand) return null;

        return cand;
    }

    function installPageDelegation(){
        document.addEventListener('click',(e)=>{
            // 1. First try: was the user actually clicking an <a>?
            let a = e.target.closest?.('a') || null;

            // 2. If not, try to treat the entire row as clickable.
            //    We'll "promote" the click to the row's invoice link.
            if(!a){
                a = findOrderRowAnchor(e.target);
            }
            if(!a) return; // nothing to do

            // special case: this is the header invoice link inside the open overlay.
            // let it behave normally (open in new tab etc).
            if (a.id === 'mc-order-link') {
                return;
            }

            const href = a.getAttribute('href') || '';
            if(!shouldInterceptOrderLink(href)) return;

            // allow ctrl/cmd/shift/alt/middle click to open new tab/window normally
            if(e.metaKey||e.ctrlKey||e.shiftKey||e.altKey||e.button===1){
                return;
            }

            e.preventDefault();
            e.stopPropagation();

            const urlAbs = new URL(href, location.origin).href;
            const invoiceText = deriveInvoiceTextFromAnchor(a);

            log('open MC overlay for', urlAbs, 'invoice:', invoiceText);
            openMainOverlay(urlAbs, invoiceText);
        }, {capture:true});

        log('[MC] delegation armed v3.8.1 + row click');
    }



    installPageDelegation();

    // ------------------------------------------------------------------
    // SAFETY NET:
    // If anything inside main overlay tries to open reply_message.php
    // or add_conversation.php in a new tab, intercept and open compose overlay.
    // ------------------------------------------------------------------
    document.addEventListener('click',(ev)=>{
        if(!isMainOpen()) return;

        // reply via data-mc-action
        const replyA = ev.target.closest?.('a[data-mc-action="reply"]');
        if(replyA && $('#mc-inline-overlay')?.contains(replyA)){
            ev.preventDefault();
            ev.stopPropagation();
            const hrefAbs = absUrl(replyA.getAttribute('data-href')||'#');
            openComposeOverlayAbsUrl(hrefAbs,'Reply');
            return;
        }

        // new convo via data-mc-action="new"
        const newA = ev.target.closest?.('a[data-mc-action="new"]');
        if(newA && $('#mc-inline-overlay')?.contains(newA)){
            ev.preventDefault();
            ev.stopPropagation();
            const hrefAbs = absUrl(newA.getAttribute('data-href')||'#');
            openComposeOverlayAbsUrl(hrefAbs,'Add Conversation');
            return;
        }
    }, {capture:true});

})();
