// ==UserScript==
// @name         Copy Buttons
// @namespace    jack.tools
// @version      1.2
// @description  Copy button on each .panel header ONLY when the ExtraNav "Copy Buttons" switch is ON (shadow DOM). Outputs clean, ready-to-use key:value lines.
// @match        https://extranet.strip-curtains.com/*
// @run-at       document-idle
// @noframes
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const PANEL_HEADER = '.panel .panel-heading';
  const PANEL_BODY = '.panel .panel-body';
  const BTN_CLASS = 'tm-copy-btn';
  const POSREL_CLASS = 'tm-copy-posrel';
  const WRAP_CLASS = 'tm-copy-wrap';

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));

  function injectStyles() {
    if (document.getElementById('tm-copy-style')) return;
    const s = document.createElement('style');
    s.id = 'tm-copy-style';
    s.textContent = `
      .${POSREL_CLASS}{ position: relative !important; }
      .${WRAP_CLASS}{
        position:absolute; right:10px; top:50%; transform:translateY(-50%);
        display:inline-flex; gap:6px; align-items:center; z-index:2;
      }
      .${BTN_CLASS}{
        padding:2px 8px; font-size:12px; line-height:1.6;
        cursor:pointer; border:1px solid rgba(0,0,0,.25);
        border-radius:4px; background:#f7f7f7; user-select:none;
      }
      .${BTN_CLASS}[disabled]{ opacity:.6; cursor:default; }
    `;
    document.head.appendChild(s);
  }

  // ---- ExtraNav shadow DOM toggle ----
  function getNavShadowRoot() {
    const host = document.getElementById('scx-nav-host');
    return host && host.shadowRoot ? host.shadowRoot : null;
  }
  function findToggle() {
    const sr = getNavShadowRoot();
    return (
      (sr && (sr.querySelector('#st_s2') || sr.querySelector('[data-name="copy"] input[type="checkbox"]'))) ||
      document.querySelector('#st_s2') ||
      document.querySelector('[data-name="copy"] input[type="checkbox"]')
    );
  }
  const isOn = () => !!(findToggle() && findToggle().checked);

  // ---- text clean helpers ----
  function cleanInline(str) {
    return (str || '')
      .replace(/\u00A0/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function cleanBlock(str) {
    return (str || '')
      .replace(/\u00A0/g, ' ')
      .replace(/[ \t]+\n/g, '\n')
      .replace(/\n{3,}/g, '\n\n')
      .replace(/[ \t]{2,}/g, ' ')
      .trim();
  }

  function textFromNode(node) {
    // Clone and remove UI/aggressive elements
    const c = node.cloneNode(true);
    qsa('script,style,noscript,button,input,select,textarea,svg,[aria-hidden="true"]', c).forEach(el => el.remove());
    qsa(`.${WRAP_CLASS}, .${BTN_CLASS}`, c).forEach(el => el.remove());
    return c.innerText || c.textContent || '';
  }

  function getPanelTitle(panelEl) {
    const hdr = panelEl.querySelector('.panel-heading') || panelEl;
    const t = cleanInline(textFromNode(hdr));
    return t || 'Panel';
  }

  // Parse 2-column tables into key:value lines with de-duplication/numbering
  function extractKeyValues(panelEl) {
    const body = panelEl.querySelector('.panel-body') || panelEl;
    const rows = qsa('tr', body).filter(tr => tr.children && tr.children.length >= 2);
    const lines = [];
    const indexByLabel = new Map(); // label -> {count, firstIdx}

    for (const tr of rows) {
      const tds = Array.from(tr.children).filter(n => n.tagName === 'TD');
      if (tds.length < 2) continue;

      let label = cleanInline(textFromNode(tds[0])).replace(/:$/, '');
      let value = cleanBlock(textFromNode(tds[1]));

      // Drop empties and trivial placeholders
      if (!label) continue;
      if (!value || value === '-' || value === '—') continue;

      // Deduplicate: Address, Address -> Address 1 / Address 2, etc.
      const key = label;
      const entry = indexByLabel.get(key);
      if (!entry) {
        indexByLabel.set(key, { count: 1, firstIdx: lines.length });
        lines.push([label, value]);
      } else {
        entry.count += 1;
        // Retroactively rename first occurrence when we see a duplicate
        if (entry.count === 2) {
          const [oldLabel, oldVal] = lines[entry.firstIdx];
          lines[entry.firstIdx] = [`${oldLabel} 1`, oldVal];
        }
        const numbered = `${label} ${entry.count}`;
        lines.push([numbered, value]);
      }
    }
    return lines;
  }

  function formatSmart(panelEl) {
    const title = getPanelTitle(panelEl);
    const kv = extractKeyValues(panelEl);

    if (kv.length) {
      // Compose: Title first, then key:value per line
      const body = kv.map(([k, v]) => `${k}: ${cleanInline(v)}`).join('\n');
      return `${title}\n${body}`;
    }

    // Fallback: full clean text of panel
    const clone = panelEl.cloneNode(true);
    qsa('script,style,noscript,button,input,select,textarea,svg,[aria-hidden="true"]', clone).forEach(el => el.remove());
    qsa(`.${WRAP_CLASS}, .${BTN_CLASS}`, clone).forEach(el => el.remove());
    return `${title}\n${cleanBlock(clone.innerText)}`;
  }

  async function copyText(txt) {
    try {
      await navigator.clipboard.writeText(txt);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = txt;
      ta.style.position = 'fixed';
      ta.style.top = '-2000px';
      ta.setAttribute('readonly', 'readonly');
      document.body.appendChild(ta);
      ta.select();
      try { document.execCommand('copy'); } catch {}
      ta.remove();
      return true;
    }
  }

  // ---- button wiring ----
  function addButton(header) {
    if (header.dataset.tmCopyAttached === '1') return;
    header.classList.add(POSREL_CLASS);

    const wrap = document.createElement('span');
    wrap.className = WRAP_CLASS;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = BTN_CLASS;
    btn.title = 'Copy panel (smart formatted)';
    btn.textContent = 'Copy';

    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      e.preventDefault();
      const panel = header.closest('.panel');
      if (!panel) return;
      const text = formatSmart(panel);
      btn.disabled = true;
      const ok = await copyText(text);
      const prev = btn.textContent;
      btn.textContent = ok ? 'Copied' : 'Failed';
      setTimeout(() => { btn.textContent = prev; btn.disabled = false; }, 900);
    });

    wrap.appendChild(btn);
    header.appendChild(wrap);
    header.dataset.tmCopyAttached = '1';
  }

  function addButtonsEverywhere() {
    qsa(PANEL_HEADER).forEach(addButton);
  }

  function removeAllButtons() {
    qsa(`.${WRAP_CLASS}`).forEach(n => n.remove());
    qsa(PANEL_HEADER).forEach(h => {
      if (h.dataset.tmCopyAttached === '1') delete h.dataset.tmCopyAttached;
      h.classList.remove(POSREL_CLASS);
    });
  }

  // Observe dynamic panels
  let panelObserver = null;
  function startPanelObserver() {
    if (panelObserver) return;
    panelObserver = new MutationObserver((muts) => {
      if (!isOn()) return;
      for (const m of muts) {
        for (const n of m.addedNodes) {
          if (!(n instanceof Element)) continue;
          if (n.matches && n.matches(PANEL_HEADER)) addButton(n);
          qsa(PANEL_HEADER, n).forEach(addButton);
        }
      }
    });
    panelObserver.observe(document.body, { childList: true, subtree: true });
  }
  function stopPanelObserver() {
    if (panelObserver) { panelObserver.disconnect(); panelObserver = null; }
  }

  let toggleBound = false;
  function bindToggleWatcher() {
    const t = findToggle();
    if (t && !toggleBound) {
      toggleBound = true;
      t.addEventListener('change', refresh, { passive: true });
    }

    const host = document.getElementById('scx-nav-host') || document.documentElement;
    const mo = new MutationObserver(() => {
      const tt = findToggle();
      if (tt && !toggleBound) {
        toggleBound = true;
        tt.addEventListener('change', refresh, { passive: true });
        refresh();
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
    if (host && host !== document.documentElement) {
      mo.observe(host, { childList: true, subtree: true });
    }
  }

  function refresh() {
    if (isOn()) {
      injectStyles();
      addButtonsEverywhere();
      startPanelObserver();
    } else {
      stopPanelObserver();
      removeAllButtons();
    }
  }

  (async function init() {
    // wait a moment for ExtraNav to mount
    for (let i = 0; i < 50 && !getNavShadowRoot(); i++) await sleep(100);
    bindToggleWatcher();
    refresh();
  })();
})();
