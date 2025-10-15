/* nav-ux.js — consolidates search UX, menus, settings, theme, hotbuttons, hover-intent, inbox badge
   Safe to include once; all features no-op if their elements are missing. */
 // =========               =========
 // ======== Search + Hover  ========
 // =========     Logic     =========
(() => {
  'use strict';

  // ========= Utilities =========
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  const now = () => Date.now();
  const safeJSON = {
    read(key, fallback = null) { try { const v = localStorage.getItem(key); return v == null ? fallback : JSON.parse(v); } catch { return fallback; } },
    write(key, val) { try { localStorage.setItem(key, JSON.stringify(val)); } catch { } },
    remove(key) { try { localStorage.removeItem(key); } catch { } },
  };

  // Generic “expandable” toggler with outside-click + Esc handling
  const Expandables = (() => {
    const active = new Set(); // elements (or controls) that own aria-expanded
    function setExpanded(ctrl, on) {
      if (!ctrl) return;
      ctrl.setAttribute('aria-expanded', String(!!on));
      if (on) active.add(ctrl); else active.delete(ctrl);
    }
    function isExpanded(ctrl) { return ctrl?.getAttribute('aria-expanded') === 'true'; }
    function closeAll(except) {
      active.forEach((ctrl) => { if (ctrl !== except) setExpanded(ctrl, false); });
    }
    // One global outside-click + Esc handler
    document.addEventListener('pointerdown', (e) => {
      if ([...active].some(ctrl => ctrl.contains(e.target) || (ctrl.id && document.getElementById(ctrl.getAttribute('aria-controls') || '')?.contains(e.target)))) return;
      closeAll();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        // Close most recently opened (order not tracked; close all)
        closeAll();
        // Return focus to a control if it exists
        const last = [...active][active.size - 1];
        last?.focus?.();
      }
    });
    return { setExpanded, isExpanded, closeAll };
  })();

  // Double-press detector
  function makeDoublePress(thresholdMs = 400) {
    let last = 0;
    return function isDouble() {
      const t = now();
      const hit = (t - last) <= thresholdMs;
      last = hit ? 0 : t;
      return hit;
    };
  }

  // Editable check excluding a specific input
  function isOtherEditable(target, except) {
    if (!target || target === except) return false;
    if (target.isContentEditable) return true;
    const t = target.tagName;
    return t === 'INPUT' || t === 'TEXTAREA' || t === 'SELECT';
  }

  // Robust form submit (works without form.requestSubmit)
  function submitInput(input) {
    if (!input) return;
    const form = input.closest('form');
    if (form) {
      if (typeof form.requestSubmit === 'function') form.requestSubmit();
      else {
        const ev = new Event('submit', { bubbles: true, cancelable: true });
        if (form.dispatchEvent(ev)) form.submit?.();
      }
    } else {
      input.dispatchEvent(new CustomEvent('search:submit', { bubbles: true, detail: { query: input.value } }));
    }
  }

  // ========= Search UX (placeholder + double Enter/Esc) =========
  (function initSearch() {
    const group = $('header.menu-top .group[role="search"]');
    if (!group) return;
    const searchInput = group.querySelector('input');
    if (!searchInput) return;

    // Responsive placeholder based on menubar width
    const bar = $('header.menu-top');
    const setPH = (w) => {
      const txt = (w <= 400) ? 'search...' :
        (w <= 550) ? 'Search...' :
          (w <= 1000) ? 'Feeling Lucky?' :
            'Looking for something...?';
      searchInput.placeholder = txt;
      searchInput.setAttribute('aria-label', txt);
    };
    if (bar) {
      const ro = new ResizeObserver(entries => setPH(entries[0].contentRect.width));
      ro.observe(bar);
      setPH(bar.clientWidth);
    }

    const isDoubleEnter = makeDoublePress(400);
    const isDoubleEsc = makeDoublePress(400);

    window.addEventListener('keydown', (e) => {
      if (e.ctrlKey || e.altKey || e.metaKey) return;

      // Double-Enter: focus (if not focused) or submit (if focused)
      if (e.key === 'Enter') {
        if (isOtherEditable(e.target, searchInput)) return;
        if (!isDoubleEnter()) return;
        e.preventDefault();
        if (document.activeElement !== searchInput) {
          searchInput.focus({ preventScroll: true });
          searchInput.select();
        } else {
          submitInput(searchInput);
        }
        return;
      }

      // Double-Escape: only when focus is inside the menubar search; blur to exit
      if (e.key === 'Escape') {
        const a = document.activeElement;
        const inSearch = a === searchInput || group.contains(a);
        if (!inSearch) return;
        if (!isDoubleEsc()) return;
        e.preventDefault();
        searchInput.blur();
      }
    });
  })();

  // ========= Search menu toggle (#searchTrigger / #searchMenu) =========
  (function initSearchMenu() {
    const btn = document.getElementById('searchTrigger');
    const menu = document.getElementById('searchMenu');
    if (!btn || !menu) return;

    btn.setAttribute('aria-controls', menu.id);
    btn.addEventListener('click', (e) => {
      const open = btn.getAttribute('aria-expanded') === 'true';
      Expandables.setExpanded(btn, !open);
      e.stopPropagation();
    });

    // Close when picking a radio
    $$('#searchMenu input[type="radio"]').forEach(r => r.addEventListener('change', () => Expandables.setExpanded(btn, false)));
  })();

  // ========= Settings menu (persisted) =========
  (function initSettingsMenu() {
    const STORAGE_KEY = 'settings:menu';
    const btn = document.getElementById('settings-toggle');
    const menu = document.getElementById('menu-settings');
    if (!btn || !menu) return;

    btn.setAttribute('aria-controls', menu.id);
    Expandables.setExpanded(btn, false);
    function setOpen(open) {
      // Do not persist the open state; it causes auto-open on next load
      Expandables.setExpanded(btn, open);
    }
    function isOpen() { return btn.getAttribute('aria-expanded') === 'true'; }

    btn.addEventListener('click', () => setOpen(!isOpen()));

    // Mirror to the “hotzone” if present
    const hit = document.getElementById('settingsHotzone');
    if (hit) {
      hit.addEventListener('click', (e) => { e.preventDefault(); btn.click(); });
      const sync = () => hit.setAttribute('aria-expanded', btn.getAttribute('aria-expanded') || 'false');
      new MutationObserver(sync).observe(btn, { attributes: true, attributeFilter: ['aria-expanded'] });
      sync();
    }

    // Persist form values if there is a form inside the menu
    const form = menu.querySelector('form');
    const read = () => safeJSON.read(STORAGE_KEY, {});
    const write = (obj) => safeJSON.write(STORAGE_KEY, obj);

    if (form) {
      // hydrate
      const s = read(); if (s.values) Object.entries(s.values).forEach(([k, v]) => { const el = form.elements[k]; if (el) el.value = v; });
      // save on change
      form.addEventListener('change', () => {
        const fd = new FormData(form);
        const s = read(); s.values = Object.fromEntries(fd.entries()); write(s);
      });
    }
  })();

  // ========= Theme toggle (persisted) =========
  (function initTheme() {
    const STORAGE_KEY = 'theme'; // 'light' | 'dark'
    const root = document.documentElement;
    const toggle = document.getElementById('theme-toggle');

    function applyTheme(theme) {
      const t = theme === 'dark' ? 'dark' : 'light';
      root.setAttribute('data-theme', t);
      root.style.colorScheme = (t === 'dark') ? 'dark' : 'light';
      localStorage.setItem(STORAGE_KEY, t);
      if (toggle) {
        const isDark = t === 'dark';
        toggle.checked = isDark;
        toggle.setAttribute('aria-checked', String(isDark));
      }
    }

    const saved = localStorage.getItem(STORAGE_KEY);
    applyTheme(saved === 'dark' ? 'dark' : 'light');

    toggle?.addEventListener('change', () =>
      applyTheme(toggle.checked ? 'dark' : 'light')
    );
  })();

  // ========= Inbox badge sync =========
  (function initInboxBadge() {
    const inboxBtn = document.querySelector('.iconDiv[data-key="inbox"]');
    const badgeEl = document.getElementById('inbox-badge');
    const srcLink = document.querySelector('a[href*="messagecenter"]');
    if (!inboxBtn || !badgeEl) return;

    function setInboxCount(n) {
      const count = Math.max(0, Number(n) || 0);
      if (count === 0) {
        badgeEl.hidden = true;
        inboxBtn.setAttribute('aria-label', 'Inbox');
      } else {
        badgeEl.hidden = false;
        badgeEl.textContent = count > 99 ? '99+' : String(count);
        inboxBtn.setAttribute('aria-label', `Inbox (${badgeEl.textContent})`);
      }
    }
    function readCountFromSource() {
      if (!srcLink) return 0;
      const spanWithNumber = Array.from(srcLink.querySelectorAll('span')).find(s => /\d/.test(s.textContent));
      const raw = spanWithNumber ? spanWithNumber.textContent : '0';
      const num = parseInt(String(raw).replace(/[^\d]/g, ''), 10);
      return isNaN(num) ? 0 : num;
    }
    const sync = () => setInboxCount(readCountFromSource());
    sync();
    if (srcLink) new MutationObserver(sync).observe(srcLink, { childList: true, characterData: true, subtree: true });

    // Optional public helpers
    window.setInboxCount = setInboxCount;
    window.clearInboxBadge = () => setInboxCount(0);
  })();

  // ========= Hotbuttons (tooltip + Alt+Click config) =========
  (function initHotButtons() {
    const STORAGE_PREFIX = 'hotbutton:';
    const DEFAULT_ICON_HTML = new WeakMap();
    const DEFAULT_LABEL = new WeakMap();
    const DEFAULT_ARIA = new WeakMap();

    const buttons = $$('.iconDiv.hotbutton[data-key]');
    if (!buttons.length) return;

    // Tooltip “Not set” when no config (or missing external hotkey config)
    buttons.forEach(el => {
      const key = el.dataset.key || '';
      const hasCfg = !!localStorage.getItem(`${STORAGE_PREFIX}${key}`);
      // Prefer your own external checker if you have it:
      const hasHotkey = (window.checkHotkeyConfig?.(key)) || hasCfg;
      if (!hasHotkey) el.setAttribute('data-tooltip', 'Not set'); else el.removeAttribute('data-tooltip');
    });

    // Remember originals
    buttons.forEach(btn => {
      const host = btn.querySelector('.iconSVG');
      const span = btn.querySelector('.text');
      if (host && !DEFAULT_ICON_HTML.has(btn)) DEFAULT_ICON_HTML.set(btn, host.innerHTML);
      if (span && !DEFAULT_LABEL.has(btn)) DEFAULT_LABEL.set(btn, span.textContent || '');
      if (!DEFAULT_ARIA.has(btn)) DEFAULT_ARIA.set(btn, btn.getAttribute('aria-label') || '');
    });

    function storageKey(key) { return `${STORAGE_PREFIX}${key}`; }
    function readConfig(key) { return safeJSON.read(storageKey(key), null); }
    function writeConfig(key, cfg) { safeJSON.write(storageKey(key), cfg); }

    function sanitizeAndFormatSVG(raw) {
      if (!raw || typeof raw !== 'string') return null;
      const parser = new DOMParser();
      const doc = parser.parseFromString(raw.trim(), 'image/svg+xml');
      const svg = doc.documentElement && doc.documentElement.tagName.toLowerCase() === 'svg' ? doc.documentElement : null;
      if (!svg || svg.querySelector('parsererror')) { alert('Invalid SVG. Paste a full <svg>…</svg>.'); return null; }

      ['script', 'iframe', 'embed', 'object', 'foreignObject', 'style'].forEach(tag =>
        doc.querySelectorAll(tag).forEach(n => n.remove())
      );

      svg.querySelectorAll('*').forEach(el => {
        for (const attr of el.getAttributeNames()) if (attr.startsWith('on')) el.removeAttribute(attr);
        el.removeAttribute('fill'); el.removeAttribute('stroke'); el.removeAttribute('color');
        const s = el.getAttribute('style');
        if (s) {
          const pruned = s.split(';').map(r => r.trim()).filter(Boolean).filter(r => !/^(fill|stroke|color)\s*:/.test(r)).join('; ');
          if (pruned) el.setAttribute('style', pruned); else el.removeAttribute('style');
        }
      });

      svg.removeAttribute('fill'); svg.removeAttribute('stroke');
      svg.setAttribute('fill', 'none');
      svg.setAttribute('stroke', 'currentColor');
      svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
      if (!svg.hasAttribute('viewBox')) {
        const w = parseFloat(svg.getAttribute('width')) || 24;
        const h = parseFloat(svg.getAttribute('height')) || 24;
        svg.setAttribute('viewBox', `0 0 ${w} ${h}`);
      }
      svg.setAttribute('width', '24');
      svg.setAttribute('height', '24');
      svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');

      return svg;
    }

    function setButtonSVG(btn, rawSvgString) {
      const host = btn.querySelector('.iconSVG'); if (!host) return;
      const svg = sanitizeAndFormatSVG(rawSvgString);
      if (!svg) return;
      host.innerHTML = '';
      host.appendChild(svg);
    }

    function applySavedConfig(btn) {
      const key = btn.dataset.key;
      const cfg = readConfig(key);
      const host = btn.querySelector('.iconSVG');
      const span = btn.querySelector('.text');
      if (!host) return;

      const nothing = !cfg || (!cfg.svg && !cfg.href && !cfg.label);
      if (nothing) {
        host.innerHTML = DEFAULT_ICON_HTML.get(btn) || '';
        if (span) span.textContent = DEFAULT_LABEL.get(btn) || '';
        const ariaDefault = DEFAULT_ARIA.get(btn);
        if (ariaDefault) btn.setAttribute('aria-label', ariaDefault); else btn.removeAttribute('aria-label');
        btn.removeAttribute('data-href'); btn.removeAttribute('title');
        return;
      }
      if (cfg.svg) setButtonSVG(btn, cfg.svg);

      if (cfg.href) { btn.dataset.href = cfg.href; if (!btn.getAttribute('title')) btn.setAttribute('title', cfg.href); }
      else { btn.removeAttribute('data-href'); btn.removeAttribute('title'); }

      if (cfg.label) { span && (span.textContent = cfg.label); btn.setAttribute('aria-label', cfg.label); }
      else {
        span && (span.textContent = DEFAULT_LABEL.get(btn) || '');
        const ariaDefault = DEFAULT_ARIA.get(btn);
        if (ariaDefault) btn.setAttribute('aria-label', ariaDefault); else btn.removeAttribute('aria-label');
      }
    }

    // Editor modal (shadow)
    function ensureConfigModal() {
      let host = document.getElementById('hb-config-host');
      if (host) return host;
      host = document.createElement('div');
      host.id = 'hb-config-host';
      host.style.position = 'fixed'; host.style.inset = '0'; host.style.zIndex = '2147483647'; host.style.display = 'none';
      document.body.appendChild(host);
      const shadow = host.attachShadow({ mode: 'open' });
      shadow.innerHTML = `<style>
    /* ========= Hot-Button Editor (innerHTML) ========= */
    /* ---- Tokens ---- */
    :root {
        --panel-w: 720px;
        --panel-h: 400px;
        --field-h: 36px;
        --gap: 10px;
        --radius: 12px;
        --ink: #111;
        --bg: #fff;
        --muted: #666;
        --border: #c9c9c9;
        --accent: #5353ff;
        --accent-border: #3b3be0;
        --shadow: 0 10px 40px rgba(0, 0, 0, .25);
        --font-ui: inherit;
        --preview-size: 112px;
        /* bigger preview */
    }

    /* ---- Host + backdrop ---- */
    :host {
        display: block;
        color-scheme: light;
        /* force light UI inside editor */
        border-radius: 17px;
    }

    /* Overlay mode (centered modal with backdrop) */
    :host([overlay]),
    :host([overlay]) .backdrop {
        position: fixed;
        inset: 0;
    }

    :host([overlay]) .backdrop {
        background: rgba(0, 0, 0, .35);
    }

    /* Contained mode (default): no overlay/backdrop */
    :host(:not([overlay])) .backdrop {
        display: none;
    }

    /* ---- Shell frame (used only when contained) ---- */
    .hb-shell {
        width: max-content;
        margin: 16px auto;
        padding: 12px;
        border-radius: 16px;
        background: transparent;
        --bg: #fff;
        --ink: #111;
        color-scheme: light;
        box-shadow: 0 12px 30px rgba(0, 0, 0, .35);
        position: relative;
    }

    /* ---- Panel (single source of truth) ---- */
    .panel {
        width: var(--panel-w);
        height: var(--panel-h);
        background: var(--bg);
        color: var(--ink);
        border-radius: var(--radius);
        box-shadow: var(--shadow);
        font-family: var(--font-ui);
        padding: 16px;
        display: grid;
        grid-template-rows: auto auto 1fr;
        /* title, preview, fields (actions float) */
        gap: 12px;
        overflow: hidden;
        border-radius: 17px;
    }

    /* Positioning differences by mode */
    :host([overlay]) .panel {
        position: absolute;
        inset: 0;
        margin: auto;
        /* true modal center */
    }

    :host(:not([overlay])) .panel {
        position: relative;
        margin: 0;
        /* in-flow card inside hb-shell */
    }

    /* ---- Headings ---- */
    h2 {
        margin: 0;
        font-size: 18px;
    }

    /* ---- Preview ---- */
    .preview {
        display: flex;
        align-items: center;
        gap: 12px;
        padding: 10px;
        border: 1px dashed #ddd;
        border-radius: 8px;
    }

    .preview .box {
        width: var(--preview-size);
        height: var(--preview-size);
        aspect-ratio: 1 / 1;
        display: grid;
        place-items: center;
        color: #222;
        background: #f3f6ff;
        border: 1px solid #e0e6ff;
        border-radius: 8px;
    }

    #hb-icon svg {
        width: 100%;
        height: 100%;
        display: block;
    }

    .hint {
        color: var(--muted);
        font-size: 12px;
    }

    /* ---- Fields (scrolls within fixed panel) ---- */
    .fields {
        min-height: 0;
        display: grid;
        gap: 8px;
        overflow: auto;
        padding-right: 2px;
        /* avoid overlaying scrollbar on text */
    }

    label {
        display: block;
        margin: 0 0 4px;
        font-weight: 600;
        font-size: 12px;
    }

    /* Single-line text boxes (also used for the SVG input) */
    .boxline {
        width: 100%;
        height: var(--field-h);
        min-height: var(--field-h);
        max-height: var(--field-h);
        box-sizing: border-box;

        padding: 8px 10px;
        border: 1px solid var(--border);
        border-radius: 8px;

        font: 13px/1.2 monospace;
        background: #fff;
        color: #111;

        resize: none;
        /* never grow */
        overflow-y: hidden;
        /* single-line */
        white-space: nowrap;
        /* keep 1 line */
        text-overflow: ellipsis;
        /* visual truncate */
    }

    /* UI font for URL/text types */
    input[type="url"].boxline,
    input[type="text"].boxline {
        font-family: var(--font-ui);
    }

    /* SVG field: one line, no visible scrollbar, keep horizontal caret scroll */
    #hb-svg.boxline {
        overflow-x: auto;
        overflow-y: hidden;
        white-space: pre;
        /* never soft-wrap */
        overflow-wrap: normal;
        word-break: normal;
        -ms-overflow-style: none;
        /* IE/old Edge */
        scrollbar-width: none;
        /* Firefox */
    }

    #hb-svg.boxline::-webkit-scrollbar {
        display: none;
    }
    .boxline{ line-height: 100; } 

    .hb-shell button {
        background: #f5f5f5;
        border: 1px solid #ccc;
        cursor: pointer;
    }

    .hb-shell button.primary {
      background: var(--accent, #5353ff);        /* fallback */
      color: #fff;
      border-color: var(--accent-border, #3b3be0);
    }

    /* Focus */
    .hb-shell .boxline:focus, .hb-shell button:focus {
        outline: 2px solid #aab4ff;
        outline-offset: 1px;
    }

    /* ========= Sample cards (scoped to .panel) ========= */
    .panel .login {
        box-sizing: border-box;
        width: 100%;
        max-width: 340px;
        min-height: 320px;
        margin: 0 auto;
        padding: 32px 24px 40px;
        background: #2c2c2c;
        color: #fff;
        border-radius: 17px;
        font-size: 1.3em;
        font-family: var(--font-ui);
    }

    .panel .login input[type="text"],
    .panel .login input[type="password"] {
        width: 100%;
        margin-top: 20px;
        padding: 13px 18px;
        border: none;
        outline: none;
        border-radius: 100px;
        background: #3c3c3c;
        color: #fff;
        font-size: .8em;
    }

    .panel .login input:focus {
        animation: bounce 1s;
    }

    .panel .login .h1 {
        display: block;
        margin: 0;
        padding: 0;
        position: relative;
        top: -35px;
        font-size: 1.3em;
        font-weight: 600;
    }

    .panel .login .btn {
        padding: 16px !important;
        border: 0;
        outline: 0;
        width: 100%;
        margin-top: 40px;
        border-radius: 500px;
        background: linear-gradient(144deg, #af40ff, #5b42f3 50%, #00ddeb);
        color: #fff;
        animation: bounce2 1.6s;
    }

    .panel .login .btn:hover {
        background: linear-gradient(144deg, #1e1e1e 20%, #1e1e1e 50%, #1e1e1e);
        transition: all .4s;
        cursor: pointer;
    }

    .panel .login .ui {
        font-weight: 800;
        background: -webkit-linear-gradient(#B563FF, #535EFC, #0EC8EE);
        -webkit-text-fill-color: transparent;
        border-bottom: 4px solid transparent;
        border-image: linear-gradient(0.25turn, #535EFC, #0EC8EE, #0EC8EE) 1;
    }

    @media (max-width: 600px) {
        .panel .login {
            width: 100%;
            padding: 2em;
        }
    }

    /* Glitch form (scoped) */
    .panel .glitch-form-wrapper {
        --bg-color: #0d0d0d;
        --primary-color: #00f2ea;
        --secondary-color: #a855f7;
        --text-color: #e5e5e5;
        --font-family: "Fira Code", Consolas, "Courier New", Courier, monospace;
        --glitch-anim-duration: .5s;
        display: flex;
        justify-content: center;
        align-items: center;
        background: transparent;
        font-family: var(--font-family);
    }

    .panel .glitch-card {
        width: 100%;
        max-width: 380px;
        margin: 0 auto;
        overflow: hidden;
        background-color: var(--bg-color);
        border: 1px solid rgba(0, 242, 234, .2);
        box-shadow: 0 0 20px rgba(0, 242, 234, .1), inset 0 0 10px rgba(0, 0, 0, .5);
    }

    .panel .card-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: .5em 1em;
        background: rgba(0, 0, 0, .3);
        border-bottom: 1px solid rgba(0, 242, 234, .2);
    }

    .panel .card-title {
        color: var(--primary-color);
        font-size: .8rem;
        font-weight: 700;
        letter-spacing: .1em;
        text-transform: uppercase;
        display: flex;
        gap: .5em;
    }

    .panel .card-title svg {
        width: 1.2em;
        height: 1.2em;
        stroke: var(--primary-color);
    }

    .panel .card-dots span {
        display: inline-block;
        width: 8px;
        height: 8px;
        margin-left: 5px;
        border-radius: 50%;
        background: #333;
    }

    .panel .card-body {
        padding: 1.5rem;
    }

    .panel .form-group {
        position: relative;
        margin-bottom: 1.5rem;
    }

    .panel .form-group input {
        width: 100%;
        padding: .75em 0;
        background: transparent;
        color: var(--text-color);
        border: none;
        outline: none;
        border-bottom: 2px solid rgba(0, 242, 234, .3);
        transition: border-color .3s ease;
    }

    .panel .form-label {
        position: absolute;
        top: .75em;
        left: 0;
        pointer-events: none;
        color: var(--primary-color);
        opacity: .6;
        font-size: 1rem;
        letter-spacing: .1em;
        text-transform: uppercase;
        transition: all .3s ease;
    }

    .panel .form-group input:focus {
        border-color: var(--primary-color);
    }

    .panel .form-group input:focus+.form-label,
    .panel .form-group input:not(:placeholder-shown)+.form-label {
        top: -1.2em;
        font-size: .8rem;
        opacity: 1;
    }

    .panel .submit-btn {
        width: 100%;
        margin-top: 1rem;
        padding: .8em;
        position: relative;
        overflow: hidden;
        cursor: pointer;
        background: transparent;
        color: var(--primary-color);
        border: 2px solid var(--primary-color);
        font-size: 1rem;
        font-weight: 700;
        letter-spacing: .2em;
        text-transform: uppercase;
        transition: all .3s;
    }

    .panel .submit-btn:hover,
    .panel .submit-btn:focus {
        background: var(--primary-color);
        color: var(--bg-color);
        box-shadow: 0 0 25px var(--primary-color);
        outline: none;
    }

    .panel .submit-btn:active {
        transform: scale(.97);
    }

    .panel .submit-btn .btn-text {
        position: relative;
        z-index: 1;
        transition: opacity .2s ease;
    }

    .panel .submit-btn:hover .btn-text {
        opacity: 0;
    }

    .panel .submit-btn::before,
    .panel .submit-btn::after {
        content: attr(data-text);
        position: absolute;
        inset: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        opacity: 0;
        background: var(--primary-color);
        transition: opacity .2s ease;
    }

    .panel .submit-btn:hover::before,
    .panel .submit-btn:focus::before {
        opacity: 1;
        color: var(--secondary-color);
        animation: glitch-anim var(--glitch-anim-duration) cubic-bezier(.25, .46, .45, .94) both;
    }

    .panel .submit-btn:hover::after,
    .panel .submit-btn:focus::after {
        opacity: 1;
        color: var(--bg-color);
        animation: glitch-anim var(--glitch-anim-duration) cubic-bezier(.25, .46, .45, .94) reverse both;
    }

    @media (prefers-reduced-motion: reduce) {

        .panel .form-group input:focus+.form-label::before,
        .panel .form-group input:focus+.form-label::after,
        .panel .submit-btn:hover::before,
        .panel .submit-btn:focus::before,
        .panel .submit-btn:hover::after,
        .panel .submit-btn:focus::after {
            animation: none;
            opacity: 0;
        }

        .panel .submit-btn:hover .btn-text {
            opacity: 1;
        }
    }

    /* ---- Shared keyframes ---- */
    @keyframes bounce {
        0% {
            transform: translateY(-250px);
            opacity: 0;
        }
    }

    @keyframes bounce1 {
        0% {
            opacity: 0;
        }

        40% {
            transform: translateY(-100px);
            opacity: 0;
        }
    }

    @keyframes bounce2 {
        0% {
            opacity: 0;
        }

        70% {
            transform: translateY(-20px);
            opacity: 0;
        }
    }

    @keyframes glitch-anim {
        0% {
            transform: translate(0);
            clip-path: inset(0 0 0 0);
        }

        20% {
            transform: translate(-5px, 3px);
            clip-path: inset(50% 0 20% 0);
        }

        40% {
            transform: translate(3px, -2px);
            clip-path: inset(20% 0 60% 0);
        }

        60% {
            transform: translate(-4px, 2px);
            clip-path: inset(80% 0 5% 0);
        }

        80% {
            transform: translate(4px, -3px);
            clip-path: inset(30% 0 45% 0);
        }

        100% {
            transform: translate(0);
            clip-path: inset(0 0 0 0);
        }
    }

    /* Anchor actions inside the panel (overlay) and inside hb-shell (contained) */
    .panel>.hb-actions,
    .hb-shell>.hb-actions {
        position: absolute;
        top: 12px;
        right: 12px;
        margin: 0;
        display: flex;
        gap: 8px;
        z-index: 5;
        background: transparent;
    }

    /* Chrome/Safari */

    /* --- 2) Make top-right action buttons smaller --- */
    .hb-actions button {
        padding: 6px 10px;
        /* was 10px 14px */
        font-size: 12px;
        /* slightly smaller label */
        border-radius: 6px;
        /* a bit tighter */
    }

    /* closer spacing */

    /* If the buttons ever crowd the title, give the panel a hair more space */
    .panel {
        padding-top: 20px;
    }



    /* Chrome/Safari */

    /* (optional) if you still see a sliver of a 2nd row due to metrics, clamp line-height */
    .boxline {
        line-height: 1;
    }

    .hb-actions button.primary {
        background: var(--accent) !important;
        color: #fff !important;
        border-color: var(--accent-border) !important;
    }

    /* Ensure the Save button is visibly “primary” inside the editor */
    /* Make Save match Cancel/Clear */
    .hb-panel .hb-actions #hb-save {
      background-color: #f5f5f5;      /* same as .hb-shell button */
      color: var(--ink, #111);
      border: 1px solid #ccc;
    }
</style>

<div class="hb-shell">
    <div class="backdrop" part="backdrop"></div>

    <section class="panel hb-panel" role="dialog" aria-modal="false" aria-labelledby="hb-title">
        <h2 id="hb-title">Hot Button</h2>

        <div class="preview hb-preview" aria-describedby="hb-hints">
            <div class="box" id="hb-icon"></div>
            <div id="hb-hints">

                <div class="hint hb-hint">Paste a full &lt;svg&gt;…&lt;/svg&gt;</div>
                <div class="hint hb-hint">You can get icons <a href="https://iconstack.io/" target="_blank"
                        rel="noopener noreferrer">here</a></div>
                <div class="hint hb-hint">Double-click an icon to copy, paste below, then set link + label.</div>
            </div>
        </div>

        <div class="fields hb-fields">
            <div class="row hb-row">
                <textarea id="hb-svg" class="boxline hb-line" rows="1" wrap="off" spellcheck="false"
                    placeholder="SVG: &lt;svg&gt;…&lt;/svg&gt;"></textarea>
            </div>

            <div class="row hb-row">
                <input id="hb-link" class="boxline hb-line" type="url" placeholder="Link: https://example.com/page" />
            </div>

            <div class="row hb-row">
                <input id="hb-label" class="boxline hb-line" type="text" placeholder="LABEL: Icons" />
            </div>
        </div>
        <div class="actions hb-actions">
            <button id="hb-cancel" type="button">Cancel (Esc)</button>
            <button id="hb-clear" type="button">Clear</button>
            <button id="hb-save"  type="button">Save</button>
        </div>

    </section>
</div>`;
      const ui = {
        host, shadow,
        backdrop: shadow.querySelector('.backdrop'),
        panel: shadow.querySelector('.panel'),
        svgInput: shadow.getElementById('hb-svg'),
        linkInput: shadow.getElementById('hb-link'),
        labelInput: shadow.getElementById('hb-label'),
        iconPreview: shadow.getElementById('hb-icon'),
        btnSave: shadow.getElementById('hb-save'),
        btnCancel: shadow.getElementById('hb-cancel'),
        btnClear: shadow.getElementById('hb-clear'),
        targetBtn: null,
      };
      const close = () => {
        host.style.display = 'none';
        ui.targetBtn = null; ui.iconPreview.innerHTML = '';
        ui.svgInput.value = ''; ui.linkInput.value = ''; ui.labelInput.value = '';
        document.removeEventListener('keydown', onEsc);
      };
      const onEsc = (e) => { if (e.key === 'Escape') close(); };
      ui.backdrop.addEventListener('click', close);
      ui.btnCancel.addEventListener('click', close);
      ui.btnClear.addEventListener('click', () => {
        if (!ui.targetBtn) return;
        const key = ui.targetBtn.dataset.key;
        safeJSON.remove(storageKey(key));
        applySavedConfig(ui.targetBtn);
        ui.iconPreview.innerHTML = '';
        ui.svgInput.value = ''; ui.linkInput.value = ''; ui.labelInput.value = '';
      });
      ui.btnSave.addEventListener('click', () => {
        if (!ui.targetBtn) return;
        const key = ui.targetBtn.dataset.key;
        const raw = ui.svgInput.value.trim();
        const href = ui.linkInput.value.trim();
        const label = ui.labelInput.value.trim();
        if (!raw && !href && !label) { safeJSON.remove(storageKey(key)); applySavedConfig(ui.targetBtn); return close(); }
        let svgOut = null;
        if (raw) {
          const node = sanitizeAndFormatSVG(raw);
          if (!node) return;
          svgOut = node.outerHTML;
        }
        writeConfig(key, { svg: svgOut, href: href || '', label: label || '' });
        applySavedConfig(ui.targetBtn);
        close();
      });
      const normalizeSvgInput = () => {
        const v = ui.svgInput.value.replace(/[\r\n\t]+/g, ' ');
        if (v !== ui.svgInput.value) ui.svgInput.value = v;
      };

      ui.svgInput.addEventListener('input', () => {
        normalizeSvgInput();
        ui.iconPreview.innerHTML = '';
        const raw = ui.svgInput.value.trim();
        if (!raw) return;
        const node = sanitizeAndFormatSVG(raw);
        if (node) ui.iconPreview.appendChild(node);
      });

      // also normalize right after paste (value updates on next frame)
      ui.svgInput.addEventListener('paste', () => {
        requestAnimationFrame(() => {
          normalizeSvgInput();
          ui.svgInput.dispatchEvent(new Event('input')); // refresh preview if changed
        });
      });



      host._open = (btn, current) => {
        ui.targetBtn = btn;
        shadow.getElementById('hb-title').textContent = `Hot Key: ${btn.dataset.key}`;
        ui.svgInput.value = current?.svg || '';
        ui.linkInput.value = current?.href || '';
        ui.iconPreview.innerHTML = '';
        if (current?.svg) {
          const node = sanitizeAndFormatSVG(current.svg);
          if (node) ui.iconPreview.appendChild(node);
        }
        ui.labelInput.value = current?.label || btn.getAttribute('aria-label') || (btn.querySelector('.text')?.textContent || '');
        host.style.display = 'block';
        document.addEventListener('keydown', onEsc);
        setTimeout(() => ui.svgInput.focus(), 0);
      };
      return host;
    }

    const modalHost = ensureConfigModal();

    // Apply saved to all, wire clicks
    buttons.forEach(applySavedConfig);
    buttons.forEach(btn => {
      btn.addEventListener('click', (ev) => {
        const key = btn.dataset.key; if (!key) return;
        if (ev.altKey) { ev.preventDefault(); modalHost._open(btn, readConfig(key) || { svg: '', href: '', label: '' }); return; }
        const cfg = readConfig(key);
        if (cfg?.href) {
          const newTab = ev.ctrlKey || ev.metaKey;
          newTab ? window.open(cfg.href, '_blank', 'noopener') : (window.location.href = cfg.href);
        }
      });
    });
  })();

  // ========= Hover intent menus for .iconDiv[data-hasmenu] + nested .has-submenu =========
  (function initHoverIntent() {
    const triggers = $$('.iconDiv[data-hasmenu]');
    if (!triggers.length) return;

    const OPEN_DELAY = 140;
    const CLOSE_DELAY = 270;
    const state = new Map(); // trigger -> {openT, closeT}

    const getMenu = (t) => t.querySelector('[data-submenu]');
    const getItems = (menu) => Array.from(menu.querySelectorAll('[role="menuitem"], .menu-item, a.item'));

    const clearTimers = (t) => {
      const s = state.get(t);
      if (!s) return;
      clearTimeout(s.openT);
      clearTimeout(s.closeT);
      s.openT = s.closeT = null;
    };

    // Hard close + kill timers (prevents "re-open" after switching)
    const forceCloseTrigger = (t) => {
      clearTimers(t);
      t.setAttribute('aria-expanded', 'false');
    };

    // NOTE: when opening one trigger, close others and kill their timers
    const setExpanded = (t, on) => {
      if (!t) return;
      if (on) {
        triggers.forEach((x) => { if (x !== t) forceCloseTrigger(x); });
      } else {
        clearTimers(t);
      }
      t.setAttribute('aria-expanded', on ? 'true' : 'false');
    };

    const scheduleOpen = (t, delay) => {
      clearTimers(t);
      const d = Number(t.dataset.openDelay) || delay || OPEN_DELAY;
      const s = state.get(t) || {};
      s.openT = setTimeout(() => setExpanded(t, true), d);
      state.set(t, s);
    };

    const scheduleClose = (t, delay) => {
      clearTimers(t);
      const d = Number(t.dataset.closeDelay) || delay || CLOSE_DELAY;
      const s = state.get(t) || {};
      s.closeT = setTimeout(() => setExpanded(t, false), d);
      state.set(t, s);
    };

    // Initialize each trigger
    triggers.forEach((trigger) => {
      const menu = getMenu(trigger);
      if (!menu) {
        trigger.removeAttribute('data-hasmenu');
        trigger.removeAttribute('aria-haspopup');
        trigger.removeAttribute('aria-expanded');
        return;
      }

      if (!menu.id) {
        const base = (trigger.getAttribute('aria-label') || 'menu').toLowerCase().replace(/\s+/g, '-');
        menu.id = `menu-${base}`;
      }
      trigger.setAttribute('aria-controls', menu.id);

      // Roving tabindex for menu items
      getItems(menu).forEach((el) => el.tabIndex = -1);

      // HOVER: when entering a new trigger, close others immediately, then open this
      trigger.addEventListener('pointerenter', () => {
        triggers.forEach((x) => { if (x !== trigger) forceCloseTrigger(x); });
        scheduleOpen(trigger);
      });

      trigger.addEventListener('pointerleave', (e) => {
        if (trigger.contains(e.relatedTarget)) return;
        scheduleClose(trigger);
      });

      // Keep open while pointer in submenu
      menu.addEventListener('pointerenter', () => {
        // If the pointer enters the PANEL of another trigger (overlapping menus),
        // close all others immediately and open THIS one immediately.
        triggers.forEach((x) => { if (x !== trigger) forceCloseTrigger(x); });
        clearTimers(trigger);          // cancel any pending close
        setExpanded(trigger, true);    // open now (no delay)
      });
      menu.addEventListener('pointerleave', (e) => {
        if (trigger.contains(e.relatedTarget)) return;
        scheduleClose(trigger);
      });

      // Focus-driven behavior (no delay) – still exclusive
      trigger.addEventListener('focusin', () => {
        triggers.forEach((x) => { if (x !== trigger) forceCloseTrigger(x); });
        setExpanded(trigger, true);
      });
      trigger.addEventListener('focusout', (e) => {
        if (!trigger.contains(e.relatedTarget)) scheduleClose(trigger);
      });

      // Keyboard (unchanged)
      trigger.addEventListener('keydown', (e) => {
        const idx = triggers.indexOf(trigger);
        const openAndFocusFirst = () => { setExpanded(trigger, true); (getItems(menu)[0] || menu).focus(); };
        const focusPrev = () => triggers[(idx - 1 + triggers.length) % triggers.length]?.focus();
        const focusNext = () => triggers[(idx + 1) % triggers.length]?.focus();

        if ((e.key === 'Enter' || e.key === ' ') && document.activeElement === trigger) { e.preventDefault(); openAndFocusFirst(); }
        if (e.key === 'ArrowDown' && document.activeElement === trigger) { e.preventDefault(); openAndFocusFirst(); }
        if (e.key === 'ArrowUp' && document.activeElement === trigger) { e.preventDefault(); setExpanded(trigger, true); const its = getItems(menu); (its[its.length - 1] || menu).focus(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); focusNext(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); focusPrev(); }
        if (e.key === 'Home') { e.preventDefault(); triggers[0]?.focus(); }
        if (e.key === 'End') { e.preventDefault(); triggers[triggers.length - 1]?.focus(); }
        if (e.key === 'Escape') { setExpanded(trigger, false); trigger.focus(); }
      });

      // Keyboard inside menu
      menu.addEventListener('keydown', (e) => {
        const its = getItems(menu);
        const i = its.indexOf(document.activeElement);
        const idx = triggers.indexOf(trigger);

        if (e.key === 'ArrowDown') { e.preventDefault(); (its[(i + 1) % its.length] || its[0])?.focus(); }
        if (e.key === 'ArrowUp') { e.preventDefault(); (its[(i - 1 + its.length) % its.length] || its[0])?.focus(); }
        if (e.key === 'Home') { e.preventDefault(); its[0]?.focus(); }
        if (e.key === 'End') { e.preventDefault(); its[its.length - 1]?.focus(); }
        if (e.key === 'Escape') { e.preventDefault(); setExpanded(trigger, false); trigger.focus(); }
        if (e.key === 'ArrowRight') { e.preventDefault(); triggers[(idx + 1) % triggers.length]?.focus(); }
        if (e.key === 'ArrowLeft') { e.preventDefault(); triggers[(idx - 1 + triggers.length) % triggers.length]?.focus(); }
      });

      // Click a menu item -> close the menu
      menu.addEventListener('click', (e) => {
        const target = e.target.closest('[role="menuitem"], .menu-item, a[href]');
        if (target) setExpanded(trigger, false);
      });
    });

    // Nested flyouts (.has-submenu) with open/close and keyboard support
    (function initNested() {
      const items = $$('.has-submenu');
      if (!items.length) return;

      const timers = new WeakMap();
      const ensureTimers = (item) => { if (!timers.has(item)) timers.set(item, { open: null, close: null }); return timers.get(item); };
      const parseDelay = (v, fb) => { const n = Number(v); return Number.isFinite(n) && n >= 0 ? n : fb; };
      const delays = (item) => ({ open: parseDelay(item.dataset.openDelay, 140), close: parseDelay(item.dataset.closeDelay, 270) });
      const focusablesSel = 'a[href],button:not([disabled]),[role="menuitem"],[tabindex]:not([tabindex="-1"])';
      const getFocusables = (c) => c ? Array.from(c.querySelectorAll(focusablesSel)) : [];
      const first = (c) => getFocusables(c)[0] || null;
      const last = (c) => { const els = getFocusables(c); return els[els.length - 1] || null; };
      const getTrigger = (item) => item.querySelector('[aria-haspopup="true"]') || first(item) || item;

      function closeAllExceptFamily(items, except, closeFn) {
        items.forEach((it) => {
          if (!except) return closeFn(it, true);
          if (it === except) return;
          if (it.contains(except)) return;
          if (except.contains(it)) return;
          closeFn(it, true);
        });
      }
      function open(item, immediate = false) {
        const t = ensureTimers(item); const { open: d } = delays(item);
        clearTimeout(t.close);
        if (item.classList.contains('open')) return;
        t.open = setTimeout(() => {
          item.classList.add('open'); item.setAttribute('aria-expanded', 'true');
          const trig = getTrigger(item);
          if (trig && trig !== item) { trig.setAttribute('aria-expanded', 'true'); trig.setAttribute('aria-haspopup', 'true'); }
        }, immediate ? 0 : d);
      }
      function close(item, immediate = false) {
        const t = ensureTimers(item); const { close: d } = delays(item);
        clearTimeout(t.open);
        t.close = setTimeout(() => {
          item.classList.remove('open'); item.setAttribute('aria-expanded', 'false');
          const trig = getTrigger(item);
          if (trig && trig !== item) trig.setAttribute('aria-expanded', 'false');
        }, immediate ? 0 : d);
      }
      function moveHorizontal(currentItem, dir) {
        const parent = currentItem.parentElement; if (!parent) return;
        const siblings = Array.from(parent.children).filter((el) => el.matches('.has-submenu'));
        const i = siblings.indexOf(currentItem); if (i === -1 || siblings.length < 2) return;
        const target = siblings[(i + (dir > 0 ? 1 : -1) + siblings.length) % siblings.length];
        closeAllExceptFamily(items, target, close); open(target, true); (getTrigger(target).focus || target.focus)?.call(getTrigger(target));
      }
      items.forEach((item) => {
        item.addEventListener('pointerenter', () => { closeAllExceptFamily(items, item, close); open(item); });
        item.addEventListener('pointerleave', () => { close(item); });
        item.addEventListener('focusin', () => { closeAllExceptFamily(items, item, close); open(item); });
        item.addEventListener('focusout', (e) => { if (!item.contains(e.relatedTarget)) close(item); });
        item.addEventListener('click', (e) => {
          if (!item.classList.contains('open')) { closeAllExceptFamily(items, item, close); open(item, true); e.preventDefault(); }
        });
        item.addEventListener('keydown', (e) => {
          const submenu = item.querySelector('.submenu, [role="menu"], .sublist');
          switch (e.key) {
            case 'Escape': close(item, true); (getTrigger(item).focus || item.focus)?.call(getTrigger(item)); e.stopPropagation(); e.preventDefault(); break;
            case 'ArrowDown': open(item, true); (first(submenu) || getTrigger(item))?.focus?.(); e.preventDefault(); break;
            case 'ArrowUp': open(item, true); (last(submenu) || getTrigger(item))?.focus?.(); e.preventDefault(); break;
            case 'ArrowLeft': moveHorizontal(item, -1); e.preventDefault(); break;
            case 'ArrowRight': moveHorizontal(item, 1); e.preventDefault(); break;
          }
        });
      });

      document.addEventListener('pointerdown', (e) => { if (!e.target.closest('.has-submenu')) items.forEach((it) => close(it, true)); });
      window.addEventListener('blur', () => { items.forEach((it) => close(it, true)); });
    })();
    // Outside click: close all immediately (kill timers)
    document.addEventListener('pointerdown', (e) => {
      if (e.target.closest('.iconDiv[data-hasmenu]')) return;
      triggers.forEach((t) => forceCloseTrigger(t));
    });
  })();
})();

 // =========               =========
 // ========= Settings Menu =========
 // =========               =========
