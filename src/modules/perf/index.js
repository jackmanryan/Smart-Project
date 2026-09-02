/**
 * TurboKit — the performance suite, in four parts:
 *
 *   A) BackBoost      keep pages BFCache-eligible, plus the Alt+[ back hotkey
 *   B) ExtraFast      clamp aggressive polling, dedupe the email endpoint, reduce CLS
 *   C) Toronto strip  remove the one panel that dominates layout cost
 *   D) Local CSS cache  serve same-origin stylesheets out of IndexedDB
 *
 * Ported from legacy/userscripts/sc-turbokit-backboost-extrafast-local-css-cache.user.js
 * (v0.2.0). The legacy script's own fetch/XHR patches are gone: the AJAX dedup now goes
 * through ctx.net.dedupe and the cache warmer through ctx.net.request, so this module no
 * longer races the tab-title module for ownership of the network.
 *
 * Two host patches remain and cannot move into core, because intercepting registration
 * *is* the feature: window.addEventListener (to swallow unload handlers that would
 * disqualify the page from the BFCache) and window.setInterval (to clamp polling). Both
 * are installed with Object.defineProperty, the same way hygiene/clean patches Node and
 * Element, and neither adds a global.
 */

import css from './styles.css';
import iconFallbackCss from './icon-fallback.css';

/* ============================================================ A) BackBoost */

/** Where the previous URL is parked on pagehide. Legacy key, kept verbatim. */
const TAB_KEY_LAST_URL = 'bb:last:url';

/**
 * Pages that are allowed to keep their unload handlers: both are editors where the
 * site's "you have unsaved changes" prompt matters more than a fast back button.
 * (quotes_editor is already excluded at the bundle level; it stays listed so the rule
 * still reads the way the legacy script wrote it.)
 */
const ALLOW_UNLOAD_PAGES = ['quotes_editor', 'orders_edit'];

/**
 * Swallow beforeunload/unload registration. A single unload listener is enough to make
 * the browser refuse to put the page in the BFCache, which is what makes back slow.
 */
function preferBfCache(log) {
  try {
    const swallow = new Set(['beforeunload', 'unload']);
    const nativeAdd = window.addEventListener;
    Object.defineProperty(window, 'addEventListener', {
      value: function addEventListenerWithoutUnload(type, fn, opts) {
        if (swallow.has(type)) return undefined; // ignore unload hooks
        return nativeAdd.call(this, type, fn, opts);
      },
      configurable: true,
      writable: true,
    });
    // The on* properties are a second registration route; close it too.
    for (const key of ['onbeforeunload', 'onunload']) {
      Object.defineProperty(window, key, {
        get: () => null,
        set: () => {
          /* ignore */
        },
        configurable: true,
      });
    }
  } catch (err) {
    log.warn('could not suppress unload handlers:', err);
  }
}

/**
 * Alt+[ goes back.
 *
 * The legacy script could also pre-load the previous page into a hidden iframe and
 * promote it on the way back. That was off by default and is not ported: eagerly
 * pre-loading made every navigation load the whole app (and the whole userscript suite)
 * twice — measured at ~3.0s extra post-interactive load time, 3,297 extra DOM nodes, 41
 * extra resource loads and 22 extra script executions per navigation. It is also why
 * scripts appeared to run on pages their @match excludes: the frame's URL really was an
 * orders-view URL, so those scripts matched.
 */
function installBackHotkey() {
  document.addEventListener('keydown', (ev) => {
    if (!ev.altKey) return;
    if (ev.key !== '[') return;
    ev.preventDefault();
    history.back();
  });
}

function startBackBoost(ctx) {
  if (!ctx.page.is(ALLOW_UNLOAD_PAGES)) preferBfCache(ctx.log);

  // Telemetry: was the page actually restored from the BFCache?
  window.addEventListener('pageshow', (e) => ctx.log.debug('pageshow persisted:', e.persisted));
  window.addEventListener('pagehide', (e) => ctx.log.debug('pagehide  persisted:', e.persisted));

  // Kept so the instant-back work has its input if it is ever revived, and because the
  // key is part of the user's session state.
  window.addEventListener('pagehide', () => {
    try {
      sessionStorage.setItem(TAB_KEY_LAST_URL, location.href);
    } catch { /* private mode or a full quota */ }
  });

  ctx.dom.onReady(installBackHotkey);
}

/* ============================================================ B) ExtraFast */

/** The one endpoint the site hammers with identical requests. */
const EMAIL_ENDPOINT_PATH = '/ajax/emails/load_email.php';

/** Anything polling faster than this is clamped to it. */
const POLL_MIN_MS = 30000;

const isEmailEndpoint = (urlLike) => {
  try {
    return new URL(urlLike, location.href).pathname === EMAIL_ENDPOINT_PATH;
  } catch {
    return false;
  }
};

