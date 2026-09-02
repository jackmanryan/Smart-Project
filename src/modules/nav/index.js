/**
 * ExtraNav — the floating overlay navbar, and the page it has to make room for.
 *
 * The legacy script fetched ExtraNav.html, ExtraNav.css and nav-ux.js from jsDelivr with
 * GM_xmlhttpRequest on every page load, then evaluated nav-ux.js through a
 * `document`/`window` Proxy so its bare `document.querySelector` calls would land inside
 * the shadow root. All three files now ship inside the bundle as text imports, nav-ux is
 * a sibling ES module that takes the shadow root as an argument, and the CDN — which the
 * bundle's `@connect` no longer even allows — is out of the picture.
 *
 * What the module does, in the order it does it (the order matters):
 *   1. lifts the site's Message Center link out of the navbar before deleting the navbar,
 *      keeping the live node so the site's own JS can carry on updating its badge;
 *   2. removes the legacy header and sidebar and re-styles the page underneath;
 *   3. rewrites the Packages table into the four-column v3.1 layout;
 *   4. mounts the menubar in a shadow root on #scx-nav-host, above everything, with
 *      pointer events passing straight through the parts of the strip that are empty.
 *
 * Ported from legacy/userscripts/extranav-navbar-main-style.user.js (v1.3.4).
 */

import navHtml from './ExtraNav.html';
import navCss from './ExtraNav.css';
import navIconSvg from './sc_icon.svg';
import pageCss from './styles.css';
import passthruCss from './passthru.css';
import { mountNavUx } from './nav-ux.js';

/* ---------------------------------------------------------------- config */

const HOST_ID = 'scx-nav-host';
const DOCK_ID = 'mc-dock';
const WRAPPER_ID = 'wrapper';

/** The exact element.style #mc-dock is meant to carry, and nothing else. */
const DOCK_STYLE = 'position: fixed; top: 28px; right: 610px;';

/** Fallback for the host's z-index when the computed value cannot be read. */
const HOST_Z_FALLBACK = 2147483647;

/** NodeFilter.SHOW_TEXT, read off window so the module stays lint-clean. */
const SHOW_TEXT = window.NodeFilter ? window.NodeFilter.SHOW_TEXT : 4;

/**
 * ExtraNav.css is authored against a document. Inside a shadow root `:root`, `html` and
 * `body` match nothing, so they all become `:host` — the same rewrite the legacy script
 * did before injecting it.
 */
