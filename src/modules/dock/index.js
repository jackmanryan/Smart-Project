/**
 * SideDock — the right-hand drawer.
 *
 * The site scatters Message Center, Shipment Sources, Notes and Shipments down the page
 * as ordinary panels. This lifts each one out of the flow and into a fixed drawer on the
 * right edge, behind a vertical rail of tabs. The drawer's open/closed state and the
 * active tab are remembered per tab in sessionStorage under the legacy keys
 * `sc:rightDrawerState` and `sc:rightDrawerActiveKey`.
 *
 * Ported from legacy/userscripts/sidedock.user.js (v1.10). Differences from the original
 * are listed here rather than hidden in the code:
 *
 *  - The three private MutationObservers are gone. Panel adoption runs from
 *    `ctx.observe.onChange`, and the nav-host z-index sync runs when the host first
 *    appears via `ctx.observe.each` instead of from an attribute observer on it.
 *  - The per-mutation re-measure is throttled; unthrottled it walked the whole panel
 *    subtree for its width on every batch of DOM changes.
 *  - `hashchange` is now `ctx.route.onChange`, so a pushState navigation that lands on
 *    `#MessageCenter-Block` opens the drawer too.
 *  - The drawer talks to the Message Center module over `ctx.events` — it emits
 *    `messages:open` when it puts a thread on screen and opens itself when something
 *    else emits the same event — instead of either side reaching into the other.
 *  - The element expandos the legacy script hung off the drawer (`_setOpen`,
 *    `_outsideBound`, `_hotkeysBound`, `_zSyncBound`) are closure state here.
 */

import css from './styles.css';

/* ------------------------------------------------------------- constants */

const DRAWER_ID = 'sc-right-drawer';
const STYLE_ID = 'dock';

/** ExtraNav's shadow host. The drawer keeps its z-index in step with it. */
const NAV_HOST_ID = 'scx-nav-host';

/** The z-index SideDock shipped with, used when the nav host is absent. */
const FALLBACK_Z = 2147483000;

/** sessionStorage — per tab, as the legacy script had it. Keys verbatim. */
const STATE_KEY = 'sc:rightDrawerState';
const ACTIVE_KEY = 'sc:rightDrawerActiveKey';

const MC_KEY = 'message-center';
const MC_BLOCK = '#MessageCenter-Block';
const MC_TABLE = `${MC_BLOCK} .table`;
const MC_TBODY = `${MC_BLOCK} .table tbody`;

/** Panel headings only carry `_tm-enhanced` once the panel modules have run. */
const HEADING_SEL = '.panel-heading._tm-enhanced';

/** What can live in the drawer, in rail order. */
const PANELS = [
  {
    key: MC_KEY,
    label: 'Message Center',
    headingMatch: /message\s*center/i,
    blockSelector: MC_BLOCK,
    toolbarSelector: 'a[href*="add_conversation"]',
  },
  { key: 'shipment-sources', label: 'Shipment Sources', headingMatch: /shipment\s*sources/i, blockSelector: '#ShipmentSources-Block' },
  { key: 'notes', label: 'Notes', headingMatch: /\bnotes?:?\b/i, blockSelector: '#Notes-Block' },
  { key: 'tracking', label: 'Tracking', headingMatch: /\bshipments\b/i, blockSelector: '#Shipments-Block' },
];

/** Double-tap a letter within the threshold to toggle that tab. */
const HOTKEYS = { s: 'shipment-sources', n: 'notes', m: MC_KEY, t: 'tracking' };
const DOUBLE_TAP_MS = 1000;

/** Minimum drawer width; the Message Center table needs more room than the rest. */
const MIN_W_MC = 1100;
const MIN_W_OTHER = 820;

const MC_COLGROUP_HTML = `
    <col class="mc-col-subject">
    <col class="mc-col-reply">
    <col class="mc-col-date">
    <col class="mc-col-from">
    <col class="mc-col-to">
    <col class="mc-col-cc">
  `;

const MC_THEAD_HTML = `
      <tr>
        <th class="mc-h mc-col-subject">Subject</th>
        <th class="mc-h mc-col-reply">Reply</th>
        <th class="mc-h mc-col-date">Updated</th>
        <th class="mc-h mc-col-from">From</th>
        <th class="mc-h mc-col-to">To</th>
        <th class="mc-h mc-col-cc">CC</th>
      </tr>`;

/* --------------------------------------------------------------- storage */

