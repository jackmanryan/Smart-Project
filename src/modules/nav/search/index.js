/**
 * Legacy Form — the search box that lives in the ExtraNav header.
 *
 * Three things ship together here, because they are one feature from the user's side:
 *
 *   1. The box itself, mounted inside the nav's shadow root. If the nav never appears,
 *      it falls back to a fixed overlay so search is never simply missing.
 *   2. The single-result fast path. On submit the search is POSTed in the background;
 *      when the results hold exactly one order we jump straight to that order and the
 *      intermediate results page is never painted. Anything else submits normally.
 *   3. The Gmail hand-off. The Gmail bridge opens `?p=search#autosearch=1&q=…`, which is
 *      handled before any UI is built, and the `tmx:auto-open-from-gmail` session gate
 *      then opens the first order link on whatever list page the site does return.
 *
 * Ported from legacy/userscripts/legacy-form-consolidated-and-hardened.user.js (v2.0.0).
 * The two globals it set (`__tmxLegacyFormMounted`, `_tmxLegacyForm`) are gone; the mount
 * guard is the module-scoped `mounted` below.
 */

import css from './styles.css';

/* ---------------------------------------------------------------- config */

const SEARCH_ACTION = 'https://extranet.strip-curtains.com/?p=search';

/** sessionStorage gate, set when a search is driven from Gmail. Legacy key, verbatim. */
const AUTO_FLAG_KEY = 'tmx:auto-open-from-gmail';

/** localStorage: the extraOption the user last searched with. Legacy key, verbatim. */
const LAST_EXTRA_KEY = 'tmx:search:extra';

/** Order links on a results/list page. `orders-view-test` is a different screen. */
const ORDER_LINK_SEL = 'a[href*="?p=orders-view"][href*="view="]:not([href*="orders-view-test"])';

const NAV_HOST_ID = 'scx-nav-host';
const NAV_HEADER_SEL = 'header.menu-top';
const SLOT_SEL = '.tmx-slot';

const TIMEOUT_MS = 15000;
const POLL_MS = 150;

const STYLE_ID = 'nav-search';

/** Tag on the loader events this module emits. Kept from the legacy script. */
const LOADING_SOURCE = 'legacy-form';

/** The extraOption values the site's search accepts, in the order it lists them. */
const OPTIONS = [
  { value: '---', label: '---' },
  { value: 'Account', label: 'Account' },
  { value: 'Broad', label: 'Broad' },
  { value: 'Email', label: 'Email' },
  { value: 'Amount', label: 'Amount' },
  { value: 'Order', label: 'Order' },
  { value: 'Phone', label: 'Phone' },
  { value: 'Invoice', label: 'Invoice' },
  { value: 'Purchase Order', label: 'Purchase Order' },
];

const SEARCH_ICON = `
  <svg viewBox="0 0 32 32" fill="currentColor" stroke="currentColor" aria-hidden="true" focusable="false">
    <polygon points="30 6 26 6 26 2 24 2 24 6 20 6 20 8 24 8 24 12 26 12 26 8 30 8 30 6"></polygon>
    <path d="M24,28.5859l-5.9751-5.9751a9.0234,9.0234,0,1,0-1.4141,1.4141L22.5859,30ZM4,17a7,7,0,1,1,7,7A7.0078,7.0078,0,0,1,4,17Z"></path>
  </svg>
`;

/** One search box per document; replaces the legacy `window.__tmxLegacyFormMounted`. */
let mounted = false;

/* --------------------------------------------------------------- storage */

/*
 * The Gmail gate is per-tab, so it lives in sessionStorage — core wraps localStorage and
 * GM storage but not sessionStorage, so these three touch it directly.
 */

function readAutoFlag() {
  try {
    return sessionStorage.getItem(AUTO_FLAG_KEY);
  } catch {
    return null;
  }
}

function setAutoFlag() {
  try {
    sessionStorage.setItem(AUTO_FLAG_KEY, '1');
  } catch { /* private mode or a full quota */ }
}

function clearAutoFlag() {
  try {
    sessionStorage.removeItem(AUTO_FLAG_KEY);
  } catch { /* nothing to clear */ }
}

/* ---------------------------------------------------------------- loader */

const emitLoading = (ctx, state) => ctx.events.emit('hamilton:loading', { state, source: LOADING_SOURCE });

function startLoadingUI(ctx, slot) {
  slot?.setAttribute('data-loading', '1');
  slot?.querySelector('.input')?.setAttribute('aria-busy', 'true');
  emitLoading(ctx, 'start');
}