const adaptCssForShadow = (css) =>
  css
    .replace(/:root\b/g, ':host')
    .replace(/(^|[\s,{])html\b/g, '$1:host')
    .replace(/(^|[\s,{])body\b/g, '$1:host');

/* ------------------------------------------------------- message centre */

/**
 * Move the Message Center link out of the navbar before the navbar is deleted.
 * The node itself is moved rather than copied, so any site JS that updates the unread
 * badge still finds the element it expects.
 */
function preserveMessageCenter() {
  const nav = document.querySelector('nav.navbar.navbar-default.navbar-static-top');
  if (!nav) return;
  const a = nav.querySelector('a[href="/?p=messagecenter"]');
  if (!a) return;
  const keep = a.closest('li') || a; // keep the whole <li> if present

  if (keep.parentNode) keep.parentNode.removeChild(keep);
  const dock =
    document.getElementById(DOCK_ID) ||
    Object.assign(document.createElement('div'), { id: DOCK_ID });
  Object.assign(dock.style, {
    position: 'fixed',
    top: '8px',
    right: '12px',
    zIndex: 2147483648,
    pointerEvents: 'auto',
  });
  dock.innerHTML = '';
  dock.appendChild(keep);
  document.body.appendChild(dock);
}

/* --------------------------------------------------------------- mc-dock */

/** Strip the flashing envelope icon and the stray ::marker text the site leaves behind. */
function sanitizeDock(dock) {
  if (!dock) return;

  // 1) the flashing envelope span (the one wrapping <i class="fa fa-envelope ...">)
  const iconSpan = dock.querySelector('span i.fa.fa-envelope')?.closest('span');
  if (iconSpan) iconSpan.remove();

  // 2) literal "<::marker></::marker>" text nodes (copy/paste artefacts in the source)
  const walker = document.createTreeWalker(dock, SHOW_TEXT, null, false);
  const doomed = [];
  while (walker.nextNode()) {
    const t = walker.currentNode;
    if (String(t.nodeValue).replace(/\s+/g, '').toLowerCase().includes('<::marker></::marker>')) {
      doomed.push(t);
    }
  }
  doomed.forEach((n) => n.parentNode && n.parentNode.removeChild(n));

  // 3) stop list bullets on the docked <li> without affecting other lists
  dock.querySelectorAll('li').forEach((li) => {
    li.style.listStyle = 'none';
    li.style.padding = '0';
    li.style.margin = '0';
  });
}

/** Re-create the Message Center anchor and its count badge if the site dropped them. */
function ensureDockContent(dock) {
  let a = dock.querySelector('a[href="/?p=messagecenter"]');
  if (a) return;

  const li = dock.querySelector('li') || dock.appendChild(document.createElement('li'));
  a = document.createElement('a');
  a.href = '/?p=messagecenter';
  li.innerHTML = '';
  li.appendChild(a);

  const badge = document.createElement('span');
  badge.textContent = '0';
  badge.style.cssText = [
    'width:25px', 'height:25px', 'background-color:#FF2F02', 'color:#fff', 'padding:3px',
    'border-radius:15px', 'float:left', 'text-align:center', 'margin:3px 5px 0 0',
  ].join(';');
  a.appendChild(badge);
}

/** Place #mc-dock immediately before #wrapper in DOM order. */
function placeBeforeWrapper(dock) {
  const wrapper = document.getElementById(WRAPPER_ID);
  if (wrapper?.parentNode && dock) {
    if (dock.nextSibling !== wrapper || dock.parentNode !== wrapper.parentNode) {
      wrapper.parentNode.insertBefore(dock, wrapper);
    }
  } else if (dock && !dock.parentNode) {
    document.body.appendChild(dock); // wrapper not present yet
  }
}

/**
 * Keep the docked Message Center bubble correct: create it if it is missing, clean it,
 * pin its inline style and put it back in front of #wrapper after an SPA re-render.
 *
 * Every write is conditional. The legacy version rewrote the style attribute on every
 * pass, which its own observer then saw as a change, so it looped against itself for as
 * long as the page was open.
 */
function manageMcDock(ctx) {
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
    ensureDockContent(dock);
    sanitizeDock(dock);
    if (dock.getAttribute('style') !== DOCK_STYLE) dock.style.cssText = DOCK_STYLE;
    placeBeforeWrapper(dock);
  }

  applyOnce();
  ctx.observe.onChange(applyOnce); // the app re-renders the header on SPA navigation
}

/* ------------------------------------------------------- page furniture */

/** Delete the legacy header and sidebar, and stop the wrapper indenting for them. */
function removeLegacyChrome() {
  document.querySelectorAll('nav.navbar.navbar-default.navbar-static-top').forEach((n) => n.remove());
  const side = document.querySelector('.navbar-default.sidebar.mainmenu');
  if (side) side.remove();
  const pageWrapper = document.getElementById('page-wrapper');
  if (pageWrapper) pageWrapper.style.marginLeft = '0';
}

/**
 * Give the Order Timeline panel an id, so the timeline CSS can be scoped to it instead of
 * styling every .panel on the page.
 */
function scopeOrderTimeline(ctx) {
  const attach = () => {
    const heading = ctx.dom
      .$$('.panel.panel-default .panel-heading')
      .find((h) => /Order\s*Timeline/i.test(h.textContent || ''));
    if (!heading) return false;
    const panel = heading.closest('.panel.panel-default');
    if (!panel) return false;
    if (panel.id !== 'order-timeline') panel.id = 'order-timeline';
    return true;
  };

  if (!attach()) {
    const stop = ctx.observe.onChange(() => {
      if (attach()) stop();
    });
  }
  ctx.route.onChange(attach);
}

/* ------------------------------------------------- packages table v3.1 */

/** Rewrite #Packages-Block's table into the four-column layout (box, items, tracking, dates). */
function upgradePackagesTable(ctx) {
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
    const stop = ctx.observe.onChange(() => {
      if (transform()) stop();
    });
  }
  ctx.route.onChange(() => transform()); // reattempt after an SPA route
}

/* -------------------------------------------------------- modal safety */

/**
 * Lift anything dialog-ish above the navbar and give it back its normal behaviour.
 *
 * The global "centre every panel heading" rules make a real dialog unusable — its close
 * button stops floating right and its header stops being a drag handle — so a panel that
 * behaves like a dialog is tagged .scx-modal-safe, which opts it out of those rules in
 * styles.css, and is raised above the shadow host.
 */
