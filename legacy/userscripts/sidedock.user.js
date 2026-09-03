// ==UserScript==
// @name         SideDock
// @namespace    jack.tools
// @version      1.10
// @match        https://extranet.strip-curtains.com/*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor&priceCheck=true*
// @run-at       document-idle
// @grant        GM_addStyle
// @noframes
// ==/UserScript==

(() => {
    'use strict';

    const DRAWER_ID   = 'sc-right-drawer';
    const STORAGE_KEY = 'sc:rightDrawerState';
    const ACTIVE_KEY  = 'sc:rightDrawerActiveKey';

    const PANELS = [
        { key:'message-center',   label:'Message Center',   headingMatch:/message\s*center/i,   blockSelector:'#MessageCenter-Block', toolbarSelector:'a[href*="add_conversation"]' },
        { key:'shipment-sources', label:'Shipment Sources', headingMatch:/shipment\s*sources/i, blockSelector:'#ShipmentSources-Block' },
        { key:'notes',            label:'Notes',            headingMatch:/\bnotes?:?\b/i,       blockSelector:'#Notes-Block' },
        { key:'tracking', label:'Tracking', headingMatch:/\bshipments\b/i, blockSelector:'#Shipments-Block' }

    ];

    // ---------- utils ----------
    const onReady = (fn) => (document.readyState !== 'loading')
    ? fn()
    : document.addEventListener('DOMContentLoaded', fn, { once:true });

    const wantsMessageCenterFromHash = () => /#MessageCenter-Block/i.test(location.hash || '');

    // ---------- drawer ----------
    function ensureDrawer() {
        let drawer = document.getElementById(DRAWER_ID);
        if (drawer) return drawer;

        drawer = document.createElement('aside');
        drawer.id = DRAWER_ID;
        drawer.setAttribute('role','complementary');
        drawer.setAttribute('aria-label','Side drawer');
        drawer.className = 'collapsed';
        drawer.innerHTML = `
      <div class="sc-drawer-body" role="region">
        <div class="sc-drawer-inner"></div>
      </div>
      <div class="sc-rail" role="tablist" aria-orientation="vertical"></div>
    `;
        document.body.appendChild(drawer);

        /* --- NEW: keep drawer z-index aligned with ExtraNav shadow host --- */
        const syncDrawerZ = () => {
            // navbar host injected by ExtraNav
            const navHost = document.getElementById('scx-nav-host');
            const baseZ = navHost
            ? parseInt(getComputedStyle(navHost).zIndex || '2147483647', 10)
            : 2147483000; // fallback = old SideDock z
            drawer.style.zIndex = String(baseZ);
        };

        // run once immediately
        syncDrawerZ();

        // observe future z-index changes on the nav host
        const navHostEl = document.getElementById('scx-nav-host');
        // if nav host doesn't exist yet, watch for it to get added once
        if (!navHostEl && !drawer._navHostWatchBound) {
            const watchForNavHost = new MutationObserver(() => {
                const hostNow = document.getElementById('scx-nav-host');
                if (!hostNow) return;

                // sync immediately once it shows up
                syncDrawerZ();

                // now watch its style changes going forward
                new MutationObserver(syncDrawerZ)
                    .observe(hostNow, { attributes:true, attributeFilter:['style'] });

                drawer._zSyncBound = true;
                watchForNavHost.disconnect();
            });

            watchForNavHost.observe(document.body, { childList:true, subtree:true });
            drawer._navHostWatchBound = true;
        }

        if (navHostEl && !drawer._zSyncBound) {
            new MutationObserver(syncDrawerZ)
                .observe(navHostEl, { attributes:true, attributeFilter:['style'] });
            drawer._zSyncBound = true;
        }
        /* --- END NEW BLOCK --- */

        const setOpen = (open) => {
            drawer.classList.toggle('collapsed', !open);
            sessionStorage.setItem(STORAGE_KEY, open ? 'open' : 'closed');
            drawer.querySelectorAll('.sc-rail-tab')
                .forEach(t => t.setAttribute('aria-expanded', String(open)));
            if (open) resizeDrawerToContent(drawer);
        };
        drawer._setOpen = setOpen;

        if (sessionStorage.getItem(STORAGE_KEY) === 'open') setOpen(true);

        if (!drawer._outsideBound) {
            const outside = (e) => {
                if (drawer.classList.contains('collapsed')) return;
                if (!drawer.contains(e.target)) setOpen(false);
            };
            document.addEventListener('mousedown', outside, true);
            document.addEventListener('touchstart', outside, true);
            drawer._outsideBound = true;
        }
        return drawer;
    }

    function ensureTab(drawer, key, label) {
        let tab = drawer.querySelector(`.sc-rail-tab[data-key="${key}"]`);
        if (tab) return tab;

        tab = document.createElement('button');
        tab.type = 'button';
        tab.className = 'sc-rail-tab';
        tab.dataset.key = key;
        tab.textContent = label;
        tab.setAttribute('role','tab');
        tab.setAttribute('title',label);
        tab.setAttribute('aria-controls',`sc-host-${key}`);
        tab.setAttribute('aria-expanded','false');

        tab.addEventListener('click', () => {
            const isActive = tab.classList.contains('active');
            const isOpen   = !drawer.classList.contains('collapsed');
            if (isActive && isOpen) {
                drawer._setOpen(false);
            } else {
                selectTab(drawer, key);
                drawer._setOpen(true);
            }
        });

        drawer.querySelector('.sc-rail').appendChild(tab);
        return tab;
    }

    function movePanelIntoDrawer(drawer, cfg) {
        if (drawer.querySelector(`#sc-host-${cfg.key}`)) return;

        const heading = Array.from(document.querySelectorAll('.panel-heading._tm-enhanced'))
        .find(h => cfg.headingMatch.test(h.textContent || ''));
        if (!heading) return;

        const panel = heading.closest('.panel');
        if (!panel) return;

        // Remove the internal heading (we provide our own)
        const internalHeading = panel.querySelector('.panel-heading._tm-enhanced');
        if (internalHeading) internalHeading.remove();

        if (cfg.blockSelector) {
            const block = panel.querySelector(cfg.blockSelector);
            if (block) block.style.display = 'block';
        }

        const body = panel.querySelector('.panel-body') || panel.firstElementChild || panel;
        const head = document.createElement('div');
        head.className = 'sc-panel-header';
        head.innerHTML = `<div class="sc-panel-title">${cfg.label}</div><div class="sc-panel-actions"></div>`;
        panel.insertBefore(head, body);

        if (cfg.toolbarSelector) {
            const tool = heading.querySelector(cfg.toolbarSelector);
            if (tool) head.querySelector('.sc-panel-actions').appendChild(tool.cloneNode(true));
        }

        const host = document.createElement('section');
        host.id = `sc-host-${cfg.key}`;
        host.dataset.key = cfg.key;
        host.className = 'sc-host';
        host.setAttribute('role','tabpanel');

        panel.dataset.drawerized = '1';
        panel.classList.add('sc-drawer-panel');
        host.appendChild(panel);
        drawer.querySelector('.sc-drawer-inner').appendChild(host);
    }

    function selectTab(drawer, key) {
        drawer.querySelectorAll('.sc-rail-tab').forEach(btn => {
            const active = btn.dataset.key === key;
            btn.classList.toggle('active', active);
            btn.setAttribute('aria-selected', String(active));
        });
        drawer.querySelectorAll('.sc-host').forEach(host => {
            host.toggleAttribute('hidden', host.dataset.key !== key);
        });
        sessionStorage.setItem(ACTIVE_KEY, key);

        setTimeout(() => {
            if (key === 'message-center') {
                transformMessageCenter();
                bindMCRowClicks();
                autoOpenIfSingle();
            }
            resizeDrawerToContent(drawer);
        }, 0);
    }

    function resizeDrawerToContent(drawer) {
        const host  = drawer.querySelector('.sc-host:not([hidden])');
        const panel = host?.querySelector('.sc-drawer-panel');
        if (!panel) return;

        const isMC     = host?.dataset.key === 'message-center';
        const body     = panel.querySelector('.panel-body') || panel;

        const widest = (root) => {
            let w = 0; const stack = [root];
            while (stack.length) { const n = stack.pop(); if (!n) continue;
                                  w = Math.max(w, n.scrollWidth || 0); stack.push(...n.children);
                                 } return Math.ceil(w);
        };
        const contentW = widest(body); // consider deepest children (e.g., table wrap)

        const railW    = parseInt(getComputedStyle(drawer).getPropertyValue('--rail-w')) || 52;
        const maxW     = Math.floor(window.innerWidth * 0.98) - railW;
        const minW     = isMC ? 1100 : 820;
        const newW     = Math.max(minW, Math.min(contentW, maxW));
        drawer.style.setProperty('--drawer-w', `${newW}px`);
    }

    function transformMessageCenter() {
        const table = document.querySelector('#MessageCenter-Block .table');
        if (!table) return;

        // Kill any extra THEADs (sticky clones cause mis-alignment)
        [...table.querySelectorAll('thead')].forEach((th,i)=>{ if(i>0) th.remove(); });

        // Ensure a canonical COLGROUP so header/body share widths 1:1.
        // Marked like the THEAD below: unguarded, this removed and re-inserted
        // the colgroup on every call, and build() runs from a
        // documentElement/subtree MutationObserver — so those two mutations
        // retriggered the observer, which called build() again. Self-feeding.
        let cg = table.querySelector('colgroup');
        if (!cg || !cg.dataset.mcColgroup) {
            if (cg) cg.remove();
            cg = document.createElement('colgroup');
            cg.dataset.mcColgroup = '1';
            cg.innerHTML = `
    <col class="mc-col-subject">
    <col class="mc-col-reply">
    <col class="mc-col-date">
    <col class="mc-col-from">
    <col class="mc-col-to">
    <col class="mc-col-cc">
  `;
            table.insertBefore(cg, table.firstChild);
        }

        // Ensure THEAD exists and has 6 columns matching the body
        let thead = table.tHead || table.querySelector('thead');
        if (!thead) { thead = document.createElement('thead'); table.insertBefore(thead, cg.nextSibling); }
        if (!thead.dataset.mcTransformed) {
            thead.innerHTML = `
      <tr>
        <th class="mc-h mc-col-subject">Subject</th>
        <th class="mc-h mc-col-reply">Reply</th>
        <th class="mc-h mc-col-date">Updated</th>
        <th class="mc-h mc-col-from">From</th>
        <th class="mc-h mc-col-to">To</th>
        <th class="mc-h mc-col-cc">CC</th>
      </tr>`;
            thead.dataset.mcTransformed = '1';
        }

        // Normalize body rows to the same 6-column order
        const tbody = table.tBodies[0] || table.querySelector('tbody');
        if (!tbody) return;

        [...tbody.rows].forEach(tr => {
            if (tr.dataset.mcTransformed) return;

            // Detail rows: keep them spanning all 6 columns
            const detail = tr.querySelector('td[colspan]');
            if (detail) { detail.colSpan = 6; tr.classList.add('mc-detail'); tr.dataset.mcTransformed = '1'; return; }

            const tds = [...tr.children];
            if (tds.length < 7) { tr.dataset.mcTransformed = '1'; return; }

            const id      = tds[0]; // drop
            const from    = tds[1];
            const to      = tds[2];
            const cc      = tds[3];
            const subject = tds[4];
            const date    = tds[5];
            const func    = tds[6];

            id.remove();

            tr.appendChild(subject); subject.className = 'mc-col-subject';
            const a = subject.querySelector('a'); if (a) a.style.display = 'inline-block';

            tr.appendChild(func);    func.className    = 'mc-col-reply';
            tr.appendChild(date);    date.className    = 'mc-col-date';
            tr.appendChild(from);    from.className    = 'mc-col-from';
            tr.appendChild(to);      to.className      = 'mc-col-to';
            tr.appendChild(cc);      cc.className      = 'mc-col-cc';

            tr.classList.add('mc-row');
            tr.dataset.mcTransformed = '1';
        });
    }


    function bindMCRowClicks() {
        const tbody = document.querySelector('#MessageCenter-Block .table tbody');
        if (!tbody || tbody.dataset.mcBound) return;

        const isInteractive = (el) => !!el.closest('a, button, input, select, textarea, [contenteditable]');
        tbody.addEventListener('click', (e) => {
            const tr = e.target.closest('tr.mc-row');
            if (!tr) return;
            if (isInteractive(e.target)) return;
            const link = tr.querySelector('.mc-col-subject a[data-toggle="collapse"][href^="#conversation"]')
            || tr.querySelector('.mc-col-subject a');
            if (link) link.click();
        }, true);

        tbody.addEventListener('mouseover', (e) => {
            const tr = e.target.closest('tr.mc-row');
            if (tr) tr.classList.add('mc-row-hover');
        }, true);
        tbody.addEventListener('mouseout', (e) => {
            const tr = e.target.closest('tr.mc-row');
            if (tr) tr.classList.remove('mc-row-hover');
        }, true);

        tbody.dataset.mcBound = '1';
    }

    function autoOpenIfSingle() {
        const tbody = document.querySelector('#MessageCenter-Block .table tbody');
        if (!tbody) return;
        const dataRows = Array.from(tbody.querySelectorAll('tr.mc-row'));
        if (dataRows.length === 1) {
            const link = dataRows[0].querySelector('.mc-col-subject a');
            if (link) link.click();
        }
    }

    // ---------- build / init ----------
    function build() {
        const drawer = ensureDrawer();

        const available = [];
        PANELS.forEach(cfg => {
            const has = Array.from(document.querySelectorAll('.panel-heading._tm-enhanced'))
            .some(h => cfg.headingMatch.test(h.textContent || ''));
            if (!has) return;
            available.push(cfg.key);
            ensureTab(drawer, cfg.key, cfg.label);
            movePanelIntoDrawer(drawer, cfg);
        });
        if (!available.length) return;

        transformMessageCenter();
        bindMCRowClicks();

        const preferMC = wantsMessageCenterFromHash() && available.includes('message-center');
        const wanted   = preferMC ? 'message-center' : (sessionStorage.getItem(ACTIVE_KEY) || available[0]);
        selectTab(drawer, available.includes(wanted) ? wanted : available[0]);

        const shouldOpen = preferMC || (sessionStorage.getItem(STORAGE_KEY) === 'open');
        drawer._setOpen(shouldOpen);

        if (shouldOpen && wanted === 'message-center') autoOpenIfSingle();

        setTimeout(() => resizeDrawerToContent(drawer), 0);
    }

    function registerDoubleTapHotkeys() {
        const drawer = ensureDrawer();
        if (drawer._hotkeysBound) return;
        drawer._hotkeysBound = true;

        const THRESH = 1000;
        const MAP = { s:'shipment-sources', n:'notes', m:'message-center', t:'tracking' };

        let lastKey = '';
        let lastTime = 0;
        let timer = null;

        const isEditable = (el) => el && (el.isContentEditable ||
                                          /^(INPUT|TEXTAREA|SELECT)$/.test(el.tagName) ||
                                          !!el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));

        const toggleTarget = (key) => {
            const target = MAP[key];
            if (!target) return;
            const tab = drawer.querySelector(`.sc-rail-tab[data-key="${target}"]`);
            if (!tab) return;

            const isOpen = !drawer.classList.contains('collapsed');
            const activeKey = drawer.querySelector('.sc-rail-tab.active')?.dataset.key || null;

            if (isOpen && activeKey === target) {
                drawer._setOpen(false);
            } else {
                selectTab(drawer, target);
                drawer._setOpen(true);
            }
        };

        document.addEventListener('keydown', (e) => {
            if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
            if (isEditable(e.target)) return;
            const k = (e.key || '').toLowerCase();
            if (!MAP[k]) return;

            const now = Date.now();
            if (lastKey === k && (now - lastTime) <= THRESH) {
                toggleTarget(k);
                lastKey = ''; lastTime = 0;
                if (timer) { clearTimeout(timer); timer = null; }
                e.preventDefault();
                return;
            }
            lastKey = k;
            lastTime = now;
            if (timer) clearTimeout(timer);
            timer = setTimeout(() => { lastKey = ''; }, THRESH);
        }, true);
    }

    // ---------- styles (scoped to drawer) ----------
    GM_addStyle(`
/* Drawer */
#${DRAWER_ID}{
  --drawer-w:1100px; --rail-w:52px;
  --sc-outline:rgba(75,63,132,.28);
  --panel-bg:rgba(255,255,255,.92);
  position:fixed; top:100px; right:0; height:80vh;
  display:flex; flex-direction:row; align-items:stretch;
  width:var(--rail-w); transition:width .25s ease; z-index:2147483000;
}
#${DRAWER_ID}:not(.collapsed){ width:calc(var(--drawer-w) + var(--rail-w)); }

#${DRAWER_ID} .sc-drawer-body{ width:0; overflow:hidden; transition:width .25s ease; background:transparent !important; border-radius:0 !important; box-shadow:none !important; }
#${DRAWER_ID}:not(.collapsed) .sc-drawer-body{ width:var(--drawer-w); }
#${DRAWER_ID} .sc-drawer-inner{ height:100%; overflow:auto; padding:10px; background:transparent !important; }
#${DRAWER_ID} .sc-host[hidden]{ display:none !important; }

/* Panel + header */
#${DRAWER_ID} .sc-drawer-panel{ margin:0; max-width:100%; border:1px solid var(--sc-outline) !important; border-radius:10px !important; background:var(--panel-bg) !important; box-shadow:none !important; }
#${DRAWER_ID} .sc-panel-header{ display:flex; align-items:center; justify-content:space-between; padding:6px 10px; border-bottom:1px solid var(--sc-outline); font-weight:600; }
#${DRAWER_ID} .sc-panel-title{ font-size:13px; }
#${DRAWER_ID} .sc-panel-actions > *{ margin-left:8px; }

/* Panel body */
#${DRAWER_ID} .sc-drawer-panel > .panel-body{ max-height:calc(80vh - 20px - 34px); overflow-y:auto; overflow-x:hidden; padding:10px; background:rgba(138,138,138,.92) !important; }

/* Message Center table (scoped) */
#${DRAWER_ID} #MessageCenter-Block .table{ width:100% !important; table-layout:fixed; border-collapse:collapse; background:transparent !important; border:0 !important; }
#${DRAWER_ID} #MessageCenter-Block .table thead:not(:first-of-type){ display:none !important; } /* hide sticky clones */

#${DRAWER_ID} #MessageCenter-Block .table thead th.mc-h{ font-size:12px; font-weight:600; white-space:nowrap; line-height:1.15; }
#${DRAWER_ID} #MessageCenter-Block .table thead th,
#${DRAWER_ID} #MessageCenter-Block .table tbody td{ padding:6px 8px !important; line-height:1.2; vertical-align:middle; box-sizing:border-box; white-space:nowrap; }

/* Columns */
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-reply{ width:1%; text-align:left; }
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-date{ width:18ch; }
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-from,
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-to,
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-cc{ width:18ch; overflow:hidden; text-overflow:ellipsis; }
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-subject{ min-width:0; width:auto; white-space:normal; }
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-subject a{ display:block; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:none; }

/* Rows / interactions */
#${DRAWER_ID} #MessageCenter-Block .table tr.mc-row{ cursor:pointer; }
#${DRAWER_ID} #MessageCenter-Block .table tr.mc-row.mc-row-hover{ background:rgba(0,0,0,.035); }

/* Detail row */
#${DRAWER_ID} #MessageCenter-Block .table td[colspan]{ padding:0 !important; }
#${DRAWER_ID} #MessageCenter-Block .panel-collapse > .panel-body{ height:360px; overflow:auto; }

/* Compact reply button inside drawer */
#${DRAWER_ID} #MessageCenter-Block .table .btn.btn-success{ padding:2px 8px; font-size:12px; }

/* Rail */
#${DRAWER_ID} .sc-rail{ width:var(--rail-w); display:flex; flex-direction:column; gap:6px; }
#${DRAWER_ID} .sc-rail-tab{ flex:1 1 0; border:0; margin:0; padding:6px 0; writing-mode:vertical-rl; text-orientation:mixed; font-weight:700; color:#fff; background:#4b3f84; border-radius:12px 0 0 12px; cursor:pointer; user-select:none; box-shadow:inset 2px 0 0 #f36c3d, 0 2px 8px rgba(0,0,0,.18); }
#${DRAWER_ID} .sc-rail-tab.active{ filter:brightness(1.06); }

/* Table layout + consistent box model */
#${DRAWER_ID} #MessageCenter-Block .table{
  width:100%!important; table-layout:fixed; border-collapse:collapse;
  background:transparent!important; border:0!important;
}

/* Column widths (apply to both header/body via <colgroup>) */
#${DRAWER_ID} #MessageCenter-Block .table col.mc-col-reply { width: 9ch; }
#${DRAWER_ID} #MessageCenter-Block .table col.mc-col-date  { width: 18ch; }
#${DRAWER_ID} #MessageCenter-Block .table col.mc-col-from,
#${DRAWER_ID} #MessageCenter-Block .table col.mc-col-to,
#${DRAWER_ID} #MessageCenter-Block .table col.mc-col-cc    { width: 18ch; }
/* Subject takes the remaining width; no fixed width on subject col */

/* Header + cell padding and centering of headers */
#${DRAWER_ID} #MessageCenter-Block .table thead th,
#${DRAWER_ID} #MessageCenter-Block .table tbody td{
  padding:6px 8px!important; line-height:1.2; vertical-align:middle; box-sizing:border-box; white-space:nowrap;
}
#${DRAWER_ID} #MessageCenter-Block .table thead th{ text-align:center; font-size:12px; font-weight:600; }

/* Center the Reply column (buttons) */
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-reply{ text-align:center; }
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-reply .btn{ display:inline-block; margin:0 auto; }

/* Subject text: clip nicely while left-aligned content-wise */
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-subject{ min-width:0; }
#${DRAWER_ID} #MessageCenter-Block .table .mc-col-subject a{
  display:block; max-width:100%; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; text-decoration:none;
}

/* Hover + detail rows */
#${DRAWER_ID} #MessageCenter-Block .table tr.mc-row{ cursor:pointer; }
#${DRAWER_ID} #MessageCenter-Block .table tr.mc-row.mc-row-hover{ background:rgba(0,0,0,.035); }
#${DRAWER_ID} #MessageCenter-Block .table td[colspan]{ padding:0!important; }
#${DRAWER_ID} #MessageCenter-Block .panel-collapse>.panel-body{ height:360px; overflow:auto; }

/* Ensure only the first THEAD is visible if the site injects a sticky clone */
#${DRAWER_ID} #MessageCenter-Block .table thead:not(:first-of-type){ display:none!important; }

`);

    // ---------- init ----------
    function init() {
        build();
        registerDoubleTapHotkeys();

        const drawer = ensureDrawer();
        const mo = new MutationObserver(() => { build(); setTimeout(() => resizeDrawerToContent(drawer), 0); });
        mo.observe(document.documentElement, { childList:true, subtree:true });

        window.addEventListener('resize', () => resizeDrawerToContent(drawer), { passive:true });
        window.addEventListener('hashchange', () => {
            if (wantsMessageCenterFromHash()) { selectTab(drawer,'message-center'); drawer._setOpen(true); }
        }, { passive:true });
    }

    onReady(init);
})();
