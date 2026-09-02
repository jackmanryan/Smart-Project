// ==UserScript==
// @name         ExtraLinks
// @namespace    sc/extranet/tools
// @version      1.5
// @description  Rewrites internal shipment links -> UPS; autolinks UPS numbers; links ####CDS tokens to Shopify Orders search using the first eligible email found on the page (excludes strip-curtains.com, singersafety.com, extruflex.com). Falls back to token search if no eligible email.
// @match        https://extranet.strip-curtains.com/*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor&priceCheck=true*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    // ---------- config ----------
    // ==== NEW: Shopify Canada settings ====
    const SHOPIFY_STORE_CA = 'https://admin.shopify.com/store/stripcurtainscanada';
    const shopifySearchUrlFor = (storeBase, q) =>
    `${storeBase}/orders?query=${encodeURIComponent(String(q || '').trim())}&link_source=search`;

    // ####CA token (4 digits + CA), case-insensitive
    const CA_TOKEN_RE = /\b(\d{4}CA)\b/gi;

    // flag so we don't reprocess the same nodes
    const FLAG_CA_AUTOLINKED = 'data-shopify-ca-autolinked';

    // ---- NEW: autolinker for ####CA tokens (email-first; digits-only fallback) ----
    function autolinkCaTokens(root) {
        const pageEmail = getSearchQuery(); // from your existing findEligibleEmail() + cache

        autolinkByRegex(root, CA_TOKEN_RE, (tokenRaw) => {
            const token = norm(tokenRaw);
            // fallback uses digits only (e.g., "2146" from "2146CA"), matching your example URL
            const digitsOnly = token.replace(/\D+/g, '');
            const query = (pageEmail && pageEmail.length) ? pageEmail : digitsOnly;

            const a = document.createElement('a');
            a.href = shopifySearchUrlFor(SHOPIFY_STORE_CA, query);
            a.textContent = tokenRaw;     // keep "####CA" as visible text
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.setAttribute('data-shopify-ca', '1');
            return a;
        }, FLAG_CA_AUTOLINKED);
    }

    const SHOPIFY_STORE = 'https://admin.shopify.com/store/f70388-f2';
    const shopifySearchUrl = (q) =>
    `${SHOPIFY_STORE}/orders?query=${encodeURIComponent(String(q || '').trim())}&link_source=search`;

    const EXCLUDED_EMAIL_DOMAINS = new Set([
        'strip-curtains.com',
        'singersafety.com',
        'extruflex.com',
    ]);

    // token to link (####CDS → 4 digits then CDS, case-insensitive)
    const CDS_TOKEN_RE = /\b(\d{4}CDS)\b/gi;

    // pragmatic email matcher (avoid trailing punctuation with lookahead)
    const EMAIL_RE = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}(?=$|[^A-Z0-9._%+-])/gi;

    // UPS conversion still supported
    const UPS_PREFIX = 'https://www.ups.com/track?tracknum=';
    const TRACK_RE = /\b(1ZR5263W[0-9A-Z]{10}|1ZX8788Y[0-9A-Z]{10})\b/gi;

    // internal shipments → UPS
    const TARGET_HOST = 'extranet.strip-curtains.com';
    const TARGET_PAGE = 'shipment-fullprogress';
    const TARGET_PARAM = 'shipment';

    // skip autolinking in these
    const SKIP_TAGS = new Set(['A', 'SCRIPT', 'STYLE', 'TEXTAREA', 'INPUT', 'SELECT', 'OPTION']);

    // flags
    const FLAG_LINK_REWRITTEN   = 'data-ups-rewritten';
    const FLAG_TEXT_AUTOLINKED  = 'data-ups-autolinked';
    const FLAG_EMAIL_AUTOLINKED = 'data-shopify-email-autolinked';
    const FLAG_CDS_AUTOLINKED   = 'data-shopify-cds-autolinked';

    // ---------- helpers ----------
    const S = v => (v == null ? '' : String(v));
    const norm = s => S(s).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
    const toUPSUrl = tracking => UPS_PREFIX + encodeURIComponent(String(tracking || '').trim());

    function emailDomain(addr) {
        const at = String(addr || '').lastIndexOf('@');
        if (at < 0) return '';
        return String(addr.slice(at + 1)).replace(/[)\].,;:]+$/, '').toLowerCase();
    }
    const isExcludedEmail = addr => EXCLUDED_EMAIL_DOMAINS.has(emailDomain(addr));

    // Find first eligible email on page (prefer mailto: links, then visible text)
    function findEligibleEmail(root) {
        // 1) mailto: links
        const mailtos = root.querySelectorAll('a[href^="mailto:" i]');
        for (const a of mailtos) {
            const addr = a.getAttribute('href').slice(7).split('?')[0]; // after 'mailto:'
            if (addr && EMAIL_RE.test(addr) && !isExcludedEmail(addr)) return addr;
        }
        // 2) visible text
        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
        let node;
        while ((node = walker.nextNode())) {
            const p = node.parentNode;
            if (!p || p.nodeType !== 1) continue;
            if (SKIP_TAGS.has(p.tagName)) continue;
            if (p.closest('a,[contenteditable="true"]')) continue;
            const t = node.nodeValue || '';
            EMAIL_RE.lastIndex = 0;
            let m;
            while ((m = EMAIL_RE.exec(t))) {
                const addr = m[0];
                if (!isExcludedEmail(addr)) return addr;
            }
        }
        return ''; // none found
    }

    // ---- generic text-node autolinker ----
    function replaceMatchesInTextNode(textNode, regex, makeNode, containerFlagAttr) {
        const text = textNode.nodeValue;
        if (!text) return;
        regex.lastIndex = 0;
        if (!regex.test(text)) return;
        regex.lastIndex = 0;

        const parent = textNode.parentNode;
        if (!parent) return;

        const frag = document.createDocumentFragment();
        let lastIndex = 0, m;
        while ((m = regex.exec(text)) !== null) {
            const start = m.index, end = start + m[0].length;
            if (start > lastIndex) frag.appendChild(document.createTextNode(text.slice(lastIndex, start)));
            frag.appendChild(makeNode(m[0]));
            lastIndex = end;
        }
        if (lastIndex < text.length) frag.appendChild(document.createTextNode(text.slice(lastIndex)));
        parent.replaceChild(frag, textNode);
        if (containerFlagAttr) parent.setAttribute(containerFlagAttr, '1');
    }

    function autolinkByRegex(root, regex, makeNode, containerFlagAttr) {
        const walker = document.createTreeWalker(
            root,
            NodeFilter.SHOW_TEXT,
            {
                acceptNode(node) {
                    const p = node.parentNode;
                    if (!p || p.nodeType !== 1) return NodeFilter.FILTER_REJECT;
                    if (SKIP_TAGS.has(p.tagName)) return NodeFilter.FILTER_REJECT;
                    if (p.closest('a,button,[role="button"]')) return NodeFilter.FILTER_REJECT;
                    if (p.closest('[contenteditable="true"]')) return NodeFilter.FILTER_REJECT;
                    if (containerFlagAttr && p.closest(`[${containerFlagAttr}="1"]`)) return NodeFilter.FILTER_REJECT;
                    return regex.test(node.nodeValue) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
                }
            },
            false
        );
        const nodes = [];
        while (walker.nextNode()) nodes.push(walker.currentNode);
        nodes.forEach(n => replaceMatchesInTextNode(n, regex, makeNode, containerFlagAttr));
    }

    // ---------- UPS link rewrite (unchanged) ----------
    function isTargetShipmentLink(a) {
        let url;
        try { url = new URL(a.href); } catch { return false; }
        if (url.hostname !== TARGET_HOST) return false;
        const page = (url.searchParams.get('p') || '').toLowerCase();
        if (page !== TARGET_PAGE) return false;
        const shipment = url.searchParams.get(TARGET_PARAM);
        return Boolean(shipment && shipment.trim());
    }

    function rewriteShipmentLink(a) {
        if (!a || a.getAttribute(FLAG_LINK_REWRITTEN) === '1') return;
        if (!isTargetShipmentLink(a)) return;
        let url;
        try { url = new URL(a.href); } catch { return; }
        const tracking = url.searchParams.get(TARGET_PARAM);
        if (!tracking) return;
        a.href = toUPSUrl(tracking);
        a.target = '_blank';
        a.rel = 'noopener noreferrer';
        a.setAttribute(FLAG_LINK_REWRITTEN, '1');
    }

    function processExistingLinks(root) {
        const selector = 'a[href*="extranet.strip-curtains.com/"][href*="p=shipment-fullprogress"][href*="shipment="]';
        root.querySelectorAll(selector).forEach(rewriteShipmentLink);
    }

    function autolinkTrackingNumbers(root) {
        autolinkByRegex(root, TRACK_RE, (raw) => {
            const a = document.createElement('a');
            a.href = toUPSUrl(norm(raw));
            a.textContent = raw;
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.setAttribute(FLAG_LINK_REWRITTEN, '1');
            return a;
        }, FLAG_TEXT_AUTOLINKED);
    }

    // ---------- NEW: link ####CDS using page email ----------
    let cachedEmail = ''; // cache per page to avoid re-scans
    function getSearchQuery() {
        if (!cachedEmail) cachedEmail = findEligibleEmail(document.body || document);
        return cachedEmail || null; // null signals no eligible email
    }

    function autolinkCdsTokens(root) {
        const queryEmail = getSearchQuery(); // may be null
        autolinkByRegex(root, CDS_TOKEN_RE, (tokenRaw) => {
            const token = norm(tokenRaw);
            const q = queryEmail || token; // fallback to token if no email
            const a = document.createElement('a');
            a.href = shopifySearchUrl(q);
            a.textContent = tokenRaw; // display the ####CDS exactly as found
            a.target = '_blank';
            a.rel = 'noopener noreferrer';
            a.setAttribute('data-shopify-cds', '1');
            return a;
        }, FLAG_CDS_AUTOLINKED);
    }

    // ---------- initial pass ----------
    processExistingLinks(document);
    autolinkTrackingNumbers(document.body || document);
    autolinkCdsTokens(document.body || document);
    autolinkCaTokens(document.body || document);

    // ---------- observe for dynamic changes ----------
    let scheduled = false;
    function scheduleScan() {
        if (scheduled) return;
        scheduled = true;
        (window.requestAnimationFrame || setTimeout)(() => {
            try {
                // If DOM changed, re-check for an eligible email once.
                if (!cachedEmail) cachedEmail = findEligibleEmail(document.body || document);

                processExistingLinks(document);
                autolinkTrackingNumbers(document.body || document);
                autolinkCdsTokens(document.body || document);
                autolinkCaTokens(document.body || document);  // <-- NEW
            } finally { scheduled = false; }
        }, 16);
    }

    const mo = new MutationObserver((muts) => {
        for (const m of muts) {
            if (m.type === 'childList' && m.addedNodes && m.addedNodes.length) { scheduleScan(); break; }
            if (m.type === 'attributes' && m.target && m.target.tagName === 'A' && m.attributeName === 'href') { scheduleScan(); break; }
        }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ['href'] });
})();
