/** Small DOM and text helpers shared by every module. No side effects on import. */

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/** Coerce anything to a string; null and undefined become ''. */
export const S = (v) => (v == null ? '' : String(v));

/** Collapse non-breaking spaces and runs of whitespace, then trim. */
export const norm = (v) => S(v).replace(/ /g, ' ').replace(/\s+/g, ' ').trim();

/** Parse the first number out of a string, ignoring currency and unit noise. */
export const toNum = (v) => {
  if (v == null) return NaN;
  const n = parseFloat(S(v).replace(/[^\d.+-]/g, ''));
  return Number.isNaN(n) ? NaN : n;
};

export const uniq = (arr) => [...new Set((arr || []).map((x) => String(x)))];

/** Escape text for safe interpolation into an HTML string. */
export const esc = (v) =>
  S(v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function debounce(fn, ms = 120) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

export function throttle(fn, ms = 120) {
  let last = 0;
  let queued = null;
  return (...args) => {
    const now = performance.now();
    if (now - last >= ms) {
      last = now;
      fn(...args);
    } else if (!queued) {
      queued = setTimeout(() => {
        queued = null;
        last = performance.now();
        fn(...args);
      }, ms - (now - last));
    }
  };
}

/** Run fn once the DOM is parsed; immediately if it already is. */
export function onReady(fn) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
  else fn();
}

/** Build an element in one call: el('div', {class:'x'}, child, 'text'). */
export function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') node.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(node.style, v);
    else if (k.startsWith('on') && typeof v === 'function') node.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'dataset') Object.assign(node.dataset, v);
    else node.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat()) {
    if (c == null || c === false) continue;
    node.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  return node;
}

/** Copy text to the clipboard, preferring the GM API when the bundle was granted it. */
export async function copyText(text) {
  const value = S(text);
  try {
    if (typeof GM_setClipboard === 'function') {
      GM_setClipboard(value, 'text');
      return true;
    }
  } catch { /* fall through to the async clipboard API */ }
  try {
    await navigator.clipboard.writeText(value);
    return true;
  } catch { /* fall through to the legacy path */ }
  try {
    const ta = el('textarea', { style: { position: 'fixed', opacity: '0', pointerEvents: 'none' } });
    ta.value = value;
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch {
    return false;
  }
}
