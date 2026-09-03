// ==UserScript==
// @name         TabName
// @namespace    jack.tools
// @version      1.0
// @description  Set document.title from JSON (sage_sales_number). Fallback to H1.page-header or "Orders".
// @match        https://extranet.strip-curtains.com/*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  let locked = false; // stop after first successful set

  const setTitle = (txt) => {
    if (locked) return;
    const clean = String(txt || '').trim();
    if (!clean) return;
    document.title = clean;
    locked = true;
  };

  const getH1Fallback = () => {
    const h1 = document.querySelector('h1.page-header');
    const txt = h1 ? h1.textContent.trim().replace(/\s+/g, ' ') : '';
    return txt || 'Orders';
  };

  const findSageInText = (t) => {
    if (!t || typeof t !== 'string') return null;
    // Fast regex: "sage_sales_number": "143901"
    const m = /"sage_sales_number"\s*:\s*"([^"]+)"/i.exec(t);
    return m ? m[1] : null;
  };

  const findSageInJSON = (data) => {
    try {
      if (Array.isArray(data) && data.length) {
        const val = data[0]?.sage_sales_number || null;
        return typeof val === 'string' && val.trim() ? val.trim() : null;
      }
      if (data && typeof data === 'object') {
        const val = data.sage_sales_number || null;
        return typeof val === 'string' && val.trim() ? val.trim() : null;
      }
    } catch { /* ignore */ }
    return null;
  };

  // 1) Scan inline <script> tags early
  const scanScripts = () => {
    if (locked) return;
    for (const s of document.scripts) {
      const txt = s.textContent || '';
      const hit = findSageInText(txt);
      if (hit) { setTitle(hit); break; }
      // If the script has JSON we can safely parse
      if (/^\s*\[/.test(txt) || /^\s*\{/.test(txt)) {
        try {
          const json = JSON.parse(txt);
          const hit2 = findSageInJSON(json);
          if (hit2) { setTitle(hit2); break; }
        } catch { /* ignore parse errors */ }
      }
    }
  };

  // 2) Intercept fetch
  const origFetch = window.fetch;
  window.fetch = async function(input, init) {
    const res = await origFetch.apply(this, arguments);
    try {
      const clone = res.clone();
      const ct = clone.headers.get('content-type') || '';
      // JSON — try to read and extract
      if (/json/i.test(ct)) {
        clone.json().then((j) => {
          if (locked) return;
          const hit = findSageInJSON(j);
          if (hit) setTitle(hit);
        }).catch(() => {});
      } else {
        // Non-JSON: fallback to text scan
        clone.text().then((t) => {
          if (locked) return;
          const hit = findSageInText(t);
          if (hit) setTitle(hit);
        }).catch(() => {});
      }
    } catch { /* ignore */ }
    return res;
  };

  // 3) Intercept XHR
  const XHR = window.XMLHttpRequest;
  function WrappedXHR() {
    const xhr = new XHR();
    xhr.addEventListener('load', function() {
      if (locked) return;
      try {
        const ct = this.getResponseHeader('content-type') || '';
        if (/json/i.test(ct)) {
          const j = typeof this.response === 'object' ? this.response : JSON.parse(this.responseText);
          const hit = findSageInJSON(j);
          if (hit) setTitle(hit);
        } else {
          const hit = findSageInText(this.responseText || '');
          if (hit) setTitle(hit);
        }
      } catch { /* ignore */ }
    });
    return xhr;
  }
  WrappedXHR.prototype = XHR.prototype;
  window.XMLHttpRequest = WrappedXHR;

  // 4) MutationObserver: catch late-added inline scripts / H1
  const mo = new MutationObserver(() => {
    if (!locked) scanScripts();
    if (!locked) {
      // If we still don't have a sage number, set H1 (temporary) to avoid blank title.
      const fallback = getH1Fallback();
      if (fallback && document.title !== fallback) {
        document.title = fallback;
      }
    }
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // 5) Final fallback after load: ensure at least H1/Orders
  const ensureFallback = () => {
    if (!locked) setTitle(getH1Fallback());
  };
  // Try early scans
  scanScripts();

  // Ensure a fallback shortly after DOM is interactive/complete
  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    setTimeout(ensureFallback, 1500);
  } else {
    document.addEventListener('DOMContentLoaded', () => setTimeout(ensureFallback, 1500), { once: true });
  }
})();