/** Raise every sub-30s interval to 30s. The site sets several 5s pollers per page. */
function clampPolling(log) {
  try {
    const nativeSetInterval = window.setInterval.bind(window);
    Object.defineProperty(window, 'setInterval', {
      value: function setIntervalClamped(fn, delay, ...rest) {
        const d = Number(delay);
        if (!Number.isNaN(d) && d < POLL_MIN_MS) return nativeSetInterval(fn, POLL_MIN_MS, ...rest);
        return nativeSetInterval(fn, delay, ...rest);
      },
      configurable: true,
      writable: true,
    });
  } catch (err) {
    log.warn('could not clamp setInterval:', err);
  }
}

/** Give the page a favicon so the browser stops requesting /favicon.ico on every view. */
function ensureFavicon(dom) {
  if (dom.$('link[rel="icon"]')) return;
  const link = dom.el('link', { rel: 'icon', href: 'data:,' });
  dom.onRoot(() => (document.head || document.documentElement).append(link));
}

/**
 * The site ships no `loading` attribute anywhere, so every image and iframe below the
 * fold is fetched eagerly. Marking them lazy is the single biggest win on order views.
 */
function markLazy(observe) {
  observe.each('img:not([loading])', (img) => img.setAttribute('loading', 'lazy'));
  observe.each('iframe:not([loading])', (frame) => frame.setAttribute('loading', 'lazy'));
}

/**
 * Fall back to a system font for .glyphicon only when no icon webfont is actually
 * loaded — clobbering it while FontAwesome or Glyphicons is present turns every icon on
 * the page into a stray letter.
 */
function maybeDropIconFont(style) {
  try {
    const canCheck = !!document.fonts?.check;
    const hasIcons =
      canCheck &&
      (document.fonts.check('1em "FontAwesome"') ||
        document.fonts.check('1em "Font Awesome 4"') ||
        document.fonts.check('1em "Font Awesome 5 Free"') ||
        document.fonts.check('1em "Font Awesome 6 Free"') ||
        document.fonts.check('1em "Font Awesome 6 Brands"') ||
        document.fonts.check('1em "Glyphicons Halflings"'));
    if (!hasIcons) style.add(iconFallbackCss, { id: 'perf-turbokit-icon-fallback' });
  } catch { /* no document.fonts: leave the site's fonts alone */ }
}

/* ======================================================= C) Toronto strip */

const TORONTO_BLOCK = '#Packages-Block-Toronto';

/** Remove the whole Bootstrap row the block sits in, or the block itself if it has none. */
function removeTorontoBlock(node) {
  let row = node;
  while (row && row !== document.documentElement && !row.classList.contains('row')) row = row.parentElement;
  (row && row.classList.contains('row') ? row : node).remove();
}

/* =================================================== D) Local CSS cache */

const LAC_DB_NAME = 'lac-db-v1';
const LAC_STORE = 'assets';
const LAC_TTL_MS = 30 * 24 * 3600 * 1000; // 30 days
const LAC_MAX_BYTES = 50 * 1024 * 1024;
const LAC_SAME_ORIGIN_ONLY = true;
/** Cross-tab lock so ten open tabs do not all re-download the same stylesheets. */
const LAC_LOCK_KEY = 'lac:update:lock';
const LAC_LOCK_STALE_MS = 120000;

const CSS_LINK_SEL = 'link[rel="stylesheet"][href]';

const absUrl = (u) => new URL(u, location.href).href;

function isSameOrigin(u) {
  try {
    return new URL(u, location.href).origin === location.origin;
  } catch {
    return false;
  }
}

let db = null;

function openDb() {
  return new Promise((resolve, reject) => {
    const req = window.indexedDB.open(LAC_DB_NAME, 1);
    req.onupgradeneeded = () => {
      const database = req.result;
      if (!database.objectStoreNames.contains(LAC_STORE)) {
        const os = database.createObjectStore(LAC_STORE, { keyPath: 'url' });
        os.createIndex('lastUsed', 'lastUsed');
      }
    };
    req.onsuccess = () => {
      db = req.result;
      resolve(db);
    };
    req.onerror = () => reject(req.error);
  });
}

const objectStore = (mode = 'readonly') => db.transaction(LAC_STORE, mode).objectStore(LAC_STORE);

const asPromise = (req) =>
  new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });

const dbGet = (url) => asPromise(objectStore().get(url)).then((r) => r || null);
const dbPut = (rec) => asPromise(objectStore('readwrite').put(rec)).then(() => undefined);
const dbAll = () => asPromise(objectStore().getAll()).then((r) => r || []);
const dbDel = (url) => asPromise(objectStore('readwrite').delete(url)).then(() => undefined);

/** Records written before the port hold a Blob; ones written since hold text. */
function cachedText(rec) {
  if (!rec) return Promise.resolve(null);
  if (typeof rec.text === 'string') return Promise.resolve(rec.text);
  if (rec.blob && typeof rec.blob.text === 'function') return rec.blob.text();
  return Promise.resolve(null);
}