function stopLoadingUI(ctx, slot) {
  slot?.removeAttribute('data-loading');
  slot?.querySelector('.input')?.removeAttribute('aria-busy');
  emitLoading(ctx, 'stop');
}

/* ------------------------------------------------------------ fast path */

/** `#autosearch=1&q=…&extra=…`, the hand-off the Gmail bridge writes. */
function parseAutoSearchFromHash() {
  const raw = location.hash ? location.hash.replace(/^#/, '') : '';
  if (!raw) return null;
  const params = new URLSearchParams(raw);
  if (params.get('autosearch') !== '1') return null;
  return { q: params.get('q') || '', extra: params.get('extra') || '---' };
}

/** Every distinct order URL in a results page, in document order. */
function uniqueOrderUrls(html) {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const urls = [];
  const seen = new Set();
  for (const a of doc.querySelectorAll(ORDER_LINK_SEL)) {
    const raw = a.getAttribute('href') || a.href || '';
    if (!raw) continue;
    const url = new URL(raw, location.origin);
    const id = url.searchParams.get('view') || url.toString();
    if (seen.has(id)) continue;
    seen.add(id);
    urls.push(url.toString());
  }
  return urls;
}

/**
 * Run the search server-side and, when it resolves to exactly one order, go there.
 *
 * Returns the URL instead of navigating when `returnUrl` is set (the new-tab path), and
 * false/null when the search was not a single hit, so the caller can submit normally.
 */
async function tryFastSearchNavigate(ctx, q, extra, { returnUrl = false } = {}) {
  const miss = returnUrl ? null : false;
  try {
    const res = await ctx.net.request(SEARCH_ACTION, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded;charset=UTF-8' },
      body: new URLSearchParams({ search: q, extraOption: extra }).toString(),
      timeoutMs: TIMEOUT_MS,
    });
    if (res.status < 200 || res.status >= 300) return miss;

    const urls = uniqueOrderUrls(res.text || '');
    if (urls.length !== 1) return miss;

    clearAutoFlag();
    if (returnUrl) return urls[0];

    // Keep the previous page in history (Back returns there) and skip the search page.
    try {
      history.pushState({ from: 'legacy-form' }, '', location.href);
    } catch { /* history can be denied */ }
    location.replace(urls[0]);
    return true;
  } catch {
    return miss;
  }
}

/**
 * The `#autosearch` route: search before anything is mounted, and never build the UI.
 * The loader is told to stay up because either branch ends in a navigation.
 */
async function runAutoSearch(ctx, seed) {
  setAutoFlag();
  emitLoading(ctx, 'start');

  if (await tryFastSearchNavigate(ctx, seed.q, seed.extra)) return;

  // Not a single hit: drop the hash so a reload does not search again, then post the
  // search the plain way and let the site render its results page.
  history.replaceState(null, '', location.pathname + location.search);
  const form = ctx.dom.el(
    'form',
    { action: SEARCH_ACTION, method: 'post', target: '_self' },
    ctx.dom.el('input', { type: 'hidden', name: 'search', value: seed.q }),
    ctx.dom.el('input', { type: 'hidden', name: 'extraOption', value: seed.extra || '---' }),
  );
  document.documentElement.append(form);
  form.submit();
}

/* --------------------------------------------------------- Gmail hand-off */

/** Follow the first order link on the page, if there is one. */
function openFirstOrderLink() {
  const a = document.querySelector(ORDER_LINK_SEL);
  const href = a?.getAttribute('href') || '';
  if (!href) return false;
  clearAutoFlag();
  location.replace(href);
  return true;
}

/**
 * When the gate is set, the user came from Gmail expecting an order, not a list. Open
 * the first order link as soon as one exists; give up with the page as it is after the
 * timeout.
 */
async function autoOpenFromGmail(ctx) {
  // Already on an order: the jump has happened, so the gate has done its job.
  if (ctx.page.id.startsWith('orders-view')) {
    clearAutoFlag();
    return;
  }

  if (readAutoFlag() !== '1') return;
  if (openFirstOrderLink()) return;

  const link = await ctx.observe.ready(ORDER_LINK_SEL, { timeout: TIMEOUT_MS });
  if (link) openFirstOrderLink();
}

/* ------------------------------------------------------------------- UI */

/**
 * Submit handling: try the fast path first, fall back to a native submit.
 *
 * `__tmxNewTabIntent` is read by the loader module, which uses it to stay down for a
 * submit that is going to a new tab, so the flag stays on the form element.
 */
