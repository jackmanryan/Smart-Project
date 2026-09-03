// ==UserScript==
// @name         Legacy Form (Consolidated & Hardened)
// @namespace    jack.nav.search.shadow
// @version      2.0.0
// @description  Styled search inside ExtraNav (or fallback overlay), Gmail → Search → first-order jump, single-result fast-path with loader, and robust SPA re-mounting.
// @match        https://extranet.strip-curtains.com/*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor&priceCheck=true*
// @run-at       document-start
// ==/UserScript==

(() => {
  'use strict';

  // ---------- Config (single source of truth) ----------
  const CFG = {
    SEARCH_ACTION: 'https://extranet.strip-curtains.com/?p=search',
    AUTO_FLAG_KEY: 'tmx:auto-open-from-gmail',
    LAST_EXTRA_KEY: 'tmx:search:extra',
    ORDER_LINK_SEL: 'a[href*="?p=orders-view"][href*="view="]:not([href*="orders-view-test"])',
    NAV_HOST_ID: 'scx-nav-host',
    NAV_HEADER_SEL: 'header.menu-top',
    TIMEOUT_MS: 15000,
    POLL_MS: 150
  };

  // De-dupe guard (avoid double run across re-renders / duplicate injections)
  if (window.__tmxLegacyFormMounted) return;
  window.__tmxLegacyFormMounted = true;

  // Optional tiny debug hook
  window._tmxLegacyForm = { version: '2.0.0' };

  const OPTIONS = [
    { value: '---',             label: '---' },
    { value: 'Account',         label: 'Account' },
    { value: 'Broad',           label: 'Broad' },
    { value: 'Email',           label: 'Email' },
    { value: 'Amount',          label: 'Amount' },
    { value: 'Order',           label: 'Order' },
    { value: 'Phone',           label: 'Phone' },
    { value: 'Invoice',         label: 'Invoice' },
    { value: 'Purchase Order',  label: 'Purchase Order' },
  ];

  // ---------- Utilities ----------
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  async function waitFor(fn, timeout = CFG.TIMEOUT_MS, step = CFG.POLL_MS) {
    const t0 = performance.now();
    for (;;) {
      const v = fn();
      if (v) return v;
      if (performance.now() - t0 > timeout) return null;
      await sleep(step);
    }
  }

  const safeLS = {
    get(k){ try { return localStorage.getItem(k); } catch { return null; } },
    set(k,v){ try { localStorage.setItem(k, v); } catch {} },
    del(k){ try { localStorage.removeItem(k); } catch {} }
  };

  function injectCSSInto(root, css) {
    const style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);
  }

  // ---------- Loader helpers (inline UI + Hamilton event) ----------
  function emitHamilton(state) {
    try { window.dispatchEvent(new CustomEvent('hamilton:loading', { detail: { state, source: 'legacy-form' } })); } catch {}
  }
  function startLoadingUI(slot) {
    try {
      slot?.setAttribute('data-loading', '1');
      slot?.querySelector('.input')?.setAttribute('aria-busy', 'true');
      emitHamilton('start');
    } catch {}
  }
  function stopLoadingUI(slot) {
    try {
      slot?.removeAttribute('data-loading');
      slot?.querySelector('.input')?.removeAttribute('aria-busy');
      emitHamilton('stop');
    } catch {}
  }

  function parseAutoSearchFromHash() {
    const raw = location.hash ? location.hash.replace(/^#/, '') : '';
    if (!raw) return null;
    const p = new URLSearchParams(raw);
    if (p.get('autosearch') !== '1') return null;
    return { q: p.get('q') || '', extra: p.get('extra') || '---' };
  }

  // ---------- FAST PATH: server-side POST → parse → immediate jump ----------
  async function tryFastSearchNavigate(q, extra, opts = {}) {
    const { returnUrl = false, signal } = opts;
    try {
      const body = new URLSearchParams({ search: q, extraOption: extra }).toString();
      const res = await fetch(CFG.SEARCH_ACTION, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
        cache: 'no-store',
        body,
        signal
      });
      if (!res.ok) return returnUrl ? null : false;

      const html = await res.text();
      const doc  = new DOMParser().parseFromString(html, 'text/html');

      const links = [...doc.querySelectorAll(CFG.ORDER_LINK_SEL)];
      const uniq  = [];
      const seen  = new Set();
      for (const a of links) {
        const raw = a.getAttribute('href') || a.href || '';
        if (!raw) continue;
        const u   = new URL(raw, location.origin);
        const id  = u.searchParams.get('view') || u.toString();
        if (seen.has(id)) continue;
        seen.add(id);
        uniq.push(u.toString());
      }

      if (uniq.length === 1) {
        const url = uniq[0];
        try { sessionStorage.removeItem(CFG.AUTO_FLAG_KEY); } catch {}
        if (returnUrl) return url;

        // Keep previous page in history (Back returns there), skip intermediate search page.
        try { history.pushState({ from: 'legacy-form' }, '', location.href); } catch {}
        location.replace(url);
        return true;
      }
      return returnUrl ? null : false;
    } catch {
      return returnUrl ? null : false;
    }
  }

  // ---------- Build UI (shadow-root or fallback overlay) ----------
  function buildSearchUI({ mountInto, position = 'header' }) {
    const sr = mountInto; // Element to inject into (shadow root or document.body)

    const slot = document.createElement('div');
    slot.className = 'tmx-slot tmx-search';
    const loadingBar = document.createElement('div');
    loadingBar.className = 'loading-bar';
    slot.appendChild(loadingBar);

    // Style
    injectCSSInto(sr, `
      .tmx-slot{ display:flex; align-items:center; min-width:260px; width:min(470px, 32vw); ${position==='overlay' ? 'position:fixed; top:10px; right:12px; z-index:2147483646;' : ''} }
      .tmx-slot.flex-right{ margin-left:auto; }
      .tmx-slot.abs-right{ position:absolute; right:12px; top:50%; transform:translateY(-50%); }

      .tmx-search{
        --field-bg:#0f1420; --text-0:#e6ebf4; --text-1:#b7c0d4;
        --surface-0:#141828; --surface-1:#1a2140; --border-0:#2a3460;
        --submenu-bg:#1b2133; --submenu-sep:#2c3244; --bg-0:#0e1324;
        --accent-1:#5353ff; --ink-1:#90a0ff;
        --btn-h:40px; --r-0:10px; --menu-w:240px; --search-size:20px; --search-gap:12px;
        font-family:inherit; font-weight:800; line-height:1.25; letter-spacing:.1px;
      }
      .tmx-search .group{ position:relative; width:100%; }
      .tmx-search .input{
        width:100%; height:44px; border:0; border-radius:var(--r-0);
        background:var(--field-bg); color:var(--text-0);
        padding-inline:12px calc(var(--search-size) + var(--search-gap) + 8px);
        box-shadow:0 0 0 1px var(--border-0), 0 0 0 2px var(--bg-0);
      }
      .tmx-search .input::placeholder{ color:var(--text-1); font-weight:600; }
      .tmx-search .input:hover{ box-shadow:0 0 0 2px var(--surface-1), 0 0 0 3px var(--bg-0); }
      .tmx-search .input:focus{ outline:none; box-shadow:0 0 0 2px var(--accent-1), 0 0 0 4px var(--bg-0); }

      .tmx-search .search-trigger{
        position:absolute; top:0; right:0; height:100%;
        width:calc(var(--search-size) + var(--search-gap) + 8px);
        display:flex; align-items:center; justify-content:center;
        background:transparent; border:0; color:var(--text-0); cursor:pointer;
      }
      .tmx-search .search-trigger svg{ width:var(--search-size); height:var(--search-size); }
      .tmx-search .search-trigger:focus-visible{ outline:none; box-shadow:0 0 0 2px var(--accent-1); border-radius:var(--r-0); }

      .tmx-search .submenu[data-submenu]{
        position:absolute; top:calc(100% + 8px); right:0; min-width:var(--menu-w);
        background:var(--submenu-bg); border:1px solid var(--border-0); border-radius:var(--r-0);
        padding:8px; margin:0; list-style:none; display:flex; flex-direction:column; gap:8px;
        opacity:0; visibility:hidden; pointer-events:none; transform:translateY(4px);
        transition:opacity .16s ease, transform .16s ease, visibility .16s step-end; color:#fff; z-index:10000;
        box-shadow: 0 0 0 1px var(--bg-0) inset;
      }
      .tmx-search .search-trigger[aria-expanded="true"] + .submenu{
        opacity:1; visibility:visible; pointer-events:auto; transform:none;
      }

      .tmx-search .list{ list-style:none; padding:0 6px; margin:0; display:flex; flex-direction:column; gap:8px; }
      .tmx-search .element{
        display:flex; align-items:center; gap:10px; padding:8px; border-radius:8px; cursor:pointer;
        border-bottom:1px solid var(--submenu-sep);
      }
      .tmx-search .element:last-child{ border-bottom:0; }
      .tmx-search .element:hover{ background: rgba(255,255,255,0.06); }
      .tmx-search .element label{ display:flex; align-items:center; gap:10px; cursor:pointer; color:#fff; }
      .tmx-search .opt-text{ color:#fff; font-weight:600; line-height:1.25; }

      .tmx-search input[type="radio"]{
        appearance:none; inline-size:1.5em; block-size:1.5em; border-radius:50%;
        background:var(--submenu-bg); margin:0; position:relative;
        transition: transform .1s ease-out, box-shadow .1s ease-out, background .1s ease-out;
        box-shadow: 0 0 0 0.15em var(--surface-0), 0 0 0 0.30em var(--bg-0), 0 0 0 0.45em var(--surface-0);
      }
      .tmx-search input[type="radio"]::before{
        content:""; position:absolute; inset:50%; inline-size:.75em; block-size:.75em; border-radius:50%;
        background: var(--bg-0); box-shadow: 0 0 0 1px var(--surface-0);
        transform: translate(-50%,-50%) scale(0); transition: transform .1s ease-out, background .1s ease-out;
      }
      .tmx-search input[type="radio"]:checked::before{ transform: translate(-50%,-50%) scale(1); background: var(--accent-1); }
      .tmx-search input[type="radio"]:focus-visible{ outline:2px dashed var(--ink-1); outline-offset:.2em; }

      /* Loading bar */
      .tmx-slot{ position:relative; }
      .tmx-slot .loading-bar{ position:absolute; left:0; right:0; top:-2px; height:2px; opacity:0; pointer-events:none; transform:translateZ(0); }
      .tmx-slot[data-loading="1"] .loading-bar{ opacity:1; }
      .tmx-slot[data-loading="1"] .input{ cursor: progress; opacity:.9; }
      .tmx-slot .loading-bar::before{
        content:""; position:absolute; left:0; top:0; bottom:0; width:30%;
        background: linear-gradient(90deg, rgba(99,102,241,.9), rgba(59,130,246,.9));
        animation: tmx-indet 1.05s infinite ease;
      }
      @keyframes tmx-indet { 0%{transform:translateX(-35%) scaleX(.35);} 50%{transform:translateX(20%) scaleX(.65);} 100%{transform:translateX(100%) scaleX(.35);} }

      /* Optional host-page width hint */
      form[action="${CFG.SEARCH_ACTION}"] { width:700px !important; }
    `);

    const form = document.createElement('form');
    form.action = CFG.SEARCH_ACTION;
    form.method = 'post';
    form.target = '_self';
    form.autocomplete = 'off';

    const group = document.createElement('div');
    group.className = 'group';
    group.setAttribute('role', 'search');

    const input = document.createElement('input');
    input.className = 'input';
    input.type = 'search';
    input.name = 'search';
    input.placeholder = 'Search…';
    input.autocomplete = 'off';
    input.setAttribute('aria-label', 'Search');

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'search-trigger';
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', 'tmx-menu');
    btn.setAttribute('aria-label', 'Search options');
    btn.innerHTML = `
      <svg viewBox="0 0 32 32" fill="currentColor" stroke="currentColor" aria-hidden="true" focusable="false">
        <polygon points="30 6 26 6 26 2 24 2 24 6 20 6 20 8 24 8 24 12 26 12 26 8 30 8 30 6"></polygon>
        <path d="M24,28.5859l-5.9751-5.9751a9.0234,9.0234,0,1,0-1.4141,1.4141L22.5859,30ZM4,17a7,7,0,1,1,7,7A7.0078,7.0078,0,0,1,4,17Z"></path>
      </svg>
    `;

    const menu = document.createElement('div');
    menu.id = 'tmx-menu';
    menu.className = 'submenu';
    menu.setAttribute('data-submenu', '');
    menu.setAttribute('role', 'menu');
    menu.setAttribute('aria-label', 'Search options');

    const ul = document.createElement('ul');
    ul.className = 'list';
    ul.setAttribute('role', 'none');

    const selHidden = document.createElement('select');
    selHidden.name = 'extraOption';
    selHidden.style.display = 'none';

    // restore persisted selection if present
    const saved = safeLS.get(CFG.LAST_EXTRA_KEY);
    let defaultExtra = OPTIONS[0].value;
    if (OPTIONS.some(o => o.value === saved)) defaultExtra = saved;

    OPTIONS.forEach((opt, i) => {
      const optEl = document.createElement('option');
      optEl.value = opt.value;
      optEl.textContent = opt.label;
      selHidden.appendChild(optEl);

      const li = document.createElement('li');
      li.className = 'element';
      const label = document.createElement('label');
      const r = document.createElement('input');
      r.type = 'radio';
      r.name = 'tm_extraOption';
      r.value = opt.value;
      if (opt.value === defaultExtra || (i === 0 && !defaultExtra)) r.checked = true;
      const span = document.createElement('span');
      span.className = 'opt-text';
      span.textContent = opt.label;

      label.append(r, document.createTextNode(' '), span);
      li.appendChild(label);
      ul.appendChild(li);
    });
    selHidden.value = defaultExtra || OPTIONS[0].value;

    menu.appendChild(ul);
    const setOpen = (open) => {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      if (open) menu.setAttribute('data-open', 'true');
      else menu.removeAttribute('data-open');
    };

    btn.addEventListener('click', () => setOpen(btn.getAttribute('aria-expanded') !== 'true'));

    // close on outside click / escape
    (sr instanceof ShadowRoot ? sr : document).addEventListener('click', (e) => {
      if (!slot.contains(e.target)) setOpen(false);
    });
    (sr instanceof ShadowRoot ? sr : document).addEventListener('keydown', (e) => {
      if (e.key === 'Escape') setOpen(false);
    });

    // keyboard: open with ArrowDown when focused in input
    input.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' && btn.getAttribute('aria-expanded') !== 'true') {
        e.preventDefault();
        setOpen(true);
      }
    });

    ul.addEventListener('change', (e) => {
      const r = e.target;
      if (r && r.type === 'radio') {
        selHidden.value = r.value;
        safeLS.set(CFG.LAST_EXTRA_KEY, r.value);
        setOpen(false);
      }
    });

    // Enter submits; Ctrl/Shift/Cmd+Enter → new tab
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && btn.getAttribute('aria-expanded') !== 'true') {
        e.preventDefault();
        const wantsNewTab = e.ctrlKey || e.shiftKey || e.metaKey;
        if (wantsNewTab) {
          form.__tmxNewTabIntent = true;
          try { form.__tmxNewTabWin = window.open('about:blank', '_blank', 'noopener'); } catch {}
        }
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
      }
    });

    group.append(input, btn, menu);
    form.append(group, selHidden);
    slot.append(form);

    // attach in header or as overlay
    if (position === 'header') {
      const header = (sr instanceof ShadowRoot ? sr : document).querySelector('header.menu-top');
      const isFlex = header && getComputedStyle(header).display.includes('flex');
      if (header) {
        slot.classList.add(isFlex ? 'flex-right' : 'abs-right');
        header.appendChild(slot);
      } else {
        // if header disappeared after we chose header mode, fall back
        slot.style.position = 'fixed';
        slot.style.top = '10px'; slot.style.right = '12px';
        (sr instanceof ShadowRoot ? sr.host.ownerDocument.body : document.body).appendChild(slot);
      }
    } else {
      (sr instanceof ShadowRoot ? sr.host.ownerDocument.body : document.body).appendChild(slot);
    }

    wireSingleResultFastPath(form, input, selHidden, slot);
  }

  function wireSingleResultFastPath(form, inputEl, selectEl, slot) {
    form.addEventListener('submit', (ev) => {
      if (form.__tmxBypassSubmit) return; // Avoid double work if we've chosen native submit.
      const wantsNewTab = !!form.__tmxNewTabIntent;
      ev.preventDefault();

      const q     = (inputEl.value || '').trim();
      const extra = selectEl.value || '---';

      // Shared controller to cancel if we decide to submit natively
      const ctrl = new AbortController();

      if (wantsNewTab) {
        // NEW TAB behavior
        tryFastSearchNavigate(q, extra, { returnUrl: true, signal: ctrl.signal }).then(url => {
          const w = form.__tmxNewTabWin;
          if (url) {
            if (w && !w.closed) w.location = url; else window.open(url, '_blank', 'noopener');
          } else {
            // Not exactly one result → submit search to a new tab
            const prevTarget = form.target;
            form.__tmxBypassSubmit = true;
            form.target = '_blank';
            form.submit();
            form.target = prevTarget;
          }
        }).finally(() => {
          form.__tmxNewTabIntent = false;
          form.__tmxNewTabWin = null;
        });
        return;
      }

      // SAME-PAGE behavior with loader
      startLoadingUI(slot);
      tryFastSearchNavigate(q, extra, { signal: ctrl.signal })
        .then(ok => {
          if (ok) return; // navigated (keep loader through nav)
          form.__tmxBypassSubmit = true;
          form.submit();   // falls back to full results page
          // we intentionally keep loader through navigation
        })
        .catch(() => {
          // If an error occurs without navigation, stop the loader
          stopLoadingUI(slot);
        });
    });
  }

  // ---------- Gmail → list page → first order auto-jump ----------
  function findAndOpenFirstOrderLink(doc = document) {
    const a = doc.querySelector(CFG.ORDER_LINK_SEL);
    if (!a) return false;
    const href = a.getAttribute('href') || '';
    if (!href) return false;
    try { sessionStorage.removeItem(CFG.AUTO_FLAG_KEY); } catch {}
    location.replace(href);
    return true;
  }

  function autoOpenFromGmail() {
    try {
      const u = new URL(location.href);
      if ((u.searchParams.get('p') || '').startsWith('orders-view')) {
        try { sessionStorage.removeItem(CFG.AUTO_FLAG_KEY); } catch {}
        return;
      }
    } catch {}

    let gated = false;
    try { gated = sessionStorage.getItem(CFG.AUTO_FLAG_KEY) === '1'; } catch {}
    if (!gated) return;

    if (findAndOpenFirstOrderLink()) return;

    const mo = new MutationObserver(() => {
      if (findAndOpenFirstOrderLink()) mo.disconnect();
    });
    mo.observe(document.documentElement, { subtree: true, childList: true });
    setTimeout(() => mo.disconnect(), CFG.TIMEOUT_MS);
  }

  // ---------- Bootstrap ----------
  (async function init() {
    // SUPER-FAST: handle #autosearch before UI mount
    const seed = parseAutoSearchFromHash();
    if (seed) {
      try { sessionStorage.setItem(CFG.AUTO_FLAG_KEY, '1'); } catch {}
      emitHamilton('start');

      // Attempt server-side fast path
      if (await tryFastSearchNavigate(seed.q, seed.extra)) return;

      // Fallback: clean URL, then submit minimal form ASAP
      history.replaceState(null, '', location.pathname + location.search);
      const f = document.createElement('form');
      f.action = CFG.SEARCH_ACTION; f.method = 'post'; f.target = '_self';
      f.append(
        Object.assign(document.createElement('input'), { type: 'hidden', name: 'search',      value: seed.q }),
        Object.assign(document.createElement('input'), { type: 'hidden', name: 'extraOption', value: seed.extra || '---' })
      );
      document.documentElement.appendChild(f);
      f.submit();
      return;
    }

    // Prefer ExtraNav shadow header; fall back to overlay if not found in time
    const host = await waitFor(() => document.getElementById(CFG.NAV_HOST_ID));
    const sr = host?.shadowRoot || null;
    const header = await waitFor(() => sr?.querySelector(CFG.NAV_HEADER_SEL));

    if (sr && header) {
      // Remove legacy/duplicate search forms not ours
      header.querySelectorAll('form[action*="?p=search"], form[role="search"]').forEach(f => {
        if (!f.closest('.tmx-slot')) f.remove();
      });

      if (!sr.querySelector('.tmx-slot')) buildSearchUI({ mountInto: sr, position: 'header' });

      // Auto-jump if we came from Gmail and a link appears
      autoOpenFromGmail();

      // Re-mount if header re-renders
      const mo = new MutationObserver(() => {
        const hdr = sr.querySelector(CFG.NAV_HEADER_SEL);
        if (hdr && !sr.querySelector('.tmx-slot')) buildSearchUI({ mountInto: sr, position: 'header' });
      });
      mo.observe(sr, { childList: true, subtree: true });
    } else {
      // Fallback overlay: ensures search always works even if ExtraNav is missing
      buildSearchUI({ mountInto: document.body, position: 'overlay' });
      autoOpenFromGmail();
    }
  })();
})();