function installModalSafety(ctx, host) {
  const getHostZ = () => {
    const z = parseInt(getComputedStyle(host).zIndex || String(HOST_Z_FALLBACK), 10);
    return Number.isFinite(z) ? z : HOST_Z_FALLBACK;
  };

  /**
   * Is this panel acting like an interactive modal / compose box? We look for the
   * obvious compose-and-send parts: a file input, #addNew, textarea#message and friends.
   */
  function looksInteractivePanel(panelEl) {
    if (!panelEl) return false;
    if (panelEl.classList.contains('scx-modal-safe')) return true; // already tagged

    const hasSubmitBtn = panelEl.querySelector('#addNew, button[id="addNew"], button.btn-success');
    const hasMessageBox = panelEl.querySelector('textarea#message, textarea[name="message"]');
    const hasFileInput = panelEl.querySelector('input[type="file"]');
    const hasUploadForm = panelEl.querySelector('form#uploadfiles');
    const hasToSelect = panelEl.querySelector('select#to, select[name="to"]');

    return !!(hasSubmitBtn || hasMessageBox || hasFileInput || hasUploadForm || hasToSelect);
  }

  /** Tag and raise a root element (a real .modal, or a panel standing in for one). */
  function tagModalScope(modEl, dlgZ, bgZ) {
    if (!modEl) return;

    // z-index only applies to a positioned element.
    if (getComputedStyle(modEl).position === 'static') modEl.style.position = 'relative';

    modEl.style.zIndex = String(dlgZ);
    modEl.style.pointerEvents = 'auto';
    modEl.classList.add('scx-modal-safe');

    // Tag the obvious children too, so the CSS override reaches .panel-heading/.panel-body
    modEl.querySelectorAll('.panel, .panel-heading, .panel-body').forEach((n) => {
      n.classList.add('scx-modal-safe');
      if (getComputedStyle(n).position === 'static') n.style.position = 'relative';
      n.style.zIndex = String(dlgZ);
      n.style.pointerEvents = 'auto';
    });

    // A Bootstrap or jQuery UI backdrop floats just under the dialog.
    document.querySelectorAll('.modal-backdrop, .ui-widget-overlay, .ui-dialog-overlay').forEach((bg) => {
      if (getComputedStyle(bg).position === 'static') {
        bg.style.position = 'fixed'; // a backdrop should cover the viewport
        bg.style.inset = '0';
      }
      bg.style.zIndex = String(bgZ);
      bg.style.pointerEvents = 'auto';
    });
  }

  function boostModals(root = document) {
    const baseZ = getHostZ();
    const dlgZ = baseZ + 2; // the dialog itself, and our interactive panels
    const bgZ = baseZ + 1; // its backdrop, when there is one

    // 1. Real modals / dialogs (Bootstrap, jQuery UI, role="dialog")
    root
      .querySelectorAll('.modal, .ui-dialog, [role="dialog"], .ui-widget.ui-widget-content')
      .forEach((modEl) => tagModalScope(modEl, dlgZ, bgZ));

    // 2. The standalone compose panel case (the Add Conversation page): a .panel that
    //    looks like a compose/send form is treated as the dialog root.
    root.querySelectorAll('.panel.panel-default').forEach((panelEl) => {
      if (panelEl.classList.contains('scx-modal-safe') || !looksInteractivePanel(panelEl)) return;
      tagModalScope(panelEl, dlgZ, bgZ);

      // Bring its row/column wrapper up too, so nothing else on that mini-page sits
      // above it.
      const rowWrap = panelEl.closest('.row, .col-lg-12, body');
      if (rowWrap && !rowWrap.classList.contains('scx-modal-safe')) {
        if (getComputedStyle(rowWrap).position === 'static') rowWrap.style.position = 'relative';
        rowWrap.style.zIndex = String(dlgZ);
        rowWrap.style.pointerEvents = 'auto';
        rowWrap.classList.add('scx-modal-safe');
      }
    });
  }

  boostModals();
  ctx.observe.onChange(() => boostModals());
  ctx.route.onChange(() => boostModals());

  // Was window.SCX_fixModalsNow.
  ctx.events.on('nav:fix-modals', () => boostModals());
}

/* ------------------------------------------------------------ shadow host */

/** The fixed strip the menubar lives in, and the shadow root inside it. */
function createShadowHost(ctx) {
  const host = ctx.dom.el('div', {
    id: HOST_ID,
    style: { position: 'fixed', top: '0', left: '0', right: '0', zIndex: String(HOST_Z_FALLBACK) },
  });
  document.body.prepend(host);
  return { host, shadow: host.attachShadow({ mode: 'open' }) };
}

/**
 * Publish the host's stacking level as --mc-dock-z, one step above it, so the Message
 * Center bubble stays clickable over the navbar. styles.css consumes the variable; the
 * dock's own element.style is left alone.
 */
function syncDockZ(host) {
  const z = parseInt(getComputedStyle(host).zIndex || String(HOST_Z_FALLBACK), 10);
  const next = String((Number.isFinite(z) ? z : HOST_Z_FALLBACK) + 1);
  if (document.documentElement.style.getPropertyValue('--mc-dock-z') !== next) {
    document.documentElement.style.setProperty('--mc-dock-z', next);
  }
}

