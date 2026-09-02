// ==UserScript==
// @name         Gmail Quote Search
// @namespace    jack.gmail.legacy
// @version      1.8
// @description  Autolink Legacy tokens, invoice IDs, and SC order IDs in Gmail; opens Legacy search page which submits on-page.
// @match        https://mail.google.com/*
// @match        https://*.google.com/*
// @run-at       document-end
// @grant        none
// ==/UserScript==

(() => {
    'use strict';

    // --- Config ---------------------------------------------------------------

    const SEARCH_ACTION = 'https://extranet.strip-curtains.com/?p=search';
    const DEFAULT_EXTRA = '---';

    // Legacy token: 6–7 digits - 4–6 digits - 3 digits - P/S (case-insensitive)
    const DASH = String.raw`[-\u2010-\u2015\u2212]`;        // -, ‐–—― and minus sign
    const ZW   = String.raw`[\u200B\u200C\u200D\uFEFF]*`;  // zero-widths Gmail sometimes injects
    const WS   = String.raw`(?:[\s\u00A0]${ZW})+`;         // space/nbsp (+ optional zero-width)
    const OWS  = String.raw`(?:[\s\u00A0]${ZW})*`;         // optional space(s)
    const LEGACY_RE_SRC =
          String.raw`\b\d{6,7}${ZW}${DASH}${ZW}\d{4,6}${ZW}${DASH}${ZW}\d{3}${ZW}${DASH}${ZW}[PS]\b`;

    // AKON ORDER PO in subject: "AKON ORDER 437429-00" → link just "437429-00"
    // Always 6 digits, dash, 2 digits; tolerate fancy dashes/ZW and spacing.
    const AKON_ORDER_PO_RE_SRC =
          String.raw`(?<=\bAKON${WS}ORDER${WS})\d{6}${ZW}${DASH}${ZW}\d{2}\b`;

    // Invoice IDs (confirmed 6 digits starting with 1)
    const INV_AFTER_PREFIX_RE_SRC = String.raw`(?<=\bInvoice\s*#\s*)1\d{5}`;
    const INV_NEXTLINE_RE_SRC     = String.raw`(?<=\bInvoice\s*#[^\n\r]*[\r\n]+\s*)1\d{5}`;
    const INV_AFTER_2363_RE_SRC   = String.raw`(?<=\b2363-)1\d{5}`;

    // Subject-style: "1###### - anything"
    const INV_SUBJECT_STYLE_RE_SRC = String.raw`(?<!\d)1\d{5}(?=\s*-)`;

    // Watched-sender standalone invoice ids in body
    const INV_STANDALONE_RE_SRC = String.raw`(?<!\d)1\d{5}(?!\d)`;

    // SC order IDs: 'SC' + 12 digits (e.g., SC352022114699)
    const SC_ORDER_RE_SRC = String.raw`\bSC\d{12}\b`;

    // PO# <alnum/dash> … but only if it contains at least one digit.
    // Examples: "PO# 450123-A", "PO#A1-23-BC", "PO#12345"
    // Tolerates zero-width/nbsp around '#' and after it.
    const PO_AFTER_HASH_RE_SRC =
          String.raw`(?<=\bPO${OWS}#${OWS})(?=[A-Za-z0-9-]*\d)[A-Za-z0-9-]+(?![A-Za-z0-9-])`;

    // Combine (global)
    const BASE_GLOBAL_RE_SRC =
          `${LEGACY_RE_SRC}|${INV_AFTER_PREFIX_RE_SRC}|${INV_NEXTLINE_RE_SRC}|${INV_AFTER_2363_RE_SRC}|${INV_SUBJECT_STYLE_RE_SRC}|${SC_ORDER_RE_SRC}|${AKON_ORDER_PO_RE_SRC}|${PO_AFTER_HASH_RE_SRC}`;

    const SKIP_TAGS = new Set(['A','SCRIPT','STYLE','TEXTAREA','INPUT','SELECT','OPTION']);
    const FLAG_AUTOLINKED = 'data-legacynum-autolinked';
    let BUBBLE_CSS_ADDED = false;

    function injectBubbleCSS() {
        if (BUBBLE_CSS_ADDED) return;
        BUBBLE_CSS_ADDED = true;
        const css = `
          /* Blend-in chips */
      a[data-legacy-number="1"]{
        display:inline-block;
        padding:0.06em 0.44em;                 /* compact in list rows */
        margin-inline:2px;
        border-radius:9999px;
        font-weight:600;
        line-height:1.25;
        white-space:nowrap;
        text-decoration:none !important;
        color:#eef3ff !important;              /* soft white */
        /* darker, desaturated blue; subtle gradient & very low shadow */
        background:
          linear-gradient(180deg, hsl(225 28% 30%) 0%, hsl(225 30% 24%) 100%);
        border:1px solid hsl(225 22% 22% / 0.9);
        box-shadow: 0 1px 0 rgba(255,255,255,0.06) inset,
                    0 1px 2px rgba(0,0,0,0.10);
        transition: filter .12s ease, box-shadow .12s ease;
        vertical-align: baseline;
        font-variant-numeric: tabular-nums;
      }
      /* Quieter hover */
      a[data-legacy-number="1"]:hover{
        filter: brightness(1.04) saturate(1.02);
        box-shadow: 0 1px 0 rgba(255,255,255,0.08) inset,
                    0 2px 3px rgba(0,0,0,0.14);
      }
      a[data-legacy-number="1"]:active{
        filter: brightness(0.98);
      }
      a[data-legacy-number="1"]:focus-visible{
        outline:2px solid hsl(225 70% 75% / 0.8);
        outline-offset:2px;
      }
      /* Make chips even tighter in list view (thread rows) */
      tr.zA a[data-legacy-number="1"], .ae4 a[data-legacy-number="1"]{
        padding:0.02em 0.38em;
        font-weight:600;
      }
      /* Respect reduced motion */
      @media (prefers-reduced-motion: reduce){
        a[data-legacy-number="1"]{ transition:none; }
      }
      /* High-contrast / forced colors fallback */
      @media (forced-colors: active){
        a[data-legacy-number="1"]{
          background:ButtonFace; color:ButtonText !important;
          border:1px solid CanvasText;
        }
        a[data-legacy-number="1"]:focus-visible{
          outline:2px solid Highlight;
        }
      }
      /* Light mode tune (keeps the same vibe, just lighter) */
      @media (prefers-color-scheme: light){
        a[data-legacy-number="1"]{
          color:#0b1a3f !important;
          background: linear-gradient(180deg, hsl(225 55% 92%) 0%, hsl(225 50% 85%) 100%);
          border:1px solid hsl(225 35% 72%);
          box-shadow: 0 1px 0 rgba(255,255,255,0.7) inset,
                      0 1px 1px rgba(0,0,0,0.05);
        }
        a[data-legacy-number="1"]:focus-visible{ outline-color:hsl(225 70% 55% / 0.9); }
      }
     `;

        const style = document.createElement('style');
        style.setAttribute('data-tmx-bubble-css','1');
        style.textContent = css;
        (document.head || document.documentElement).appendChild(style);
    }

    // Watched senders whose bodies should also auto-link any standalone 1######
    const WATCHED_SENDERS = ['peter@strip-curtains.com', 'shipping@strip-curtains.com'];

    // --- Utils ----------------------------------------------------------------

    const norm = (s) => String(s || '').replace(/\u00A0/g,' ').replace(/\s+/g,' ').trim();

    function buildLegacyUrl(q, extra = DEFAULT_EXTRA) {
        const url  = new URL(SEARCH_ACTION);
        url.hash   = new URLSearchParams({ autosearch: '1', q: norm(q), extra }).toString();
        return url.toString();
    }

    function openLegacySearch(q) {
        window.open(buildLegacyUrl(q), '_blank', 'noopener,noreferrer');
    }

    function replaceMatchesInTextNode(textNode, reSrc) {
        const text = textNode.nodeValue;
        if (!text) return;

        const TEST_RE = new RegExp(reSrc, 'i');
        if (!TEST_RE.test(text)) return;

        const re = new RegExp(reSrc, 'gi');
        let m, last = 0;
        const frag = document.createDocumentFragment();

        while ((m = re.exec(text)) !== null) {
            const start = m.index;
            const matched = m[0];
            const end = start + matched.length;

            if (start > last) frag.appendChild(document.createTextNode(text.slice(last, start)));

            const tokenOrId = matched;
            const a = document.createElement('a');
            a.textContent = matched;
            a.href = buildLegacyUrl(tokenOrId);
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.setAttribute('data-legacy-number', '1');
            a.addEventListener('click', (e) => {
                e.preventDefault();
                openLegacySearch(tokenOrId);
            });

            frag.appendChild(a);
            last = end;
        }

        if (last < text.length) frag.appendChild(document.createTextNode(text.slice(last)));

        const parent = textNode.parentNode;
        if (parent) {
            parent.replaceChild(frag, textNode);
            parent.setAttribute(FLAG_AUTOLINKED, '1');
        }
    }

    function autolink(root, reSrc) {
        const ANY_RE_TEST = new RegExp(reSrc, 'i');

        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const p = node.parentNode;
                    if (!p || p.nodeType !== 1) return NodeFilter.FILTER_REJECT;
                    if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
                    if (p.closest('a,button,[role="button"],[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;

                    const cs = p.ownerDocument.defaultView.getComputedStyle(p);
                    if (!cs || cs.display === 'none' || cs.visibility === 'hidden') return NodeFilter.FILTER_REJECT;

                    return ANY_RE_TEST.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
            }
        );

        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach((n) => replaceMatchesInTextNode(n, reSrc));
    }

    // Try to decide if a message body belongs to one of the watched senders.
    function bodyIsFromWatchedSender(bodyEl) {
        if (!bodyEl) return false;

        let el = bodyEl;
        for (let i = 0; el && i < 8; i++) {
            for (const email of WATCHED_SENDERS) {
                try {
                    if (el.querySelector && el.querySelector(`span[email="${email}"]`)) {
                        return true;
                    }
                } catch (e) { /* ignore */ }
            }
            el = el.parentElement;
        }
        return false;
    }

    function scan() {
        injectBubbleCSS(); // ensure bubble styles are present before we inject links
        // Pass 1 (GLOBAL)
        autolink(document.body || document.documentElement, BASE_GLOBAL_RE_SRC);

        // Pass 2 (SENDER-SCOPED): in bodies from peter@ / shipping@ also link any standalone 1######
        const EXTENDED_RE_SRC = `${BASE_GLOBAL_RE_SRC}|${INV_STANDALONE_RE_SRC}`;
        const bodies = document.querySelectorAll('div.a3s'); // Gmail message bodies
        bodies.forEach((body) => {
            if (bodyIsFromWatchedSender(body)) {
                autolink(body, EXTENDED_RE_SRC);
            }
        });
    }

    // --- Boot & dynamic updates ----------------------------------------------

    scan(); // initial

    let scheduled = false;
    function schedule() {
        if (scheduled) return;
        scheduled = true;
        (window.requestAnimationFrame || setTimeout)(() => {
            try { scan(); } finally { scheduled = false; }
        }, 16);
    }

    const mo = new MutationObserver((muts) => {
        for (const m of muts) {
            if ((m.type === 'childList' && m.addedNodes && m.addedNodes.length) || m.type === 'characterData') {
                schedule();
                break;
            }
        }
    });

    mo.observe(document.documentElement, { subtree: true, childList: true, characterData: true });
    window.addEventListener('hashchange', schedule, true);
})();
