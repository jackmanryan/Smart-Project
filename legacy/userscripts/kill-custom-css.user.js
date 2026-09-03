// ==UserScript==
// @name         Kill custom.css
// @namespace    jack.tools
// @version      1.0.0
// @description  Disable/remove https://extranet.strip-curtains.com/css/custom.css after load and on re-injection
// @match        https://extranet.strip-curtains.com/*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor&priceCheck=true*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
  'use strict';

  const TARGET_PART = '/css/custom.css'; // match fragment
  const LINK_SEL = `link[rel~="stylesheet"][href*="${TARGET_PART}"]`;

  function nukeLink(el) {
    try { el.disabled = true; } catch {}
    try { el.parentNode && el.parentNode.removeChild(el); } catch {}
  }

  // Remove any @import of the target from same-origin stylesheets
  function nukeImportsIn(sheet) {
    try {
      const rules = sheet.cssRules;
      if (!rules) return 0;
      let removed = 0;
      // walk backwards so indices don't shift
      for (let i = rules.length - 1; i >= 0; i--) {
        const r = rules[i];
        if (r && r.type === CSSRule.IMPORT_RULE && r.href && r.href.includes(TARGET_PART)) {
          sheet.deleteRule(i);
          removed++;
        }
      }
      return removed;
    } catch {
      // Cross-origin or inaccessible; ignore.
      return 0;
    }
  }

  function disableCustomCssEverywhere() {
    let hits = 0;

    // 1) Direct <link> tags
    document.querySelectorAll(LINK_SEL).forEach(link => {
      nukeLink(link);
      hits++;
    });

    // 2) CSSStyleSheet objects (direct href or @imports)
    for (const sheet of Array.from(document.styleSheets)) {
      try {
        if (sheet.href && sheet.href.includes(TARGET_PART)) {
          // Disable and remove its owner node for good measure
          sheet.disabled = true;
          sheet.ownerNode && sheet.ownerNode.parentNode && sheet.ownerNode.parentNode.removeChild(sheet.ownerNode);
          hits++;
          continue;
        }
      } catch {}
      hits += nukeImportsIn(sheet);
    }

    if (hits > 0) {
      console.debug(`[Kill custom.css] neutralized ${hits} occurrence(s).`);
    }
  }

  // Run after full load to ensure we "win" at the end
  if (document.readyState === 'complete') {
    disableCustomCssEverywhere();
  } else {
    window.addEventListener('load', disableCustomCssEverywhere, { once: true });
  }

  // Guard against late/SPA injections
  const mo = new MutationObserver(muts => {
    let found = false;
    for (const m of muts) {
      if (m.type !== 'childList') continue;
      m.addedNodes.forEach(n => {
        if (n.nodeType !== 1) return;
        if (n.matches && n.matches(LINK_SEL)) {
          nukeLink(n);
          found = true;
        }
        // Also scan descendants quickly
        const late = n.querySelectorAll ? n.querySelectorAll(LINK_SEL) : [];
        late.forEach(nukeLink);
      });
    }
    if (found) disableCustomCssEverywhere(); // catch any @imports added with it
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });

  // Optional: final sweep after a short delay, in case something injected after load
  setTimeout(disableCustomCssEverywhere, 1500);
})();
