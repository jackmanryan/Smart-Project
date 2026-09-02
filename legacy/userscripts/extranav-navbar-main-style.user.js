// ==UserScript==
// @name         ExtraNav - NAVBAR MAIN STYLE
// @namespace    https://strip-curtains.com/
// @version      1.3.4
// @description  Floating overlay navbar (shadow DOM), Packages v3.1, timeline scoping, dark/light tokens.
// @match        https://extranet.strip-curtains.com/*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor&priceCheck=true*
// @exclude      https://extranet.strip-curtains.com/quotepayment*
// @run-at       document-start
// @grant        GM_addStyle
// @grant        GM_xmlhttpRequest
// @connect      cdn.jsdelivr.net
// ==/UserScript==

/* ---------- 0) Prevent theme flash (document-start) ---------- */
(() => {
    const saved = localStorage.getItem('ui:theme'); // 'dark' | 'light' | null
    if (saved) document.documentElement.setAttribute('data-theme', saved);
})();

(() => {
    'use strict';

    /* ---------- 1) Small utilities ---------- */
    const BASE    = 'https://cdn.jsdelivr.net/gh/jackmanryan/Smart-Project@6a85ccad7fd377ee5947f4c0898e65ab6f38473c/ExtraNav';
    const HTML_URL = `${BASE}/ExtraNav.html`;
    const CSS_URL  = `${BASE}/ExtraNav.css`;
    const JS_URL   = `${BASE}/nav-ux.js`;

    const fetchText = (url) => new Promise((resolve, reject) =>
                                           GM_xmlhttpRequest({
        method: 'GET',
        url,
        onload: r => resolve(r.responseText),
        onerror: reject
    })
                                          );

    const absolutizeCssUrls = (css, base) =>
    css.replace(/url\(\s*(['"]?)(?!data:|https?:|#)([^'")]+)\1\s*\)/g,
                (_m, q, p) => `url(${q}${base}/${p.replace(/^\.\//,'')}${q})`);

    const absolutizeHtmlUrls = (root, base) => {
        root.querySelectorAll('[src],[href]').forEach(el => {
            const a = el.hasAttribute('src') ? 'src' : 'href';
            const v = el.getAttribute(a);
            if (!v || /^(https?:|data:|mailto:|javascript:|#)/i.test(v)) return;
            el.setAttribute(a, `${base}/${v.replace(/^\.\//,'')}`);
        });
    };

    const adaptCssForShadow = (css) =>
    css.replace(/:root\b/g, ':host')
    .replace(/(^|[\s,{])html\b/g, '$1:host')
    .replace(/(^|[\s,{])body\b/g, '$1:host');

    const onReady = (fn) =>
    (document.readyState === 'loading')
    ? document.addEventListener('DOMContentLoaded', fn, { once: true })
    : fn();

    /* ---------- 2) SPA route signals ---------- */
    (function routeSignals() {
        const fire = () => window.dispatchEvent(new Event('tm:route'));
        const _push = history.pushState.bind(history);
        history.pushState = function(...args){ const r = _push(...args); fire(); return r; };
        window.addEventListener('popstate', fire);
        window.addEventListener('hashchange', fire);
    })();

    /* ---------- 3) New-tab wiring (works for any root) ---------- */
    function enableNewTabClicks(root = document) {
        const SKIP = /^(javascript:|data:|mailto:|tel:|blob:)/i;

        const closestLink = (node) =>
        node?.closest?.('a[href], [role="link"][href], [data-href], [data-url]') || null;

        const getHref = (el) => {
            if (!el) return null;
            const raw = el.getAttribute?.('href') ?? el.getAttribute?.('data-href') ?? el.getAttribute?.('data-url');
            if (!raw || SKIP.test(raw)) return null;
            try { return new URL(raw, location.href).href; } catch { return null; }
        };

        const openBlank = (href) => window.open(href, '_blank', 'noopener,noreferrer');

        if (!root?.addEventListener) return;

        // Middle click
        root.addEventListener('auxclick', (e) => {
            if (e.button !== 1) return;
            const a = closestLink(e.target);
            const href = getHref(a);
            if (!href) return;
            e.preventDefault(); e.stopPropagation();
            openBlank(href);
        }, true);

        // Ctrl/⌘ + left click
        root.addEventListener('click', (e) => {
            if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
            const a = closestLink(e.target);
            const href = getHref(a);
            if (!href) return;
            e.preventDefault(); e.stopPropagation();
            openBlank(href);
        }, true);
    }

    /* ---------- 4) Evaluate nav-ux inside shadow with a document/window proxy ---------- */
    const isKey = (t) => /^key(down|up|press)$/i.test(t);

    function runInShadow(code, shadowRoot, hostEl) {
        const OD = hostEl.ownerDocument || window.document;
        const REAL_DOC = window.document;

        const docProxy = {
            querySelector:        (...a) => shadowRoot.querySelector(...a),
            querySelectorAll:     (...a) => shadowRoot.querySelectorAll(...a),
            getElementById:       (id)  => shadowRoot.getElementById ? shadowRoot.getElementById(id) : shadowRoot.querySelector('#' + CSS.escape(id)),
            dispatchEvent:        (evt) => shadowRoot.dispatchEvent(evt),
            addEventListener:     (type, cb, opt) => (isKey(type) ? window.addEventListener(type, cb, opt) : shadowRoot.addEventListener(type, cb, opt)),
            removeEventListener:  (type, cb, opt) => (isKey(type) ? window.removeEventListener(type, cb, opt) : shadowRoot.removeEventListener(type, cb, opt)),
            body:                 REAL_DOC.body,
            documentElement:      REAL_DOC.documentElement,
            head:                 shadowRoot,
            createElement:        (...a) => OD.createElement(...a),
            createElementNS:      (...a) => OD.createElementNS(...a),
            createTextNode:       (...a) => OD.createTextNode(...a),
            createDocumentFragment:     () => OD.createDocumentFragment(),
            importNode:           (...a) => OD.importNode(...a),
        };

        const winProxy = new Proxy(window, { get(t, p) { return p === 'document' ? docProxy : t[p]; } });

        new Function('document','window','root', code)(docProxy, winProxy, hostEl);

        try { shadowRoot.dispatchEvent(new Event('DOMContentLoaded', { bubbles: false })); } catch {}
        try { window.dispatchEvent(new Event('load')); } catch {}
    }

    /* ---------- 5) Main ---------- */
    onReady(async () => {

        /* 5a) Preserve “Message Center” badge before removing legacy navbar */
        (function preserveMessageCenter(){
            const nav = document.querySelector('nav.navbar.navbar-default.navbar-static-top');
            if (!nav) return;
            const a = nav.querySelector('a[href="/?p=messagecenter"]');
            if (!a) return;
            const keep = a.closest('li') || a; // keep the whole <li> if present
            // Move the existing node so any site JS that updates the badge can still find it
            if (keep.parentNode) keep.parentNode.removeChild(keep);
            const dock = document.getElementById('mc-dock') ||
                  Object.assign(document.createElement('div'), { id: 'mc-dock' });
            Object.assign(dock.style, {
                position:'fixed', top:'8px', right:'12px',
                zIndex:2147483648, pointerEvents:'auto'
            });
            dock.innerHTML = '';
            dock.appendChild(keep);
            document.body.appendChild(dock);
        })();

        /* 5a.1) Normalize + relocate #mc-dock, remove icon span + stray ::marker text */
        (function manageMcDock(){
            const DESIRED_STYLE = 'position: fixed; top: 28px; right: 610px;'; // exact element.style we want
            const DOCK_ID = 'mc-dock';
            const WRAPPER_ID = 'wrapper';

            // Clean out envelope icon span and any ::marker junk text nodes
            function sanitizeDock(dock) {
                if (!dock) return;

                // 1) remove the flashing envelope span (the one that wraps <i class="fa fa-envelope ...">)
                const iconSpan = dock.querySelector('span i.fa.fa-envelope')?.closest('span');
                if (iconSpan) iconSpan.remove();

                // 2) remove literal text nodes that look like "<::marker></::marker>" (sometimes copy/paste artifacts)
                const walker = document.createTreeWalker(dock, NodeFilter.SHOW_TEXT, null, false);
                const doomed = [];
                while (walker.nextNode()) {
                    const t = walker.currentNode;
                    if (String(t.nodeValue).replace(/\s+/g,'').toLowerCase().includes('<::marker></::marker>')) {
                        doomed.push(t);
                    }
                }
                doomed.forEach(n => n.parentNode && n.parentNode.removeChild(n));

                // 3) stop list bullets/markers (if <li> exists) without affecting other lists
                dock.querySelectorAll('li').forEach(li => {
                    li.style.listStyle = 'none';
                    li.style.padding = '0';
                    li.style.margin = '0';
                });
            }

            // Force exact inline style: only position/top/right
            function setExactStyle(el) {
                if (!el) return;
                el.removeAttribute('style');
                el.style.cssText = DESIRED_STYLE;
            }

            // Place #mc-dock immediately BEFORE #wrapper in DOM order
            function placeBeforeWrapper(dock) {
                const wrapper = document.getElementById(WRAPPER_ID);
                if (wrapper?.parentNode && dock) {
                    if (dock.nextSibling !== wrapper || dock.parentNode !== wrapper.parentNode) {
                        wrapper.parentNode.insertBefore(dock, wrapper);
                    }
                } else if (dock && !dock.parentNode) {
                    // fallback: attach to body if wrapper not present yet
                    document.body.appendChild(dock);
                }
            }

            // Ensure the inner HTML block exists (create if needed)
            function ensureContent(dock) {
                // If the anchor is missing, re-create minimal Message Center link with the count span.
                let a = dock.querySelector('a[href="/?p=messagecenter"]');
                if (!a) {
                    const li = dock.querySelector('li') || dock.appendChild(document.createElement('li'));
                    a = document.createElement('a');
                    a.href = '/?p=messagecenter';
                    li.innerHTML = ''; li.appendChild(a);

                    // Create the red count badge span if absent; default to "0"
                    const badge = document.createElement('span');
                    badge.textContent = '0';
                    badge.style.cssText = [
                        'width:25px','height:25px','background-color:#FF2F02','color:#fff','padding:3px',
                        'border-radius:15px','float:left','text-align:center','margin:3px 5px 0 0'
                    ].join(';');
                    a.appendChild(badge);
                }
            }

            // One pass: create/find, sanitize, style, relocate
            function applyOnce() {
                let dock = document.getElementById(DOCK_ID);
                if (!dock) {
                    dock = document.createElement('div');
                    dock.id = DOCK_ID;
                    dock.innerHTML = `
        <li>
          <a href="/?p=messagecenter">
            <span style="width:25px;height:25px;background-color:#FF2F02;color:#fff;padding:3px;border-radius:15px;float:left;text-align:center;margin:3px 5px 0 0;">0</span>
          </a>
        </li>`;
                    document.body.appendChild(dock);
                }
                ensureContent(dock);
                sanitizeDock(dock);
                setExactStyle(dock);
                placeBeforeWrapper(dock);
            }

            // Initial pass
            applyOnce();

            // Keep it corrected if the app re-renders (SPA / AJAX)
            const mo = new MutationObserver(() => applyOnce());
            mo.observe(document.documentElement, { childList: true, subtree: true });

            // Optional console helper for debugging
            Object.assign(window, {
                _mcDock: {
                    reapply: applyOnce,
                    info: () => {
                        const d = document.getElementById(DOCK_ID);
                        return {
                            exists: !!d,
                            style: d?.getAttribute('style') || '',
                            beforeWrapper: !!d && d.nextElementSibling?.id === WRAPPER_ID
                        };
                    }
                }
            });
        })();


        /* 5b) Remove legacy header/sidebar; keep wrapper spacing sane */
        document.querySelectorAll('nav.navbar.navbar-default.navbar-static-top').forEach(n => n.remove());

        const side = document.querySelector('.navbar-default.sidebar.mainmenu'); if (side) side.remove();
        const pageWrapper = document.getElementById('page-wrapper'); if (pageWrapper) pageWrapper.style.marginLeft = '0';

        /* 5c) Scope “Order Timeline” to #order-timeline; re-check on SPA loads */
        const attachOrderTimelineId = () => {
            const heading = [...document.querySelectorAll('.panel.panel-default .panel-heading')]
            .find(h => /Order\s*Timeline/i.test(h.textContent || ''));
            if (!heading) return false;
            const panel = heading.closest('.panel.panel-default');
            if (!panel) return false;
            if (panel.id !== 'order-timeline') panel.id = 'order-timeline';
            return true;
        };
        if (!attachOrderTimelineId()) {
            const mo = new MutationObserver(() => { if (attachOrderTimelineId()) mo.disconnect(); });
            mo.observe(document.documentElement, { childList: true, subtree: true });
        }
        window.addEventListener('tm:route', attachOrderTimelineId);


        GM_addStyle(`body{padding-top:80px!important;} #page-wrapper{margin-left:0!important} #mc-dock a{display:inline-block;}`);
        GM_addStyle(`
/* ===========================
   TOKEN BRIDGE (keep light touch)
   =========================== */
:root{
  /* Core */
  --bg-0: var(--color-bg, #fff);
  --surface-0: var(--color-surface, #141828);
  --surface-1: var(--color-surface-muted, #bebebe);
  --border-0: var(--color-border, #2a3460);
  --text-0: var(--color-fg, #0f1218);
  --text-1: var(--color-fg-muted, #6b7280);

  /* Accents */
  --accent-0: var(--color-accent, #47d6c9);
  --accent-1: var(--color-primary, #5353ff);
  --accent-2: var(--color-primary-strong, #6c6cff);
  --accent-warn: var(--color-danger, #8e2a2a);
  --accent-ok: var(--color-success, #2a8e5f);
  --notif: var(--color-notice, #FF2F02);

  /* Utility */
  --ink-0: var(--color-ink, #141414);
  --ink-1: var(--color-on-contrast, #fff);
  --field-bg: var(--color-field-bg, #151a22);
  --hover-ring: var(--color-ring-hover, #303745);
  --submenu-bg: var(--color-menu-bg, #bebebe);
  --submenu-sep: var(--color-divider, #42434a);

  /* Type & radii */
  --font-sans: var(--font-body, "Open Sans");
  --r-0: var(--radius-2, 10px);
  --r-1: var(--radius-3, 12px);
  --r-2: var(--radius-4, 16px);

  /* Search/sizing */
  --search-size: var(--size-search-ico, 20px);
  --search-gap: var(--space-search-gap, clamp(10px, 1.2vw, 14px));

  /* Motion */
  --t-fast: .12s; --t-ui: .22s; --ease: ease; --ease-out: ease-out;

  /* Page + dark tokens */
  --page-bg-light:#eae8f2; --page-ink-light:#111;
  --page-bg-dark:#0d1117;  --page-ink-dark:#e6edf3;
  --page-muted:#8b949e;    --panel-dark:#161b22; --border-dark:#30363d;

  /* Timeline tokens */
  --tl-complete-bg:#5D9477;
  --tl-complete-border:#659C7F;
  --tl-complete-ink:inherit;

  /* Derived */
  --elev-0: 0 0 0 1px var(--border-0);
  --focus-ring: 0 0 0 3px color-mix(in oklab, var(--accent-1), #000 40%);
}

:root[data-theme="light"]{ color-scheme: light; }
:root[data-theme="dark"]{
  --bg-0:#0f1218;
  --surface-0:#141828;
  --surface-1:#bebebe;
  --border-0:#2a3460;
  --text-0:#e6ebf4;
  --text-1:#b7c0d4;
  --field-bg:#0f1420;
  --hover-ring:#2a3450;
  --submenu-bg:#1b2133;
  --submenu-sep:#2c3244;
  --accent-0:#47d6c9; --accent-1:#5353ff; --accent-2:#6c6cff;
  --tl-complete-bg: color-mix(in oklab, #2a60c9, #000 86%);
  --tl-complete-border:#659C7F;
  color-scheme: dark;
}

/* ===========================
   BASE (do NOT change host spacing)
   =========================== */
html[data-theme="light"] body{
  background:var(--page-bg-light) !important;
  color:var(--page-ink-light) !important;
}
html[data-theme="dark"] body{
  background:var(--page-bg-dark) !important;
  color:var(--page-ink-dark) !important;
}

/* Keep wrapper tone only; no spacing overrides */
#page-wrapper{ background-color:#EAE8F2; }
html[data-theme="dark"] #page-wrapper{
  background:var(--panel-dark) !important;
  color:var(--page-ink-dark) !important;
  border-color:var(--border-dark) !important;
}

/* Panels (no overflow clipping; no fixed heights) */
.panel{
  background:#4D437C;
  border:1px solid #4D437C;
  border-radius:28px;
  color:var(--text-0);
  box-shadow:var(--elev-0);
  /* overflow: visible;  ← default; avoid cut-offs */
}

.panel a{ color:#E3DFF2; }
.panel-default > .panel-heading{
  color:#fff; background-color:#4d437c; border-color:#4d437c; border-radius: 28px;
}
/* Leave body padding to host; only color if needed elsewhere */
.panel .table > tbody > tr > td{ border-color:#141414; }

/* Buttons & shared “badge” block from host */
.border,
.table-bordered > thead,
.table .table,
.btn-primary,
.btn-default{
  color:#fff;
  background-color:#4D437C;
  border-color:#E3DFF2;
  border-radius:20px;
  border:transparent;
}
.btn-success{ color:#fff; background-color:#52439b; border-color:transparent; }

/* Table row hovers (keep durations small) */
.panel .table > tbody > tr > td,
.table-striped > tbody > tr:nth-of-type(2n+1){
  background-color:#b3b3b3;
  transition: background-color var(--t-ui) var(--ease-out);
}
.panel .table > tbody > tr > td:hover,
.table-striped > tbody > tr:nth-of-type(2n+1):hover{
  background-color:#9f9f9f;
  transition: background-color var(--t-fast) var(--ease);
}
@media (prefers-reduced-motion: reduce){
  .panel .table > tbody > tr > td,
  .table-striped > tbody > tr:nth-of-type(2n+1),
  .panel .table > tbody > tr > td:hover,
  .table-striped > tbody > tr:nth-of-type(2n+1):hover{ transition:none; }
}

/* Forms (visuals only) */
.form-control{
  width:100%;
  height:clamp(36px, 44px, 44px); /* avoid experimental cqh unit */
  border:0;
  border-radius:var(--r-0);
  background:var(--field-bg);
  color:#fff;
  padding-inline:12px calc(var(--search-size) + var(--search-gap) + 6px);
  box-shadow:var(--elev-0);
  transition: box-shadow .15s var(--ease), transform .06s var(--ease);
}
.form-control:hover{ box-shadow:0 0 0 2px #E3DFF2; }

/* ===========================
   ORDER TIMELINE (scoped, no fixed height)
   =========================== */
#order-timeline{ overflow:visible !important; }

#order-timeline .panel-body{
  /* only padding here; do not touch global .panel-body */
  padding:60px !important;
  box-sizing:border-box;
  min-height:150px !important;   /* instead of height */
}
@media (max-width:1020px){
  #order-timeline .panel-body{ min-height:300px !important; }
}
@media (max-width:550px){
  #order-timeline .panel-body{ min-height:450px !important; }
}

/* Responsive grid for tiles */
#order-timeline .panel-body > div > ul{
  list-style:none; margin:0; padding:0;
  display:grid; grid-template-columns:repeat(auto-fit, minmax(140px,1fr));
}

/* Reset legacy floats; card fallback look */
#order-timeline .panel-body > div > ul > li{
  float:none !important; left:auto !important; width:auto !important; height:auto !important;
  box-sizing:border-box; padding:12px; text-align:center;
  border-radius:16px;
  background:#151a22;
  border:2px solid #4a427b;
  min-height:130px;
  display:grid; grid-auto-rows:min-content; align-content:center;
}

/* Icon/text spacing */
#order-timeline .panel-body > div > ul > li > span[style*="font-size"]{
  display:block; line-height:1; margin-bottom:6px;
}
#order-timeline .tl_name{ display:block; font-weight:600; margin-top:4px; }

/* Completed-stage override (fight inline) */
#order-timeline .panel-body ul > li[style*="background-color:#e5ffcc" i],
#order-timeline .panel-body ul > li.timeline-complete,
.panel-body ul > li[style*="background-color:#e5ffcc" i]{
  background:var(--tl-complete-bg) !important;
  border-color:var(--tl-complete-border) !important;
  color:var(--tl-complete-ink) !important;
}

.panel a { color:#E3DFF2; }
.table .table-striped .table-bordered .table-hover
.panel-default > .panel-heading {
  color: #fff;
  background-color: #4d437c;
  border-color: #4d437c;
  border-radius: 28px;
}

.panel > .panel-default { height: 230.15px; }

.panel .table > tbody > tr > td{ border-color:#141414; }

.panel.panel-default .panel-body{
  padding:30px;                    /* your earlier unitless value fixed */
  background:#bebebe;
  color:#fff;
  border-radius:29px;
}
/* ===== PACKAGES v3.1 (4 columns, pills, zebra rows) ===== */
#Packages-Block{ box-sizing:border-box; overflow-x:auto; }

#Packages-Block .packages-table.packages-v3{
  width:100%; border-collapse:collapse; table-layout:fixed;
}
#Packages-Block .packages-v3 thead th{
  position:sticky; top:0; z-index:2;
  background:#4D437C; color:#fff; white-space:nowrap;
}

/* widths */
#Packages-Block .packages-v3 th.col-box,
#Packages-Block .packages-v3 td.col-box{ width:240px; }
#Packages-Block .packages-v3 th.col-items,
#Packages-Block .packages-v3 td.col-items{ /* flexible */ }
#Packages-Block .packages-v3 th.col-track,
#Packages-Block .packages-v3 td.col-track{ width:300px; }
#Packages-Block .packages-v3 th.col-dates,
#Packages-Block .packages-v3 td.col-dates{ width:240px; }

#Packages-Block .packages-v3 td,
#Packages-Block .packages-v3 th{
  padding:10px; vertical-align:top;
  border:1px solid rgba(20,20,20,.35);
  word-break:break-word; overflow-wrap:anywhere;
}
#Packages-Block .packages-v3 td a{ word-break:break-all; overflow-wrap:anywhere; }

/* Pills */
#Packages-Block .pill{
  display:inline-flex; align-items:center; gap:6px;
  padding:4px 10px; border-radius:999px;
  background:#4D437C; color:#fff; font-weight:600; line-height:1;
}
#Packages-Block .pill .label{ opacity:.85; font-weight:500; }

/* Column 1: box + type + weight + hold button */
#Packages-Block .box-col{ display:grid; gap:8px; align-content:start; }
#Packages-Block .box-col .box-num{ font-weight:700; font-size:16px; }
#Packages-Block .box-col .pill--type{}
#Packages-Block .box-col .pill--weight{}
#Packages-Block .box-col .hold-wrap{ margin-top:2px; }

/* Column 2: Items — header + zebra rows */
#Packages-Block .items-grid{
  --cols: 1.4fr .6fr .5fr;
  display:block; max-height:260px; overflow:auto;
  padding-right:4px; scrollbar-gutter:stable both-edges;
}
#Packages-Block .items-grid .hdr-row,
#Packages-Block .items-grid .item-row{
  display:grid; grid-template-columns:var(--cols); gap:6px 12px; align-items:start;
}
#Packages-Block .items-grid .hdr-row .hdr{
  font-weight:700; color:#fff; background:#4D437C; padding:2px 6px; border-radius:4px;
}
#Packages-Block .items-grid .item-row{ padding:2px 0; }
#Packages-Block .items-grid .item-row:nth-of-type(even){ /* start line on the 2nd SKU row */
  border-top:1px solid rgba(20,20,20,.3);
}
#Packages-Block .items-grid .sku{ font-family:ui-monospace,SFMono-Regular,Menlo,monospace; }
#Packages-Block .items-grid .sku,
#Packages-Block .items-grid .amt,
#Packages-Block .items-grid .qty{ min-width:0; }

/* Column 3: tracking stack (no weight, no Released) */
#Packages-Block .track-col{ display:grid; gap:8px; align-content:start; }
#Packages-Block .track-col .track-link{ margin-top:2px; }
#Packages-Block .track-col .status-line{ display:flex; flex-wrap:wrap; gap:8px 12px; align-items:center; }
#Packages-Block .track-col .claim a{ display:inline-block; margin-right:8px; }

/* Column 4: dates */
#Packages-Block .dates-col{ display:grid; gap:8px; align-content:start; }
#Packages-Block .dates-col .pill--date{}

/* Print */
@media print{
  #Packages-Block{ overflow:visible !important; }
  #Packages-Block .items-grid{ max-height:none; overflow:visible; }
  #Packages-Block .packages-v3 thead th{ position:static; }
}
/* center all panel headers */
.panel-heading._tm-enhanced{
  display:flex; align-items:center; justify-content:center;
  gap:.5rem; text-align:center;
}

/* when we detect it toggles, show pointer + subtle hover */
.panel-heading.sc-clickable{ cursor:pointer; }
.panel-heading.sc-clickable:hover{ filter:brightness(1.03); }

/* keep icons spaced a bit */
.panel-heading._tm-enhanced i{ margin-right:.25rem; }
/* =========.panel .table > tbody > tr > td,
.panel.panel-default .panel-body {
  background: transparent;}==================
   DARK THEME: containers & tables only
   =========================== */
html[data-theme="dark"] .panel,
html[data-theme="dark"] .well,
html[data-theme="dark"] .ibox-content,
html[data-theme="dark"] .content,
html[data-theme="dark"] .card,
html[data-theme="dark"] table,
html[data-theme="dark"] .table,
html[data-theme="dark"] .panel-body,
html[data-theme="dark"] .panel .table > tbody > tr > td{
  background:#0c005182 !important;
  color:var(--page-ink-dark) !important;
  border-color:var(--border-dark) !important;
}
html[data-theme="dark"] .table th{ color:var(--page-ink-dark) !important; }
html[data-theme="dark"] .table td,
html[data-theme="dark"] .table th{ border-color:var(--border-dark) !important; }
html[data-theme="dark"] a{ color:#8ab4f8 !important; }
html[data-theme="dark"] .text-muted,
html[data-theme="dark"] .muted{ color:var(--page-muted) !important; }

/* --- FINAL OVERRIDES: center every panel heading --- */
.panel.panel-default > .panel-heading,
.panel > .panel-heading,
.panel-heading{
  display:flex !important;
  align-items:center !important;
  justify-content:center !important;
  text-align:center !important;
  gap:.5rem;
}

/* neutralize right-pushers inside the header */
.panel-heading > *{ float:none !important; margin:0 !important; }
.panel-heading .pull-right,
.panel-heading .float-right{ float:none !important; }
.panel-heading .ml-auto{ margin-left:0 !important; }
.panel-heading [style*="margin-left:auto"]{ margin-left:0 !important; }

/* if a table lives inside the heading, don't let it be 100% */
.panel-heading table,
.panel-heading .table{
  width:auto !important;
  margin:0 auto !important;
  text-align:inherit !important;   /* inherit centered text */
}
.panel-heading th,
.panel-heading td{
  text-align:inherit !important;
}
.panel-heading.sc-clickable{
    transition: background-color .15s ease, color .15s ease, border-color .15s ease;
    user-select: none;
  }
  .panel-heading.sc-clickable:hover{
    background-color:#62569C !important;
    border-color:#62569C !important;
    color:#fff !important;
    user-select: none;
  }
  /* keep inner text/links readable on hover */
  .panel-heading.sc-clickable:hover,
  .panel-heading.sc-clickable:hover .sc-title,
  .panel-heading.sc-clickable:hover .sc-meta,
  .panel-heading.sc-clickable:hover a,
  .panel-heading.sc-clickable:hover i{
    color:#fff !important;
    user-select: none;
  }
  :root{
  --font-ui: "Inter", "Source Sans 3", "IBM Plex Sans", system-ui, -apple-system,
             "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", sans-serif;
  --font-mono: "IBM Plex Mono", ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
}
body { font-family: var(--font-ui); font-size: 14.5px; }
.code, code, pre { font-family: var(--font-mono); }
#inbox-badge {
  background-color: #FF2F02;
  color: #fff;
  padding: 3px;
  border-radius: 15px;
  min-width: 25px;
  height: 25px;
  display: inline-flex;
  align-items: center;
  justify-content: center;
  margin-right: 5px;
  z-index:1000;
}

.form-control[disabled], .form-control[readonly], #po_comments_1, fieldset[disabled] .form-control {
    background-color: var(--field-bg);
    opacity: 1;
}
:root { --mc-dock-z: 2147483649; }            /* sane default */
  #mc-dock{ z-index: var(--mc-dock-z) !important; pointer-events:auto !important; }
/* =========================================================
   LAYER + SIZING NORMALIZATION
   ========================================================= */

/* ---------- 0. Global layer tokens ---------- */
:root {
  /* base content / cards */
  --z-base:        0;
  --z-card:        1;

  /* floating UI above cards (docks, drawers) */
  --z-float:       2147483638;

  /* main navbar / global chrome */
  --z-nav:         2147483640;

  /* hard-stop top layer (modals / backdrops) */
  --z-modal:       2147483645;
}

/* ---------- 1. Page base stays underneath overlays ---------- */
#page-wrapper {
  position: relative;
  z-index: var(--z-base);
  /* margin-left already forced to 0 and padding-top already set to 80px
     upstream in ExtraNav. We do NOT touch spacing further here. */
}

/* All primary Bootstrap .panel cards = base layer */
.panel,
.panel.panel-default,
.panel .panel-body {
  position: relative;
  z-index: var(--z-card);
  /* allow cards to size naturally – no stacking context tricks */
  max-width: 100%;
  box-shadow: var(--elev-0);
}

/* kill any fixed height on nested .panel-default so cards aren't bloated */
.panel > .panel-default {
  height: auto !important;
  min-height: 0 !important;
}

/* trim generic body padding so cards are compact, not puffy */
.panel.panel-default .panel-body {
  padding: 16px 20px !important;
  min-height: 0 !important;
  border-radius: inherit;
  /* keep your background tokens */
  background: #bebebe;
  color: #fff;
}

/* ---------- 2. Timeline card specifically ----------
   Before: #order-timeline .panel-body had padding:60px and min-height:150/300/450px
   which forced a giant block. We scale that down and let height be content-driven.
*/
#order-timeline .panel-body {
  padding: 24px !important;
  min-height: auto !important;
  box-sizing: border-box;
}
@media (max-width:1020px){
  #order-timeline .panel-body {
    min-height: auto !important;
  }
}
@media (max-width:550px){
  #order-timeline .panel-body {
    min-height: auto !important;
  }
}

/* The timeline tiles themselves keep your grid/visual language. We do not
   force any artificial min-height beyond what content needs. */
#order-timeline .panel-body > div > ul > li {
  min-height: 0 !important;
  padding: 12px;
  border-radius: 16px;
  background: #151a22;
  border: 2px solid #4a427b;
  display: grid;
  grid-auto-rows: min-content;
  align-content: center;
  text-align: center;
  float: none !important;
  width: auto !important;
  height: auto !important;
  left: auto !important;
}

/* ---------- 3. Navbar host and SideDock layering ----------
   We assert:
   - navbar/shadow host (#scx-nav-host) is on var(--z-nav)
   - right drawer / dock hover UIs sit just under nav using var(--z-float)
   - mc-dock inherits var(--z-float) instead of hardcoding above everything
*/

/* ExtraNav shadow host element (global top bar) */
#scx-nav-host {
  position: fixed !important;
  top: 0;
  left: 0;
  right: 0;
  z-index: var(--z-nav) !important;
  pointer-events: auto;
}

/* Right drawer (SideDock) – fixed panel of message center / notes / etc.
   SideDock already sets position:fixed; top:100px; right:0; height:80vh
   and dynamically syncs its zIndex to navHost. We clamp it below nav. :contentReference[oaicite:6]{index=6} */
#sc-right-drawer {
  z-index: calc(var(--z-nav) - 1) !important;
}

/* Message Center dock bubble (#mc-dock).
   Script repositions it fixed at top:28px right:610px and used --mc-dock-z:2147483649. :contentReference[oaicite:7]{index=7}
   We pin it just under navbar but above cards.
*/
:root {
  --mc-dock-z: var(--z-float);
}
#mc-dock {
  position: fixed;
  z-index: var(--mc-dock-z) !important;
  pointer-events: auto !important;
}

/* ---------- 4. Modals / overlays ----------
   Bootstrap modals/backdrops should ALWAYS sit above nav, SideDock, mc-dock.
   This prevents the navbar or drawer from visually overlapping dialogs.
*/
.modal,
.modal.in,
.modal.show {
  position: fixed;
  z-index: var(--z-modal) !important;
}

.modal-backdrop,
.modal-backdrop.in,
.modal-backdrop.show {
  z-index: calc(var(--z-modal) - 1) !important;
}

/* ---------- 5. Tables / scrolling ----------
   Keep sticky headers, internal scroll, etc. from Packages v3.1 and Message
   Center drawer exactly as-is. We don't touch that logic here. :contentReference[oaicite:8]{index=8} :contentReference[oaicite:9]{index=9}
*/

/* ---------- 6. Safety: prevent accidental local z-index escalation ----------
   If any random .panel or .well gets a z-index > 1 without being fixed/absolute,
   it could jump above overlays due to stacking contexts. Force them back down.
*/
.panel,
.well,
.ibox-content,
.content,
.card {
  z-index: var(--z-card) !important;
}

`);

        /* 5e) Packages table v3.1 transform (unchanged behavior; wrapped) */
        (function upgradePackagesTableV31(){
            const RX = {
                box:/^Box\s*Number/i, items:/^Items/i, inside:/What\s*is\s*inside/i,
                weight:/Total\s*Weight/i, tracking:/Tracking/i,
                picked:/Picked\s*Date/i, date:/^Date\s*and\s*Time/i,
                onhold:/On\s*Hold/i, rush:/Rush\s*Type/i, submit:/Submit\s*Claim/i
            };
            const findIndex = (ths, rx) => ths.findIndex(th => rx.test((th.textContent||'').trim()));

            function transform(){
                const root = document.getElementById('Packages-Block');
                const tbl  = root?.querySelector('#dataTables-example');
                if (!tbl) return false;
                if (tbl.classList.contains('packages-v3')) return true;

                const head = tbl.tHead?.rows?.[0]; if (!head) return false;
                const ths  = Array.from(head.cells);

                const map = {
                    box:findIndex(ths,RX.box), items:findIndex(ths,RX.items), inside:findIndex(ths,RX.inside),
                    weight:findIndex(ths,RX.weight), tracking:findIndex(ths,RX.tracking),
                    picked:findIndex(ths,RX.picked), date:findIndex(ths,RX.date),
                    onhold:findIndex(ths,RX.onhold), rush:findIndex(ths,RX.rush), submit:findIndex(ths,RX.submit)
                };

                let idxCheck = ths.findIndex(th => th.querySelector('input[type="checkbox"]'));
                if (idxCheck < 0) idxCheck = 0;

                if (map.items  >= 0) ths[map.items].textContent   = 'Items';
                if (map.tracking>= 0) ths[map.tracking].textContent= 'Tracking';
                if (map.picked >= 0) ths[map.picked].textContent   = 'Dates & Times';

                const rows = Array.from(tbl.tBodies?.[0]?.rows || []);
                rows.forEach(row => {
                    const cells = Array.from(row.cells);

                    const boxTxt  = (cells[map.box]?.textContent || '').trim();
                    const typeTxt = (cells[map.inside]?.textContent || '').trim();
                    const weight  = (cells[map.weight]?.textContent || '').trim();
                    const pickTx  = (cells[map.picked]?.textContent || '').trim();
                    const dateTx  = (cells[map.date]?.textContent || '').trim();
                    const rushTx  = (cells[map.rush]?.textContent || '').trim();

                    let holdBtnHTML = '';
                    if (cells[map.onhold]) {
                        const tmp = document.createElement('div');
                        tmp.innerHTML = cells[map.onhold].innerHTML;
                        const btn = tmp.querySelector('button');
                        if (btn) holdBtnHTML = btn.outerHTML;
                    }

                    const trackHTML = cells[map.tracking]?.innerHTML || '';
                    const claimHTML = cells[map.submit]?.innerHTML || '';

                    const boxCell = cells[map.box];
                    if (boxCell) {
                        boxCell.classList.add('col-box');
                        boxCell.innerHTML = `
              <div class="box-col" style="display:grid;gap:8px;align-content:start;">
                <div class="box-num" style="font-weight:700;font-size:16px;">${boxTxt || '&nbsp;'}</div>
                ${typeTxt ? `<div class="pill pill--type" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:#4D437C;color:#fff;font-weight:600;line-height:1;">${typeTxt}</div>` : ''}
                ${weight  ? `<div class="pill pill--weight" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:#4D437C;color:#fff;font-weight:600;line-height:1;"><span class="label" style="opacity:.85;font-weight:500;">Total&nbsp;Weight</span><strong>${weight}</strong></div>` : ''}
                ${holdBtnHTML ? `<div class="hold-wrap" style="margin-top:2px;">${holdBtnHTML}</div>` : ''}
              </div>`;
                    }

                    const itemsCell = cells[map.items];
                    if (itemsCell) {
                        itemsCell.classList.add('col-items');
                        const nested = itemsCell.querySelector('table');
                        let items = [];
                        if (nested?.tBodies?.[0]) {
                            items = Array.from(nested.tBodies[0].rows).map(tr => {
                                const c = Array.from(tr.cells);
                                return { sku:(c[0]?.textContent||'').trim(), amount:(c[1]?.textContent||'').trim(), qty:(c[2]?.textContent||'').trim() };
                            });
                        }
                        const wrap = document.createElement('div');
                        wrap.className = 'items-grid';
                        wrap.style.cssText = '--cols:1.4fr .6fr .5fr;display:block;max-height:260px;overflow:auto;padding-right:4px;scrollbar-gutter:stable both-edges;';
                        wrap.insertAdjacentHTML('beforeend', `
              <div class="hdr-row" style="display:grid;grid-template-columns:var(--cols);gap:6px 12px;align-items:start;">
                <div class="hdr" style="font-weight:700;color:#fff;background:#4D437C;padding:2px 6px;border-radius:4px;">SKU</div>
                <div class="hdr" style="font-weight:700;color:#fff;background:#4D437C;padding:2px 6px;border-radius:4px;">Amount</div>
                <div class="hdr" style="font-weight:700;color:#fff;background:#4D437C;padding:2px 6px;border-radius:4px;">Qty</div>
              </div>`);
                        wrap.insertAdjacentHTML('beforeend', items.map(i => `
              <div class="item-row" style="display:grid;grid-template-columns:var(--cols);gap:6px 12px;align-items:start;padding:2px 0;border-top:1px solid rgba(20,20,20,.15);">
                <div class="sku" style="font-family:ui-monospace,SFMono-Regular,Menlo,monospace;min-width:0;">${i.sku || '&nbsp;'}</div>
                <div class="amt" style="min-width:0;">${i.amount || '&nbsp;'}</div>
                <div class="qty" style="min-width:0;">${i.qty || '&nbsp;'}</div>
              </div>`).join(''));
                        itemsCell.innerHTML = '';
                        itemsCell.appendChild(wrap);
                    }

                    const trackCell = cells[map.tracking];
                    if (trackCell) {
                        trackCell.classList.add('col-track');
                        trackCell.innerHTML = `
              <div class="track-col" style="display:grid;gap:8px;align-content:start;">
                ${trackHTML ? `<div class="track-link" style="margin-top:2px;"><strong>Tracking:</strong> ${trackHTML}</div>` : ''}
                ${rushTx ? `<div class="status-line" style="display:flex;flex-wrap:wrap;gap:8px 12px;align-items:center;"><strong>Rush:</strong>&nbsp;${rushTx}</div>` : ''}
                ${claimHTML ? `<div class="claim">${claimHTML}</div>` : ''}
              </div>`;
                    }

                    const pickCell = cells[map.picked];
                    if (pickCell) {
                        pickCell.classList.add('col-dates');
                        pickCell.innerHTML = `
              <div class="dates-col" style="display:grid;gap:8px;align-content:start;">
                ${pickTx ? `<div class="pill pill--date" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:#4D437C;color:#fff;font-weight:600;line-height:1;"><span class="label" style="opacity:.85;font-weight:500;">Time&nbsp;Picked:</span><span>${pickTx}</span></div>` : ''}
                ${dateTx ? `<div class="pill pill--date" style="display:inline-flex;align-items:center;gap:6px;padding:4px 10px;border-radius:999px;background:#4D437C;color:#fff;font-weight:600;line-height:1;"><span class="label" style="opacity:.85;font-weight:500;">Labels&nbsp;Printed:</span><span>${dateTx}</span></div>` : ''}
              </div>`;
                    }

                    const toRemove = [idxCheck, map.inside, map.weight, map.date, map.onhold, map.rush, map.submit]
                    .filter(i => i >= 0).sort((a,b)=>b-a);
                    toRemove.forEach(i => { if (cells[i]) cells[i].remove(); });
                });

                const toRemoveHead = [idxCheck, map.inside, map.weight, map.date, map.onhold, map.rush, map.submit]
                .filter(i => i >= 0).sort((a,b)=>b-a);
                toRemoveHead.forEach(i => { if (ths[i]) ths[i].remove(); });

                const newThs = Array.from(head.cells);
                const cls = ['col-box','col-items','col-track','col-dates'];
                newThs.forEach((th, idx) => {
                    th.classList.add(cls[idx] || '');
                    Array.from(tbl.tBodies[0].rows).forEach(r => r.cells[idx]?.classList.add(cls[idx] || ''));
                });

                tbl.classList.add('packages-table','packages-v3');
                return true;
            }

            if (!transform()) {
                const mo = new MutationObserver(() => { if (transform()) mo.disconnect(); });
                mo.observe(document.documentElement, { childList:true, subtree:true });
            }
            window.addEventListener('tm:route', () => { /* reattempt after SPA route */ transform(); });
        })();

        /* 5f) Shadow host + pass-through policy */
        const host = Object.assign(document.createElement('div'), { id: 'scx-nav-host' });
        Object.assign(host.style, { position: 'fixed', top: 0, left: 0, right: 0, zIndex: 2147483647 });
        document.body.prepend(host);
        const shadow = host.attachShadow({ mode: 'open' });

        /* >>> ensure mc-dock is layered above the host <<< */
        (function ensureDockAboveHost(){
            const hostZ = parseInt(getComputedStyle(host).zIndex || '2147483647', 10);
            // publish z-index one step above host via a CSS var (does not touch #mc-dock element.style)
            document.documentElement.style.setProperty('--mc-dock-z', String(hostZ + 1));

            // if host's z-index ever changes, keep mc-dock above it
            new MutationObserver(() => {
                const z = parseInt(getComputedStyle(host).zIndex || hostZ, 10);
                document.documentElement.style.setProperty('--mc-dock-z', String(z + 1));
            }).observe(host, { attributes: true, attributeFilter: ['style'] });
        })();
        /* 5f.2) Modal safety & click restore
   - lift ANY dialog-ish panel above ExtraNav
   - mark it .scx-modal-safe so header/body get normal behavior
   - guarantee it's clickable
*/
        (function fixModalLayeringAndSafeHeaders(){
            function getHostZ() {
                const z = parseInt(getComputedStyle(host).zIndex || '2147483647', 10);
                return Number.isFinite(z) ? z : 2147483647;
            }

            // Heuristic: is this panel acting like an interactive modal / compose box?
            // We look for common interactive bits: file input, #addNew button, textarea#message, etc.
            function looksInteractivePanel(panelEl) {
                if (!panelEl) return false;
                if (panelEl.classList.contains('scx-modal-safe')) return true; // already tagged

                // inside this panel body, do we have obvious "compose/send" stuff?
                const hasSubmitBtn   = panelEl.querySelector('#addNew, button[id="addNew"], button.btn-success');
                const hasMessageBox  = panelEl.querySelector('textarea#message, textarea[name="message"]');
                const hasFileInput   = panelEl.querySelector('input[type="file"]');
                const hasUploadForm  = panelEl.querySelector('form#uploadfiles');
                const hasToSelect    = panelEl.querySelector('select#to, select[name="to"]');

                return !!(hasSubmitBtn || hasMessageBox || hasFileInput || hasUploadForm || hasToSelect);
            }

            // Tag + raise a root element (real .modal OR fallback panel)
            function tagModalScope(modEl, dlgZ, bgZ) {
                if (!modEl) return;

                // Make sure z-index will apply.
                const cs = getComputedStyle(modEl);
                if (cs.position === 'static') {
                    modEl.style.position = 'relative';
                }

                modEl.style.zIndex = String(dlgZ);
                modEl.style.pointerEvents = 'auto';
                modEl.classList.add('scx-modal-safe');

                // Also tag obvious children so the CSS override hits .panel-heading / .panel-body
                modEl.querySelectorAll('.panel, .panel-heading, .panel-body').forEach(n => {
                    n.classList.add('scx-modal-safe');
                    // each child should also be position:relative so z-index layering sticks
                    const csChild = getComputedStyle(n);
                    if (csChild.position === 'static') {
                        n.style.position = 'relative';
                    }
                    n.style.zIndex = String(dlgZ);
                    n.style.pointerEvents = 'auto';
                });

                // If there's a backdrop/overlay (Bootstrap / jQuery UI style), float it just under dialog
                document.querySelectorAll('.modal-backdrop, .ui-widget-overlay, .ui-dialog-overlay').forEach(bg => {
                    const csBg = getComputedStyle(bg);
                    if (csBg.position === 'static') {
                        bg.style.position = 'fixed'; // backdrop should cover viewport
                        bg.style.inset = '0';
                    }
                    bg.style.zIndex = String(bgZ);
                    bg.style.pointerEvents = 'auto';
                });
            }

            function boostModals(root = document) {
                const baseZ = getHostZ();
                const dlgZ  = baseZ + 2; // dialog itself (and our interactive panels)
                const bgZ   = baseZ + 1; // backdrop, if present

                // 1. Real modals / dialogs (Bootstrap, jQuery UI, role="dialog")
                const realDialogNodes = root.querySelectorAll(
                    '.modal, .ui-dialog, [role="dialog"], .ui-widget.ui-widget-content'
                );
                realDialogNodes.forEach(modEl => tagModalScope(modEl, dlgZ, bgZ));

                // 2. Fallback "standalone compose panel" case (your Add Conversation page)
                //    Find any .panel.panel-default that *looks* like a compose/send form.
                const panelNodes = root.querySelectorAll('.panel.panel-default');
                panelNodes.forEach(panelEl => {
                    if (!panelEl.classList.contains('scx-modal-safe') && looksInteractivePanel(panelEl)) {
                        // Use the panel itself as the modal root
                        tagModalScope(panelEl, dlgZ, bgZ);

                        // Also ensure its closest row/col wrapper comes up too,
                        // so nothing else in that mini-page sits above it.
                        const rowWrap = panelEl.closest('.row, .col-lg-12, body');
                        if (rowWrap && !rowWrap.classList.contains('scx-modal-safe')) {
                            if (getComputedStyle(rowWrap).position === 'static') {
                                rowWrap.style.position = 'relative';
                            }
                            rowWrap.style.zIndex = String(dlgZ);
                            rowWrap.style.pointerEvents = 'auto';
                            rowWrap.classList.add('scx-modal-safe');
                        }
                    }
                });
            }

            // Inject (or reuse) the modal safety stylesheet
            (function injectModalSafeStyle(){
                if (document.querySelector('style[data-scx-modal-safety]')) return;
                const modalStyle = document.createElement('style');
                modalStyle.setAttribute('data-scx-modal-safety', '1');
                modalStyle.textContent = `
/* ============================
   MODAL SAFETY OVERRIDES
   Panels tagged .scx-modal-safe opt OUT of global
   .panel-heading flex/center overrides and regain clickability.
   ============================ */

/* Restore normal panel header layout so draggable handles / close buttons behave */
.scx-modal-safe.panel-heading,
.scx-modal-safe .panel-heading {
  display:block !important;
  justify-content:flex-start !important;
  align-items:flex-start !important;
  text-align:left !important;
  cursor:move;
}

/* Undo our global float:none for header contents in this safe scope */
.scx-modal-safe.panel-heading > *,
.scx-modal-safe .panel-heading > * {
  float:initial !important;
  margin:initial !important;
}

/* Allow pull-right / close buttons again */
.scx-modal-safe.panel-heading .pull-right,
.scx-modal-safe .panel-heading .pull-right,
.scx-modal-safe.panel-heading [style*="float:right"],
.scx-modal-safe .panel-heading [style*="float:right"] {
  float:right !important;
  margin-left:auto !important;
}

/* Body in safe panels should be scrollable and interactive */
.scx-modal-safe.panel-body,
.scx-modal-safe .panel-body {
  overflow:visible !important;
  pointer-events:auto !important;
}

/* Force controls in safe panels to actually receive clicks */
.scx-modal-safe button,
.scx-modal-safe .btn,
.scx-modal-safe input,
.scx-modal-safe select,
.scx-modal-safe textarea,
.scx-modal-safe label {
  pointer-events:auto !important;
  cursor:pointer;
}

/* Keep textarea editability visible (your tm-field dark style still applies) */
.scx-modal-safe textarea,
.scx-modal-safe input,
.scx-modal-safe select {
  cursor:text;
}
        `;
                document.head.appendChild(modalStyle);
            })();

            // Run once now
            boostModals();

            // Watch DOM for new injected dialogs / compose panels
            const mo = new MutationObserver(() => boostModals());
            mo.observe(document.documentElement, { childList: true, subtree: true });

            // Re-run on SPA route/nav changes too
            window.addEventListener('tm:route', boostModals);

            // Console helper for debugging
            window.SCX_fixModalsNow = boostModals;
        })();



        const passThru = document.createElement('style');
        passThru.textContent = `
      :host { pointer-events: none !important; }
      :host > * { pointer-events: none !important; }
      header.menu-top, header.menu-top * { pointer-events: auto !important; }
      .submenu { pointer-events: none !important; }
      .submenu[data-open="true"] { pointer-events: auto !important; }
    `;
        shadow.appendChild(passThru);

        /* 5g) Fonts (optional, best-effort; no strict checks) */
        document.head.append(
            Object.assign(document.createElement('link'), { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossOrigin: 'anonymous' }),
            Object.assign(document.createElement('link'), { rel: 'preconnect', href: 'https://cdn.jsdelivr.net', crossOrigin: 'anonymous' }),
            Object.assign(document.createElement('link'), { rel: 'stylesheet', href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap' }),
        );

        /* 5h) Load HTML into shadow + mount legacy search bridge */
        const html = await fetchText(HTML_URL);
        const doc = new DOMParser().parseFromString(html, 'text/html');
        const container = doc.body || doc;
        absolutizeHtmlUrls(container, BASE);

        const header = container.querySelector('header.menu-top');
        if (header) shadow.appendChild(header);

        /* 5i) Load CSS into shadow; adapt URLs + :root scopes */
        const rawCSS = await fetchText(CSS_URL);
        shadow.appendChild(Object.assign(document.createElement('style'), {
            textContent: adaptCssForShadow(absolutizeCssUrls(rawCSS, BASE))
        }));

        /* 5j) Keep theme attrs synced to shadow host */
        const syncAttrs = () => ['data-theme','data-sexy'].forEach(a => {
            const v = document.documentElement.getAttribute(a);
            if (v === null) host.removeAttribute(a); else host.setAttribute(a, v);
        });
        syncAttrs();
        new MutationObserver(syncAttrs).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme','data-sexy'] });

        /* 5k) Load nav JS into shadow with proxies */
        try {
            const js = await fetchText(JS_URL);
            runInShadow(js, shadow, host);
        } catch (err) {
            console.error('[ExtraNav] nav-ux eval failed:', err);
        }

        /* 5l) Wire “open in new tab” for both roots, and on SPA routes */
        enableNewTabClicks(document);
        enableNewTabClicks(shadow);
        window.addEventListener('tm:route', () => {
            // Re-wire in case SPA replaces anchors or re-renders menus
            enableNewTabClicks(document);
            enableNewTabClicks(shadow);
        });
    });
})();