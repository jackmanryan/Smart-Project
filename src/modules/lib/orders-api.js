/**
 * SCORD — the extranet's order-record client, plus the message-thread fetch.
 *
 * Both were globals in the SC FAB script: `window.SCORD` (v3.1-hotfix) and
 * `window.fetchMCThread`, each installed behind an `if (!window.X)` guard so a second
 * copy of the script would not clobber the first. A call-site scan of the legacy set
 * found nothing outside that one script calling either, so they are named exports here
 * instead of globals and the guards have nothing left to guard.
 *
 * Ported from legacy/userscripts/sc-fab-message-and-sales-viewer-scord-integrated.user.js.
 * No side effects on import.
 */

import { createLogger } from '../../core/log.js';

const log = createLogger('lib.orders-api');

/* --------------------------------------------------------------- popup parsing */

const decodeEntities = (s) => Object.assign(document.createElement('textarea'), { innerHTML: s }).value;

/**
 * The popup endpoint usually answers with JSON, but some variants answer with the whole
 * HTML page and the record array printed somewhere inside it. Anchor on the record's own
 * id when it is there, else on a field name every order carries, else on the first `[`;
 * then walk forward counting brackets (skipping string contents) to the matching close.
 */
function extractJSONArray(html, salesId) {
  const s = decodeEntities(html);
  let idx = s.indexOf(`"id":"${salesId}"`);
  if (idx === -1) idx = s.indexOf(`"id":${salesId}`);
  if (idx === -1) {
    for (const anchor of ['"billing_firstname"', '"payment_gateway"', '"sales_total"', '"order_number"']) {
      idx = s.indexOf(anchor);
      if (idx !== -1) break;
    }
  }
  if (idx === -1) idx = s.indexOf('[');
  if (idx === -1) throw new Error('No likely JSON anchor found');

  const start = s.lastIndexOf('[', idx);
  if (start === -1) throw new Error('Opening "[" not found near anchor');

  let depth = 0;
  let inStr = false;
  let escaped = false;
  for (let i = start; i < s.length; i++) {
    const ch = s[i];
    if (inStr) {
      if (escaped) { escaped = false; continue; }
      if (ch === '\\') { escaped = true; continue; }
      if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') { inStr = true; continue; }
    if (ch === '[') depth++;
    if (ch === ']') {
      depth--;
      if (depth === 0) return s.slice(start, i + 1);
    }
  }
  throw new Error('Balanced JSON array not found');
}

const isJSONish = (x) => typeof x === 'string' && (x.trim().startsWith('[') || x.trim().startsWith('{'));

/** Some columns arrive as JSON inside the JSON. Parse the ones we know about. */
const decodeKnownFields = (rec) => {
  const maybe = (v) =>
    isJSONish(v)
      ? (() => {
          try {
            return JSON.parse(v);
          } catch {
            return v;
          }
        })()
      : v;
  if ('review_partsHandling' in rec) rec.review_partsHandling = maybe(rec.review_partsHandling);
  return rec;
};

/* -------------------------------------------------------------------- transport */

/**
 * xhr-first transport, to dodge a patched fetch and global-scope races.
 *
 * This is deliberate and load-bearing: the bundle's own network tap (and, before it,
 * TurboKit) replaces `window.fetch` at document-start, and page scripts have been known
 * to do the same. Building an XMLHttpRequest here reaches the browser API directly, and
 * it keeps the request free of the forbidden headers a fetch-based version tripped over.
 * Note this constructs an XHR — it never patches one.
 */
function fetchXhr(url, { timeoutMs = 15000, headers = {}, rangeBytes = null } = {}) {
  return new Promise((resolve, reject) => {
    const x = new XMLHttpRequest();
    x.open('GET', url, true);
    x.withCredentials = true;
    Object.entries(headers).forEach(([k, v]) => x.setRequestHeader(k, v));
    if (rangeBytes != null) x.setRequestHeader('Range', `bytes=0-${rangeBytes}`);
    x.timeout = timeoutMs;
    const t0 = performance.now();
    x.onload = () =>
      resolve({
        ok: x.status >= 200 && x.status < 300,
        status: x.status,
        ttfb_ms: Math.round(performance.now() - t0),
        text: x.responseText,
      });
    x.onerror = () => reject(new Error('network error'));
    x.ontimeout = () => reject(new Error('timeout'));
    x.send();
  });
}

/* ----------------------------------------------------------------------- config */

/**
 * Transport defaults. `transport` is kept from the legacy config object even though the
 * xhr path is the only one implemented — call sites pass `{ transport: 'xhr' }` to say
 * out loud which path they need.
 */
const config = { transport: 'xhr', timeoutMs: 15000, useRange: false, rangeBytes: 65535 };

/** Patch the defaults, e.g. setConfig({ timeoutMs: 30000 }). Returns the live config. */
export const setConfig = (patch = {}) => Object.assign(config, patch);

/* ------------------------------------------------------------------ order fetch */

/**
 * The five ways this server has been seen to hand back the products popup, best first.
 * Each is tried in turn and the first one that parses wins.
 */
const POPUP_VARIANTS = (q) => [
  { name: 'GET ?json=1', url: `/?p=orders-products-list-popup&view=${q}&json=1`, headers: {} },
  { name: 'GET ?format=json', url: `/?p=orders-products-list-popup&view=${q}&format=json`, headers: {} },
  { name: 'GET ?ajax=1', url: `/?p=orders-products-list-popup&view=${q}&ajax=1`, headers: {} },
  { name: 'GET + XRW', url: `/?p=orders-products-list-popup&view=${q}`, headers: { 'X-Requested-With': 'XMLHttpRequest' } },
  { name: 'GET base', url: `/?p=orders-products-list-popup&view=${q}`, headers: {} },
];

/**
 * The raw record array behind an order, with a note of which variant answered.
 * @returns {Promise<{data: any, meta: {variant: string, status: number, ttfb_ms: number, url?: string}}>}
 */
export async function getPopup(viewId, opts = {}) {
  const cfg = Object.assign({}, config, opts);
  const q = encodeURIComponent(String(viewId));

  for (const v of POPUP_VARIANTS(q)) {
    try {
      const r = await fetchXhr(v.url, {
        timeoutMs: cfg.timeoutMs,
        headers: v.headers,
        rangeBytes: cfg.useRange ? cfg.rangeBytes : null,
      });
      if (cfg.useRange && r.status !== 206) log.debug('Range not honored:', r.status);

      const looksJSON = r.text.slice(0, 200).includes('"aaData"') || r.text.trim().startsWith('{');
      const arr = looksJSON ? JSON.parse(r.text) : JSON.parse(extractJSONArray(r.text, viewId));

      log.debug('getPopup', viewId, { variant: v.name, status: r.status, ttfb_ms: r.ttfb_ms });
      return { data: arr, meta: { variant: v.name, status: r.status, ttfb_ms: r.ttfb_ms, url: v.url } };
    } catch { /* try the next variant */ }
  }

  // Last resort: scrape the order page itself for the same array.
  const r = await fetchXhr(`/?p=orders-view&view=${q}`, { timeoutMs: cfg.timeoutMs });
  const arr = JSON.parse(extractJSONArray(r.text, viewId));
  log.debug('getPopup fallback-view', viewId, { status: r.status, ttfb_ms: r.ttfb_ms });
  return { data: arr, meta: { variant: 'orders-view scrape', status: r.status, ttfb_ms: r.ttfb_ms } };
}

/** One order record by sales id, with its nested JSON columns decoded. */
export async function getOrder(salesId, opts = {}) {
  const { data } = await getPopup(salesId, opts);
  const rec = Array.isArray(data) ? data.find((r) => String(r?.id) === String(salesId)) || data[0] : data;
  if (!rec) throw new Error('Record not found for view=' + salesId);
  return decodeKnownFields(rec);
}

/* --------------------------------------------------------------- message threads */

const THREAD_ENDPOINT = new URL('/ajax/sales/loadMessages.php', location.origin).href;

/**
 * One Message Center conversation by id.
 *
 * Stays on `fetch` rather than ctx.net.request: this endpoint wants a multipart POST and
 * an abortable timeout, and ctx.net.request offers no AbortSignal. It is same-origin, so
 * the plain credentialed fetch is enough.
 *
 * @returns {Promise<{id: string, html: string, description: string}>}
 */
export async function fetchMCThread(id, { timeoutMs = 10_000, signal } = {}) {
  if (!id) throw new Error('fetchMCThread: "id" is required');
  const ownCtrl = !signal ? new AbortController() : null;
  const finalSignal = signal || ownCtrl.signal;
  const timer = ownCtrl ? setTimeout(() => ownCtrl.abort('timeout'), timeoutMs) : null;
  try {
    const fd = new FormData();
    fd.append('id', String(id));
    const res = await fetch(THREAD_ENDPOINT, {
      method: 'POST',
      body: fd,
      credentials: 'include',
      signal: finalSignal,
      headers: { 'X-Requested-With': 'XMLHttpRequest' },
    });
    const text = await res.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch { /* handled by the shape check below */ }
    if (!data || data.type !== 'success' || typeof data.html !== 'string') {
      throw new Error(`Unexpected response (${res.status}): ${text.slice(0, 240)}…`);
    }
    return { id: data.id ?? String(id), html: data.html, description: data.description || '' };
  } finally {
    if (timer) clearTimeout(timer);
  }
}
