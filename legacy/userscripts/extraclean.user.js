// ==UserScript==
// @name         ExtraClean
// @namespace    jack.tools
// @version      1.3
// @description  Remove only the specified CSS/blocks (MetisMenu CSS, Summernote includes, Toronto panel hide rule, stray styles, icon-font override, emailsPane/img/iframe rules), clean \9 hacks, and drop the navbar sidebar.
// @match https://extranet.strip-curtains.com/*
// @exclude      https://extranet.strip-curtains.com/?p=orders-review&review=*
// @run-at       document-start
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    const LOG = false;
    const log = (...a) => { if (LOG) console.log('[tm-cleanup]', ...a); };

    const matches = {
        // styles inlined with a data attribute
        styleDataAttr: [
            /vendor\/metisMenu\/metisMenu\.min\.css/i,
            /dist\/css\/jquery\.modal\.css/i,
        ],
        // entire <style> blocks to kill by distinctive text
        styleText: [
            /#Packages-Block-Toronto[\s\S]*?display:\s*none\s*!important;?/i,
            // the "emailsPane/img/iframe/link[rel=icon]" block (any of these lines)
            /Reserve space so late email HTML|#emailsPane|content-visibility:\s*auto|link\[rel=["']icon["']\]/i,
            // icon-font override
            /\.fa\s*,\s*\.fas\s*,\s*\.far\s*,\s*\.fal\s*,\s*\.fab\s*,\s*\.glyphicon\s*\{[\s\S]*?font-family:[\s\S]*?sans-serif\s*!important;?\s*\}/i,
        ],
        linkHref: [/summernote/i],
        scriptSrc: [/summernote/i],
        // cleanup of broken hacks
        ieHackToken: /\\9\s*;?/g,
        badBgLine: /background-color\s*:\s*#[0-9a-f]{3,6}\s*\\9\s*;?/ig,
    };

    function isKillStyle(el) {
        if (el.tagName !== 'STYLE') return false;
        const dif = el.getAttribute('data-inlined-from') || '';
        if (dif && matches.styleDataAttr.some((r) => r.test(dif))) return true;
        const txt = el.textContent || '';
        return !!(txt && matches.styleText.some((r) => r.test(txt)));
    }

    function isKillLink(el) {
        if (el.tagName !== 'LINK') return false;
        const rel = (el.getAttribute('rel') || '').toLowerCase();
        if (!rel.includes('stylesheet')) return false;
        const href = el.getAttribute('href') || '';
        return matches.linkHref.some((r) => r.test(href));
    }

    function isKillScript(el) {
        if (el.tagName !== 'SCRIPT') return false;
        const src = el.getAttribute('src') || '';
        return !!(src && matches.scriptSrc.some((r) => r.test(src)));
    }

    function sanitizeStyleText(txt) {
        if (!txt) return txt;
        txt = txt.replace(matches.badBgLine, '');
        txt = txt.replace(matches.ieHackToken, ';');
        return txt;
    }

    function sanitizeStyleAttr(el) {
        const styleVal = el.getAttribute('style');
        if (!styleVal) return;
        const cleaned = sanitizeStyleText(styleVal);
        if (cleaned !== styleVal) el.setAttribute('style', cleaned);
    }

    function drop(node, why='') {
        try { node.remove(); if (LOG) log('removed', node.tagName, why); } catch (_) {}
    }

    // Intercept DOM insertions (narrow)
    const patch = (proto, method) => {
        const orig = proto[method];
        Object.defineProperty(proto, method, {
            value: function (...args) {
                const node = args[0];
                if (node && node.nodeType === 1) {
                    if (node.tagName === 'STYLE') {
                        const t = node.textContent || '';
                        const s = sanitizeStyleText(t);
                        if (t !== s) node.textContent = s;
                        if (isKillStyle(node)) { drop(node, '(style match)'); return node; }
                    } else if (node.tagName === 'LINK' && isKillLink(node)) {
                        drop(node, '(summernote link)'); return node;
                    } else if (node.tagName === 'SCRIPT' && isKillScript(node)) {
                        drop(node, '(summernote script)'); return node;
                    } else {
                        sanitizeStyleAttr(node);
                    }
                }
                return orig.apply(this, args);
            },
            configurable: true, writable: false,
        });
    };
    patch(Node.prototype, 'appendChild');
    patch(Node.prototype, 'insertBefore');
    patch(Element.prototype, 'replaceChild');

    // Attribute set hook
    const origSetAttr = Element.prototype.setAttribute;
    Object.defineProperty(Element.prototype, 'setAttribute', {
        value: function (name, value) {
            const ret = origSetAttr.apply(this, arguments);
            const tag = this.tagName;
            if (tag === 'LINK' && name === 'href' && isKillLink(this)) drop(this, '(summernote link set)');
            else if (tag === 'SCRIPT' && name === 'src' && isKillScript(this)) drop(this, '(summernote script set)');
            else if (name === 'style') sanitizeStyleAttr(this);
            return ret;
        },
        configurable: true, writable: false,
    });

    // Remove the specific panels: LTL Shipment Quote Request, Calls
    function removeTargetPanels(root = document) {
        // A) match by the toggling target in the heading's onclick
        root.querySelectorAll('[onclick*="#LTL-Block"], [onclick*="#Calls-Block"]').forEach((a) => {
            const panel = a.closest('.panel') || a.closest('.row') || a.closest('.panel-heading') || a;
            if (panel) drop(panel, '(removed target panel via onclick)');
        });

        // B) match by the body id directly
        root.querySelectorAll('#LTL-Block, #Calls-Block').forEach((el) => {
            const panel = el.closest('.panel') || el.closest('.row') || el;
            if (panel) drop(panel, '(removed target panel via id)');
        });

        // C) safe fallback by heading text (in case markup differs)
        root.querySelectorAll('.panel-heading').forEach((h) => {
            const t = (h.querySelector('a')?.textContent || h.textContent || '')
            .toLowerCase().replace(/\s+/g, ' ').trim();
            if (t.includes('ltl shipment quote request') || t.startsWith('calls')) {
                const panel = h.closest('.panel') || h;
                if (panel) drop(panel, '(removed target panel via text)');
            }
        });
    }


    function sweep(root = document) {
        // styles
        root.querySelectorAll('style').forEach((s) => {
            const t = s.textContent || '';
            const cleaned = sanitizeStyleText(t);
            if (cleaned !== t) s.textContent = cleaned;
            if (isKillStyle(s)) drop(s, '(style sweep)');
        });
        // summernote includes
        root.querySelectorAll('link[rel*="stylesheet"]').forEach((l) => isKillLink(l) && drop(l, '(summernote link sweep)'));
        root.querySelectorAll('script[src]').forEach((sc) => isKillScript(sc) && drop(sc, '(summernote script sweep)'));
        // inline style attributes
        root.querySelectorAll('[style]').forEach(sanitizeStyleAttr);
        // >>> ADD: remove the two specific panels
        removeTargetPanels(root);
    }

    const mo = new MutationObserver((muts) => {
        let needPurge = false;
        for (const m of muts) {
            if (m.type === 'childList') {
                m.addedNodes.forEach((n) => n && n.nodeType === 1 && (sweep(n), needPurge = true));
            } else if (m.type === 'attributes' && m.attributeName === 'style') {
                sanitizeStyleAttr(m.target);
            }
        }
        if (needPurge) purgeRules();
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true });

    sweep();

    // Purge specific CSS rules from live stylesheets (even if they arrive later)
    function purgeRules() {
        const iconSelTargets = ['.fa', '.fas', '.far', '.fal', '.fab', '.glyphicon'];
        try {
            for (const sheet of Array.from(document.styleSheets)) {
                let rules;
                try { rules = sheet.cssRules; } catch (_) { continue; } // cross-origin
                if (!rules) continue;

                for (let i = rules.length - 1; i >= 0; i--) {
                    const r = rules[i];
                    if (r.type !== CSSRule.STYLE_RULE) continue;

                    const selText = (r.selectorText || '').trim();
                    const sels = selText.split(',').map(s => s.trim());
                    const st = r.style;

                    // 1) Icon-font override
                    const touchesIcons = sels.some(s => iconSelTargets.includes(s));
                    const ff = st && st.getPropertyValue('font-family');
                    const ffImp = st && st.getPropertyPriority && st.getPropertyPriority('font-family') === 'important';
                    if (touchesIcons && ff && /system-ui|-apple-system|Segoe UI|Roboto|Arial|sans-serif/i.test(ff) && ffImp) {
                        sheet.deleteRule(i); continue;
                    }

                    // 2) emailsPane / *email* block (min-height or overflow-anchor)
                    if (sels.some(s => /#emailsPane|\[id\*="email"\]|\[class\*="email"\]/i.test(s))) {
                        const mh = st.getPropertyValue('min-height');
                        const oa = st.getPropertyValue('overflow-anchor');
                        if (mh || oa) { sheet.deleteRule(i); continue; }
                    }

                    // 3) img, iframe { content-visibility: auto; }
                    const hasImg = sels.includes('img');
                    const hasIframe = sels.includes('iframe');
                    const cv = st.getPropertyValue('content-visibility');
                    if (cv && /auto/i.test(cv) && (hasImg || hasIframe)) {
                        sheet.deleteRule(i); continue;
                    }

                    // 4) img { height: auto; }
                    if (selText === 'img') {
                        const h = st.getPropertyValue('height');
                        if (h && /auto/i.test(h)) { sheet.deleteRule(i); continue; }
                    }

                    // 5) link[rel="icon"] { }
                    if (/link\[rel=["']icon["']\]/i.test(selText)) {
                        sheet.deleteRule(i); continue;
                    }

                    // 6) input[type=search] { -webkit-appearance: none; }
                    if (sels.some(s => /^input\s*\[\s*type\s*=\s*["']?search["']?\s*\]$/i.test(s))) {
                        const ap = st.getPropertyValue('-webkit-appearance') || st.getPropertyValue('appearance');
                        if (ap && /none/i.test(ap)) { sheet.deleteRule(i); continue; }
                    }
                }
            }
        } catch (_) {}
    }

    function afterDomReady() {
        // Keep search inputs normal regardless of any remaining CSS
        const fix = document.createElement('style');
        fix.textContent = `
      input[type="search"] { -webkit-appearance: auto !important; appearance: auto !important; }
      #Packages-Block-Toronto,
      .panel:has(#Packages-Block-Toronto),
      .panel-heading:has(#Packages-Block-Toronto) { display: initial !important; visibility: initial !important; }
    `;
      document.documentElement.appendChild(fix);

      // Remove the sidebar block inside the navbar (leaves top navbar intact)
      try {
          const nav = document.querySelector('nav.navbar.navbar-default.navbar-static-top[role="navigation"]');
          const sidebar = nav && nav.querySelector('.navbar-static-side');
          if (sidebar) sidebar.remove();
      } catch (_) {}

      purgeRules();
  }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', afterDomReady, { once: true });
    } else {
        afterDomReady();
    }
})();