/** Drop the least recently used records until the store fits in the byte budget. */
async function prune() {
  const all = await dbAll();
  let total = all.reduce((sum, rec) => sum + (rec.bytes || 0), 0);
  if (total <= LAC_MAX_BYTES) return;
  all.sort((a, b) => (a.lastUsed || 0) - (b.lastUsed || 0));
  for (const rec of all) {
    if (total <= LAC_MAX_BYTES) break;
    await dbDel(rec.url);
    total -= rec.bytes || 0;
  }
}

/**
 * Bring one stylesheet up to date. A record inside its TTL is only touched to refresh
 * `lastUsed`; anything older is re-fetched, conditionally when an older record left us
 * a validator to send.
 */
async function refreshRecord(url, net) {
  const rec = await dbGet(url);
  const now = Date.now();

  if (rec && now - (rec.fetchedAt || 0) < LAC_TTL_MS) {
    rec.lastUsed = now;
    await dbPut(rec);
    return;
  }

  const headers = {};
  if (rec?.etag) headers['If-None-Match'] = rec.etag;
  if (rec?.lastModified) headers['If-Modified-Since'] = rec.lastModified;

  let res;
  try {
    res = await net.request(url, { headers });
  } catch {
    return; // offline or blocked: the record we already have keeps being served
  }

  if (res.status === 304 && rec) {
    rec.fetchedAt = now;
    rec.lastUsed = now;
    await dbPut(rec);
    return;
  }

  if (res.status >= 200 && res.status < 300) {
    const text = res.text || '';
    await dbPut({
      url,
      type: 'text/css',
      bytes: text.length,
      // ctx.net.request does not surface response headers, so a validator can only be
      // carried forward from a record the legacy script wrote, never learned here.
      etag: rec?.etag || '',
      lastModified: rec?.lastModified || '',
      fetchedAt: now,
      lastUsed: now,
      text,
    });
    await prune();
  }
}

/** Replace a <link> with the cached stylesheet inlined ahead of it. */
function swapLinkToInlineCss(link, cssText, baseUrl) {
  if (!link.parentNode) return;
  // naive url(...) fixup for relatives
  const base = new URL(baseUrl);
  const dir = base.pathname.replace(/[^/]+$/, '');
  const fixed = String(cssText).replace(/url\(\s*(['"]?)(?![a-z]+:|\/)/gi, (m, q) => `url(${q}${base.origin}${dir}`);
  const style = document.createElement('style');
  style.setAttribute('data-lac', link.href);
  style.textContent = fixed;
  link.parentNode.insertBefore(style, link);
  link.remove();
}

async function inlineFromCache(link) {
  const href = link.href;
  if (!href) return;
  if (LAC_SAME_ORIGIN_ONLY && !isSameOrigin(href)) return;
  const text = await cachedText(await dbGet(absUrl(href)));
  if (text != null) swapLinkToInlineCss(link, text, href);
}

/** Refresh every same-origin stylesheet, once per tab and never two tabs at a time. */
async function warmCache(ctx) {
  const now = Date.now();
  const held = ctx.settings.json.get(LAC_LOCK_KEY, null);
  if (held && now - (held.t || 0) < LAC_LOCK_STALE_MS) return; // someone else active
  ctx.settings.json.set(LAC_LOCK_KEY, { t: now, id: Math.random() });

  try {
    const urls = ctx.dom
      .$$(CSS_LINK_SEL)
      .map((link) => link.href)
      .filter((href) => href && (!LAC_SAME_ORIGIN_ONLY || isSameOrigin(href)));
    await Promise.allSettled(urls.map((href) => refreshRecord(absUrl(href), ctx.net)));
  } finally {
    ctx.settings.raw.remove(LAC_LOCK_KEY);
  }
}

async function startCssCache(ctx) {
  try {
    await openDb();
  } catch (err) {
    ctx.log.debug('IndexedDB unavailable; cache off', err);
    return;
  }

  // Serve from cache: the links already parsed and any the page adds later. Best effort
  // — by the time a link is in the tree the browser has usually started fetching it.
  ctx.observe.each(CSS_LINK_SEL, (link) => ctx.log.guard(() => inlineFromCache(link)));

  ctx.dom.onReady(() => ctx.log.guard(() => warmCache(ctx)));
}

/* =============================================================== module */

export default {
  id: 'perf.turbokit',
  title: 'TurboKit performance suite',
  runAt: 'start',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    const { dom, observe, style, net } = ctx;

    // A) BFCache assist and the back hotkey.
    startBackBoost(ctx);

    // B) Polling clamp, request dedup, CLS and lazy-load.
    clampPolling(ctx.log);
    net.dedupe((url) => isEmailEndpoint(url));
    style.add(css, { id: 'perf-turbokit' });
    ensureFavicon(dom);
    markLazy(observe);
    maybeDropIconFont(style);

    // C) The heavy panel: hidden by styles.css, removed here.
    observe.each(TORONTO_BLOCK, removeTorontoBlock);

    // D) Local stylesheet cache.
    ctx.log.guard(() => startCssCache(ctx));

    ctx.log.debug('loaded');
  },
};