/*
 * The drawer's state is per tab, so it lives in sessionStorage. Core wraps localStorage
 * and GM storage but not sessionStorage, so these two touch it directly.
 */

function readSession(key) {
  try {
    return sessionStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeSession(key, value) {
  try {
    sessionStorage.setItem(key, value);
  } catch { /* storage disabled */ }
}

/* --------------------------------------------------------------- helpers */

const wantsMessageCenterFromHash = () => /#MessageCenter-Block/i.test(location.hash || '');

const enhancedHeadings = () => Array.from(document.querySelectorAll(HEADING_SEL));

const hasPanel = (cfg) => enhancedHeadings().some((h) => cfg.headingMatch.test(h.textContent || ''));

/** Widest scrollWidth anywhere in the subtree — the table wrap is usually the deepest. */
function widest(root) {
  let w = 0;
  const stack = [root];
  while (stack.length) {
    const n = stack.pop();
    if (!n) continue;
    w = Math.max(w, n.scrollWidth || 0);
    stack.push(...n.children);
  }
  return Math.ceil(w);
}

function isInteractive(node) {
  return !!(node && node.closest && node.closest('a, button, input, select, textarea, [contenteditable]'));
}

function isEditable(node) {
  if (!node) return false;
  if (node.isContentEditable) return true;
  if (/^(INPUT|TEXTAREA|SELECT)$/.test(node.tagName || '')) return true;
  return !!(node.closest && node.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
}

/* ------------------------------------------------- Message Center layout */

/**
 * Fold the site's Message Center table into the six columns the drawer shows: the id
 * cell is dropped and Subject leads.
 *
 * Every step is guarded by a data attribute. Unguarded, this removed and re-inserted the
 * colgroup on every call, and build() runs from a document-wide observer — so those two
 * mutations retriggered the observer, which called build() again. Self-feeding.
 */
function transformMessageCenter() {
  const table = document.querySelector(MC_TABLE);
  if (!table) return;

  // Kill any extra THEADs (sticky clones cause mis-alignment)
  Array.from(table.querySelectorAll('thead')).forEach((th, i) => {
    if (i > 0) th.remove();
  });

  // Ensure a canonical COLGROUP so header/body share widths 1:1.
  let cg = table.querySelector('colgroup');
  if (!cg || !cg.dataset.mcColgroup) {
    if (cg) cg.remove();
    cg = document.createElement('colgroup');
    cg.dataset.mcColgroup = '1';
    cg.innerHTML = MC_COLGROUP_HTML;
    table.insertBefore(cg, table.firstChild);
  }

  // Ensure THEAD exists and has 6 columns matching the body
  let thead = table.tHead || table.querySelector('thead');
  if (!thead) {
    thead = document.createElement('thead');
    table.insertBefore(thead, cg.nextSibling);
  }
  if (!thead.dataset.mcTransformed) {
    thead.innerHTML = MC_THEAD_HTML;
    thead.dataset.mcTransformed = '1';
  }

  // Normalize body rows to the same 6-column order
  const tbody = table.tBodies[0] || table.querySelector('tbody');
  if (!tbody) return;

  Array.from(tbody.rows).forEach((tr) => {
    if (tr.dataset.mcTransformed) return;

    // Detail rows: keep them spanning all 6 columns
    const detail = tr.querySelector('td[colspan]');
    if (detail) {
      detail.colSpan = 6;
      tr.classList.add('mc-detail');
      tr.dataset.mcTransformed = '1';
      return;
    }

    const tds = Array.from(tr.children);
    if (tds.length < 7) {
      tr.dataset.mcTransformed = '1';
      return;
    }

    const [id, from, to, cc, subject, date, func] = tds;

    id.remove();

    tr.appendChild(subject);
    subject.className = 'mc-col-subject';
    const a = subject.querySelector('a');
    if (a) a.style.display = 'inline-block';

    tr.appendChild(func);
    func.className = 'mc-col-reply';
    tr.appendChild(date);
    date.className = 'mc-col-date';
    tr.appendChild(from);
    from.className = 'mc-col-from';
    tr.appendChild(to);
    to.className = 'mc-col-to';
    tr.appendChild(cc);
    cc.className = 'mc-col-cc';

    tr.classList.add('mc-row');
    tr.dataset.mcTransformed = '1';
  });
}

/* ----------------------------------------------------------------- drawer */

function createDock(ctx) {
  const { dom, events, log, observe, route } = ctx;

  /** The drawer element, once built. */
  let drawer = null;
  /** Was the Message Center on screen the last time we told anyone? */
  let mcOnScreen = false;

  const isOpen = () => !!drawer && !drawer.classList.contains('collapsed');
  const activeKey = () => drawer?.querySelector('.sc-rail-tab.active')?.dataset.key || null;
  const tabFor = (key) => drawer?.querySelector(`.sc-rail-tab[data-key="${key}"]`) || null;

  /* -------------------------------------------------- message center wiring */

  /**
   * Tell the Message Center module that its view just came up, once per appearance.
   * It owns what happens next; the drawer only reports what it did.
   */
  function announce(reason) {
    const visible = isOpen() && activeKey() === MC_KEY;
    if (visible === mcOnScreen) return;
    mcOnScreen = visible;
    if (visible) events.emit('messages:open', { source: 'dock', reason });
  }

  /** Open one conversation: announce it, then let the site's own toggle do the work. */
  function openConversation(link, reason) {
    if (!link) return;
    const href = link.getAttribute('href') || '';
    events.emit('messages:open', {
      source: 'dock',
      reason,
      href,
      conversation: href.startsWith('#') ? href.slice(1) : '',
    });
    link.click();
  }

  /** A whole row is a click target, except where the row already has its own control. */
  function bindRowClicks() {
    const tbody = document.querySelector(MC_TBODY);
    if (!tbody || tbody.dataset.mcBound) return;

    tbody.addEventListener(
      'click',
      (e) => {
        const tr = e.target.closest('tr.mc-row');
        if (!tr) return;
        if (isInteractive(e.target)) return;
        const link =
          tr.querySelector('.mc-col-subject a[data-toggle="collapse"][href^="#conversation"]') ||
          tr.querySelector('.mc-col-subject a');
        openConversation(link, 'row');
      },
      true,
    );

    tbody.addEventListener(
      'mouseover',
      (e) => {
        const tr = e.target.closest('tr.mc-row');
        if (tr) tr.classList.add('mc-row-hover');
      },
      true,
    );
    tbody.addEventListener(
      'mouseout',
      (e) => {
        const tr = e.target.closest('tr.mc-row');
        if (tr) tr.classList.remove('mc-row-hover');
      },
      true,
    );

    tbody.dataset.mcBound = '1';
  }

  /** One conversation on the order means nobody wants to click it open by hand. */
  function autoOpenIfSingle() {
    const tbody = document.querySelector(MC_TBODY);
    if (!tbody) return;
    const dataRows = Array.from(tbody.querySelectorAll('tr.mc-row'));
    if (dataRows.length !== 1) return;
    openConversation(dataRows[0].querySelector('.mc-col-subject a'), 'auto-single');
  }

  /* ----------------------------------------------------------- measurement */

  function resizeToContent() {
    if (!drawer) return;
    const host = drawer.querySelector('.sc-host:not([hidden])');
    const panel = host?.querySelector('.sc-drawer-panel');
    if (!panel) return;

    const isMC = host?.dataset.key === MC_KEY;
    const body = panel.querySelector('.panel-body') || panel;

    const contentW = widest(body);
    const railW = parseInt(getComputedStyle(drawer).getPropertyValue('--rail-w')) || 52;
    const maxW = Math.floor(window.innerWidth * 0.98) - railW;
    const minW = isMC ? MIN_W_MC : MIN_W_OTHER;
    const newW = Math.max(minW, Math.min(contentW, maxW));
    drawer.style.setProperty('--drawer-w', `${newW}px`);
  }

  /*
   * The legacy script re-measured on every mutation batch, and the measurement walks the
   * whole panel subtree. Throttling it keeps the same result without the per-batch walk.
   */
  const resizeSoon = dom.throttle(resizeToContent, 120);

  /* ------------------------------------------------------------- structure */

  /** Track ExtraNav's shadow host so the drawer never lands above or below the navbar. */
  function syncDrawerZ() {
    if (!drawer) return;
    const navHost = document.getElementById(NAV_HOST_ID);
    const z = navHost ? parseInt(getComputedStyle(navHost).zIndex, 10) : NaN;
    // A host with `z-index: auto` used to write the string "NaN" and be ignored; the
    // fallback below lands on the same value the stylesheet already carries.
    drawer.style.zIndex = String(Number.isFinite(z) ? z : FALLBACK_Z);
  }

  function setOpen(open, reason = 'dock') {
    if (!drawer) return;
    drawer.classList.toggle('collapsed', !open);
    writeSession(STATE_KEY, open ? 'open' : 'closed');
    drawer.querySelectorAll('.sc-rail-tab').forEach((t) => t.setAttribute('aria-expanded', String(open)));
    if (open) resizeToContent();
    announce(reason);
  }

  function ensureDrawer() {
    if (drawer && drawer.isConnected) return drawer;

    const existing = document.getElementById(DRAWER_ID);
    if (existing) {
      drawer = existing;
      return drawer;
    }

    drawer = dom.el(
      'aside',
      { id: DRAWER_ID, class: 'collapsed', role: 'complementary', 'aria-label': 'Side drawer' },
      dom.el('div', { class: 'sc-drawer-body', role: 'region' }, dom.el('div', { class: 'sc-drawer-inner' })),
      dom.el('div', { class: 'sc-rail', role: 'tablist', 'aria-orientation': 'vertical' }),
    );
    document.body.appendChild(drawer);

    syncDrawerZ();

    if (readSession(STATE_KEY) === 'open') setOpen(true, 'restore');

    // Clicking anywhere outside an open drawer closes it, before the page sees the click.
    const outside = (e) => {
      if (!drawer || drawer.classList.contains('collapsed')) return;
      if (!drawer.contains(e.target)) setOpen(false, 'outside');
    };
    document.addEventListener('mousedown', outside, true);
    document.addEventListener('touchstart', outside, true);

    return drawer;
  }

  function ensureTab(key, label) {
    const found = tabFor(key);
    if (found) return found;

    const tab = dom.el('button', {
      type: 'button',
      class: 'sc-rail-tab',
      dataset: { key },
      role: 'tab',
      title: label,
      'aria-controls': `sc-host-${key}`,
      'aria-expanded': 'false',
      onClick: () => {
        if (tab.classList.contains('active') && isOpen()) {
          setOpen(false, 'tab');
        } else {
          selectTab(key, 'tab');
          setOpen(true, 'tab');
        }
      },
    });
    tab.textContent = label;

    drawer.querySelector('.sc-rail').appendChild(tab);
    return tab;
  }

  /** Lift a page panel out of the document flow and into the drawer, once. */
  function movePanelIntoDrawer(cfg) {
    if (drawer.querySelector(`#sc-host-${cfg.key}`)) return;

    const heading = enhancedHeadings().find((h) => cfg.headingMatch.test(h.textContent || ''));
    if (!heading) return;

    const panel = heading.closest('.panel');
    if (!panel) return;

    // Remove the internal heading (we provide our own)
    const internalHeading = panel.querySelector(HEADING_SEL);
    if (internalHeading) internalHeading.remove();

    if (cfg.blockSelector) {
      const block = panel.querySelector(cfg.blockSelector);
      if (block) block.style.display = 'block';
    }

    const body = panel.querySelector('.panel-body') || panel.firstElementChild || panel;
    const actions = dom.el('div', { class: 'sc-panel-actions' });
    const head = dom.el('div', { class: 'sc-panel-header' }, dom.el('div', { class: 'sc-panel-title' }, cfg.label), actions);
    // `body` is normally a child of the panel; when the fallback above picked the panel
    // itself there is nothing to insert before, so the header goes first either way.
    panel.insertBefore(head, body.parentNode === panel ? body : panel.firstChild);

    if (cfg.toolbarSelector) {
      const tool = heading.querySelector(cfg.toolbarSelector);
      if (tool) actions.appendChild(tool.cloneNode(true));
    }

    const host = dom.el('section', { id: `sc-host-${cfg.key}`, class: 'sc-host', dataset: { key: cfg.key }, role: 'tabpanel' });

    panel.dataset.drawerized = '1';
    panel.classList.add('sc-drawer-panel');
    host.appendChild(panel);
    drawer.querySelector('.sc-drawer-inner').appendChild(host);
  }

  function selectTab(key, reason = 'dock') {
    if (!drawer) return;

    drawer.querySelectorAll('.sc-rail-tab').forEach((btn) => {
      const active = btn.dataset.key === key;
      btn.classList.toggle('active', active);
      btn.setAttribute('aria-selected', String(active));
    });
    drawer.querySelectorAll('.sc-host').forEach((host) => {
      host.toggleAttribute('hidden', host.dataset.key !== key);
    });
    writeSession(ACTIVE_KEY, key);

    // The panel is only laid out after this frame, so measure and wire it on the next.
    setTimeout(() => {
      if (key === MC_KEY) {
        transformMessageCenter();
        bindRowClicks();
        autoOpenIfSingle();
      }
      resizeToContent();
    }, 0);

    announce(reason);
  }

  /* ----------------------------------------------------------------- build */

  /**
   * Adopt whatever panels this page has. Adoption strips the panel's own heading, so a
   * panel already in the drawer no longer matches and later passes fall straight out —
   * which is what keeps this cheap when it runs from the document observer.
   */
  function build() {
    ensureDrawer();

    const available = [];
    for (const cfg of PANELS) {
      if (!hasPanel(cfg)) continue;
      available.push(cfg.key);
      ensureTab(cfg.key, cfg.label);
      movePanelIntoDrawer(cfg);
    }
    if (!available.length) return;

    transformMessageCenter();
    bindRowClicks();

    const preferMC = wantsMessageCenterFromHash() && available.includes(MC_KEY);
    const wanted = preferMC ? MC_KEY : readSession(ACTIVE_KEY) || available[0];
    selectTab(available.includes(wanted) ? wanted : available[0], preferMC ? 'hash' : 'restore');

    const shouldOpen = preferMC || readSession(STATE_KEY) === 'open';
    setOpen(shouldOpen, preferMC ? 'hash' : 'restore');

    // Deliberately keyed off `wanted` rather than the tab that was actually selected,
    // as the legacy script had it: a stored key for a panel this page lacks does not
    // auto-open the first panel's single conversation.
    if (shouldOpen && wanted === MC_KEY) autoOpenIfSingle();

    setTimeout(resizeToContent, 0);
  }

  /* --------------------------------------------------------------- hotkeys */

  function toggleTarget(key) {
    const target = HOTKEYS[key];
    if (!target || !tabFor(target)) return;

    if (isOpen() && activeKey() === target) {
      setOpen(false, 'hotkey');
    } else {
      selectTab(target, 'hotkey');
      setOpen(true, 'hotkey');
    }
  }

  function registerDoubleTapHotkeys() {
    let lastKey = '';
    let lastTime = 0;
    let timer = null;

    document.addEventListener(
      'keydown',
      (e) => {
        if (e.defaultPrevented || e.ctrlKey || e.altKey || e.metaKey) return;
        if (isEditable(e.target)) return;
        const k = (e.key || '').toLowerCase();
        if (!HOTKEYS[k]) return;

        const now = Date.now();
        if (lastKey === k && now - lastTime <= DOUBLE_TAP_MS) {
          toggleTarget(k);
          lastKey = '';
          lastTime = 0;
          if (timer) {
            clearTimeout(timer);
            timer = null;
          }
          e.preventDefault();
          return;
        }
        lastKey = k;
        lastTime = now;
        if (timer) clearTimeout(timer);
        timer = setTimeout(() => {
          lastKey = '';
        }, DOUBLE_TAP_MS);
      },
      true,
    );
  }

  /* ------------------------------------------------------------------ start */

  return {
    start() {
      build();
      registerDoubleTapHotkeys();

      // Panels arrive late and the site re-renders them; adopt whatever shows up.
      observe.onChange(() => {
        build();
        resizeSoon();
      });

      // ExtraNav mounts its host after us on a cold load.
      observe.each(`#${NAV_HOST_ID}`, syncDrawerZ);

      window.addEventListener('resize', resizeToContent, { passive: true });

      // `?…#MessageCenter-Block` is how the rest of the tooling links straight to a
      // conversation list. The target tab is not checked here, as in the legacy script.
      route.onChange(() => {
        if (!wantsMessageCenterFromHash()) return;
        selectTab(MC_KEY, 'hash');
        setOpen(true, 'hash');
      });

      // The other direction: the Message Center module (or anything else) asks for the
      // conversation list, and the drawer puts it on screen.
      events.on('messages:open', (detail) => {
        if (detail && detail.source === 'dock') return; // our own signal, coming back
        if (!tabFor(MC_KEY)) return;
        mcOnScreen = true; // it asked for this, so do not echo the event back at it
        selectTab(MC_KEY, 'request');
        setOpen(true, 'request');
      });

      log.debug('loaded');
    },
  };
}

/* ---------------------------------------------------------------- module */

export default {
  id: 'dock',
  title: 'Side dock',
  runAt: 'end',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    ctx.style.add(css, { id: STYLE_ID });
    createDock(ctx).start();
  },
};