/** Mirror the document's theme attributes onto the host, so the shadow CSS can see them. */
function mirrorThemeAttrs(ctx, host) {
  const syncAttrs = () =>
    ['data-theme', 'data-sexy'].forEach((a) => {
      const v = document.documentElement.getAttribute(a);
      if (v === null) host.removeAttribute(a);
      else host.setAttribute(a, v);
    });

  syncAttrs();
  ctx.theme.onChange(syncAttrs);
  ctx.events.on('nav:host-attrs', syncAttrs); // nav-ux flipping data-sexy
  ctx.route.onChange(syncAttrs);
}

/* ---------------------------------------------------------- new-tab clicks */

/**
 * Middle click and Ctrl/Cmd + click open a link in a new tab, including links that are
 * only links by convention ([data-href], [data-url], role="link") and links inside the
 * shadow root, where the browser's own handling never sees a real anchor.
 */
function enableNewTabClicks(root = document) {
  const SKIP = /^(javascript:|data:|mailto:|tel:|blob:)/i;

  const closestLink = (node) =>
    node?.closest?.('a[href], [role="link"][href], [data-href], [data-url]') || null;

  const getHref = (el) => {
    if (!el) return null;
    const raw = el.getAttribute?.('href') ?? el.getAttribute?.('data-href') ?? el.getAttribute?.('data-url');
    if (!raw || SKIP.test(raw)) return null;
    try {
      return new URL(raw, location.href).href;
    } catch {
      return null;
    }
  };

  const openBlank = (href) => window.open(href, '_blank', 'noopener,noreferrer');

  if (!root?.addEventListener) return;

  // Middle click
  root.addEventListener(
    'auxclick',
    (e) => {
      if (e.button !== 1) return;
      const href = getHref(closestLink(e.target));
      if (!href) return;
      e.preventDefault();
      e.stopPropagation();
      openBlank(href);
    },
    true,
  );

  // Ctrl/Cmd + left click
  root.addEventListener(
    'click',
    (e) => {
      if (e.button !== 0 || !(e.ctrlKey || e.metaKey)) return;
      const href = getHref(closestLink(e.target));
      if (!href) return;
      e.preventDefault();
      e.stopPropagation();
      openBlank(href);
    },
    true,
  );
}

/* ------------------------------------------------------------------ fonts */

/** Best effort; the stack in the CSS falls back to system fonts if this never lands. */
function loadFonts() {
  document.head.append(
    Object.assign(document.createElement('link'), {
      rel: 'preconnect',
      href: 'https://fonts.gstatic.com',
      crossOrigin: 'anonymous',
    }),
    Object.assign(document.createElement('link'), {
      rel: 'stylesheet',
      href: 'https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&display=swap',
    }),
  );
}

/* ----------------------------------------------------------------- menubar */

/** Put the markup, the stylesheet and the behaviour into the shadow root. */
function mountMenubar(ctx, host, shadow) {
  // Pass-through first: it is the weakest sheet, and everything after it may override.
  ctx.style.addToShadow(shadow, passthruCss, { id: 'nav-passthru' });

  loadFonts();

  const parsed = new DOMParser().parseFromString(navHtml, 'text/html');
  const header = parsed.querySelector('header.menu-top');
  if (!header) {
    ctx.log.error('ExtraNav.html has no header.menu-top; the navbar cannot mount');
    return;
  }

  // The logo used to be pulled from the CDN on every page load; it ships with the bundle.
  const logo = header.querySelector('img.xs-icon');
  if (logo) logo.setAttribute('src', `data:image/svg+xml;utf8,${encodeURIComponent(navIconSvg)}`);

  shadow.appendChild(header);
  ctx.style.addToShadow(shadow, adaptCssForShadow(navCss), { id: 'nav-extranav' });

  mirrorThemeAttrs(ctx, host);

  ctx.log.guard(() => mountNavUx(shadow, ctx));

  enableNewTabClicks(document);
  enableNewTabClicks(shadow);
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'nav',
  title: 'ExtraNav navbar',
  runAt: 'end',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    // Order matters: the Message Center link has to be rescued before the navbar that
    // holds it is deleted.
    preserveMessageCenter();
    manageMcDock(ctx);
    removeLegacyChrome();
    scopeOrderTimeline(ctx);

    ctx.style.add(pageCss, { id: 'nav' });

    upgradePackagesTable(ctx);

    const { host, shadow } = createShadowHost(ctx);
    syncDockZ(host);
    ctx.route.onChange(() => syncDockZ(host));

    installModalSafety(ctx, host);
    mountMenubar(ctx, host, shadow);
  },
};