function wireSingleResultFastPath(ctx, form, inputEl, selectEl, slot) {
  form.addEventListener('submit', (ev) => {
    if (form.__tmxBypassSubmit) return; // our own native submit, on its way out
    const wantsNewTab = !!form.__tmxNewTabIntent;
    ev.preventDefault();

    const q = (inputEl.value || '').trim();
    const extra = selectEl.value || '---';

    if (wantsNewTab) {
      // The tab was opened synchronously off the keypress, so the popup blocker allows
      // it; it is pointed at the order once we know there is exactly one.
      tryFastSearchNavigate(ctx, q, extra, { returnUrl: true })
        .then((url) => {
          const win = form.__tmxNewTabWin;
          if (url) {
            if (win && !win.closed) win.location = url;
            else window.open(url, '_blank', 'noopener');
            return;
          }
          // Not exactly one result → send the search itself to a new tab.
          const prevTarget = form.target;
          form.__tmxBypassSubmit = true;
          form.target = '_blank';
          form.submit();
          form.target = prevTarget;
        })
        .finally(() => {
          form.__tmxNewTabIntent = false;
          form.__tmxNewTabWin = null;
        });
      return;
    }

    // Same-tab: the loader covers the wait either way, so it is started before the
    // request and deliberately left running through the navigation that follows.
    startLoadingUI(ctx, slot);
    tryFastSearchNavigate(ctx, q, extra)
      .then((ok) => {
        if (ok) return;
        form.__tmxBypassSubmit = true;
        form.submit(); // full results page
      })
      .catch(() => {
        // Failed without navigating, so nothing else will take the loader down.
        stopLoadingUI(ctx, slot);
      });
  });
}

/**
 * Build the search box and put it in the header, or wherever `position` says.
 * `root` is the nav's shadow root, or document.body for the fallback overlay.
 */
function buildSearchUI(ctx, root, position) {
  const { dom } = ctx;
  // A shadow root is a document fragment; document.body is not. Events and lookups are
  // scoped to whichever tree we were handed.
  const isShadow = root.nodeType === 11;
  const scope = isShadow ? root : document;
  const body = isShadow ? root.host.ownerDocument.body : document.body;

  if (isShadow) ctx.style.addToShadow(root, css, { id: STYLE_ID });
  else ctx.style.add(css, { id: STYLE_ID });

  const slot = dom.el('div', { class: 'tmx-slot tmx-search' }, dom.el('div', { class: 'loading-bar' }));

  const form = dom.el('form', { action: SEARCH_ACTION, method: 'post', target: '_self', autocomplete: 'off' });
  const group = dom.el('div', { class: 'group', role: 'search' });

  const input = dom.el('input', {
    class: 'input',
    type: 'search',
    name: 'search',
    placeholder: 'Search…',
    autocomplete: 'off',
    'aria-label': 'Search',
  });

  const btn = dom.el('button', {
    type: 'button',
    class: 'search-trigger',
    'aria-expanded': 'false',
    'aria-controls': 'tmx-menu',
    'aria-label': 'Search options',
  });
  btn.innerHTML = SEARCH_ICON;

  const menu = dom.el('div', {
    id: 'tmx-menu',
    class: 'submenu',
    'data-submenu': '',
    role: 'menu',
    'aria-label': 'Search options',
  });
  const list = dom.el('ul', { class: 'list', role: 'none' });

  // The real field the site reads. The radios are the visible control; this carries the
  // value into the POST.
  const selHidden = dom.el('select', { name: 'extraOption', style: { display: 'none' } });

  const saved = ctx.settings.raw.get(LAST_EXTRA_KEY, null);
  const defaultExtra = OPTIONS.some((o) => o.value === saved) ? saved : OPTIONS[0].value;

  for (const opt of OPTIONS) {
    selHidden.append(dom.el('option', { value: opt.value }, opt.label));

    const radio = dom.el('input', { type: 'radio', name: 'tm_extraOption', value: opt.value });
    if (opt.value === defaultExtra) radio.checked = true;
    const label = dom.el('label', {}, radio, ' ', dom.el('span', { class: 'opt-text' }, opt.label));
    list.append(dom.el('li', { class: 'element' }, label));
  }
  selHidden.value = defaultExtra;

  // `data-open` mirrors aria-expanded: ExtraNav's pass-through stylesheet only lets
  // pointer events reach a submenu that carries it.
  const setOpen = (open) => {
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
    if (open) menu.setAttribute('data-open', 'true');
    else menu.removeAttribute('data-open');
  };
  const isOpen = () => btn.getAttribute('aria-expanded') === 'true';

  btn.addEventListener('click', () => setOpen(!isOpen()));

  scope.addEventListener('click', (e) => {
    if (!slot.contains(e.target)) setOpen(false);
  });
  scope.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') setOpen(false);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown' && !isOpen()) {
      e.preventDefault();
      setOpen(true);
    }
  });

  list.addEventListener('change', (e) => {
    const radio = e.target;
    if (!radio || radio.type !== 'radio') return;
    selHidden.value = radio.value;
    ctx.settings.raw.set(LAST_EXTRA_KEY, radio.value);
    setOpen(false);
  });

  // Enter submits; Ctrl/Shift/Cmd+Enter opens the result in a new tab.
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' || isOpen()) return;
    e.preventDefault();
    if (e.ctrlKey || e.shiftKey || e.metaKey) {
      form.__tmxNewTabIntent = true;
      try {
        form.__tmxNewTabWin = window.open('about:blank', '_blank', 'noopener');
      } catch { /* the popup blocker said no; window.open below gets a second try */ }
    }
    if (typeof form.requestSubmit === 'function') form.requestSubmit();
    else form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
  });

  menu.append(list);
  group.append(input, btn, menu);
  form.append(group, selHidden);
  slot.append(form);

  if (position === 'header') {
    const header = scope.querySelector(NAV_HEADER_SEL);
    if (header) {
      // A flex header takes the slot at the end of the row; anything else gets it
      // positioned against the header box.
      const isFlex = getComputedStyle(header).display.includes('flex');
      slot.classList.add(isFlex ? 'flex-right' : 'abs-right');
      header.append(slot);
    } else {
      // The header went away between choosing header mode and building: overlay instead.
      slot.classList.add('overlay');
      body.append(slot);
    }
  } else {
    slot.classList.add('overlay');
    body.append(slot);
  }

  wireSingleResultFastPath(ctx, form, input, selHidden, slot);
}

