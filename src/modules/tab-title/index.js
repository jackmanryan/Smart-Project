/**
 * TabName — title the browser tab with the order's Sage sales number.
 *
 * The extranet titles every order tab the same way, so eight open orders are eight
 * identical tabs. The number lives in JSON that reaches the page by three different
 * routes — inlined into a <script> the document ships with, or in an XHR/fetch the grid
 * fires after load — so all of them are watched and the first hit wins.
 *
 * Ported from legacy/userscripts/tabname.user.js (v1.0).
 */

/** The shape the number arrives in: "sage_sales_number": "143901". */
const SAGE_IN_TEXT = /"sage_sales_number"\s*:\s*"([^"]+)"/i;

/** Cheap "is this worth handing to JSON.parse" test, as the legacy script used. */
const LOOKS_LIKE_JSON = /^\s*[[{]/;

const FALLBACK_TITLE = 'Orders';

/**
 * How long to wait before settling for the H1. Long enough for the order JSON to land,
 * short enough that the tab is never left blank. Straight from the legacy script.
 */
const FALLBACK_DELAY_MS = 1500;

/* ---------------------------------------------------------------- finders */

function findSageInText(text) {
  if (!text || typeof text !== 'string') return null;
  const m = SAGE_IN_TEXT.exec(text);
  return m ? m[1] : null;
}

/**
 * Read the number off already-parsed JSON. Only the top level is inspected: the payload
 * is either the order object itself or a one-row list of it.
 */
function findSageInJSON(data) {
  try {
    if (Array.isArray(data) && data.length) {
      const val = data[0]?.sage_sales_number || null;
      return typeof val === 'string' && val.trim() ? val.trim() : null;
    }
    if (data && typeof data === 'object') {
      const val = data.sage_sales_number || null;
      return typeof val === 'string' && val.trim() ? val.trim() : null;
    }
  } catch { /* a malformed payload is just a miss */ }
  return null;
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/** Inline <script> body: regex first, then a parse if the body is a JSON literal. */
function sageFromScript(text) {
  const hit = findSageInText(text);
  if (hit) return hit;
  if (!LOOKS_LIKE_JSON.test(text || '')) return null;
  return findSageInJSON(parseJson(text));
}

/**
 * Response body. The legacy script branched on the Content-Type header; ctx.net reports
 * the body only, so the body's own shape decides which reader runs first.
 */
function sageFromBody(text) {
  if (!text) return null;
  if (LOOKS_LIKE_JSON.test(text)) {
    const hit = findSageInJSON(parseJson(text));
    if (hit) return hit;
  }
  return findSageInText(text);
}

/** The page heading, or the literal "Orders" when there is not even a heading yet. */
function h1Fallback(dom) {
  const h1 = dom.$('h1.page-header');
  return dom.norm(h1 ? h1.textContent : '') || FALLBACK_TITLE;
}

/* ----------------------------------------------------------------- module */

export default {
  id: 'tab-title',
  title: 'Tab shows the Sage number',
  runAt: 'start',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    const { dom, observe, net } = ctx;

    let locked = false; // stop after the first successful set
    const stops = [];

    /** Take the title and stop listening. Blank candidates are ignored, not locked. */
    const setTitle = (txt) => {
      if (locked) return;
      const clean = String(txt || '').trim();
      if (!clean) return;
      document.title = clean;
      locked = true;
      while (stops.length) stops.pop()();
    };

    // 1) Inline <script> tags. This re-reads every script on each batch rather than
    //    visiting each node once: the site streams its order JSON, so a script whose
    //    body was incomplete when the node first appeared only yields the number on a
    //    later pass. The legacy script re-scanned document.scripts the same way.
    const scanScripts = () => {
      if (locked) return;
      for (const script of document.scripts) {
        const hit = sageFromScript(script.textContent || '');
        if (hit) {
          setTitle(hit);
          return;
        }
      }
    };
    scanScripts();
    stops.push(observe.onChange(scanScripts));

    // 2) Everything the page fetches. The legacy script installed its own fetch and
    //    XMLHttpRequest wrappers here; the bundle taps the network once for everyone.
    stops.push(
      net.onResponse(({ text }) => {
        if (locked) return;
        const hit = sageFromBody(text);
        if (hit) setTitle(hit);
      }),
    );

    // 3) Until the number turns up, keep the tab showing the heading rather than a blank
    //    or stale title. This is deliberately not locked in — a late JSON hit still wins.
    stops.push(
      observe.onChange(() => {
        if (locked) return;
        const fallback = h1Fallback(dom);
        if (fallback && document.title !== fallback) document.title = fallback;
      }),
    );

    // 4) If the JSON never arrives, settle for the heading and stop looking.
    dom.onReady(() => setTimeout(() => setTitle(h1Fallback(dom)), FALLBACK_DELAY_MS));
  },
};
