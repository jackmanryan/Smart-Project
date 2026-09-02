// ==UserScript==
// @name         fileBUBBLE
// @namespace    https://strip-curtains.com/
// @description  Shadow-DOM radial menu that runs in parallel with ExtraNav; bottom-left floating FAB + items.
// @version      0.5.0
// @match        https://*extranet.strip-curtains.com/?p=orders-view&view=*
// @match        https://extranet.strip-curtains.com//?p=orders-view&view=*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const HOST_ID = 'scx-radial-host';
  if (document.getElementById(HOST_ID)) return;

  const onReady = (fn) =>
    (document.readyState === 'loading')
      ? document.addEventListener('DOMContentLoaded', fn, { once: true })
      : fn();

  onReady(() => {
    // Host (kept small so it won't block page clicks)
    const host = document.createElement('div');
    host.id = HOST_ID;
    Object.assign(host.style, {
      position: 'fixed',
      left: '0',
      bottom: '0',
      width: '0',
      height: '0',
      zIndex: '2147483646'
    });
    document.body.appendChild(host);
    const root = host.attachShadow({ mode: 'open' });

    // ---------- CSS (scoped) ----------
    const css = `
:host{
  /* default edge offsets; override with inline style on <div id="scx-radial-host"> if needed */
  --edge-x: 19px;
  --edge-y: 19px;
  /* click-away distance */
  --rm-close-distance: 200px;
}

/* ---------- Theme tokens (mapped to your globals) ---------- */
.rm-theme {
  /* layout */
  --rm-size: var(--control-lg, 56px);
  --rm-item: var(--control-md, 44px);
  --rm-spread: var(--space-11, calc(var(--rm-item) * 2.25));
  /* color & elevation */
  --rm-fab-bg: var(--accent-2, #5353ff);
  --rm-fab-fg: var(--ink-1, #fff);
  --rm-item-bg: var(--surface-1, #1a2140);
  --rm-item-fg: var(--ink-1, #fff);
  --rm-ring: var(--border-0, #2a3460);
  --rm-shadow: var(--elev-1, 0 6px 10px rgba(0,0,0,.30));
  --rm-shadow-hover: var(--elev-2, 0 8px 15px rgba(0,0,0,.35));
  --rm-fab-bg-hover: color-mix(in oklab, var(--rm-fab-bg), #fff 12%);
  /* motion & radius */
  --rm-radius: var(--radius-full, 999px);
  --rm-t-fast: var(--t-fast, .18s);
  --rm-t-med: var(--t-med, .22s);
  --rm-focus: var(--focus-ring, 0 0 0 3px rgba(83,83,255,.5));
  /* tooltip */
  --rm-tip-bg: var(--accent-2, #5353ff);
  --rm-tip-fg: var(--ink-1, #fff);
  --rm-tip-pad: var(--space-2, 6px) var(--space-3, 10px);
  --rm-tip-radius: var(--radius-2, 6px);
  --rm-tip-shadow: var(--elev-1, 0 6px 14px rgba(0,0,0,.25));
  --rm-tip-font: var(--font-size-2, 13px);
}

/* ---------- Container (bottom-left floating) ---------- */
.radial-menu {
  position: fixed;
  left: var(--edge-x);
  bottom: var(--edge-y);
  width: var(--rm-size);
  height: var(--rm-size);
  -webkit-tap-highlight-color: transparent;
  user-select: none;
}

/* ---------- State driver ---------- */
.radial-menu__toggle {
  position: absolute; inset: 0;
  opacity: 0; pointer-events: none;
}

/* ---------- FAB ---------- */
.radial-menu__fab {
  position: absolute; inset: 0;
  display: inline-flex; align-items: center; justify-content: center;
  width: var(--rm-size); height: var(--rm-size);
  border-radius: var(--rm-radius);
  background: var(--rm-fab-bg); color: var(--rm-fab-fg);
  border: 1px solid var(--rm-ring);
  box-shadow: var(--rm-shadow);
  cursor: pointer;
  transition: transform var(--rm-t-med) ease, box-shadow var(--rm-t-med) ease, background var(--rm-t-fast) ease;
  z-index: 2; touch-action: manipulation;
}
.radial-menu__fab * { pointer-events: none; }
.radial-menu__fab:hover { background: var(--rm-fab-bg-hover); box-shadow: var(--rm-shadow-hover); }
.radial-menu__fab:active { transform: scale(.96); }
.radial-menu__fab:focus-visible { box-shadow: var(--rm-focus); }
.radial-menu__toggle:checked + .radial-menu__fab { transform: rotate(45deg) scale(.96); background: var(--rm-fab-bg-hover); }

/* ---------- Items layer ---------- */
.radial-menu__items { position: absolute; inset: 0; display: block; pointer-events: none; z-index:1; }

/* ---------- Item ---------- */
.radial-menu__item{
  --angle: 0deg;
  position: absolute; left: 50%; top: 50%;
  width: var(--rm-item); height: var(--rm-item);
  margin-left: calc(var(--rm-item)/-2); margin-top: calc(var(--rm-item)/-2);
  display: grid; place-items: center; text-decoration: none;
  border-radius: var(--rm-radius);
  border: 1px solid var(--rm-ring);
  background: var(--rm-item-bg); color: var(--rm-item-fg);
  box-shadow: var(--rm-shadow);
  cursor: pointer;
  transform: rotate(var(--angle)) translate(0) rotate(calc(var(--angle) * -1)) scale(.6);
  opacity: 0; visibility: hidden;
  transition: transform var(--rm-t-med) ease, opacity var(--rm-t-fast) ease, background var(--rm-t-fast) ease, visibility 0s linear var(--rm-t-fast);
}
.radial-menu__item:hover { background: color-mix(in oklab, var(--rm-item-bg), #fff 12%); }
.radial-menu__item:focus-visible{ outline: 3px solid color-mix(in oklab, var(--rm-fab-bg), #fff 30%); outline-offset: 2px; }

.radial-menu__toggle:checked ~ .radial-menu__items { pointer-events: auto; }
.radial-menu__toggle:checked ~ .radial-menu__items .radial-menu__item{
  transform: rotate(var(--angle)) translate(var(--rm-spread)) rotate(calc(var(--angle) * -1)) scale(1);
  opacity: 1; visibility: visible; transition-delay: 0s;
}

/* ---------- Tooltip ---------- */
.radial-menu__item[data-tip]::after{
  content: attr(data-tip);
  position: absolute; left: 50%; top: calc(-1 * var(--rm-item) - 8px);
  transform: translate(-50%, -6px) scale(.95);
  background: var(--rm-tip-bg); color: var(--rm-tip-fg);
  padding: var(--rm-tip-pad); border-radius: var(--rm-tip-radius);
  white-space: nowrap; box-shadow: var(--rm-tip-shadow);
  font-size: var(--rm-tip-font); line-height: 1.1; opacity: 0; pointer-events: none;
  transition: transform var(--rm-t-fast) ease, opacity var(--rm-t-fast) ease, top var(--rm-t-fast) ease; z-index:3;
}
.radial-menu__item[data-tip]::before{
  content: ""; position: absolute; left: 50%; top: calc(-1 * var(--rm-item) + 2px);
  transform: translateX(-50%) rotate(45deg);
  width: 8px; height: 8px; background: var(--rm-tip-bg);
  border-radius: 2px; opacity: 0; pointer-events: none;
  transition: opacity var(--rm-t-fast) ease, top var(--rm-t-fast) ease; z-index:2;
}
.radial-menu__item:hover::after, .radial-menu__item:focus-visible::after{ opacity: 1; transform: translate(-50%, -12px) scale(1); top: calc(-1 * var(--rm-item) - 12px); }
.radial-menu__item:hover::before, .radial-menu__item:focus-visible::before{ opacity: 1; top: calc(-1 * var(--rm-item) - 2px); }

/* ---------- Reduced motion ---------- */
@media (prefers-reduced-motion: reduce){
  .radial-menu__fab, .radial-menu__item, .radial-menu__item::before, .radial-menu__item::after{ transition: none !important; }
}
    `.trim();

    // ---------- Markup ----------
    const wrap = document.createElement('div');
    wrap.className = 'radial-menu rm-theme';
    wrap.setAttribute('aria-label', 'Quick actions');
    wrap.innerHTML = `
      <input id="rm-toggle" class="radial-menu__toggle" type="checkbox" autocomplete="off" />
      <label for="rm-toggle" class="radial-menu__fab" aria-label="Open menu">
        <span class="rm-icon" aria-hidden="true">
          <!-- stylized file icon (uses currentColor) -->
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" fill="none"
               stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" viewBox="0 0 24 24">
            <path d="M14 3v4a1 1 0 0 0 1 1h4"/>
            <path d="M17 21h-10a2 2 0 0 1 -2 -2v-14a2 2 0 0 1 2 -2h7l5 5v11a2 2 0 0 1 -2 2z"/>
          </svg>
        </span>
      </label>

      <nav class="radial-menu__items" aria-hidden="true">
        <!-- 12 o’clock -->
        <a class="radial-menu__item" data-tip="Download Invoice" style="--angle:-90deg" href="#">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none"
               xmlns="http://www.w3.org/2000/svg">
            <path d="M4 18.6V8.05C4 5.2 4 3.77 4.88 2.89C5.76 2 7.17 2 10 2H14C16.83 2 18.24 2 19.12 2.89C20 3.77 20 5.2 20 8.05V18.65C20 20.16 20 20.91 19.54 21.21C18.78 21.7 17.62 20.68 17.03 20.31C16.54 20 16.3 19.85 16.03 19.84C15.74 19.83 15.49 19.98 14.97 20.31L13.06 21.51C12.54 21.84 12.29 22 12 22C11.71 22 11.46 21.84 10.94 21.51L9.03 20.31C8.54 20 8.3 19.85 8.03 19.84C7.74 19.83 7.49 19.98 6.97 20.31C6.38 20.68 5.22 21.70 4.46 21.21C4 20.91 4 20.16 4 18.6Z" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/>
            <path d="M16 6H8M10 10H8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
            <path d="M12 17V11M9.5 14.5L12 17L14.5 14.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
          </svg>
        </a>

        <!-- 1:30 -->
        <a class="radial-menu__item" data-tip="Download Quote" style="--angle:-45deg" href="#">
          <svg width="25" height="24" viewBox="0 0 25 24" fill="currentColor" xmlns="http://www.w3.org/2000/svg">
            <path d="M7.45 18.18c-.23.11-.5.09-.72-.05a.75.75 0 0 1-.35-.63v-2.56C4.18 14.58 2.5 12.68 2.5 10.38 2.5 7.82 4.57 5.75 7.13 5.75s4.62 2.07 4.62 4.63c0 2.84-1.05 4.79-2.11 6.05-.53.61-1.06 1.05-1.47 1.33-.21.14-.38.24-.52.32l-.02.01-.03.01-.05.03Zm-3.45-7.80c0 1.73 1.40 3.13 3.13 3.13.41 0 .75.33.75.75v1.81c.20-.18.41-.39.62-.64.87-1 1.76-2.61 1.76-5 0-1.73-1.40-3.13-3.13-3.13S4 8.65 4 10.38z"/>
            <path d="M18.2 18.18c-.23.11-.5.09-.72-.05a.75.75 0 0 1-.35-.63v-2.56c-2.2-.36-3.88-2.27-3.88-4.57 0-2.56 2.07-4.63 4.62-4.63s4.62 2.07 4.62 4.63c0 2.84-1.05 4.79-2.12 6.05-.52.61-1.05 1.05-1.46 1.33-.22.14-.39.24-.53.32l-.02.01-.03.01-.05.03Zm-3.45-7.80c0 1.73 1.40 3.13 3.13 3.13.41 0 .75.33.75.75v1.81c.20-.18.41-.39.62-.64.87-1 1.76-2.61 1.76-5 0-1.73-1.40-3.13-3.13-3.13s-3.13 1.40-3.13 3.13Z"/>
          </svg>
        </a>

        <!-- 3 o’clock -->
        <a class="radial-menu__item" data-tip="Download Packing List" style="--angle:0deg" href="#">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"
               xmlns="http://www.w3.org/2000/svg">
            <path fill-rule="evenodd" clip-rule="evenodd"
              d="M7.246 1.25H16.754c1.022 0 1.72-.0007 2.309.2043 1.113.3872 1.977 1.2829 2.348 2.4112.20.597.20 1.307.20 2.3616v14.0041c0 1.4652-1.727 2.3375-2.864 1.2967-.08-.0721-.19-.0721-.27 0l-.483.4421c-.928.8493-2.334.8493-3.262 0-.355-.3249-.882-.3249-1.237 0-.928.8493-2.334.8493-3.262 0-.355-.3249-.882-.3249-1.237 0-.928.8493-2.335.8493-3.263 0l-.483-.4421c-.079-.0721-.191-.0721-.271 0-1.137 1.0408-2.864.1685-2.864-1.2967V6.3701c0-1.2522-.0094-1.6983.1017-2.0366.2294-.6962.7568-1.233 1.4161-1.4624.3185-.1105.7391-.121 .9601-.121zM7 6.75h.5a.75.75 0 1 1 0 1.5H7a.75.75 0 0 1 0-1.5Zm3.5 0H17a.75.75 0 1 1 0 1.5h-6.5a.75.75 0 1 1 0-1.5ZM7 10.25h.5a.75.75 0 1 1 0 1.5H7a.75.75 0 1 1 0-1.5Zm3.5 0H17a.75.75 0 1 1 0 1.5h-6.5a.75.75 0 1 1 0-1.5ZM7 13.75h.5a.75.75 0 1 1 0 1.5H7a.75.75 0 0 1 0-1.5Z"/>
          </svg>
        </a>
      </nav>
    `;

    const style = document.createElement('style');
    style.textContent = css;
    root.append(style, wrap);

    // ---------- Behavior ----------
    const $$  = (sel) => root.querySelectorAll(sel);
    const $1  = (sel) => root.querySelector(sel);
    const toggle = root.getElementById('rm-toggle');

    const closeAll = () => { if (toggle) toggle.checked = false; };

    // Start closed (also handles bfcache restores)
    window.addEventListener('DOMContentLoaded', closeAll, { once: true });
    window.addEventListener('pageshow', closeAll);

    // Click-away close (distance from FAB center > --rm-close-distance)
    const getPx = () => {
      const cs = getComputedStyle(host);
      return parseFloat(cs.getPropertyValue('--rm-close-distance')) || 200;
    };
    const center = () => {
      const fab = root.querySelector('.radial-menu__fab');
      const r = fab.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    window.addEventListener('pointerdown', (e) => {
      if (!toggle?.checked) return;
      const { x, y } = center();
      if (Math.hypot(e.clientX - x, e.clientY - y) > getPx()) closeAll();
    }, true);

    // Close on item click (after navigation is initiated)
    $$('.radial-menu__item').forEach(a => {
      a.addEventListener('click', () => { setTimeout(closeAll, 0); }, { capture: true });
    });

    // Close on SPA route changes (works with ExtraNav’s route signal)
    window.addEventListener('tm:route', closeAll);

    // ---------- Link logic ----------
    // Accept Invoice_123.pdf, Invoice-123.pdf, or Invoice 123.pdf
    const INVOICE_RX = /\/uploads\/(\d+)\/Invoice[-_ ]?(\d+)\.pdf(?:$|\?)/i;

    function findInvoiceInDom() {
      const a = [...document.querySelectorAll('a[href*="/uploads/"]')]
        .find(el => INVOICE_RX.test(el.href));
      if (!a) return null;
      const m = a.href.match(INVOICE_RX);
      return m ? { url: a.href, id: m[1], sage: m[2] } : null;
    }

    // Minimal best-effort order probe
    function getOrderBrief(){
      const idFromUrl = new URLSearchParams(location.search).get('view');
      const guesses = [
        globalThis.order,
        globalThis.currentOrder,
        globalThis.ORDER,
        globalThis.ExtraNav?.order,
        globalThis.ExtraNav?.state?.order,
        globalThis.pageState?.order
      ].filter(Boolean);
      const o = guesses.find(x => typeof x === 'object' && (('id' in x) || ('sage_sales_number' in x))) || {};
      return {
        id: o.id ?? idFromUrl ?? null,
        sage_sales_number: o.sage_sales_number ?? null
      };
    }

    function extractOrderLinks(order) {
      // Prefer authoritative OG DOM invoice link
      const dom = findInvoiceInDom();

      // Fill missing fields from DOM match when available
      const id   = order?.id ?? dom?.id ?? new URLSearchParams(location.search).get('view');
      const sage = order?.sage_sales_number ?? dom?.sage ?? null;

      // Construct fallback candidates (first will be used)
      const candidates = (id && sage)
        ? [
            `https://extranet.strip-curtains.com/uploads/${id}/Invoice_${sage}.pdf`,
            `https://extranet.strip-curtains.com/uploads/${id}/Invoice-${sage}.pdf`,
            `https://extranet.strip-curtains.com/uploads/${id}/Invoice ${sage}.pdf`
          ]
        : [];

      const invoiceUrl = dom?.url || candidates[0] || null;

      // Quote link from Order Info Panels userscript
      const quoteUrl = (typeof globalThis !== 'undefined' && globalThis.Qlink) || null;

      return { invoiceUrl, quoteUrl };
    }

    function setAnchor(sel, url){
      const a = $1(sel);
      if (!a) return;
      if (url){
        a.setAttribute('href', url);
        a.setAttribute('target', '_blank');
        a.setAttribute('rel', 'noopener');
        a.removeAttribute('aria-disabled');
        a.style.opacity = '';
        a.style.pointerEvents = '';
      } else {
        a.removeAttribute('href');
        a.setAttribute('aria-disabled', 'true');
        a.style.opacity = '.5';
        a.style.pointerEvents = 'none';
      }
    }

    function applyLinks(){
      const order = getOrderBrief();
      const { invoiceUrl, quoteUrl } = extractOrderLinks(order);
      setAnchor('.radial-menu__item[data-tip="Download Invoice"]', invoiceUrl);
      setAnchor('.radial-menu__item[data-tip="Download Quote"]',   quoteUrl);
      // Packing List: leave as-is until a rule/pattern is provided
    }

    // Run now and on common navigation hooks
    applyLinks();
    window.addEventListener('pageshow', applyLinks);
    window.addEventListener('tm:route', applyLinks);

    // React when the OG DOM injects the invoice link later
    const debounce = (fn, ms=120) => { let t; return (...args) => { clearTimeout(t); t = setTimeout(() => fn(...args), ms); }; };
    const mo = new MutationObserver(debounce(() => {
      if (findInvoiceInDom()) applyLinks();
    }, 120));
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Light re-check shortly after load to catch late globals like Qlink
    setTimeout(applyLinks, 800);
  });
})();