(() => {
  'use strict';

  /** =================== Minimal Nav API (kept) =================== */
  window.NavUX = Object.assign(window.NavUX || {}, {
    closeAllMenus: () =>
      document
        .querySelectorAll('.iconDiv[data-hasmenu][aria-expanded="true"]')
        .forEach(el => el.setAttribute('aria-expanded', 'false')),
  });

  /** =================== Small helpers =================== */
  const $ = sel => document.querySelector(sel);
  const px = v => parseFloat(v) || 0;
  const svg = (strings, ...vals) => String.raw({ raw: strings }, ...vals);

  /** =================== DOM refs =================== */
  const PANEL_ID = 'menu-settings';
  const GRID_ID  = 'st_group';
  const groupEl  = document.getElementById(GRID_ID);
  const tbodyEl  = document.getElementById('st_tbody'); // optional table

  if (!groupEl) return; // settings grid is required

  /** =================== Storage Keys =================== */
  const ST_STORAGE_KEY   = 'st:switches:v1';
  const EX_STORAGE_KEY   = 'settings:extra:v1';

  /** =================== Switch Items (PASTE HERE) =================== */
  // Paste your current items here (same structure you showed).
  // Example provided only to keep the module no-op-safe if you run it before pasting.
  /** ---------------- Switches: config ---------------- */
  const stItems = [
    { key: 's1', name: 'claim', label: 'Claim Buttons', value: false, tooltip: 'Claim Mode' },
    { key: 's2', name: 'copy', label: 'Copy Buttons', value: false, tooltip: 'Copy Buttons' },
    { key: 's3', name: 'sexy', label: 'Sexy Mode', value: false, tooltip: 'Sexy Time' },
    { key: 's4', name: 'acct', label: 'Customer Account', value: true, tooltip: 'Customer Account Tab' },
    { key: 's5', name: 'ship', label: 'Shipping', value: true, tooltip: 'Shipping Tab' },
    { key: 's6', name: 'product', label: 'Production', value: true, tooltip: 'Production Tab' },
    { key: 's7', name: 'process', label: 'Processing', value: true, tooltip: 'Processing Tab' },
  ];

  /** =================== Theme toggle: ensure cell exists =================== */
  function ensureThemeToggleCell() {
    const existing = document.getElementById('theme-toggle');
    if (existing) {
      const label = existing.closest('.tt_switch');
      if (label && !groupEl.contains(label)) {
        const cell = document.createElement('div');
        cell.className = 'st_item';
        cell.appendChild(label); // move node to grid
        groupEl.prepend(cell);
      }
      return;
    }
    const cell = document.createElement('div');
    cell.className = 'st_item';

    // ====== PASTE YOUR THEME TOGGLE MARKUP (cell.innerHTML) HERE ======
    // Keep the same ids/classes (tt_switch, tt_track, tt_knob, stars, etc.)
    cell.innerHTML = `
    <label class="switch tt_switch">
        <input id="theme-toggle" type="checkbox" role="switch" aria-label="Toggle dark mode" />
        <div class="slider round tt_track">
        <div class="sun-moon tt_knob">
            <svg id="moon-dot-1" class="moon-dot tt_moon-dot" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="moon-dot-2" class="moon-dot tt_moon-dot" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="moon-dot-3" class="moon-dot tt_moon-dot" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="light-ray-1" class="light-ray tt_ray" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="light-ray-2" class="light-ray tt_ray" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="light-ray-3" class="light-ray tt_ray" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="cloud-1" class="cloud-dark tt_cloud--dark" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="cloud-2" class="cloud-dark tt_cloud--dark" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="cloud-3" class="cloud-dark tt_cloud--dark" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="cloud-4" class="cloud-light tt_cloud--light" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="cloud-5" class="cloud-light tt_cloud--light" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
            <svg id="cloud-6" class="cloud-light tt_cloud--light" viewBox="0 0 100 100" aria-hidden="true"><circle cx="50" cy="50" r="50"/></svg>
        </div>
        <div class="stars tt_stars" aria-hidden="true">
            <svg id="star-1" class="star tt_star" viewBox="0 0 20 20"><path d="M0 10C10 10 10 10 0 10C10 10 10 10 10 20C10 10 10 10 20 10C10 10 10 10 10 0C10 10 10 10 0 10Z"/></svg>
            <svg id="star-2" class="star tt_star" viewBox="0 0 20 20"><path d="M0 10C10 10 10 10 0 10C10 10 10 10 10 20C10 10 10 10 20 10C10 10 10 10 10 0C10 10 10 10 0 10Z"/></svg>
            <svg id="star-3" class="star tt_star" viewBox="0 0 20 20"><path d="M0 10C10 10 10 10 0 10C10 10 10 10 10 20C10 10 10 10 20 10C10 10 10 10 10 0C10 10 10 10 0 10Z"/></svg>
            <svg id="star-4" class="star tt_star" viewBox="0 0 20 20"><path d="M0 10C10 10 10 10 0 10C10 10 10 10 10 20C10 10 10 10 20 10C10 10 10 10 10 0C10 10 10 10 0 10Z"/></svg>
        </div>
        </div>
    </label>`;
    // ================================================================

    groupEl.prepend(cell);
  }
  ensureThemeToggleCell();

  /** =================== Icons (PASTE HERE) =================== */
  // Leave as placeholder; renderer will fall back to DEFAULT_* when empty.
  const ICONS = {
    claim: { on: svg`<svg width="24" height="24" viewBox="0 0 24 25" fill="none" xmlns="http://www.w3.org/2000/svg">
<circle cx="8" cy="8.49609" r="6" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<circle cx="16" cy="8.49609" r="2" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M22 17.4961V19.4961C22 19.8467 21.9398 20.1833 21.8293 20.4961M20 22.3254C19.6872 22.4359 19.3506 22.4961 19 22.4961C18.6494 22.4961 18.3128 22.4359 18 22.3254M16 17.4961V19.4961C16 19.8467 16.0602 20.1833 16.1707 20.4961M22 8.49609V5.49609M22 14.4961V11.4961M16 14.4961V10.4961" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`, off: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M2.01733 15C4.2169 15 6.00001 16.7831 6.00001 18.9827" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M2.01733 9.00001C3.87717 9.00001 5.43925 7.72519 5.87743 6.00171" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M18 5.01733C18 7.19765 19.769 8.96876 21.9423 8.9996" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9.87868 9.87866C9.33579 10.4216 9 11.1716 9 12C9 13.6568 10.3431 15 12 15C12.8284 15 13.5784 14.6642 14.1213 14.1213" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M3 3L21 21" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M21.8907 15C21.0718 15 20.312 15.253 19.6851 15.6851" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M21.541 17.541C22 16.6386 22 15.278 22 13V11C22 8.17157 22 6.75736 21.1213 5.87868C20.2426 5 18.8284 5 16 5H9M18.9305 18.9305C18.168 19 17.2143 19 16 19H8C5.17157 19 3.75736 19 2.87868 18.1213C2 17.2426 2 15.8284 2 13V11C2 8.17157 2 6.75736 2.87868 5.87868C3.38012 5.37724 4.05597 5.16196 5.06953 5.06953" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>` },
    copy:  {
      on: svg`
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
             viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z"/>
          <path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1"/>
        </svg>`,
      off: svg`<!-- category: Text; tags: [clipboard, clone, duplicate] -->
        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"
             viewBox="0 0 24 24" fill="none" stroke="#000000" stroke-width="2"
             stroke-linecap="round" stroke-linejoin="round">
          <path d="M19.414 19.415a2 2 0 0 1 -1.414 .585h-8a2 2 0 0 1 -2 -2v-8c0 -.554 .225 -1.055 .589 -1.417m3.411 -.583h6a2 2 0 0 1 2 2v6"/>
          <path d="M16 8v-2a2 2 0 0 0 -2 -2h-6m-3.418 .59c-.36 .36 -.582 .86 -.582 1.41v8a2 2 0 0 0 2 2h2"/>
          <path d="M3 3l18 18"/>
        </svg>`
    },
    sexy:     { on: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M5.65784 11.0022L4.18747 14.3105C2.3324 18.4844 1.40486 20.5713 2.41719 21.5837C3.42951 22.596 5.51646 21.6685 9.69037 19.8134L12.9987 18.343C15.5161 17.2242 16.7748 16.6647 16.9751 15.586C17.1754 14.5073 16.2014 13.5333 14.2535 11.5854L12.4155 9.7474C10.4675 7.79944 9.49353 6.82546 8.41482 7.02575C7.33611 7.22604 6.77669 8.48475 5.65784 11.0022Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M6.5 10.5L13.5 17.5M4.5 15.5L8.5 19.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M16 8L19 5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M14.1973 2C14.5963 2.66667 14.9156 4.4 13 6" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M22 9.80274C21.3333 9.40365 19.6 9.08438 18 11" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M18.0009 2V2.02" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M22.0009 6V6.02" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M21.0009 13V13.02" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M11.0009 3V3.02" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`, off: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M19.439 15.439C20.3636 14.5212 21.0775 13.6091 21.544 12.955C21.848 12.5287 22 12.3155 22 12C22 11.6845 21.848 11.4713 21.544 11.045C20.1779 9.12944 16.6892 5 12 5C11.0922 5 10.2294 5.15476 9.41827 5.41827M6.74742 6.74742C4.73118 8.1072 3.24215 9.94266 2.45604 11.045C2.15201 11.4713 2 11.6845 2 12C2 12.3155 2.15201 12.5287 2.45604 12.955C3.8221 14.8706 7.31078 19 12 19C13.9908 19 15.7651 18.2557 17.2526 17.2526" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9.85786 10C9.32783 10.53 9 11.2623 9 12.0711C9 13.6887 10.3113 15 11.9289 15C12.7377 15 13.47 14.6722 14 14.1421" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
<path d="M3 3L21 21" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>` },
    acct:   { on: svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 0 36 36" fill="none" width="48" height="48"
                            stroke="currentColor" stroke-width="0">
                            <path stroke-width="1.1" fill-rule="evenodd"
                                d="M4 4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V6a2 2 0 0 0-2-2H4Zm10 5a1 1 0 0 1 1-1h3a1 1 0 1 1 0 2h-3a1 1 0 0 1-1-1Zm0 3a1 1 0 0 1 1-1h3a1 1 0 1 1 0 2h-3a1 1 0 0 1-1-1Zm0 3a1 1 0 0 1 1-1h3a1 1 0 1 1 0 2h-3a1 1 0 0 1-1-1Zm-8-5a3 3 0 1 1 6 0 3 3 0 0 1-6 0Zm1.942 4a3 3 0 0 0-2.847 2.051l-.044.133-.004.012c-.042.126-.055.167-.042.195.006.013.02.023.038.039.032.025.08.064.146.155A1 1 0 0 0 6 17h6a1 1 0 0 0 .811-.415.713.713 0 0 1 .146-.155c.019-.016.031-.026.038-.04.014-.027 0-.068-.042-.194l-.004-.012-.044-.133A3 3 0 0 0 10.059 14H7.942Z"
                                clip-rule="evenodd" />
                        </svg>`, off: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M19.439 15.439C20.3636 14.5212 21.0775 13.6091 21.544 12.955C21.848 12.5287 22 12.3155 22 12C22 11.6845 21.848 11.4713 21.544 11.045C20.1779 9.12944 16.6892 5 12 5C11.0922 5 10.2294 5.15476 9.41827 5.41827M6.74742 6.74742C4.73118 8.1072 3.24215 9.94266 2.45604 11.045C2.15201 11.4713 2 11.6845 2 12C2 12.3155 2.15201 12.5287 2.45604 12.955C3.8221 14.8706 7.31078 19 12 19C13.9908 19 15.7651 18.2557 17.2526 17.2526" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9.85786 10C9.32783 10.53 9 11.2623 9 12.0711C9 13.6887 10.3113 15 11.9289 15C12.7377 15 13.47 14.6722 14 14.1421" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
<path d="M3 3L21 21" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>` },
    ship:   { on: svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="1 0 36 36" fill="none" width="48" height="48"
                            stroke="currentColor" stroke-width="0">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"
                                d="M13 7h6l2 4m-8-4v8m0-8V6a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v9h2m8 0H9m4 0h2m4 0h2v-4m0 0h-5m3.5 5.5a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Zm-10 0a2.5 2.5 0 1 1-5 0 2.5 2.5 0 0 1 5 0Z" />
                        </svg>`, off: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M19.439 15.439C20.3636 14.5212 21.0775 13.6091 21.544 12.955C21.848 12.5287 22 12.3155 22 12C22 11.6845 21.848 11.4713 21.544 11.045C20.1779 9.12944 16.6892 5 12 5C11.0922 5 10.2294 5.15476 9.41827 5.41827M6.74742 6.74742C4.73118 8.1072 3.24215 9.94266 2.45604 11.045C2.15201 11.4713 2 11.6845 2 12C2 12.3155 2.15201 12.5287 2.45604 12.955C3.8221 14.8706 7.31078 19 12 19C13.9908 19 15.7651 18.2557 17.2526 17.2526" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9.85786 10C9.32783 10.53 9 11.2623 9 12.0711C9 13.6887 10.3113 15 11.9289 15C12.7377 15 13.47 14.6722 14 14.1421" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
<path d="M3 3L21 21" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>` },
    product:  { on: svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 29" fill="none" width="34" height="34"
                            height="34" stroke="currentColor" stroke-width="1.6">
                            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.6"
                                d="M8.4 6.763c-.251.1-.383.196-.422.235L6.564 5.584l2.737-2.737c1.113-1.113 3.053-1.097 4.337.187l1.159 1.159a1 1 0 0 1 1.39.022l4.105 4.105a1 1 0 0 1 .023 1.39l1.345 1.346a1 1 0 0 1 0 1.415l-2.052 2.052a1 1 0 0 1-1.414 0l-1.346-1.346a1 1 0 0 1-1.323.039L11.29 8.983a1 1 0 0 1 .04-1.324l-.849-.848c-.18-.18-.606-.322-1.258-.25a3.271 3.271 0 0 0-.824.202Zm1.519 3.675L3.828 16.53a1 1 0 0 0 0 1.414l2.736 2.737a1 1 0 0 0 1.414 0l6.091-6.091-4.15-4.15Z" />
                        </svg>`, off: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M19.439 15.439C20.3636 14.5212 21.0775 13.6091 21.544 12.955C21.848 12.5287 22 12.3155 22 12C22 11.6845 21.848 11.4713 21.544 11.045C20.1779 9.12944 16.6892 5 12 5C11.0922 5 10.2294 5.15476 9.41827 5.41827M6.74742 6.74742C4.73118 8.1072 3.24215 9.94266 2.45604 11.045C2.15201 11.4713 2 11.6845 2 12C2 12.3155 2.15201 12.5287 2.45604 12.955C3.8221 14.8706 7.31078 19 12 19C13.9908 19 15.7651 18.2557 17.2526 17.2526" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9.85786 10C9.32783 10.53 9 11.2623 9 12.0711C9 13.6887 10.3113 15 11.9289 15C12.7377 15 13.47 14.6722 14 14.1421" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
<path d="M3 3L21 21" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>` },
    process: { on: svg`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 28 29" fill="none" width="34" height="34"
                            stroke="currentColor" stroke-width="1">
                            <path fill-rule="evenodd" stroke-linecap="round" stroke-linejoin="round" stroke-width="1"
                                d="M9 7V2.221a2 2 0 0 0-.5.365L4.586 6.5a2 2 0 0 0-.365.5H9Zm2 0V2h7a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V9h5a2 2 0 0 0 2-2Zm.5 5a1.5 1.5 0 1 0 0 3 1.5 1.5 0 0 0 0-3Zm0 5c.47 0 .917-.092 1.326-.26l1.967 1.967a1 1 0 0 0 1.414-1.414l-1.817-1.818A3.5 3.5 0 1 0 11.5 17Z"
                                clip-rule="evenodd" />
                        </svg>`, off: svg`<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M19.439 15.439C20.3636 14.5212 21.0775 13.6091 21.544 12.955C21.848 12.5287 22 12.3155 22 12C22 11.6845 21.848 11.4713 21.544 11.045C20.1779 9.12944 16.6892 5 12 5C11.0922 5 10.2294 5.15476 9.41827 5.41827M6.74742 6.74742C4.73118 8.1072 3.24215 9.94266 2.45604 11.045C2.15201 11.4713 2 11.6845 2 12C2 12.3155 2.15201 12.5287 2.45604 12.955C3.8221 14.8706 7.31078 19 12 19C13.9908 19 15.7651 18.2557 17.2526 17.2526" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
<path d="M9.85786 10C9.32783 10.53 9 11.2623 9 12.0711C9 13.6887 10.3113 15 11.9289 15C12.7377 15 13.47 14.6722 14 14.1421" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
<path d="M3 3L21 21" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
</svg>` },
  };

  /** =================== Icon fallbacks =================== */
  const DEFAULT_ON = `
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path fill="currentColor" d="M21 12.79A9 9 0 1 1 11.21 3a7 7 0 0 0 9.79 9.79Z"/>
    </svg>`;
  const DEFAULT_OFF = `
    <svg viewBox="0 0 24 24" width="24" height="24" aria-hidden="true">
      <path d="M6.76 4.84 5.34 3.42 3.92 4.84 5.34 6.26 6.76 4.84zm10.48 0 1.42-1.42
               1.42 1.42-1.42 1.42-1.42-1.42zM12 1h0v2h0V1zm0 20h0v2h0v-2zM1 12h2v0H1v0zm20
               0h2v0h-2v0zM4.22 18.36l1.42-1.42 1.42 1.42-1.42 1.42-1.42-1.42zm12.72 0 1.42
               1.42-1.42 1.42-1.42-1.42 1.42-1.42z" fill="currentColor"/>
      <circle cx="12" cy="12" r="4" fill="currentColor"/>
    </svg>`;

  function getIconMarkup(item, state /* 'on'|'off' */) {
    const inline = (item[state + 'SVG'] ?? '').trim();
    if (inline) return inline;
    const byName = (ICONS[item.name]?.[state] ?? '').trim();
    if (byName) return byName;
    const byKey  = (ICONS[item.key]?.[state] ?? '').trim();
    if (byKey) return byKey;
    return state === 'on' ? DEFAULT_ON : DEFAULT_OFF;
  }

  /** =================== Persistence =================== */
  function loadInitialState(items) {
    const map = new Map(items.map(i => [i.key, !!i.value]));
    try {
      const raw = localStorage.getItem(ST_STORAGE_KEY);
      if (!raw) return map;
      const saved = JSON.parse(raw);
      if (saved && typeof saved === 'object') {
        items.forEach(i => {
          if (Object.prototype.hasOwnProperty.call(saved, i.key)) {
            map.set(i.key, !!saved[i.key]);
          }
        });
      }
    } catch {/* ignore */}
    return map;
  }
  function saveState(map) {
    const obj = {}; map.forEach((v, k) => (obj[k] = !!v));
    localStorage.setItem(ST_STORAGE_KEY, JSON.stringify(obj));
  }

  /** =================== Switches: bus + API =================== */
  const STBus   = new EventTarget();
  const STState = loadInitialState(stItems);

  function emitChange(detail) {
    STBus.dispatchEvent(new CustomEvent('st:change', { detail }));
    groupEl.dispatchEvent(new CustomEvent('st:change', { bubbles: true, detail }));
  }

  const ST = {
      get: (key) => STState.get(key),
      set: (key, val, opts = { save: true, emit: true }) => {
      if (!STState.has(key)) return;
      const input = groupEl.querySelector(`.st_input[data-key="${key}"]`);
      if (!input) return;
      const next = !!val;
      const prev = !!STState.get(key);
       input.checked = next;
       STState.set(key, next);
       if (opts.save && next !== prev) saveState(STState);
      const item = stItems.find(x => x.key === key);
      const label = input.closest('.st_switch');
      if (label) label.dataset.tooltipContent = `${item.tooltip}`;
      if (opts.emit) emitChange({ key, name: item.name, label: item.label, value: next });
      renderTable();
    },
    subscribe: (key, fn) => {
      const h = (e) => { if (e.detail.key === key) fn(e.detail); };
      STBus.addEventListener('st:change', h);
      return () => STBus.removeEventListener('st:change', h);
    },
    subscribeAll: (fn) => {
      const h = (e) => fn(e.detail);
      STBus.addEventListener('st:change', h);
      return () => STBus.removeEventListener('st:change', h);
    },
    list: () => stItems.map(i => ({ key: i.key, name: i.name, label: i.label, value: STState.get(i.key) })),
  };
  window.stSwitches = ST;
  /* ==== Menu toggles (acct / ship / product / process) ==== */

  const MENU_SWITCHES = {
    s4: '.iconDiv[data-key="accounts"]',    // Accounts tab
    s5: '.iconDiv[data-key="shipping"]',    // Shipping tab
    s6: '.iconDiv[data-key="production"]',  // Production tab
    s7: '.iconDiv[data-key="processing"]',  // Processing tab
  };

  function setMenuEnabled(selector, enabled) {
    const node = document.querySelector(selector);
    if (!node) return;
    node.toggleAttribute('hidden', !enabled);            // fully hide/show
    node.setAttribute('aria-hidden', String(!enabled));
    node.setAttribute('aria-disabled', String(!enabled));
    node.setAttribute('tabindex', enabled ? '0' : '-1');
    if (!enabled) node.setAttribute('aria-expanded', 'false'); // collapse if open
  }
 //In case the button toggle breaks
  // function setMenuEnabled(selector, enabled) {
  // const node = document.querySelector(selector);
  // if (!node) return;
  // const hide = !enabled;

  // // make it disappear no matter what
  // node.hidden = hide;                         // sets [hidden]
  // node.style.display = hide ? 'none' : '';    // inline style wins

  // // accessibility / interaction
  // node.setAttribute('aria-hidden', String(hide));
  // node.setAttribute('aria-disabled', String(hide));
  // node.tabIndex = hide ? -1 : 0;
  // if (hide) node.setAttribute('aria-expanded', 'false');
  // }

  /* First-run defaults: if nothing saved yet, turn these 4 ON and save. */
  const firstRunNoSaved = !localStorage.getItem(ST_STORAGE_KEY);
  if (firstRunNoSaved) {
    Object.keys(MENU_SWITCHES).forEach(k => {
      if (STState.has(k)) STState.set(k, true);
    });
    saveState(STState);
  }

  /* Initial paint from current state */
  (function syncAllMenus() {
    Object.entries(MENU_SWITCHES).forEach(([k, sel]) => {
      setMenuEnabled(sel, !!ST.get(k));
    });
  })();

  /* Live sync on toggle */
  Object.entries(MENU_SWITCHES).forEach(([k, sel]) => {
    ST.subscribe(k, ({ value }) => setMenuEnabled(sel, !!value));
  });


  /** =================== Build the switch grid =================== */
  for (const item of stItems) {
    const id = `st_${item.key}`;
    const wrapper = document.createElement('div');
    wrapper.className = 'st_item';

    const label = document.createElement('label');
    label.className = 'st_switch data-tooltip';
    label.setAttribute('aria-label', item.label);
    label.dataset.tooltipContent = item.tooltip ?? `${item.label}: ${!!item.value}`;
    label.dataset.key = item.key;
    label.dataset.name = item.name;

    const input = document.createElement('input');
    input.type = 'checkbox';
    input.className = 'st_input';
    input.id = id;
    input.name = item.name || item.key;
    input.checked = !!STState.get(item.key);
    input.dataset.key = item.key;

    const slider = document.createElement('span');
    slider.className = 'st_slider';
    slider.setAttribute('aria-hidden', 'true');

    const onEl = document.createElement('span');
    onEl.className = 'On';
    onEl.setAttribute('aria-hidden', 'true');

    const offEl = document.createElement('span');
    offEl.className = 'Off';
    offEl.setAttribute('aria-hidden', 'true');

    // Note: your CSS shows ".On" when UNCHECKED and ".Off" when CHECKED
    onEl.innerHTML  = getIconMarkup(item, 'off');
    offEl.innerHTML = getIconMarkup(item, 'on');

    label.append(input, slider, onEl, offEl);
    wrapper.append(label);
    groupEl.appendChild(wrapper);
  }

  /** =================== Table (optional) =================== */
  function renderTable() {
    if (!tbodyEl) return;
    tbodyEl.innerHTML = '';
    for (const item of stItems) {
      const tr = document.createElement('tr');
      const tdKey = document.createElement('td');
      const tdVal = document.createElement('td');
      tdKey.textContent = `${item.label} (${item.name})`;
      const on = STState.get(item.key);
      tdVal.innerHTML = `<span class="badge ${on ? 'on' : 'off'}">${on}</span>`;
      tr.append(tdKey, tdVal);
      tbodyEl.appendChild(tr);
    }
  }
  renderTable();

  /** =================== Sync user actions =================== */
  groupEl.addEventListener('change', (e) => {
    const t = e.target;
    if (!t.classList.contains('st_input')) return;
    const key = t.dataset.key;
    const item = stItems.find(x => x.key === key);
    if (!item) return;
    const value = t.checked;
    STState.set(key, value);
    saveState(STState);
    const label = t.closest('.st_switch');
    if (label) label.dataset.tooltipContent = `${item.label}: ${value}`;
    renderTable();
    emitChange({ key, name: item.name, label: item.label, value });
  });

  /** =================== Cross-tab sync =================== */
  const LIVE_SYNC = false; // set true only if you want live updates across tabs
  if (LIVE_SYNC) {
    window.addEventListener('storage', (e) => {
      if (e.key !== ST_STORAGE_KEY) return;
      let saved = {};
      try { saved = JSON.parse(e.newValue || '{}'); } catch {}
      stItems.forEach(i => {
        if (Object.prototype.hasOwnProperty.call(saved, i.key)) {
          // apply without writing back (no loops)
          ST.set(i.key, !!saved[i.key], { save: false, emit: true });
        }
      });
    });
  }

  // Signal for late loaders
  document.dispatchEvent(new CustomEvent('st:switches-ready'));

  /** =================== Extras: hooks + positioning =================== */
  const OFFSET_R = 25;      // distance to the right of the grid
  const BTN_SIZE = 20;
  const TOGGLES  = [
    { id: 'extra-toggle-1', tooltip: 'High Contrast' },
    { id: 'extra-toggle-2', tooltip: 'Experimental Mode' },
  ];

  const ExtraBus = new EventTarget();
  const extraState = (() => { try { return JSON.parse(localStorage.getItem(EX_STORAGE_KEY) || '{}'); } catch { return {} } })();
  const saveExtras = s => localStorage.setItem(EX_STORAGE_KEY, JSON.stringify(s));

  window.SettingsExtras = {
    get: id => !!extraState[id],
    set: (id, val) => {
      const el = document.getElementById(id); if (!el) return;
      el.checked = !!val; el.setAttribute('aria-checked', String(el.checked));
      extraState[id] = el.checked; saveExtras(extraState);
      ExtraBus.dispatchEvent(new CustomEvent('extra:change', { detail: { id, value: el.checked } }));
    },
    subscribe: (id, fn) => { const h = e => e.detail.id === id && fn(e.detail); ExtraBus.addEventListener('extra:change', h); return () => ExtraBus.removeEventListener('extra:change', h); },
    subscribeAll: (fn) => { const h = e => fn(e.detail); ExtraBus.addEventListener('extra:change', h); return () => ExtraBus.removeEventListener('extra:change', h); },
    list: () => TOGGLES.map(t => ({ id: t.id, value: !!extraState[t.id] })),
  };

  const isOpen = () => document.getElementById('settings-toggle')?.getAttribute('aria-expanded') === 'true';
  const relRect = (el, anc) => { const a = anc.getBoundingClientRect(), r = el.getBoundingClientRect(); return { left: r.left - a.left, top: r.top - a.top, width: r.width, height: r.height }; };

  function ensureCol(panel, grid) {
    let col = document.getElementById('extra-toggle-col');
    if (!col) {
      col = document.createElement('div');
      col.id = 'extra-toggle-col';
      Object.assign(col.style, {
        position: 'absolute', display: 'flex', flexDirection: 'column',
        gap: '32px', pointerEvents: 'none'
      });
      TOGGLES.forEach(t => {
        const label = document.createElement('label');
        label.className = 'data-tooltip extra-toggle';
        label.dataset.tooltipContent = t.tooltip;
        label.title = t.tooltip;
        label.style.pointerEvents = 'auto';

        const input = document.createElement('input');
        input.type = 'checkbox'; input.id = t.id; input.name = t.id;
        input.checked = !!extraState[t.id];
        input.setAttribute('aria-label', t.tooltip);
        input.setAttribute('aria-checked', String(input.checked));
        input.addEventListener('change', () => {
          extraState[t.id] = input.checked;
          input.setAttribute('aria-checked', String(input.checked));
          saveExtras(extraState);
          ExtraBus.dispatchEvent(new CustomEvent('extra:change', { detail: { id: t.id, value: input.checked } }));
        });

        const box = document.createElement('span');
        box.className = 'custom-checkbox';
        box.setAttribute('aria-hidden', 'true');

        label.append(input, box);
        col.appendChild(label);
      });
      panel.appendChild(col);
      document.dispatchEvent(new CustomEvent('extra:ready'));
    }
    positionCol(panel, grid, col);
  }

  function positionCol(panel, grid, col) {
    const g = relRect(grid, panel);
    col.style.left   = (g.left + g.width + OFFSET_R) + 'px';
    col.style.top    = g.top + 'px';
    col.style.width  = '20px';
    col.style.height = g.height + 'px';
    col.style.alignItems = 'center';
    col.style.display    = isOpen() ? 'flex' : 'none';
  }

  function ensureBtn(panel, grid) {
    let btn = document.getElementById('grid-corner-btn');
    if (!btn) {
      btn = document.createElement('button');
      btn.id = 'grid-corner-btn'; btn.type = 'button';
      btn.setAttribute('aria-label', 'Settings');
      btn.innerHTML = `
        <svg fill="#FFFFFF" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 16 16">
          <path d="M2.75 14A1.75 1.75 0 0 1 1 12.25v-2.5a.75.75 0 0 1 1.5 0v2.5c0 .138.112.25.25.25h10.5a.25.25 0 0 0 .25-.25v-2.5a.75.75 0 0 1 1.5 0v2.5A1.75 1.75 0 0 1 13.25 14Z"/>
          <path d="M11.78 4.72a.749.749 0 1 1-1.06 1.06L8.75 3.811V9.5a.75.75 0 0 1-1.5 0V3.811L5.28 5.78a.749.749 0 1 1-1.06-1.06l3.25-3.25a.749.749 0 0 1 1.06 0l3.25 3.25Z"/>
        </svg>`;
      panel.appendChild(btn);
    }
    positionBtn(panel, grid, btn);
  }

  function positionBtn(panel, grid, btn) {
    const cs   = getComputedStyle(grid);
    const cellW = (cs.gridTemplateColumns.match(/(-?\d+(\.\d+)?)px/) || [])[1] ? parseFloat(RegExp.$1) : 64;
    const cellH = px(cs.gridAutoRows) || 34;
    const gapX  = px(cs.columnGap) || 8;
    const gapY  = px(cs.rowGap) || 10;

    const count = grid.querySelectorAll('.st_item').length;
    const rows  = Math.ceil(count / 2);
    const odd   = (count % 2) === 1;

    const g = relRect(grid, panel);
    let left, top;
    if (odd) {
      const cellLeft = g.left + cellW + gapX;
      const cellTop  = g.top + (rows - 1) * (cellH + gapY);
      left = cellLeft + (cellW - BTN_SIZE) / 2;
      top  = cellTop  + (cellH - BTN_SIZE) / 2;
    } else {
      left = g.left + g.width  - BTN_SIZE;
      top  = g.top  + g.height - BTN_SIZE;
    }

    btn.style.left    = left + 'px';
    btn.style.top     = top  + 'px';
    btn.style.display = isOpen() ? 'inline-flex' : 'none';
  }

  function reflow() {
    const panel = document.getElementById(PANEL_ID);
    const grid  = document.getElementById(GRID_ID);
    if (!panel || !grid) return;
    ensureCol(panel, grid);
    ensureBtn(panel, grid);
  }

  // Build/position when switches render, when panel opens/closes, and on resize/mutation
  document.addEventListener('st:switches-ready', reflow);
  window.addEventListener('resize', reflow);
  const settingsBtn = document.getElementById('settings-toggle');
  settingsBtn?.addEventListener('click', () => requestAnimationFrame(reflow));
  const gridNode = document.getElementById(GRID_ID);
  if (gridNode) {
    new MutationObserver(reflow).observe(gridNode, { childList: true });
    new ResizeObserver(reflow).observe(gridNode);
  }
  if (document.readyState !== 'loading') reflow();
  else window.addEventListener('DOMContentLoaded', reflow);

  /** =================== Tooltip cool-down (scoped) =================== */
  (function tooltipCooldown() {
    const scope = document.getElementById(PANEL_ID);
    if (!scope) return;
    const timers = new WeakMap(), REARM_MS = 2400;
    function suspendTip(el) {
      if (!el) return; el.setAttribute('data-tip-suspend', '');
      if (timers.has(el)) clearTimeout(timers.get(el));
      const t = setTimeout(() => { el.removeAttribute('data-tip-suspend'); timers.delete(el); }, REARM_MS);
      timers.set(el, t);
    }
    scope.addEventListener('pointerup', (e) => {
      const host = e.target.closest('.data-tooltip'); if (!host || !scope.contains(host)) return;
      if (e.pointerType === 'mouse') host.querySelector('input,button,[tabindex]')?.blur?.();
      suspendTip(host);
    });
    scope.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const host = e.target.closest('.data-tooltip'); if (host) suspendTip(host);
    });
  })();
  // === Sexy mode wiring (use stSwitches) ===
  (function () {
    const root = document.documentElement;
    const KEY = 's3'; // Sexy Mode switch key from stItems

    const apply = (isOn) => {
      root.setAttribute('data-sexy', isOn ? 'on' : 'off'); // OFF => rain
    };

    // initial paint from saved state
    apply(!!ST.get(KEY));

    // live updates when user toggles
    ST.subscribe(KEY, ({ value }) => apply(!!value));
  })();
  
  // === High Contrast wiring (extra-toggle-1) ===
  (function () {
    const ID = 'extra-toggle-1';
    const root = document.documentElement;
    const STYLE_ID = 'hc-style';

    // Inject a tiny stylesheet once
    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        /* 50% contrast increase when enabled */
        html[data-high-contrast="on"] { filter: contrast(1.5); }
      `;
      document.head.appendChild(style);
    }

    function apply(isOn) {
      ensureStyle();
      root.setAttribute('data-high-contrast', isOn ? 'on' : 'off');
    }

    // Initial paint from saved state
    apply(!!window.SettingsExtras?.get(ID));

    // Live updates
    window.SettingsExtras?.subscribe(ID, ({ value }) => apply(!!value));
  })();
  
  // === Low Contrast wiring (extra-toggle-2) ===
  (function () {
    const ID = 'extra-toggle-2';
    const root = document.documentElement;
    const STYLE_ID = 'lc-style';

    // Inject stylesheet once
    function ensureStyle() {
      if (document.getElementById(STYLE_ID)) return;
      const style = document.createElement('style');
      style.id = STYLE_ID;
      style.textContent = `
        /* 20% contrast decrease when enabled */
        html[data-low-contrast="on"] { filter: contrast(0.8); }
      `;
      document.head.appendChild(style);
    }

    function apply(isOn) {
      ensureStyle();
      root.setAttribute('data-low-contrast', isOn ? 'on' : 'off');
    }

    // Initial paint + live updates
    apply(!!window.SettingsExtras?.get(ID));
    window.SettingsExtras?.subscribe(ID, ({ value }) => apply(!!value));
  })();


})();

 // =========               =========
 // ========= Priamry Menu  =========
 // =========               =========
(() => {
  /** ----------------- Central registries ----------------- */

  // One shared blank icon (use anywhere)
  const BLANK_SVG = '<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"></svg>';

  /** Icons registry: put only real SVGs here. Missing keys will fall back to BLANK_SVG. */
  const ICONS = {
    blank: BLANK_SVG,

    // Processing
    poPending: `<?xml version="1.0" encoding="UTF-8"?><svg width="24px" height="24px" stroke-width="1.5" viewBox="0 0 24 24"
                fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000">
                <path d="M9 2L15 2" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                </path>
                <path d="M12 10L12 14" stroke="#000000" stroke-width="1.5" stroke-linecap="round"
                    stroke-linejoin="round"></path>
                <path
                    d="M12 22C16.4183 22 20 18.4183 20 14C20 9.58172 16.4183 6 12 6C7.58172 6 4 9.58172 4 14C4 18.4183 7.58172 22 12 22Z"
                    stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>`,
    orderPending: `<?xml version="1.0" encoding="UTF-8"?><svg width="24px" height="24px" viewBox="0 0 24 24" stroke-width="1.5"
                fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000">
                <path
                    d="M12 12C15.866 12 19 8.86599 19 5H5C5 8.86599 8.13401 12 12 12ZM12 12C15.866 12 19 15.134 19 19H5C5 15.134 8.13401 12 12 12Z"
                    stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
                <path d="M5 2L12 2L19 2" stroke="#000000" stroke-width="1.5" stroke-linecap="round"
                    stroke-linejoin="round"></path>
                <path d="M5 22H12L19 22" stroke="#000000" stroke-width="1.5" stroke-linecap="round"
                    stroke-linejoin="round"></path>
            </svg>`,
    confirmationPending: `<?xml version="1.0" encoding="UTF-8"?><svg width="24px" height="24px" viewBox="0 0 24 24" stroke-width="1.5"
                fill="none" xmlns="http://www.w3.org/2000/svg" color="#000000">
                <path d="M12 6L12 12L18 12" stroke="#000000" stroke-width="1.5" stroke-linecap="round"
                    stroke-linejoin="round"></path>
                <path
                    d="M21.8883 10.5C21.1645 5.68874 17.013 2 12 2C6.47715 2 2 6.47715 2 12C2 17.5228 6.47715 22 12 22C16.1006 22 19.6248 19.5318 21.1679 16"
                    stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"></path>
                <path d="M17 16H21.4C21.7314 16 22 16.2686 22 16.6V21" stroke="#000000" stroke-width="1.5"
                    stroke-linecap="round" stroke-linejoin="round"></path>
            </svg>`,

    // Production (top level)
    richmondOrders: `<?xml version="1.0" encoding="UTF-8"?>
            <svg width="24" height="24" viewBox="0 0 35.541 55.407" fill="currentColor"
                xmlns="http://www.w3.org/2000/svg" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
                <g transform="translate(-32.155 -22.026)">
                    <circle cx="43.28363" cy="47.94702" r="1.49996" />
                    <circle cx="56.53912" cy="47.94702" r="1.49996" />
                    <path
                        d="M49.29834,46.45801c-0.55225,0-1,0.44775-1,1v5.5415c0,0.55225,0.44775,1,1,1h3.3667c0.55273,0,1-0.44775,1-1    s-0.44727-1-1-1h-2.3667v-4.5415C50.29834,46.90576,49.85059,46.45801,49.29834,46.45801z" />
                    <path
                        d="M66.91504,34.56934c-1.70575-5.60034-6.36481-10.06476-12.23749-11.79895    c-0.05902,0.32031-0.13348,0.65033-0.20825,0.98047c-0.07239,0.31964-0.15338,0.64398-0.23962,0.97168    c-0.54651,2.07684-1.35474,4.29822-2.3299,6.52747c-0.34912,0.79816-0.72064,1.59534-1.10547,2.38739    c-0.05115,0.10529-0.1001,0.21143-0.15173,0.31647c0.77521,0.58289,1.56287,1.32855,2.33386,2.1604    c1.31006,1.41351,2.56769,3.06891,3.63,4.58868c0.43091,0.61652,0.82837,1.20752,1.18427,1.75232    c2.80768,3.65564,4.74078,7.38177,5.19806,8.29395c-0.00574,0.36243-0.01941,0.70966-0.03662,1.04755    c-2.03815,3.10785-8.39221,3.62061-11.10547,3.69153c-0.86084-0.0293-1.50391-0.01758-1.7666-0.00781l-0.02832,0.00537    l-0.13477-0.00537c-0.25439-0.00879-0.91113-0.02246-1.73193,0.00879c-2.70465-0.06921-9.13031-0.5769-11.15314-3.72284    c-0.02191-0.31012-0.05859-0.61713-0.06927-0.92883c0.86407-1.10492,3.40833-4.40662,6.61591-8.74719    c0.01373-0.02356,0.01593-0.05054,0.0318-0.0733c0.23535-0.33759,0.47321-0.68823,0.71216-1.04767    c1.40387-2.11157,2.84991-4.57837,4.1524-7.14166c0.15228-0.29968,0.30304-0.59937,0.45099-0.90131    c0.27283-0.55682,0.53571-1.11603,0.79083-1.67645c1.08698-2.38806,1.99152-4.78046,2.57202-6.98871    c0.0863-0.32843,0.16528-0.65204,0.23657-0.97144c0.07391-0.33075,0.14325-0.65845,0.19995-0.97809    c-0.67194-0.12036-1.34595-0.21503-2.01825-0.25659C42.65771,21.5542,36.45898,27.54639,33.875,33.69873    c-0.40479,0.96338-0.74512,1.96045-1.0127,2.96338c-0.64941,2.43652-0.85303,4.83936-0.60498,7.14209    c0.11816,1.09717,0.30957,2.04443,0.58643,2.896c0.32324,0.99658,0.81982,1.85986,1.33984,2.76416l0.61719,1.07275    c0.00732,0.0127,0.04492,0.07324,0.05273,0.08545c0.02063,0.03308,0.05249,0.08356,0.08423,0.13538    c0.02612,0.8689,0.10541,1.7309,0.21222,2.58508c0.23267,2.83478,1.02142,10.22717,3.22845,15.79468    c0.77881,1.96387,2.08057,4.73828,4.3833,6.15088c2.33594,1.43262,4.93262,2.14453,7.45459,2.14453    c2.76416,0,5.43799-0.85498,7.58057-2.55322c3.27539-2.59668,4.55762-7.17822,5.50293-11.26904    c0.8609-3.7312,1.40259-7.49286,1.61969-11.18701c0.0033-0.04822,0.00824-0.09723,0.01129-0.14532    c0.00189-0.03314,0.00586-0.06665,0.00769-0.09979c0.00049-0.00928-0.0033-0.01764-0.00305-0.02686    c0.03467-0.57385,0.05829-1.14099,0.06226-1.69556c0.11768-0.4082,0.6629-1.53003,0.93445-2.08862    c0.31396-0.64697,0.48193-0.99463,0.55664-1.22217c0.45752-1.38184,0.78955-2.77246,0.98779-4.13281    C67.90137,40.08936,67.70752,37.16992,66.91504,34.56934z M46.69727,57.81641c0.03467,0.00537,3.52979,0.50146,6.58789,0.00293    c0.55469-0.09424,1.05957,0.28174,1.14844,0.82617c0.08887,0.54492-0.28125,1.05908-0.82617,1.14746    c-1.15039,0.1875-2.33594,0.25-3.40527,0.25c-2.06299,0-3.69141-0.23242-3.79346-0.24707    c-0.5459-0.08008-0.92432-0.5874-0.84473-1.13379C45.64307,58.11572,46.15137,57.74023,46.69727,57.81641z" />
                    <path
                        d="M49.71582,35.76849c-0.88892,1.68658-1.8266,3.31177-2.76434,4.80945c1.92175-0.22034,4.34589-0.3515,6.97363-0.16907    C52.63727,38.68616,51.13629,36.90997,49.71582,35.76849z" />
                </g>
            </svg>`,
    vendorOrders: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                <path
                    d="M10.646 12.774c-1.939 .396 -4.467 .317 -6.234 -.601c-2.454 -1.263 -1.537 -4.66 1.423 -4.982c2.254 -.224 3.814 -.354 5.65 .214c.835 .256 1.93 .569 1.355 3.281c-.191 1.067 -1.07 1.904 -2.194 2.088z" />
                <path
                    d="M5.84 7.132c.083 -.564 .214 -1.12 .392 -1.661c.456 -.936 1.095 -2.068 3.985 -2.456a22.464 22.464 0 0 1 2.867 .08c1.776 .14 2.643 1.234 3.287 3.368c.339 1.157 .46 2.342 .629 3.537v11l-12.704 -.019c-.552 -2.386 -.262 -5.894 .204 -8.481" />
                <path
                    d="M17 10c.991 .163 2.105 .383 3.069 .67c.255 .13 .52 .275 .534 .505c.264 3.434 .57 7.448 .278 9.825h-3.881" />
            </svg>`,
    hardwareOrders: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
<path d="M11.4194 15.1694L17.25 21C18.2855 22.0355 19.9645 22.0355 21 21C22.0355 19.9645 22.0355 18.2855 21 17.25L15.1233 11.3733M11.4194 15.1694L13.9155 12.1383C14.2315 11.7546 14.6542 11.5132 15.1233 11.3733M11.4194 15.1694L6.76432 20.8219C6.28037 21.4096 5.55897 21.75 4.79768 21.75C3.39064 21.75 2.25 20.6094 2.25 19.2023C2.25 18.441 2.59044 17.7196 3.1781 17.2357L10.0146 11.6056M15.1233 11.3733C15.6727 11.2094 16.2858 11.1848 16.8659 11.2338C16.9925 11.2445 17.1206 11.25 17.25 11.25C19.7353 11.25 21.75 9.23528 21.75 6.75C21.75 6.08973 21.6078 5.46268 21.3523 4.89779L18.0762 8.17397C16.9605 7.91785 16.0823 7.03963 15.8262 5.92397L19.1024 2.64774C18.5375 2.39223 17.9103 2.25 17.25 2.25C14.7647 2.25 12.75 4.26472 12.75 6.75C12.75 6.87938 12.7555 7.00749 12.7662 7.13411C12.8571 8.20956 12.6948 9.39841 11.8617 10.0845L11.7596 10.1686M10.0146 11.6056L5.90901 7.5H4.5L2.25 3.75L3.75 2.25L7.5 4.5V5.90901L11.7596 10.1686M10.0146 11.6056L11.7596 10.1686M18.375 18.375L15.75 15.75M4.86723 19.125H4.87473V19.1325H4.86723V19.125Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>`,
    usaOrders: `<svg fill="#000000" width="800px" height="800px" viewBox="0 0 32 32" xmlns="http://www.w3.org/2000/svg"><path d="M 3 7 L 3 17 L 15 17 L 17 17 L 29 17 L 29 15 L 17 15 L 17 13 L 29 13 L 29 11 L 17 11 L 17 9 L 29 9 L 29 7 L 17 7 L 15 7 L 3 7 z M 5 8 C 5.552 8 6 8.448 6 9 C 6 9.552 5.552 10 5 10 C 4.448 10 4 9.552 4 9 C 4 8.448 4.448 8 5 8 z M 9 8 C 9.552 8 10 8.448 10 9 C 10 9.552 9.552 10 9 10 C 8.448 10 8 9.552 8 9 C 8 8.448 8.448 8 9 8 z M 13 8 C 13.552 8 14 8.448 14 9 C 14 9.552 13.552 10 13 10 C 12.448 10 12 9.552 12 9 C 12 8.448 12.448 8 13 8 z M 7 11 C 7.552 11 8 11.448 8 12 C 8 12.552 7.552 13 7 13 C 6.448 13 6 12.552 6 12 C 6 11.448 6.448 11 7 11 z M 11 11 C 11.552 11 12 11.448 12 12 C 12 12.552 11.552 13 11 13 C 10.448 13 10 12.552 10 12 C 10 11.448 10.448 11 11 11 z M 15 11 C 15.552 11 16 11.448 16 12 C 16 12.552 15.552 13 15 13 C 14.448 13 14 12.552 14 12 C 14 11.448 14.448 11 15 11 z M 5 14 C 5.552 14 6 14.448 6 15 C 6 15.552 5.552 16 5 16 C 4.448 16 4 15.552 4 15 C 4 14.448 4.448 14 5 14 z M 9 14 C 9.552 14 10 14.448 10 15 C 10 15.552 9.552 16 9 16 C 8.448 16 8 15.552 8 15 C 8 14.448 8.448 14 9 14 z M 13 14 C 13.552 14 14 14.448 14 15 C 14 15.552 13.552 16 13 16 C 12.448 16 12 15.552 12 15 C 12 14.448 12.448 14 13 14 z M 3 19 L 3 21 L 29 21 L 29 19 L 3 19 z M 3 23 L 3 25 L 29 25 L 29 23 L 3 23 z"/></svg>`,

    // Production > Warehouse
    warehouse: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                <path
                    d="M10.4478 2.98351L4.94777 5.2993C3.76103 5.79898 3.16767 6.04882 2.83383 6.5516C2.5 7.05438 2.5 7.6982 2.5 8.98585V21.5H5.5V11.5C5.5 10.5572 5.5 10.0858 5.79289 9.79289C6.08579 9.5 6.55719 9.5 7.5 9.5H16.5C17.4428 9.5 17.9142 9.5 18.2071 9.79289C18.5 10.0858 18.5 10.5572 18.5 11.5V21.5H21.5V8.98585C21.5 7.6982 21.5 7.05438 21.1662 6.5516C20.8323 6.04882 20.239 5.79898 19.0522 5.2993L13.5522 2.98351C12.7867 2.66117 12.4039 2.5 12 2.5C11.5961 2.5 11.2133 2.66117 10.4478 2.98351Z"
                    stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
                <path d="M11 6.5H13" stroke="#000000" stroke-width="1.5" stroke-linecap="round"
                    stroke-linejoin="round" />
                <path
                    d="M13 15.5H11C10.0572 15.5 9.58579 15.5 9.29289 15.7929C9 16.0858 9 16.5572 9 17.5V19.5C9 20.4428 9 20.9142 9.29289 21.2071C9.58579 21.5 10.0572 21.5 11 21.5H13C13.9428 21.5 14.4142 21.5 14.7071 21.2071C15 20.9142 15 20.4428 15 19.5V17.5C15 16.5572 15 16.0858 14.7071 15.7929C14.4142 15.5 13.9428 15.5 13 15.5Z"
                    stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" />
            </svg>`,
    ordersToProcess: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11 22C10.1818 22 9.40019 21.6698 7.83693 21.0095C3.94564 19.3657 2 18.5438 2 17.1613C2 16.7742 2 10.0645 2 7M11 22L11 11.3548M11 22C11.3404 22 11.6463 21.9428 12 21.8285M20 7V11.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M18 18.0005L18.9056 17.0949M22 18C22 15.7909 20.2091 14 18 14C15.7909 14 14 15.7909 14 18C14 20.2091 15.7909 22 18 22C20.2091 22 22 20.2091 22 18Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7.32592 9.69138L4.40472 8.27785C2.80157 7.5021 2 7.11423 2 6.5C2 5.88577 2.80157 5.4979 4.40472 4.72215L7.32592 3.30862C9.12883 2.43621 10.0303 2 11 2C11.9697 2 12.8712 2.4362 14.6741 3.30862L17.5953 4.72215C19.1984 5.4979 20 5.88577 20 6.5C20 7.11423 19.1984 7.5021 17.5953 8.27785L14.6741 9.69138C12.8712 10.5638 11.9697 11 11 11C10.0303 11 9.12883 10.5638 7.32592 9.69138Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M5 12L7 13" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 4L6 9" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`,
    reviewed: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M11 22C10.1818 22 9.40019 21.6698 7.83693 21.0095C3.94564 19.3657 2 18.5438 2 17.1613C2 16.7742 2 10.0645 2 7M11 22V11.3548M11 22C11.3404 22 11.6463 21.9428 12 21.8285M20 7V11.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M7.32592 9.69138L4.40472 8.27785C2.80157 7.5021 2 7.11423 2 6.5C2 5.88577 2.80157 5.4979 4.40472 4.72215L7.32592 3.30862C9.12883 2.43621 10.0303 2 11 2C11.9697 2 12.8712 2.4362 14.6741 3.30862L17.5953 4.72215C19.1984 5.4979 20 5.88577 20 6.5C20 7.11423 19.1984 7.5021 17.5953 8.27785L14.6741 9.69138C12.8712 10.5638 11.9697 11 11 11C10.0303 11 9.12883 10.5638 7.32592 9.69138Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M5 12L7 13" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 4L6 9" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M20.1322 20.1589L22 22M21.2074 17.5964C21.2074 19.5826 19.594 21.1928 17.6037 21.1928C15.6134 21.1928 14 19.5826 14 17.5964C14 15.6102 15.6134 14 17.6037 14C19.594 14 21.2074 15.6102 21.2074 17.5964Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
            </svg>`,
    onHold: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M4 7C4 5.58579 4 4.87868 4.43934 4.43934C4.87868 4 5.58579 4 7 4C8.41421 4 9.12132 4 9.56066 4.43934C10 4.87868 10 5.58579 10 7V17C10 18.4142 10 19.1213 9.56066 19.5607C9.12132 20 8.41421 20 7 20C5.58579 20 4.87868 20 4.43934 19.5607C4 19.1213 4 18.4142 4 17V7Z" stroke="#000000" stroke-width="1.5"/>
            <path d="M14 7C14 5.58579 14 4.87868 14.4393 4.43934C14.8787 4 15.5858 4 17 4C18.4142 4 19.1213 4 19.5607 4.43934C20 4.87868 20 5.58579 20 7V17C20 18.4142 20 19.1213 19.5607 19.5607C19.1213 20 18.4142 20 17 20C15.5858 20 14.8787 20 14.4393 19.5607C14 19.1213 14 18.4142 14 17V7Z" stroke="#000000" stroke-width="1.5"/>
            </svg>`,
    cancelled: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M10.2471 6.7402C11.0734 7.56657 11.4866 7.97975 12.0001 7.97975C12.5136 7.97975 12.9268 7.56658 13.7531 6.74022L13.7532 6.7402L15.5067 4.98669L15.5067 4.98668C15.9143 4.5791 16.1182 4.37524 16.3302 4.25283C17.3966 3.63716 18.2748 4.24821 19.0133 4.98669C19.7518 5.72518 20.3628 6.60345 19.7472 7.66981C19.6248 7.88183 19.421 8.08563 19.0134 8.49321L17.26 10.2466C16.4336 11.073 16.0202 11.4864 16.0202 11.9999C16.0202 12.5134 16.4334 12.9266 17.2598 13.7529L19.0133 15.5065C19.4209 15.9141 19.6248 16.1179 19.7472 16.3299C20.3628 17.3963 19.7518 18.2746 19.0133 19.013C18.2749 19.7516 17.3965 20.3626 16.3302 19.7469C16.1182 19.6246 15.9143 19.4208 15.5067 19.013L13.7534 17.2598L13.7533 17.2597C12.9272 16.4336 12.5136 16.02 12.0001 16.02C11.4867 16.02 11.073 16.4336 10.2469 17.2598L10.2469 17.2598L8.49353 19.013C8.0859 19.4208 7.88208 19.6246 7.67005 19.7469C6.60377 20.3626 5.72534 19.7516 4.98693 19.013C4.2484 18.2746 3.63744 17.3963 4.25307 16.3299C4.37549 16.1179 4.5793 15.9141 4.98693 15.5065L6.74044 13.7529C7.56681 12.9266 7.98 12.5134 7.98 11.9999C7.98 11.4864 7.5666 11.073 6.74022 10.2466L4.98685 8.49321C4.57928 8.08563 4.37548 7.88183 4.25307 7.66981C3.63741 6.60345 4.24845 5.72518 4.98693 4.98669C5.72542 4.24821 6.60369 3.63716 7.67005 4.25283C7.88207 4.37524 8.08593 4.5791 8.49352 4.98668L8.49353 4.98669L10.2471 6.7402Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            </svg>`,
    warehouseScreens: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
            <path d="M20 10C20 6.22876 20 4.34315 18.8284 3.17157C17.6569 2 15.7712 2 12 2H10C6.22876 2 4.34315 2 3.17157 3.17157C2 4.34315 2 6.22876 2 10V12C2 15.7712 2 17.6569 3.17157 18.8284C4.23467 19.8915 5.8857 19.99 9 19.9991H9.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M14.5285 21.0596C12.8812 21.1735 11.249 13.4909 12.3697 12.37C13.4905 11.2491 21.1736 12.8801 21.0598 14.5274C20.9814 15.6063 19.1553 16.033 19.2086 16.9918C19.2243 17.2726 19.579 17.5286 20.2885 18.0404C20.7815 18.3961 21.2841 18.7415 21.7687 19.1086C21.9621 19.2551 22.0385 19.5015 21.9817 19.7337C21.7089 20.8491 20.854 21.7078 19.7341 21.9817C19.5018 22.0385 19.2555 21.9621 19.109 21.7686C18.742 21.284 18.3967 20.7813 18.041 20.2882C17.5292 19.5786 17.2733 19.2239 16.9925 19.2082C16.0339 19.1549 15.6072 20.9812 14.5285 21.0596Z" stroke="#000000" stroke-width="1.5"/>
            <path d="M2 7H20" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/>
            </svg>`,
    backOrders: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 22C11.1818 22 10.4002 21.6708 8.83693 21.0123C4.94564 19.3734 3 18.5539 3 17.1754V7.54234M12 22C12.8182 22 13.5998 21.6708 15.1631 21.0123C19.0544 19.3734 21 18.5539 21 17.1754V7.54234M12 22V12.0292M21 7.54234C21 8.15478 20.1984 8.54152 18.5953 9.315L15.6741 10.7244C13.8712 11.5943 12.9697 12.0292 12 12.0292M21 7.54234C21 6.9299 20.1984 6.54316 18.5953 5.76969L17 5M3 7.54234C3 8.15478 3.80157 8.54152 5.40472 9.315L8.32592 10.7244C10.1288 11.5943 11.0303 12.0292 12 12.0292M3 7.54234C3 6.9299 3.80157 6.54317 5.40472 5.76969L7 5M6 13.0263L8 14.0234" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10 2L12 4M12 4L14 6M12 4L10 6M12 4L14 2" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
          </svg>`,
    manualOrdersImport: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M12 22C11.1818 22 10.4002 21.6754 8.83693 21.0262C4.94564 19.4101 3 18.6021 3 17.2429V7.74463M12 22C12.8182 22 13.5998 21.6754 15.1631 21.0262C19.0544 19.4101 21 18.6021 21 17.2429V7.74463M12 22V12.1687M3 7.74463C3 8.3485 3.80157 8.72983 5.40472 9.49248L8.32592 10.8822C10.1288 11.7399 11.0303 12.1687 12 12.1687M3 7.74463C3 7.14076 3.80157 6.75944 5.40472 5.99678L7.5 5M21 7.74463C21 8.3485 20.1984 8.72983 18.5953 9.49248L15.6741 10.8822C13.8712 11.7399 12.9697 12.1687 12 12.1687M21 7.74463C21 7.14076 20.1984 6.75944 18.5953 5.99678L16.5 5M6 13.1518L8 14.135" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M12.0037 2L12.0037 8.99995M12.0037 8.99995C12.2668 9.00351 12.5263 8.81972 12.7178 8.59534L14 7.06174M12.0037 8.99995C11.7499 8.99652 11.4929 8.81368 11.2897 8.59534L10 7.06174" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
          </svg>`,
    productionList: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
          <path d="M3.5 9V14C3.5 17.7712 3.5 19.6569 4.67157 20.8284C5.84315 22 7.72876 22 11.5 22H12.5C16.2712 22 18.1569 22 19.3284 20.8284C20.5 19.6569 20.5 17.7712 20.5 14V10C20.5 6.22876 20.5 4.34315 19.3284 3.17157C18.1569 2 16.2712 2 12.5 2H12" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M13.5 17H17.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M13.5 7H17.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M13.5 12H17.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M6.5 16.5C6.5 16.5 7.46758 16.7672 8 18C8 18 9 15 11 14" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          <path d="M10 5H3.5M10 5C10 4.15973 7.67332 2.58984 7.08333 2M10 5C10 5.84027 7.67331 7.41016 7.08333 8" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
          </svg>`,

    // Production > Inventory
    inventory: `<svg
          xmlns="http://www.w3.org/2000/svg"
          width="24"
          height="24"
          viewBox="0 0 24 24"
          fill="none"
          stroke="#000000"
          stroke-width="1"
          stroke-linecap="round"
          stroke-linejoin="round"
        >
          <path d="M2.97 12.92A2 2 0 0 0 2 14.63v3.24a2 2 0 0 0 .97 1.71l3 1.8a2 2 0 0 0 2.06 0L12 19v-5.5l-5-3-4.03 2.42Z" />
          <path d="m7 16.5-4.74-2.85" />
          <path d="m7 16.5 5-3" />
          <path d="M7 16.5v5.17" />
          <path d="M12 13.5V19l3.97 2.38a2 2 0 0 0 2.06 0l3-1.8a2 2 0 0 0 .97-1.71v-3.24a2 2 0 0 0-.97-1.71L17 10.5l-5 3Z" />
          <path d="m17 16.5-5-3" />
          <path d="m17 16.5 4.74-2.85" />
          <path d="M17 16.5v5.17" />
          <path d="M7.97 4.42A2 2 0 0 0 7 6.13v4.37l5 3 5-3V6.13a2 2 0 0 0-.97-1.71l-3-1.8a2 2 0 0 0-2.06 0l-3 1.8Z" />
          <path d="M12 8 7.26 5.15" />
          <path d="m12 8 4.74-2.85" />
          <path d="M12 13.5V8" />
        </svg>`,
    receiving: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C7.58172 2 4 5.13401 4 9H20C20 5.13401 16.4183 2 12 2Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8 17.3333C8 15.4029 8.34533 15 10 15H14C15.6547 15 16 15.4029 16 17.3333V19.6667C16 21.5971 15.6547 22 14 22H10C8.34533 22 8 21.5971 8 19.6667V17.3333Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12.008 17.5H11.999" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M4 9L12 15L20 9" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    hardwareQueue: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path fill-rule="evenodd" clip-rule="evenodd" d="M2.25 6C2.25 5.58579 2.58579 5.25 3 5.25H21C21.4142 5.25 21.75 5.58579 21.75 6C21.75 6.41421 21.4142 6.75 21 6.75H3C2.58579 6.75 2.25 6.41421 2.25 6ZM2.25 10C2.25 9.58579 2.58579 9.25 3 9.25H21C21.4142 9.25 21.75 9.58579 21.75 10C21.75 10.4142 21.4142 10.75 21 10.75H3C2.58579 10.75 2.25 10.4142 2.25 10ZM19.2053 13.4431L19.2948 13.4948C20.0836 13.9501 20.7374 14.3276 21.2037 14.681C21.6788 15.041 22.105 15.4808 22.2158 16.1093C22.2614 16.3678 22.2614 16.6322 22.2158 16.8907C22.105 17.5192 21.6788 17.959 21.2037 18.319C20.7374 18.6724 20.0836 19.0499 19.2947 19.5053L19.2053 19.5569C18.4165 20.0124 17.7626 20.3899 17.2235 20.617C16.6741 20.8485 16.0802 20.9977 15.4805 20.7794C15.2338 20.6896 15.0048 20.5574 14.8037 20.3887C14.3148 19.9784 14.1471 19.3894 14.0728 18.798C14 18.2175 14 17.4625 14 16.5517V16.4483C14 15.5375 14 14.7825 14.0728 14.202C14.1471 13.6106 14.3148 13.0216 14.8037 12.6113C15.0048 12.4426 15.2338 12.3104 15.4805 12.2206C16.0802 12.0023 16.6741 12.1515 17.2235 12.383C17.7626 12.6101 18.4165 12.9876 19.2053 13.4431ZM16.6411 13.7653C16.1992 13.5791 16.051 13.6092 15.9935 13.6302C15.9113 13.6601 15.8349 13.7042 15.7679 13.7604C15.721 13.7998 15.6209 13.913 15.5611 14.3888C15.5014 14.8646 15.5 15.5243 15.5 16.5C15.5 17.4757 15.5014 18.1354 15.5611 18.6112C15.6209 19.087 15.721 19.2002 15.7679 19.2396C15.8349 19.2958 15.9113 19.3399 15.9935 19.3698C16.051 19.3908 16.1992 19.4209 16.6411 19.2347C17.083 19.0485 17.655 18.7199 18.5 18.2321C19.345 17.7442 19.9156 17.4131 20.2978 17.1235C20.68 16.8339 20.728 16.6905 20.7386 16.6302C20.7538 16.5441 20.7538 16.4559 20.7386 16.3698C20.728 16.3095 20.68 16.1661 20.2978 15.8765C19.9156 15.5869 19.345 15.2558 18.5 14.7679C17.655 14.2801 17.083 13.9515 16.6411 13.7653ZM2.25 14C2.25 13.5858 2.58579 13.25 3 13.25H11C11.4142 13.25 11.75 13.5858 11.75 14C11.75 14.4142 11.4142 14.75 11 14.75H3C2.58579 14.75 2.25 14.4142 2.25 14ZM2.25 18C2.25 17.5858 2.58579 17.25 3 17.25H11C11.4142 17.25 11.75 17.5858 11.75 18C11.75 18.4142 11.4142 18.75 11 18.75H3C2.58579 18.75 2.25 18.4142 2.25 18Z" fill="#000000"/>
        </svg>`,
    stripsReport: `<?xml version="1.0" encoding="UTF-8"?><svg id="a" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 18.4 17.4"><path d="M7.7,5.7c0,2.8,2.2,5,5,5s5-2.2,5-5S15.5.7,12.7.7M7.7,5.7c0-2.8,2.2-5,5-5M7.7,5.7v11H.7V5.7C.7,1.7,4,.7,5.7.7h7" fill="none" stroke="#000" stroke-miterlimit="10" stroke-width="1.4"/><circle cx="12.7" cy="5.7" r="2" stroke="#000"/><line x1="8.1" y1="10.5" x2=".2" y2="10.5" fill="none" opacity=".9" stroke="#000" stroke-miterlimit="10" stroke-width=".3"/></svg>`,
    completedReports: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 16.5C11 16.5 12.5 17 13.25 19C13.25 19 16.8235 13.1667 20 12" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M4 5H18" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M4 10H15" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
        <path d="M4 15H8" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`,
    stripsScanReports: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M2 4V20" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M5 4V20" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M15 4V20" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8 18V6C8 5.05719 8 4.58579 8.29289 4.29289C8.58579 4 9.05719 4 10 4C10.9428 4 11.4142 4 11.7071 4.29289C12 4.58579 12 5.05719 12 6V18C12 18.9428 12 19.4142 11.7071 19.7071C11.4142 20 10.9428 20 10 20C9.05719 20 8.58579 20 8.29289 19.7071C8 19.4142 8 18.9428 8 18Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M18 18V6C18 5.05719 18 4.58579 18.2929 4.29289C18.5858 4 19.0572 4 20 4C20.9428 4 21.4142 4 21.7071 4.29289C22 4.58579 22 5.05719 22 6V18C22 18.9428 22 19.4142 21.7071 19.7071C21.4142 20 20.9428 20 20 20C19.0572 20 18.5858 20 18.2929 19.7071C18 19.4142 18 18.9428 18 18Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    hardwareScanReports: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M3 4V20" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7.5 4V17" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M12 4V17" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M16.5 4V17" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M21 4V20" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7.49981 20H7.50879" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M11.9998 20H12.0088" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M16.4998 20H16.5088" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,

    // Shipping (top level)
    uploadTracking: `<svg height="24" width="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#000000">
                <path
                    d="M224,144v64a8,8,0,0,1-8,8H40a8,8,0,0,1-8-8V144a8,8,0,0,1,16,0v56H208V144a8,8,0,0,1,16,0ZM88,80h32v64a8,8,0,0,0,16,0V80h32a8,8,0,0,0,5.66-13.66l-40-40a8,8,0,0,0-11.32,0l-40,40A8,8,0,0,0,88,80Z" />
            </svg>`,
    tracking: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
                <path d="M19.07 4.93A10 10 0 0 0 6.99 3.34" />
                <path d="M4 6h.01" />
                <path d="M2.29 9.62A10 10 0 1 0 21.31 8.35" />
                <path d="M16.24 7.76A6 6 0 1 0 8.23 16.67" />
                <path d="M12 18h.01" />
                <path d="M17.99 11.66A6 6 0 0 1 15.77 16.67" />
                <circle cx="12" cy="12" r="2" />
                <path d="m13.41 10.59 5.66-5.66" />
            </svg>`,
    richmondTracking: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                        stroke="#ffffff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M16 7h.01" />
                        <path d="M3.4 18H12a8 8 0 0 0 8-8V7a4 4 0 0 0-7.28-2.3L2 20" />
                        <path d="m20 7 2 .5-2 .5" />
                        <path d="M10 18v3" />
                        <path d="M14 17.75V21" />
                        <path d="M7 18a6 6 0 0 0 3.84-10.61" />
                    </svg>`,
    vendorTracking: `<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none"
                        stroke="#000000" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                        <path d="M2 17 17 2" />
                        <path d="m2 14 8 8" />
                        <path d="m5 11 8 8" />
                        <path d="m8 8 8 8" />
                        <path d="m11 5 8 8" />
                        <path d="m14 2 8 8" />
                        <path d="M7 22 22 7" />
                    </svg>`,
    upsTracking: `<svg fill="#000000" width="800px" height="800px" viewBox="0 0 14 14" role="img" focusable="false"
                        aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="m 6.96499,1.000079 c -0.61711,0 -1.2357,0.056 -1.9384,0.1613 -1.09141,0.1641 -2.19962,0.4989 -2.90561,0.8778 l -0.14528,0.078 0,3.2204 0,3.2204 0.0546,0.3003 c 0.0639,0.3515 0.20439,0.7882 0.34088,1.0596 0.23374,0.4649 0.64146,0.9585 1.03154,1.2488 0.48862,0.3637 1.68247,0.9909 3.17356,1.6674 0.19976,0.091 0.38847,0.1653 0.41939,0.1659 0.17404,0 2.53598,-1.1668 3.23429,-1.6024 0.95597,-0.5963 1.5379,-1.4557 1.74104,-2.5713 0.0532,-0.2919 0.0533,-0.3 0.0533,-3.5008 l 0,-3.2083 -0.14528,-0.078 c -0.72134,-0.3872 -1.8616,-0.7273 -2.98459,-0.8903 C 8.19773,1.047779 7.58212,0.99807901 6.965,1.000079 Z m 2.39855,1.0921 c 0.97168,0 2.18921,0.038 2.2824,0.096 0.0199,0.012 0.0272,0.842 0.0272,3.0893 0,2.5863 -0.006,3.1157 -0.0362,3.3461 -0.13596,1.0291 -0.625,1.833 -1.4449,2.375 -0.36413,0.2407 -0.7284,0.4418 -1.47296,0.8128 -0.52775,0.263 -1.68622,0.8033 -1.72024,0.8022 -0.006,-2e-4 -0.23439,-0.1005 -0.50739,-0.223 -0.59315,-0.2662 -1.82833,-0.8767 -2.16711,-1.0712 -0.63338,-0.3637 -1.00476,-0.6582 -1.27938,-1.0144 -0.3518,-0.4564 -0.52378,-0.8369 -0.65031,-1.439 -0.0535,-0.2548 -0.0546,-0.2942 -0.0624,-2.249 l -0.008,-1.9896 0.21305,-0.1866 c 0.51461,-0.4507 1.21239,-0.9224 1.82324,-1.2326 1.16584,-0.5919 2.37713,-0.9233 3.9589,-1.0831 0.21139,-0.021 0.60225,-0.031 1.04392,-0.033 z m 0.83589,2.7755 c -0.0988,0 -0.19422,0.012 -0.28017,0.032 -0.38197,0.09 -0.68503,0.3172 -0.83726,0.6277 -0.0674,0.1375 -0.083,0.2005 -0.0919,0.3697 -0.0309,0.5884 0.18206,0.9146 0.8759,1.342 0.42821,0.2638 0.55777,0.4272 0.55931,0.7052 7.8e-4,0.1411 -0.008,0.1743 -0.0717,0.2642 -0.0996,0.141 -0.22513,0.2012 -0.44298,0.2124 -0.21501,0.011 -0.43845,-0.053 -0.6706,-0.1934 -0.0852,-0.051 -0.16102,-0.093 -0.16841,-0.093 -0.007,0 -0.0134,0.1641 -0.0134,0.3648 l 0,0.3648 0.18075,0.083 c 0.35883,0.1658 0.75921,0.2182 1.1055,0.1448 0.43844,-0.093 0.7703,-0.4043 0.88005,-0.8256 0.0461,-0.1771 0.0479,-0.5619 0.003,-0.7292 -0.0978,-0.3675 -0.31537,-0.5935 -0.94683,-0.9834 -0.35764,-0.2208 -0.47216,-0.3633 -0.47216,-0.5873 0,-0.1269 0.0387,-0.2135 0.13705,-0.307 0.21548,-0.2046 0.64342,-0.1817 0.99554,0.053 0.0796,0.053 0.15149,0.097 0.1598,0.097 0.008,0 0.0151,-0.1524 0.0151,-0.3386 l 0,-0.3386 -0.0943,-0.062 c -0.19816,-0.1312 -0.52596,-0.2069 -0.8225,-0.2024 z m -3.09928,0.027 c -0.0327,6e-4 -0.0661,0 -0.10016,0 -0.15315,0.01 -0.34629,0.031 -0.42917,0.051 -0.21552,0.052 -0.48694,0.1614 -0.55431,0.2237 l -0.0577,0.053 0,2.8422 c 0,1.5632 0.008,2.8497 0.0167,2.8589 0.009,0.01 0.19715,0.014 0.41769,0.01 l 0.40099,-0.01 0.006,-0.9096 0.006,-0.9095 0.35686,0 c 0.31362,10e-4 0.37671,-0.01 0.52068,-0.055 0.57742,-0.1995 0.94875,-0.7645 1.06071,-1.6142 0.0356,-0.2702 0.0149,-0.9529 -0.0356,-1.1753 -0.0977,-0.4302 -0.2349,-0.7038 -0.47424,-0.9458 -0.30412,-0.3075 -0.64439,-0.4371 -1.13515,-0.4283 z m -1.67376,0.042 -0.41783,0.01 -0.41782,0.01 -0.0121,1.6681 -0.0121,1.6681 -0.0661,0.049 c -0.0506,0.038 -0.11296,0.052 -0.26635,0.059 -0.17344,0.01 -0.2149,0 -0.30924,-0.047 -0.0879,-0.045 -0.12298,-0.084 -0.1816,-0.2014 l -0.0726,-0.1453 -0.0121,-1.5255 -0.0121,-1.5254 -0.41163,0 -0.41163,0 0,1.5618 c 0,1.4267 0.004,1.5753 0.0434,1.7191 0.13305,0.4825 0.40827,0.7561 0.86464,0.8596 0.22768,0.052 0.76758,0.034 1.05347,-0.034 0.11998,-0.029 0.31066,-0.098 0.42373,-0.1543 l 0.20563,-0.1023 0.006,-1.9316 0.006,-1.9316 z m 1.75164,0.5857 c 0.24943,9e-4 0.43468,0.1327 0.54812,0.3904 0.0997,0.2266 0.13297,0.4851 0.13152,1.0226 -10e-4,0.5384 -0.0232,0.7011 -0.13298,0.9926 -0.0689,0.1829 -0.27643,0.3993 -0.42488,0.443 -0.11819,0.035 -0.35748,0.035 -0.45115,0 l -0.0666,-0.024 0,-1.3673 0,-1.3673 0.0908,-0.039 c 0.0499,-0.022 0.16444,-0.044 0.25443,-0.05 0.0172,-0.001 0.0341,0 0.0507,0 z" />
                    </svg>`,
    fedexTracking: `<svg fill="#000000" width="800px" height="800px" viewBox="0 0 32 32"
                        xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M29.3 17.425l2.665-2.995h-3.12l-1.085 1.24-1.125-1.24h-5.935v-0.8h2.805v-2.405h-7.56v3.775h-0.025c-0.48-0.55-1.075-0.74-1.77-0.74-1.42 0-2.49 0.97-2.865 2.245-0.9-2.97-4.87-2.88-6.095-0.7v-1.21h-2.74v-1.31h3v-2.055h-5.45v9.22h2.45v-3.875h2.445c-0.075 0.285-0.115 0.59-0.115 0.91 0 3.655 5.13 4.57 6.51 1.185h-2.1c-0.735 1.045-2.29 0.445-2.29-0.73h4.275c0.185 1.525 1.37 2.845 3.005 2.845 0.705 0 1.35-0.345 1.745-0.93h0.025v0.595h10.61l1.105-1.25 1.115 1.25h3.22zM6.965 16.595c0.305-1.315 2.085-1.28 2.325 0zM14.635 19.040c-1.73 0-1.7-3.14 0-3.14 1.63 0 1.725 3.14 0 3.14zM23.025 19.995h-4.72v-8.325h4.75v1.51h-2.805v1.695h2.775v1.405h-2.805v2.235h2.805zM20.73 18.005v-1.22h2.805v-2.2l2.535 2.85-2.535 2.85v-2.28zM27.66 18.52l-1.305 1.475h-1.905l2.28-2.56-2.28-2.56h1.985l1.33 1.465 1.28-1.465h1.925l-2.27 2.55 2.3 2.57h-2.025z" />
                    </svg>`,

    // Shipping > Shipping
    shipping: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.5 17.5C19.5 18.8807 18.3807 20 17 20C15.6193 20 14.5 18.8807 14.5 17.5C14.5 16.1193 15.6193 15 17 15C18.3807 15 19.5 16.1193 19.5 17.5Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M9.5 17.5C9.5 18.8807 8.38071 20 7 20C5.61929 20 4.5 18.8807 4.5 17.5C4.5 16.1193 5.61929 15 7 15C8.38071 15 9.5 16.1193 9.5 17.5Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M14.5 17.5H9.5M19.5 17.5H20.2632C20.4831 17.5 20.5931 17.5 20.6855 17.4885C21.3669 17.4036 21.9036 16.8669 21.9885 16.1855C22 16.0931 22 15.9831 22 15.7632V13C22 9.41015 19.0899 6.5 15.5 6.5M2 4H12C13.4142 4 14.1213 4 14.5607 4.43934C15 4.87868 15 5.58579 15 7V15.5M2 12.75V15C2 15.9346 2 16.4019 2.20096 16.75C2.33261 16.978 2.52197 17.1674 2.75 17.299C3.09808 17.5 3.56538 17.5 4.5 17.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 7H8M2 10H6" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    shipped: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M8 22H6C4.11438 22 3.17157 22 2.58579 21.4142C2 20.8284 2 19.8856 2 18V16C2 14.1144 2 13.1716 2.58579 12.5858C3.17157 12 4.11438 12 6 12H8C9.88562 12 10.8284 12 11.4142 12.5858C12 13.1716 12 14.1144 12 16V18C12 19.8856 12 20.8284 11.4142 21.4142C10.8284 22 9.88562 22 8 22Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6 15L8 15" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M18 2C15.7909 2 14 3.80892 14 6.04033C14 7.31626 14.5 8.30834 15.5 9.1945C16.2049 9.81911 17.0588 10.8566 17.5714 11.6975C17.8173 12.1008 18.165 12.1008 18.4286 11.6975C18.9672 10.8733 19.7951 9.81911 20.5 9.1945C21.5 8.30834 22 7.31626 22 6.04033C22 3.80892 20.2091 2 18 2Z" stroke="#000000" stroke-width="1.5" stroke-linejoin="round"/>
        <path d="M18 15V18C18 19.8856 18 20.8284 17.5314 21.4142C17.0839 21.9735 16.3761 21.9988 15 21.9999" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M18.0078 6L17.9988 6" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    shipmentsInQueue: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M11 22C10.1818 22 9.40019 21.6698 7.83693 21.0095C3.94564 19.3657 2 18.5438 2 17.1613C2 16.7742 2 10.0645 2 7M11 22L11 11.3548M11 22C11.3404 22 11.6463 21.9428 12 21.8285M20 7V11.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M18 18.0005L18.9056 17.0949M22 18C22 15.7909 20.2091 14 18 14C15.7909 14 14 15.7909 14 18C14 20.2091 15.7909 22 18 22C20.2091 22 22 20.2091 22 18Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7.32592 9.69138L4.40472 8.27785C2.80157 7.5021 2 7.11423 2 6.5C2 5.88577 2.80157 5.4979 4.40472 4.72215L7.32592 3.30862C9.12883 2.43621 10.0303 2 11 2C11.9697 2 12.8712 2.4362 14.6741 3.30862L17.5953 4.72215C19.1984 5.4979 20 5.88577 20 6.5C20 7.11423 19.1984 7.5021 17.5953 8.27785L14.6741 9.69138C12.8712 10.5638 11.9697 11 11 11C10.0303 11 9.12883 10.5638 7.32592 9.69138Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M5 12L7 13" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M16 4L6 9" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    expectedShipmentPending: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.5 19.5C19.5 20.8807 18.3807 22 17 22C15.6193 22 14.5 20.8807 14.5 19.5C14.5 18.1193 15.6193 17 17 17C18.3807 17 19.5 18.1193 19.5 19.5Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M9.5 19.5C9.5 20.8807 8.38071 22 7 22C5.61929 22 4.5 20.8807 4.5 19.5C4.5 18.1193 5.61929 17 7 17C8.38071 17 9.5 18.1193 9.5 19.5Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M14.5 19.5H9.5M19.5 19.5H20.2632C20.4831 19.5 20.5931 19.5 20.6855 19.4885C21.3669 19.4036 21.9036 18.8669 21.9885 18.1855C22 18.0931 22 17.9831 22 17.7632V15C22 11.4101 19.0899 8.5 15.5 8.5M11 6H12C13.4142 6 14.1213 6 14.5607 6.43934C15 6.87868 15 7.58579 15 9V17.5M2 12V17C2 17.9346 2 18.4019 2.20096 18.75C2.33261 18.978 2.52197 19.1674 2.75 19.299C3.09808 19.5 3.56538 19.5 4.5 19.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7.85 7.85L6.5 6.95V4.7M2 6.5C2 8.98528 4.01472 11 6.5 11C8.98528 11 11 8.98528 11 6.5C11 4.01472 8.98528 2 6.5 2C4.01472 2 2 4.01472 2 6.5Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    shipOut: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 22C11.1818 22 10.4002 21.6708 8.83693 21.0123C4.94564 19.3734 3 18.5539 3 17.1754V7.54234M12 22C12.8182 22 13.5998 21.6708 15.1631 21.0123C19.0544 19.3734 21 18.5539 21 17.1754V7.54234M12 22V12.0292M3 7.54234C3 8.15478 3.80157 8.54152 5.40472 9.315L8.32592 10.7244C10.1288 11.5943 11.0303 12.0292 12 12.0292M3 7.54234C3 6.9299 3.80157 6.54317 5.40472 5.76969L7 5M21 7.54234C21 8.15478 20.1984 8.54152 18.5953 9.315L15.6741 10.7244C13.8712 11.5943 12.9697 12.0292 12 12.0292M21 7.54234C21 6.9299 20.1984 6.54316 18.5953 5.76969L17.0446 5.02151M6 13.0263L8 14.0234" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M11.9963 9L11.9963 2.00005M11.9963 2.00005C11.7332 1.99649 11.4737 2.18028 11.2822 2.40466L10 3.93826M11.9963 2.00005C12.2501 2.00348 12.5071 2.18632 12.7103 2.40466L14 3.93826" stroke="#000000" stroke-width="1.5" stroke-linecap="round"/>
        </svg>`,
    manageShipmentType: `<svg stroke="#848484ff" fill="#000000" id="Icon" xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 32 32">
          <path d="M29.9189,18.6064l-3-7c-.1572-.3682-.5186-.6064-.9189-.6064h-3v-2c0-.5527-.4473-1-1-1h-3v2h2v12.5562c-.9094.5308-1.5869,1.4009-1.858,2.4438h-6.2841c-.447-1.7207-1.9993-3-3.8579-3s-3.4109,1.2793-3.8579,3h-1.1421v-8h-2v9c0,.5527.4473,1,1,1h2.1421c.447,1.7207,1.9993,3,3.8579,3s3.4109-1.2793,3.8579-3h6.2841c.4472,1.7207,1.9997,3,3.858,3s3.4108-1.2793,3.858-3h2.142c.5527,0,1-.4473,1-1v-7c0-.1401-.0293-.2725-.0811-.3936ZM9,28c-1.1025,0-2-.8975-2-2s.8975-2,2-2,2,.8975,2,2-.8975,2-2,2ZM23,13h2.3408l2.1431,5h-4.4839v-5ZM23,28c-1.103,0-2-.8975-2-2s.897-2,2-2,2,.8975,2,2-.897,2-2,2ZM28,25h-1.142c-.4472-1.7207-1.9997-3-3.858-3v-2h5v5ZM4.833,11.7529l-1.49,1.4901,1.414,1.414,1.49-1.4901c.5318.3546,1.127.6031,1.753.7321v2.1011h2v-2.1011c.626-.129,1.2211-.3775,1.7529-.7319l1.49,1.49,1.414-1.414-1.49-1.49c.3545-.5318.603-1.127.732-1.753h2.1011v-2h-2.1011c-.129-.6259-.3774-1.2211-.7319-1.7529l1.4901-1.4901-1.414-1.414-1.4901,1.4901c-.5318-.3546-1.127-.6031-1.753-.7321V2h-2v2.1011c-.6259.129-1.2211.3775-1.7529.7319l-1.49-1.49-1.414,1.414,1.49,1.49c-.3545.5318-.603,1.127-.732,1.753H2v2h2.1011c.1289.6259.3774,1.2211.7319,1.7529ZM9,6c1.6569,0,3,1.3431,3,3-.0018,1.6561-1.3439,2.9982-3,3-1.6569,0-3-1.3431-3-3s1.3431-3,3-3Z"/>
        </svg>`,

    // Shipping > LTL
    ltl: `<svg height="24" width="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#000000">
                <path
                    d="M236.4,70.65,130.2,40.31a8,8,0,0,0-3.33-.23L21.74,55.1A16.08,16.08,0,0,0,8,70.94V185.06A16.08,16.08,0,0,0,21.74,200.9l105.13,15A8.47,8.47,0,0,0,128,216a7.85,7.85,0,0,0,2.2-.31l106.2-30.34A16.07,16.07,0,0,0,248,170V86A16.07,16.07,0,0,0,236.4,70.65ZM96,120H80V62.94l40-5.72V198.78l-40-5.72V136H96a8,8,0,0,0,0-16ZM24,70.94l40-5.72V120H48a8,8,0,0,0,0,16H64v54.78l-40-5.72ZM136,197.39V58.61L232,86V170Z" />
            </svg`,
    ltlShipments: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.5 17.5C19.5 18.8807 18.3807 20 17 20C15.6193 20 14.5 18.8807 14.5 17.5C14.5 16.1193 15.6193 15 17 15C18.3807 15 19.5 16.1193 19.5 17.5Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M9.5 17.5C9.5 18.8807 8.38071 20 7 20C5.61929 20 4.5 18.8807 4.5 17.5C4.5 16.1193 5.61929 15 7 15C8.38071 15 9.5 16.1193 9.5 17.5Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M14.5 17.5H9.5M2 4H12C13.4142 4 14.1213 4 14.5607 4.43934C15 4.87868 15 5.58579 15 7V15.5M15.5 6.5H17.3014C18.1311 6.5 18.5459 6.5 18.8898 6.6947C19.2336 6.8894 19.4471 7.2451 19.8739 7.95651L21.5725 10.7875C21.7849 11.1415 21.8911 11.3186 21.9456 11.5151C22 11.7116 22 11.918 22 12.331V15C22 15.9346 22 16.4019 21.799 16.75C21.6674 16.978 21.478 17.1674 21.25 17.299C20.9019 17.5 20.4346 17.5 19.5 17.5M2 13V15C2 15.9346 2 16.4019 2.20096 16.75C2.33261 16.978 2.52197 17.1674 2.75 17.299C3.09808 17.5 3.56538 17.5 4.5 17.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2 7H8M2 10H6" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    ltlRequestPending: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.5 19.5C19.5 20.8807 18.3807 22 17 22C15.6193 22 14.5 20.8807 14.5 19.5C14.5 18.1193 15.6193 17 17 17C18.3807 17 19.5 18.1193 19.5 19.5Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M9.5 19.5C9.5 20.8807 8.38071 22 7 22C5.61929 22 4.5 20.8807 4.5 19.5C4.5 18.1193 5.61929 17 7 17C8.38071 17 9.5 18.1193 9.5 19.5Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M14.5 19.5H9.5M19.5 19.5H20.2632C20.4831 19.5 20.5931 19.5 20.6855 19.4885C21.3669 19.4036 21.9036 18.8669 21.9885 18.1855C22 18.0931 22 17.9831 22 17.7632V15C22 11.4101 19.0899 8.5 15.5 8.5M11 6H12C13.4142 6 14.1213 6 14.5607 6.43934C15 6.87868 15 7.58579 15 9V17.5M2 12V17C2 17.9346 2 18.4019 2.20096 18.75C2.33261 18.978 2.52197 19.1674 2.75 19.299C3.09808 19.5 3.56538 19.5 4.5 19.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M7.85 7.85L6.5 6.95V4.7M2 6.5C2 8.98528 4.01472 11 6.5 11C8.98528 11 11 8.98528 11 6.5C11 4.01472 8.98528 2 6.5 2C4.01472 2 2 4.01472 2 6.5Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    ltlRequestSent: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M19.5 17.5C19.5 18.8807 18.3807 20 17 20C15.6193 20 14.5 18.8807 14.5 17.5C14.5 16.1193 15.6193 15 17 15C18.3807 15 19.5 16.1193 19.5 17.5Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M9.5 17.5C9.5 18.8807 8.38071 20 7 20C5.61929 20 4.5 18.8807 4.5 17.5C4.5 16.1193 5.61929 15 7 15C8.38071 15 9.5 16.1193 9.5 17.5Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M14.5 17.5H9.5M15 15.5V7C15 5.58579 15 4.87868 14.5607 4.43934C14.1213 4 13.4142 4 12 4H5C3.58579 4 2.87868 4 2.43934 4.43934C2 4.87868 2 5.58579 2 7V15C2 15.9346 2 16.4019 2.20096 16.75C2.33261 16.978 2.52197 17.1674 2.75 17.299C3.09808 17.5 3.56538 17.5 4.5 17.5M15.5 6.5H17.3014C18.1311 6.5 18.5459 6.5 18.8898 6.6947C19.2336 6.8894 19.4471 7.2451 19.8739 7.95651L21.5725 10.7875C21.7849 11.1415 21.8911 11.3186 21.9456 11.5151C22 11.7116 22 11.918 22 12.331V15C22 15.9346 22 16.4019 21.799 16.75C21.6674 16.978 21.478 17.1674 21.25 17.299C20.9019 17.5 20.4346 17.5 19.5 17.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M9.32653 12L10.8131 10.8258C11.6044 10.2008 12 9.88833 12 9.5M9.32653 7L10.8131 8.17417C11.6044 8.79917 12 9.11168 12 9.5M12 9.5L5 9.5" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    ltlCompleted: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <circle cx="17" cy="19.0001" r="2" stroke="#000000" stroke-width="1.5"/>
        <circle cx="7" cy="19.0001" r="2" stroke="#000000" stroke-width="1.5"/>
        <path d="M2 9.00012V13.9471C2 16.3291 2 17.5201 2.73223 18.2601C3.2191 18.7522 3.90328 18.917 5 18.9723M12.4271 5.00012C13.3404 5.30002 14.0564 6.02366 14.3532 6.94666C14.5 7.40334 14.5 7.96765 14.5 9.09625C14.5 9.84865 14.5 10.2249 14.5979 10.5293C14.7957 11.1446 15.2731 11.6271 15.882 11.827C16.1832 11.9259 16.5555 11.9259 17.3 11.9259H22V13.9471C22 16.3291 22 17.5201 21.2678 18.2601C20.7809 18.7522 20.0967 18.917 19 18.9723M9 19.0001H15" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M14.5 7.00012H16.3212C17.7766 7.00012 18.5042 7.00012 19.0964 7.35383C19.6886 7.70754 20.0336 8.34824 20.7236 9.62962L22 12.0001" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8.9992 4.90975C9.0192 5.65975 8.81922 6.37977 8.45922 6.98977C8.25922 7.34977 7.9992 7.67978 7.6892 7.93978C7.0092 8.58978 6.09922 8.97978 5.08922 8.99978C3.84922 9.02978 2.7292 8.48977 1.9992 7.61977C1.8592 7.46977 1.7392 7.29978 1.6292 7.12978C1.2392 6.53978 1.0192 5.8398 0.999195 5.0898C0.969195 3.8298 1.52919 2.67977 2.42919 1.92977C3.10919 1.36977 3.96917 1.01978 4.90917 0.999776C5.95917 0.979776 6.91921 1.35978 7.63921 1.99978C8.44921 2.70978 8.9692 3.73975 8.9992 4.90975Z" stroke="#000000" stroke-width="1.45" stroke-miterlimit="100" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M3.43945 5.02979L4.44946 5.98975L6.53943 3.96973" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,

    // Accounts
    productPricing: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M17.5 5C18.3284 5 19 5.67157 19 6.5C19 7.32843 18.3284 8 17.5 8C16.6716 8 16 7.32843 16 6.5C16 5.67157 16.6716 5 17.5 5Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M2.77423 11.1439C1.77108 12.2643 1.7495 13.9546 2.67016 15.1437C4.49711 17.5033 6.49674 19.5029 8.85633 21.3298C10.0454 22.2505 11.7357 22.2289 12.8561 21.2258C15.8979 18.5022 18.6835 15.6559 21.3719 12.5279C21.6377 12.2187 21.8039 11.8397 21.8412 11.4336C22.0062 9.63798 22.3452 4.46467 20.9403 3.05974C19.5353 1.65481 14.362 1.99377 12.5664 2.15876C12.1603 2.19608 11.7813 2.36233 11.472 2.62811C8.34412 5.31646 5.49781 8.10211 2.77423 11.1439Z" stroke="#000000" stroke-width="1.5"/>
        <path d="M13.7884 12.3666C13.8097 11.9656 13.9222 11.232 13.3125 10.6745M13.3125 10.6745C13.1238 10.502 12.866 10.3463 12.5149 10.2225C11.2583 9.77964 9.71484 11.262 10.8067 12.6189C11.3936 13.3482 11.8461 13.5726 11.8035 14.4008C11.7735 14.9835 11.2012 15.5922 10.4469 15.8241C9.7916 16.0255 9.06876 15.7588 8.61156 15.2479C8.05332 14.6242 8.1097 14.0361 8.10492 13.7798M13.3125 10.6745L14.0006 9.98639M8.66131 15.3257L8.00781 15.9792" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    quotes: `<svg height="24" width="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#000000"><path d="M100,56H40A16,16,0,0,0,24,72v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,100,56Zm0,80H40V72h60ZM216,56H156a16,16,0,0,0-16,16v64a16,16,0,0,0,16,16h60v8a32,32,0,0,1-32,32,8,8,0,0,0,0,16,48.05,48.05,0,0,0,48-48V72A16,16,0,0,0,216,56Zm0,80H156V72h60Z"/></svg>`,
    akonOrders: `<svg height="24" width="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#000000"><path d="M232,104a56.06,56.06,0,0,0-56-56H136a24,24,0,0,1,24-24,8,8,0,0,0,0-16,40,40,0,0,0-40,40H80a56.06,56.06,0,0,0-56,56,16,16,0,0,0,8,13.83V128c0,35.53,33.12,62.12,59.74,83.49C103.66,221.07,120,234.18,120,240a8,8,0,0,0,16,0c0-5.82,16.34-18.93,28.26-28.51C190.88,190.12,224,163.53,224,128V117.83A16,16,0,0,0,232,104ZM80,64h96a40.06,40.06,0,0,1,40,40H40A40,40,0,0,1,80,64Zm74.25,135c-10.62,8.52-20,16-26.25,23.37-6.25-7.32-15.63-14.85-26.25-23.37C77.8,179.79,48,155.86,48,128v-8H208v8C208,155.86,178.2,179.79,154.25,199Z"/></svg>`,
    fullyDelivered: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M21 7V12M3 7C3 10.0645 3 16.7742 3 17.1613C3 18.5438 4.94564 19.3657 8.83693 21.0095C10.4002 21.6698 11.1818 22 12 22L12 11.3548" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M15 19C15 19 15.875 19 16.75 21C16.75 21 19.5294 16 22 15" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M8.32592 9.69138L5.40472 8.27785C3.80157 7.5021 3 7.11423 3 6.5C3 5.88577 3.80157 5.4979 5.40472 4.72215L8.32592 3.30862C10.1288 2.43621 11.0303 2 12 2C12.9697 2 13.8712 2.4362 15.6741 3.30862L18.5953 4.72215C20.1984 5.4979 21 5.88577 21 6.5C21 7.11423 20.1984 7.5021 18.5953 8.27785L15.6741 9.69138C13.8712 10.5638 12.9697 11 12 11C11.0303 11 10.1288 10.5638 8.32592 9.69138Z" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M6 12L8 13" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        <path d="M17 4L7 9" stroke="#000000" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
        </svg>`,
    sage: `<svg height="24" width="24" xmlns="http://www.w3.org/2000/svg" viewBox="0 0 256 256" fill="#000000">
                <path
                    d="M192,116a12,12,0,1,1-12-12A12,12,0,0,1,192,116ZM152,64H112a8,8,0,0,0,0,16h40a8,8,0,0,0,0-16Zm96,48v32a24,24,0,0,1-24,24h-2.36l-16.21,45.38A16,16,0,0,1,190.36,224H177.64a16,16,0,0,1-15.07-10.62L160.65,208h-57.3l-1.92,5.38A16,16,0,0,1,86.36,224H73.64a16,16,0,0,1-15.07-10.62L46,178.22a87.69,87.69,0,0,1-21.44-48.38A16,16,0,0,0,16,144a8,8,0,0,1-16,0,32,32,0,0,1,24.28-31A88.12,88.12,0,0,1,112,32H216a8,8,0,0,1,0,16H194.61a87.93,87.93,0,0,1,30.17,37c.43,1,.85,2,1.25,3A24,24,0,0,1,248,112Zm-16,0a8,8,0,0,0-8-8h-3.66a8,8,0,0,1-7.64-5.6A71.9,71.9,0,0,0,144,48H112A72,72,0,0,0,58.91,168.64a8,8,0,0,1,1.64,2.71L73.64,208H86.36l3.82-10.69A8,8,0,0,1,97.71,192h68.58a8,8,0,0,1,7.53,5.31L177.64,208h12.72l18.11-50.69A8,8,0,0,1,216,152h8a8,8,0,0,0,8-8Z" />
            </svg>`,
    enteredInSageReports: `<svg width="24" height="24" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
                        <path
                            d="M4 5.25C4 4.00736 5.00736 3 6.25 3H15.75C16.9926 3 18 4.00736 18 5.25V14H22V17.75C22 19.5449 20.5449 21 18.75 21H12.95C12.9828 20.8384 13 20.6712 13 20.5V19.5H16.5V5.25C16.5 4.83579 16.1642 4.5 15.75 4.5H6.25C5.83579 4.5 5.5 4.83579 5.5 5.25V14H4V5.25ZM18 19.5H18.75C19.7165 19.5 20.5 18.7165 20.5 17.75V15.5H18V19.5ZM8.25 7C7.83579 7 7.5 7.33579 7.5 7.75C7.5 8.16421 7.83579 8.5 8.25 8.5H13.75C14.1642 8.5 14.5 8.16421 14.5 7.75C14.5 7.33579 14.1642 7 13.75 7H8.25ZM7.5 11.75C7.5 11.3358 7.83579 11 8.25 11H13.75C14.1642 11 14.5 11.3358 14.5 11.75C14.5 12.1642 14.1642 12.5 13.75 12.5H8.25C7.83579 12.5 7.5 12.1642 7.5 11.75ZM2.5 15C1.67157 15 1 15.6716 1 16.5V20.5C1 21.3284 1.67157 22 2.5 22H10.5C11.3284 22 12 21.3284 12 20.5V16.5C12 15.6716 11.3284 15 10.5 15H2.5ZM10 16C10 16.5523 10.4477 17 11 17V18C9.89543 18 9 17.1046 9 16H10ZM9 21C9 19.8954 9.89543 19 11 19V20C10.4477 20 10 20.4477 10 21H9ZM2 17C2.55229 17 3 16.5523 3 16H4C4 17.1046 3.10457 18 2 18V17ZM2 19C3.10457 19 4 19.8954 4 21H3C3 20.4477 2.55228 20 2 20V19ZM6.5 16.75C7.4665 16.75 8.25 17.5335 8.25 18.5C8.25 19.4665 7.4665 20.25 6.5 20.25C5.5335 20.25 4.75 19.4665 4.75 18.5C4.75 17.5335 5.5335 16.75 6.5 16.75Z"
                            fill="#000000" />
                    </svg>`,
    enteredInSage: `<svg stroke="#000000" width="24" height="24" viewBox="0 0 24 24" fill="none"
                        xmlns="http://www.w3.org/2000/svg">
                        <path opacity="0.4"
                            d="M12 14.5C13.3807 14.5 14.5 13.3807 14.5 12C14.5 10.6193 13.3807 9.5 12 9.5C10.6193 9.5 9.5 10.6193 9.5 12C9.5 13.3807 10.6193 14.5 12 14.5Z"
                            stroke="#000000" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round"
                            stroke-linejoin="round" />
                        <path opacity="0.4" d="M18.5 9.5V14.5" stroke="#000000" stroke-width="1.5"
                            stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round" />
                        <path
                            d="M9 18C9 18.75 8.79001 19.46 8.42001 20.06C7.73001 21.22 6.46 22 5 22C3.54 22 2.26999 21.22 1.57999 20.06C1.20999 19.46 1 18.75 1 18C1 15.79 2.79 14 5 14C7.21 14 9 15.79 9 18Z"
                            stroke="#000000" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round"
                            stroke-linejoin="round" />
                        <path d="M3.43945 18L4.42944 18.99L6.55945 17.02" stroke="#000000" stroke-width="1.5"
                            stroke-linecap="round" stroke-linejoin="round" />
                        <path d="M2 15.3V9C2 5.5 4 4 7 4H17C20 4 22 5.5 22 9V15C22 18.5 20 20 17 20H8.5"
                            stroke="#000000" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round"
                            stroke-linejoin="round" />
                    </svg>`,
    notInSage: `<svg stroke="#000000" width="24" height="24" viewBox="0 0 24 24" fill="none"
                        xmlns="http://www.w3.org/2000/svg">
                        <path d="M2 15.2V9C2 5.5 4 4 7 4H17C20 4 22 5.5 22 9V15C22 18.5 20 20 17 20H8.5"
                            stroke="#000000" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round"
                            stroke-linejoin="round" />
                        <path opacity="0.4"
                            d="M12 14.5C13.3807 14.5 14.5 13.3807 14.5 12C14.5 10.6193 13.3807 9.5 12 9.5C10.6193 9.5 9.5 10.6193 9.5 12C9.5 13.3807 10.6193 14.5 12 14.5Z"
                            stroke="#000000" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round"
                            stroke-linejoin="round" />
                        <path opacity="0.4" d="M18.5 9.5V14.5" stroke="#000000" stroke-width="1.5"
                            stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round" />
                        <path
                            d="M9 18C9 18.75 8.78998 19.46 8.41998 20.06C7.72998 21.22 6.46 22 5 22C3.54 22 2.27002 21.22 1.58002 20.06C1.21002 19.46 1 18.75 1 18C1 15.79 2.79 14 5 14C7.21 14 9 15.79 9 18Z"
                            stroke="#000000" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round"
                            stroke-linejoin="round" />
                        <path d="M7.75 15.25L2.25 20.75" stroke="#000000" stroke-width="1.5" stroke-miterlimit="10"
                            stroke-linecap="round" stroke-linejoin="round" />
                    </svg>`,
    subtotalCheckPending: `<svg stroke="#000000" width="24" height="24" viewBox="0 0 24 24" fill="none"
                        xmlns="http://www.w3.org/2000/svg">
                        <path opacity="0.4"
                            d="M12 14.5C13.3807 14.5 14.5 13.3807 14.5 12C14.5 10.6193 13.3807 9.5 12 9.5C10.6193 9.5 9.5 10.6193 9.5 12C9.5 13.3807 10.6193 14.5 12 14.5Z"
                            stroke="#000000" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round"
                            stroke-linejoin="round" />
                        <path opacity="0.4" d="M18.5 9.5V14.5" stroke="#000000" stroke-width="1.5"
                            stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round" />
                        <path
                            d="M5 22C7.20914 22 9 20.2091 9 18C9 15.7909 7.20914 14 5 14C2.79086 14 1 15.7909 1 18C1 20.2091 2.79086 22 5 22Z"
                            stroke="#000000" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round"
                            stroke-linejoin="round" />
                        <path d="M5.25 16.75V17.68C5.25 18.03 5.07001 18.36 4.76001 18.54L4 19" stroke="#000000"
                            stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round" stroke-linejoin="round" />
                        <path d="M2 15.2V9C2 5.5 4 4 7 4H17C20 4 22 5.5 22 9V15C22 18.5 20 20 17 20H8.5"
                            stroke="#000000" stroke-width="1.5" stroke-miterlimit="10" stroke-linecap="round"
                            stroke-linejoin="round" />
                    </svg>`
  };


  /** Hrefs/route registry: one source of truth for every destination */
  const HREFS = {
    processing: {
      poPending: '?p=pocontrol&type=PO%20SENT&',
      orderPending: '?p=orders&sales_status=Pending',
      confirmationPending: '?p=pocontrol&type=CONFIRMATION%20NUMBER&'
    },

    production: {
      richmondOrders: 'linkhere',
      vendorOrders: 'linkhere',
      hardwareOrders: 'linkhere',
      usaOrders: 'linkhere',
      warehouse: {
        ordersToProcess: 'linkhere',
        reviewed: 'linkhere',
        onHold: 'linkhere',
        cancelled: 'linkhere',
        warehouseScreens: 'linkhere',
        backOrders: 'linkhere',
        manualOrdersImport: 'linkhere',
        productionList: 'linkhere'
      },
      inventory: {
        receiving: 'linkhere',              // (spelling kept to match your label)
        hardwareQueue: 'linkhere',
        stripsReport: 'linkhere',
        completedReports: 'linkhere',
        stripsScanReports: 'linkhere',
        hardwareScanReports: 'linkhere'
      }
    },

    shipping: {
      uploadTracking: 'linkhere',
      tracking: {
        richmondTracking: 'linkhere',
        vendorTracking: 'linkhere',
        upsTracking: 'linkhere',
        fedexTracking: 'linkhere'
      },
      shipping: {
        shipped: 'linkhere',
        shipmentsInQueue: 'linkhere',
        expectedShipmentPending: 'linkhere',
        shipOut: 'linkhere',
        manageShipmentType: 'linkhere'
      },
      ltl: {
        ltlShipments: 'linkhere',
        ltlRequestPending: 'linkhere',
        ltlRequestSent: 'linkhere',
        ltlCompleted: 'linkhere'
      }
    },

    accounts: {
      productPricing: 'linkhere',
      quotes: 'linkhere',
      akonOrders: 'linkhere',
      fullyDelivered: 'linkhere',
      sage: {
        enteredInSageReports: 'linkhere',
        enteredInSage: 'linkhere',
        notInSage: 'linkhere',
        subtotalCheckPending: 'linkhere'
      }
    }
  };

  /** ----------------- Menu data using keys only ----------------- */

  const MENUS = {
    processing: {
      items: [
        { label: 'PO Pending', iconKey: 'poPending', hrefKey: 'processing.poPending', variant: 'ok' },
        { label: 'Order Pending', iconKey: 'orderPending', hrefKey: 'processing.orderPending', variant: 'ok' },
        { separator: true },
        { label: 'Confirmation Pending', iconKey: 'confirmationPending', hrefKey: 'processing.confirmationPending' }
      ]
    },

    production: {
      items: [
        { label: 'Richmond Orders', iconKey: 'richmondOrders', hrefKey: 'production.richmondOrders' },
        { label: 'Vendor Orders', iconKey: 'vendorOrders', hrefKey: 'production.vendorOrders' },
        { label: 'Hardware Orders', iconKey: 'hardwareOrders', hrefKey: 'production.hardwareOrders' },
        { label: 'USA Orders', iconKey: 'usaOrders', hrefKey: 'production.usaOrders' },
        { separator: true },
        {
          label: 'Warehouse', iconKey: 'warehouse',
          submenu: [
            { label: 'Orders to Process', iconKey: 'ordersToProcess', hrefKey: 'production.warehouse.ordersToProcess' },
            { label: 'Reviewed', iconKey: 'reviewed', hrefKey: 'production.warehouse.reviewed' },
            { label: 'On Hold', iconKey: 'onHold', hrefKey: 'production.warehouse.onHold' },
            { label: 'Cancelled', iconKey: 'cancelled', hrefKey: 'production.warehouse.cancelled' },
            { separator: true },
            { label: 'Warehouse Screens', iconKey: 'warehouseScreens', hrefKey: 'production.warehouse.warehouseScreens' },
            { label: 'Back Orders', iconKey: 'backOrders', hrefKey: 'production.warehouse.backOrders' },
            { label: 'Manual Orders Import', iconKey: 'manualOrdersImport', hrefKey: 'production.warehouse.manualOrdersImport' },
            { label: 'Production List', iconKey: 'productionList', hrefKey: 'production.warehouse.productionList' }
          ]
        },
        {
          label: 'Inventory', iconKey: 'inventory',
          submenu: [
            { label: 'Receiving', iconKey: 'receiving', hrefKey: 'production.inventory.receiving' },
            { label: 'Hardware Queue', iconKey: 'hardwareQueue', hrefKey: 'production.inventory.hardwareQueue' },
            { label: 'Strips Report', iconKey: 'stripsReport', hrefKey: 'production.inventory.stripsReport' },
            { label: 'Completed Reports', iconKey: 'completedReports', hrefKey: 'production.inventory.completedReports' },
            { label: 'Strips Scan Reports', iconKey: 'stripsScanReports', hrefKey: 'production.inventory.stripsScanReports' },
            { label: 'Hardware Scan Reports', iconKey: 'hardwareScanReports', hrefKey: 'production.inventory.hardwareScanReports' }
          ]
        }
      ]
    },

    shipping: {
      items: [
        { label: 'Upload Tracking', iconKey: 'uploadTracking', hrefKey: 'shipping.uploadTracking', variant: 'ok' },
        { separator: true },
        {
          label: 'Tracking', iconKey: 'tracking',
          submenu: [
            { label: 'Richmond Tracking', iconKey: 'richmondTracking', hrefKey: 'shipping.tracking.richmondTracking' },
            { label: 'Vendor Tracking', iconKey: 'vendorTracking', hrefKey: 'shipping.tracking.vendorTracking' },
            { separator: true },
            { label: 'UPS Tracking', iconKey: 'upsTracking', hrefKey: 'shipping.tracking.upsTracking' },
            { label: 'FedEx Tracking', iconKey: 'fedexTracking', hrefKey: 'shipping.tracking.fedexTracking' }
          ]
        },
        {
          label: 'Shipping', iconKey: 'shipping',
          submenu: [
            { label: 'Shipped', iconKey: 'shipped', hrefKey: 'shipping.shipping.shipped' },
            { label: 'Shipments in Queue', iconKey: 'shipmentsInQueue', hrefKey: 'shipping.shipping.shipmentsInQueue' },
            { label: 'Expected Shipment Pending', iconKey: 'expectedShipmentPending', hrefKey: 'shipping.shipping.expectedShipmentPending' },
            { label: 'Ship Out', iconKey: 'shipOut', hrefKey: 'shipping.shipping.shipOut' },
            { separator: true },
            { label: 'Manage Shipment Type', iconKey: 'manageShipmentType', hrefKey: 'shipping.shipping.manageShipmentType' }
          ]
        },
        { separator: true },
        {
          label: 'LTL', iconKey: 'ltl',
          submenu: [
            { label: 'LTL Shipments', iconKey: 'ltlShipments', hrefKey: 'shipping.ltl.ltlShipments' },
            { separator: true },
            { label: 'LTL Request Pending', iconKey: 'ltlRequestPending', hrefKey: 'shipping.ltl.ltlRequestPending' },
            { label: 'LTL Request Sent', iconKey: 'ltlRequestSent', hrefKey: 'shipping.ltl.ltlRequestSent' },
            { label: 'LTL Completed', iconKey: 'ltlCompleted', hrefKey: 'shipping.ltl.ltlCompleted' }
          ]
        }
      ]
    },

    accounts: {
      items: [
        { label: 'Product Pricing', iconKey: 'productPricing', hrefKey: 'accounts.productPricing' },
        { separator: true },
        { label: 'Quotes', iconKey: 'quotes', hrefKey: 'accounts.quotes' },
        { label: 'Akon Orders', iconKey: 'akonOrders', hrefKey: 'accounts.akonOrders' },
        { label: 'Fully Delivered', iconKey: 'fullyDelivered', hrefKey: 'accounts.fullyDelivered' },
        { separator: true },
        {
          label: 'Sage', iconKey: 'sage',
          submenu: [
            { label: 'Entered In Sage Reports', iconKey: 'enteredInSageReports', hrefKey: 'accounts.sage.enteredInSageReports' },
            { separator: true },
            { label: 'Entered In Sage', iconKey: 'enteredInSage', hrefKey: 'accounts.sage.enteredInSage' },
            { label: 'Not In Sage', iconKey: 'notInSage', hrefKey: 'accounts.sage.notInSage' },
            { label: 'Subtotal Check Pending', iconKey: 'subtotalCheckPending', hrefKey: 'accounts.sage.subtotalCheckPending' }
          ]
        }
      ]
    }
  };

  /** ----------------- Minimal renderer & helpers ----------------- */

  const VARIANT_CLASS = { ok: 'special', warn: 'delete' };

  const makeIcon = (svg) => {
    const wrap = document.createElement('div');
    wrap.innerHTML = (svg || '').trim();
    return wrap.firstElementChild || document.createComment('no-icon');
  };

  const topSep = () => { const d = document.createElement('div'); d.className = 'separator'; return d; };
  const listSep = () => { const li = document.createElement('li'); li.className = 'separator'; li.setAttribute('role', 'separator'); return li; };

  function attachNav(el, href, target = '_self') {
    el.dataset.url = href;
    el.addEventListener('click', (e) => {
      e.stopPropagation();
      target === '_self' ? (location.href = href) : window.open(href, target);
    });
  }

  /** Resolve iconKey/hrefKey into actual icon/href (keeps backward compatibility) */
  const getByPath = (root, path) => path?.split('.').reduce((o, k) => (o ? o[k] : undefined), root);
  function resolveKeys(items) {
    return items.map(it => {
      if (it.separator) return it;
      const out = { ...it };

      // prefer explicit icon/href; otherwise resolve from keys
      if (!out.icon) out.icon = (out.iconKey && ICONS[out.iconKey]) || ICONS.blank;
      if (!out.href && out.hrefKey) out.href = getByPath(HREFS, out.hrefKey);

      if (out.submenu) out.submenu = resolveKeys(out.submenu);
      return out;
    });
  }

  function enhanceFlyout(li) {
    li.classList.add('has-submenu');
    li.setAttribute('aria-haspopup', 'true');
    li.setAttribute('aria-expanded', 'false');
    li.tabIndex = 0;
    const open = () => { li.classList.add('open'); li.setAttribute('aria-expanded', 'true'); };
    const close = () => { li.classList.remove('open'); li.setAttribute('aria-expanded', 'false'); };
    li.addEventListener('mouseenter', open);
    li.addEventListener('mouseleave', close);
    li.addEventListener('focusin', open);
    li.addEventListener('focusout', (e) => { if (!li.contains(e.relatedTarget)) close(); });
    li.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); li.classList.contains('open') ? close() : open(); }
      if (e.key === 'Escape') close();
    });
  }

  function renderMenu(container, items) {
    container.innerHTML = '';
    const frag = document.createDocumentFragment();
    let section = document.createElement('ul');
    section.className = 'list';
    const flushSection = () => {
      if (section.children.length) frag.appendChild(section);
      section = document.createElement('ul');
      section.className = 'list';
    };

    for (const it of resolveKeys(items)) {
      if (it.separator) { flushSection(); frag.appendChild(topSep()); continue; }

      const li = document.createElement('li');
      li.className = 'element' +
        (it.submenu ? ' has-submenu' : '') +
        (it.variant && VARIANT_CLASS[it.variant] ? ` ${VARIANT_CLASS[it.variant]}` : '');

      if (it.color) li.style.color = it.color;
      if (it.icon) li.appendChild(makeIcon(it.icon));

      const label = document.createElement('p');
      label.className = 'label';
      label.textContent = it.label || '';
      li.appendChild(label);

      if (it.href) attachNav(li, it.href, it.target);

      if (it.submenu && it.submenu.length) {
        const sub = document.createElement('ul');
        sub.className = 'sublist';
        sub.setAttribute('role', 'menu');

        for (const s of it.submenu) {
          if (s.separator) { sub.appendChild(listSep()); continue; }
          const sli = document.createElement('li');
          sli.className = 'subelement';
          if (s.color) sli.style.color = s.color;
          if (s.icon) sli.appendChild(makeIcon(s.icon));
          const sp = document.createElement('p');
          sp.className = 'label';
          sp.textContent = s.label || '';
          sli.appendChild(sp);
          if (s.href) attachNav(sli, s.href, s.target);
          sub.appendChild(sli);
        }

        li.appendChild(sub);
        enhanceFlyout(li);
      }

      section.appendChild(li);
    }

    flushSection();
    container.appendChild(frag);
  }

  /** ---- Mount all configured menus by id="menu-{key}" ---- */
  function renderAll() {
    for (const [key, def] of Object.entries(MENUS)) {
      const host = document.getElementById(`menu-${key}`);
      if (host) renderMenu(host, def.items || []);
    }
  }

  /** Public API (unchanged) */
  window.NavUX = Object.assign(window.NavUX || {}, {
    setMenu: (key, items) => {
      MENUS[key] = { items };
      const host = document.getElementById(`menu-${key}`);
      if (host) renderMenu(host, items);
    },
    closeAllMenus: () => {
      document.querySelectorAll('.has-submenu.open').forEach(li => {
        li.classList.remove('open');
        li.setAttribute('aria-expanded', 'false');
      });
      document.querySelectorAll('.iconDiv[data-hasmenu][aria-expanded="true"]')
        .forEach(btn => btn.setAttribute('aria-expanded', 'false'));
    },
    menus: MENUS
  });

  /** Wire top buttons (unchanged) */
  document.querySelectorAll('.iconDiv[data-hasmenu]').forEach(btn => {
    const toggle = () => {
      const isOpen = btn.getAttribute('aria-expanded') === 'true';
      window.NavUX.closeAllMenus();
      btn.setAttribute('aria-expanded', String(!isOpen));
    };
    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); }
      if (e.key === 'Escape') btn.setAttribute('aria-expanded', 'false');
    });
  });
  document.addEventListener('click', () => window.NavUX.closeAllMenus());

  /** Initial paint */
  renderAll();
})();


 // =========               =========
 // ========= Search Hook   =========
 // =========               =========
(function wireSearchToHost() {
  const scopeEl = document.querySelector('#searchScopeForm');
  if (!scopeEl) return; // no scope menu on this page

  const scopeMap = {
    general: { url: '?p=search',          param: 'search',        extra: null },          // Broad/default
    quotes:  { url: '?p=search_quotes',   param: 'search_quotes', extra: null },          // Quotes endpoint
    account: { url: '?p=search',          param: 'search',        extra: 'Account' },
    email:   { url: '?p=search',          param: 'search',        extra: 'Email' },
    amount:  { url: '?p=search',          param: 'search',        extra: 'Amount' },
    order:   { url: '?p=search',          param: 'search',        extra: 'Order' },
    phone:   { url: '?p=search',          param: 'search',        extra: 'Phone' },
    invoice: { url: '?p=search',          param: 'search',        extra: 'Invoice' },
    po:      { url: '?p=search',          param: 'search',        extra: 'PurchaseOrder' }, // maps "po" -> PurchaseOrder
  };

  function getScope() {
    return scopeEl.querySelector('input[name="searchScope"]:checked')?.value || 'general';
  }

  function postTo(url, fields) {
    const f = document.createElement('form');
    f.method = 'POST';
    f.action = url;
    f.target = '_self';
    Object.entries(fields).forEach(([name, value]) => {
      if (value == null) return;
      const i = document.createElement('input');
      i.type = 'hidden';
      i.name = name;
      i.value = value;
      f.appendChild(i);
    });
    document.body.appendChild(f);
    f.submit();
  }

  // Handle bubbled submit from the top search input
  document.addEventListener('search:submit', (e) => {
    const query = (e.detail?.query ?? '').trim();
    if (!query) return; // ignore empty
    const sc = scopeMap[getScope()] || scopeMap.general;

    const fields = {};
    fields[sc.param] = query;                  // "search" OR "search_quotes"
    if (sc.extra) fields['extraOption'] = sc.extra; // for ?p=search when scoped

    postTo(sc.url, fields);
  });

  // Optional: submit on single Enter when focused inside the input
  const q = document.querySelector('header.menu-top .group[role="search"] input[type="search"]');
  q?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && !e.isComposing) {
      e.preventDefault();
      q.dispatchEvent(new CustomEvent('search:submit', { bubbles: true, detail: { query: q.value } }));
    }
  });
})();