/** Mount into the nav header, clearing out any search form the site left there. */
function mountIntoHeader(ctx, root) {
  const header = root.querySelector(NAV_HEADER_SEL);
  if (!header || root.querySelector(SLOT_SEL)) return;

  for (const form of header.querySelectorAll('form[action*="?p=search"], form[role="search"]')) {
    if (!form.closest(SLOT_SEL)) form.remove();
  }
  buildSearchUI(ctx, root, 'header');
}

/**
 * Wait for the nav's header to exist inside its shadow root.
 *
 * ctx.observe watches the document tree and a shadow root is a separate tree, so this is
 * the one wait the shared observer cannot do for us — hence the poll, at the legacy
 * script's own interval and budget.
 */
async function waitForShadowHeader(ctx, root) {
  const started = performance.now();
  for (;;) {
    const header = root.querySelector(NAV_HEADER_SEL);
    if (header) return header;
    if (performance.now() - started > TIMEOUT_MS) return null;
    await ctx.dom.sleep(POLL_MS);
  }
}

async function start(ctx) {
  const host = await ctx.observe.ready(`#${NAV_HOST_ID}`, { timeout: TIMEOUT_MS });
  const root = host?.shadowRoot || null;
  const header = root ? await waitForShadowHeader(ctx, root) : null;

  if (!root || !header) {
    // No nav: the overlay keeps search available on its own.
    ctx.log.info('nav host not found; using the fallback overlay');
    buildSearchUI(ctx, document.body, 'overlay');
    ctx.log.guard(() => autoOpenFromGmail(ctx));
    return;
  }

  mountIntoHeader(ctx, root);
  ctx.log.guard(() => autoOpenFromGmail(ctx));

  // Re-mount if the header is re-rendered under us. The legacy script watched the shadow
  // root itself; a module gets the shared document observer instead, so the check also
  // runs on every route change to cover a re-render the document never sees.
  const remount = () => mountIntoHeader(ctx, root);
  ctx.observe.onChange(remount);
  ctx.route.onChange(remount);
}

/* --------------------------------------------------------------- module */

export default {
  id: 'nav.search',
  title: 'Header search box',
  runAt: 'start',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    if (mounted) return;
    mounted = true;

    // Before any UI: an #autosearch URL is a search, not a page to decorate.
    const seed = parseAutoSearchFromHash();
    if (seed) {
      ctx.log.guard(() => runAutoSearch(ctx, seed));
      return;
    }

    ctx.log.guard(() => start(ctx));
  },
};
