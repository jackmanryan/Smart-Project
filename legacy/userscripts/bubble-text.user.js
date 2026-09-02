// ==UserScript==
// @name         Bubble Text
// @namespace    jack.tools
// @version      1.13.0
// @description  Bubbles + gated copy. Auto-detects "naked entities" (IDs, dates, money incl. k/m/b), emails/phones (even inline next to buttons), name/company blocks, message columns, and order links. Consolidated passes, faster rescans, robust theming.
// @match        https://extranet.strip-curtains.com/*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    /* =========================
     CSS (contrast-safe)
     ========================= */
    const css = `
:root{
  --tm-bubble-bg:#1c2230; --tm-bubble-fg:#f2f4f8; --tm-bubble-bd:#2a3242; --tm-bubble-shadow:rgba(0,0,0,.22);
  --tm-pulse-ink:rgba(255,255,255,.75);
  /* Purple link-bubble palette (overrideable) */
  --tm-link-bubble-bg:#E3DFF2; /* bg */
  --tm-link-bubble-fg:#1c2230; /* text */
  --tm-link-bubble-bd:#cfc9f1; /* subtle border to match */
  --tm-bubble-max-w: 92vw;
}
[data-theme="light"]{--tm-bubble-bg:#1c2230;--tm-bubble-fg:#f2f4f8;--tm-bubble-bd:#2a3242;}
[data-theme="dark"]{--tm-bubble-bg:#10151c;--tm-bubble-fg:#e5e9ef;--tm-bubble-bd:#1b2130;--tm-pulse-ink:rgba(255,255,255,.65);}

/* Compact tables */
#page-wrapper .panel{margin-bottom:12px!important;}
#page-wrapper .panel-body{padding:10px 12px!important;}
#page-wrapper .panel-body>*{margin:8px 0;}
#page-wrapper .panel .table{margin-bottom:0!important;}
#page-wrapper .panel .table>tbody>tr>td{padding:6px 8px!important;vertical-align:middle!important;}

/* Bubble core */
.tm-bubble{
  display:inline-block;padding:3px 10px;background:var(--tm-bubble-bg);color:var(--tm-bubble-fg);
  border:1px solid var(--tm-bubble-bd);border-radius:12px;font-weight:600;line-height:1.18;
  white-space:normal; word-break:normal; overflow-wrap:normal; hyphens:none;
  width:fit-content; max-width:var(--tm-bubble-max-w); box-shadow:0 1px 2px var(--tm-bubble-shadow) inset,0 0 0 1px rgba(255,255,255,.03);
  position:relative; user-select:text;
}
.tm-bubble a{color:inherit;text-decoration:underline;}
.tm-bubble:empty{display:none;}
/* List formatting inside bubbles */
.tm-bubble .tm-list{
  list-style:disc; margin:.25rem 0 0 1.2rem; padding:0;
}
.tm-bubble .tm-list .tm-li{
  display:list-item; margin:.1rem 0;
}
@keyframes tm-bubble-pulse{0%{box-shadow:0 0 0 0 var(--tm-pulse-ink);}100%{box-shadow:0 0 0 16px rgba(255,255,255,0);}}
.tm-bubble[data-copied="1"]::after{content:"";position:absolute;inset:-2px;border-radius:12px;pointer-events:none;animation:tm-bubble-pulse 520ms ease-out forwards;}

/* High specificity overrides vs table skins */
#page-wrapper table tbody tr>td>.tm-bubble,
table.table-striped tbody tr>td>.tm-bubble,
table.table-bordered tbody tr>td>.tm-bubble{all:unset;}
#page-wrapper table tbody tr>td>.tm-bubble,
table.table-striped tbody tr>td>.tm-bubble,
table.table-bordered tbody tr>td>.tm-bubble{
  display:inline-block!important;padding:3px 10px!important;background:var(--tm-bubble-bg)!important;color:var(--tm-bubble-fg)!important;
  border:1px solid var(--tm-bubble-bd)!important;border-radius:12px!important;font-weight:600!important;line-height:1.18!important;
  white-space:normal!important; word-break:normal!important; overflow-wrap:normal!important; hyphens:none!important;
  width:fit-content!important; max-width:var(--tm-bubble-max-w)!important;
  box-shadow:0 1px 2px var(--tm-bubble-shadow) inset,0 0 0 1px rgba(255,255,255,.03)!important; position:relative!important; user-select:text!important;
}
#page-wrapper table tbody tr>td>.tm-bubble a{color:currentColor!important;text-decoration:underline;}
/* Force contrasting ink inside bubbles (even in themed cells like .sorting_1) */
#page-wrapper table tbody tr>td>.tm-bubble,
#page-wrapper table tbody tr>td>.tm-bubble .tm-key,
#page-wrapper table tbody tr>td>.tm-bubble .tm-val,
#page-wrapper table tbody tr>td>.tm-bubble a{ color:var(--tm-bubble-fg)!important; }

/* Icons inherit but allow inline overrides */
#page-wrapper table tbody tr>td>.tm-bubble i,
#page-wrapper table tbody tr>td>.tm-bubble .fa,
#page-wrapper table tbody tr>td>.tm-bubble .glyphicon{ color:currentColor; }

.tm-bubble .tm-key{opacity:.9;margin-right:.35em;}
.tm-bubble .tm-val{white-space:nowrap; word-break:keep-all; overflow-wrap:normal; hyphens:none; font-variant-numeric:tabular-nums;}

.tm-bubble input,.tm-bubble select,.tm-bubble textarea{
  background:transparent!important;color:inherit!important;border:none!important;box-shadow:none!important;outline:none!important;
  padding:0!important;margin:0!important;font:inherit!important;line-height:inherit!important;
}
.tm-bubble textarea{width:100%!important;resize:vertical;}
.tm-bubble ::placeholder{color:rgba(233,237,242,.65)!important;}

#page-wrapper input.tm-field,#page-wrapper select.tm-field,#page-wrapper textarea.tm-field{
  background:#151a22!important;color:#fff!important;border:1px solid #2a3460!important;border-radius:12px!important;
  box-shadow:0 0 0 1px #2a3460!important;padding:6px 10px!important;line-height:1.18!important;
}
#page-wrapper textarea.tm-field{resize:vertical;}
#page-wrapper .tm-field:disabled{opacity:.85;}
#page-wrapper .tm-field::placeholder{color:rgba(233,237,242,.65)!important;}

html[data-tm-copy-enabled="1"] .tm-bubble{cursor:copy!important;}
html[data-tm-copy-enabled="0"] .tm-bubble{cursor:text!important;}

/* Purple href/link bubble treatment */
.tm-bubble--order-link{
  --tm-bubble-bg: var(--tm-link-bubble-bg);
  --tm-bubble-fg: var(--tm-link-bubble-fg);
  --tm-bubble-bd: var(--tm-link-bubble-bd);
}
.tm-bubble--order-link a{text-decoration:underline;color:inherit;}
.tm-bubble--order-link i{opacity:.95;}
`;
    const styleEl = document.createElement('style');
    styleEl.id = 'tm-bubbles-style';
    styleEl.textContent = css;
    document.head.appendChild(styleEl);
    if (typeof GM_addStyle === 'function') GM_addStyle(css);

    /* =========================
     Utilities
     ========================= */
    const sleep = (ms) => new Promise(r => setTimeout(r, ms));
    const qsa = (sel, ctx = document) => Array.from(ctx.querySelectorAll(sel));
    const norm = (s) => (s || '').replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
    const BUTTON_SEL = 'button, [role="button"], .tm-copy-btn, .btn, a.btn';
    const isButtonLike = (el) =>
    !!el && el.nodeType === 1 && (
        el.matches?.(BUTTON_SEL) ||
        [...(el.classList || [])].some(c => c === 'btn' || c.startsWith('btn-'))
    );
    const targetHasButtonLike = (root) => !!root?.querySelector?.(BUTTON_SEL);

    const ORDER_LINK_SEL = [
        'a[href*="?p=orders-view"][href*="view="]',
        'a[href*="?p=orders-review"][href*="review="]',
        'a[href*="?p=3partyshipment"][href*="view="]'
    ].join(',');
    /* Expanded link-bubble targets (keep ORDER_LINK_SEL for heuristics) */
    const LINK_BUBBLE_SEL = [
        ORDER_LINK_SEL,
        /* Leads → MessageCenter */
        'a[href*="?p=leads_view2"][href*="#MessageCenter-Block"]',
        /* Direct PDF downloads */
        'a[href$=".pdf"]',
        /* Modal action links */
        'a[rel="modal:open"]',
        /* Accordion/Conversation toggles */
        'a[href^="#conversation"]',
        /* UPS tracking */
        'a[href*="ups.com/track"]'
    ].join(',');

    const CODES = /(?:USD|CAD|AUD|EUR|GBP|MXN|NZD|JPY|CNY|INR|CHF|SEK|NOK|DKK|ZAR)/i;
    const MONEY_CORE = String.raw`\d{1,3}(?:,\d{3})*(?:\.\d+)?`;
    const MONEY_SUFFIX = /(?:k|m|b|bn|mm)/i; // 122k, 3.2m, 1bn, 250mm
    const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/;
    const PHONE_RE = /\+?\d[\d().\s\-]{7,}\d/;

    const ric = window.requestIdleCallback || (cb => setTimeout(() => cb({ timeRemaining: () => 1 }), 0));

    /* =========================
     Detection helpers
     ========================= */
    const looksLikeLabel = (text) => {
        const t = norm(text || '');
        if (!t) return false;
        if (t.endsWith(':')) return true;
        return (t.length <= 24 && /^[\w\s().#&/+\-]+:?$/i.test(t));
    };

    const isShortPlainLabelish = (txt) => {
        const t = norm(txt);
        if (!t) return false;
        if (t.length > 28) return false;
        if (/\r|\n/.test(t)) return false;
        if (/\d/.test(t)) return false;
        if (!/[A-Za-z]/.test(t)) return false;
        if (/^(?:View Items|popup|>|<)$/i.test(t)) return false;
        return true;
    };

    const isTokenish = (s) => /(\S{10,}|\d{8,})/.test(s || '');

    const isMoneyish = (txt) => {
        const t = norm(txt); if (!t) return false;
        // Exact whole-cell money (code/symbol before or after), with optional k/m/b suffix
        const before = new RegExp(`^(?:${CODES.source})\\s*${MONEY_CORE}(?:\\s*${MONEY_SUFFIX.source})?$`, 'i');
        const after  = new RegExp(`^${MONEY_CORE}(?:\\s*${MONEY_SUFFIX.source})?\\s*(?:${CODES.source})$`, 'i');
        const symbol = new RegExp(`^[€£$]\\s*${MONEY_CORE}(?:\\s*${MONEY_SUFFIX.source})?$`);
        return before.test(t) || after.test(t) || symbol.test(t);
    };

    const containsMoneyish = (txt) => {
        const t = norm(txt); if (!t) return false;
        const any = new RegExp(`(?:[€£$]\\s*)?${MONEY_CORE}(?:\\s*${MONEY_SUFFIX.source})?(?:\\s*(?:${CODES.source}))?`, 'i');
        return any.test(t);
    };

    const containsEmail = (txt) => EMAIL_RE.test(txt || '');
    const containsPhone = (txt) => PHONE_RE.test(txt || '');

    const isPureId   = (t) => /^\d{4,}$/.test(t);
    const isHyphId   = (t) => /^\d[\d,]*-\d+$/.test(t);
    const isIsoDate  = (t) => /^\d{4}-\d{2}-\d{2}$/.test(t);
    const isZeroDate = (t) => /^0{4}-0{2}-0{2}$/.test(t);
    const isNumericish = (txt) => {
        const t = norm(txt);
        if (!t) return false;
        if (/[A-Za-z]/.test(t)) return false;
        return /^[-+]?\d[\d,]*(?:\.\d+)?$/.test(t);
    };

    const isSentenceLike = (t) => {
        const s = norm(t);
        if (!s) return false;
        const words = s.split(' ').filter(Boolean).length;
        if (words < 4) return false;
        if (s.length < 20) return false;
        // avoid pure ids/money/date
        if (isMoneyish(s) || isPureId(s) || isIsoDate(s) || isZeroDate(s) || isNumericish(s)) return false;
        return /[A-Za-z]/.test(s);
    };

    const splitKeyVal = (text) => {
        const colonCount = (text.match(/:/g) || []).length;
        if (colonCount !== 1) return null; // e.g. "... Type: X Auth Code: Y ..." → don't decorate
        const i = text.indexOf(':');
        if (i > 1 && i <= 24) {
            const key = norm(text.slice(0, i + 1));
            const val = norm(text.slice(i + 1));
            if (key && val) return { key, val };
        }
        return null;
    };

    /* =========================
     Bubble builders
     ========================= */
    function ensureUnbroken(bubble) {
        const capPx = Math.floor(Math.min(window.innerWidth * 0.92, 99999));
        const measureEl = bubble.querySelector('.tm-val') || bubble;
        bubble.style.maxInlineSize = '';
        bubble.style.maxWidth = '';
        requestAnimationFrame(() => {
            const cw = measureEl.clientWidth;
            const sw = measureEl.scrollWidth;
            if (sw > cw) {
                const target = Math.min(sw + 12, capPx);
                bubble.style.maxInlineSize = target + 'px';
                bubble.style.maxWidth = target + 'px';
            }
        });
    }

    // Split "Key: Value" while PRESERVING markup (e.g., <br>) in the value.
    function decorateKeyVal(bubble) {
        if (bubble.dataset.tmDecorated === '1') return;
        if (bubble.classList.contains('tm-bubble--order-link')) return; // never split link bubbles
        if (bubble.querySelector('a')) return; // if links are inside, skip splitting

        const rawText = bubble.textContent || '';
        if (!rawText) return;
        const colonPos = rawText.indexOf(':');
        // only treat short labels like "Source (1):"
        if (colonPos < 1 || colonPos > 24) return;

        // Build label text
        const label = norm(rawText.slice(0, colonPos + 1));
        if (!label) return;

        // Remove label text from the leading text nodes only (preserve <br>, <div>, etc.)
        let remaining = label.length;
        const walker = document.createTreeWalker(bubble, NodeFilter.SHOW_TEXT, null);
        const toRemove = [];
        let node;
        while (remaining > 0 && (node = walker.nextNode())) {
            const s = node.nodeValue || '';
            if (!s.length) continue;
            if (s.length <= remaining) {
                remaining -= s.length;
                toRemove.push(node);
            } else {
                node.nodeValue = s.slice(remaining);
                remaining = 0;
            }
        }
        toRemove.forEach(n => n.parentNode && n.parentNode.removeChild(n));

        // Create key/value shells and move the (now label-less) content into .tm-val
        const keyEl = document.createElement('span');
        keyEl.className = 'tm-key';
        keyEl.textContent = label;
        const valEl = document.createElement('span');
        valEl.className = 'tm-val';
        while (bubble.firstChild) valEl.appendChild(bubble.firstChild);
        bubble.append(keyEl, document.createTextNode(' '), valEl);

        maybeSplitValList(valEl);
        bubble.dataset.tmDecorated = '1';
    }

    // If the value looks like an inline list, split into bullets (keeps things readable).
    function maybeSplitValList(valEl){
        if (!valEl) return;
        if (valEl.querySelector('br, p, div, ul, ol, li')) return; // already multiline
        const raw = norm(valEl.textContent || '');
        if (!raw || raw.length < 40) return;

        // Heuristic: repeated item-like tokens (e.g., "1 unit", "15 strips", "15.000 ft")
        const tokenRe = /\b\d+(?:\.\d+)?\s*(?:unit|units|strips|ft)\b/gi;
        const hits = raw.match(tokenRe);
        if (!hits || hits.length < 2) return;

        // Insert a newline before each subsequent token to segment items
        let marked = raw.replace(tokenRe, (m, offset) => (offset > 0 ? '\n' : '') + m);
        // Also respect common trailers like "All from us"
        marked = marked.replace(/\s+(All\s+from\s+us)\b/i, '\n$1');

        const lines = marked.split('\n').map(s => s.trim()).filter(Boolean);
        if (lines.length < 2) return;

        // Rebuild as a list
        valEl.textContent = '';
        const ul = document.createElement('ul');
        ul.className = 'tm-list';
        lines.forEach(t => {
            const li = document.createElement('li');
            li.className = 'tm-li';
            li.textContent = t;
            ul.appendChild(li);
        });
        valEl.appendChild(ul);
    }

    function wrapValueCell(td) {
        if (!td || td.dataset.tmBubbled === '1') return null;
        if (targetHasButtonLike(td)) { td.dataset.tmBubbled = '1'; styleControlsIn(td); return null; }
        if (td.querySelector(':scope > input, :scope > textarea, :scope > select')) { td.dataset.tmBubbled = '1'; styleControlsIn(td); return null; }
        const visibleText = norm(td.textContent);
        if (!visibleText) return null;
        if (td.querySelector(':scope > .tm-bubble')) return td.querySelector(':scope > .tm-bubble');

        const bubble = document.createElement('span');
        bubble.className = 'tm-bubble';
        bubble.title = gate.isOn()
            ? 'Click: copy value • Double-click: copy row'
        : 'Enable “Copy Buttons” in ExtraNav to copy';

        while (td.firstChild) bubble.appendChild(td.firstChild);
        td.appendChild(bubble);
        td.dataset.tmBubbled = '1';
        // Preserve original multi-line cells; otherwise split "Key: Value"
        decorateKeyVal(bubble);
        if (isTokenish(bubble.textContent)) ensureUnbroken(bubble);
        return bubble;
    }

    function bubbleOrderLinkAnchor(a) {
        if (!a || a.dataset.tmLinkBubbled === '1' || isButtonLike(a)) return;
        // If the anchor is already inside a bubble, just promote that bubble to link style.
        const host = a.closest('.tm-bubble');
        if (host) {
            host.classList.add('tm-bubble--order-link');
            try { a.style.setProperty('float', 'none', 'important'); } catch {}
            a.style.setProperty('color', 'inherit', 'important');
            a.dataset.tmLinkBubbled = '1';
            return;
        }
        const bubble = document.createElement('span');
        bubble.className = 'tm-bubble tm-bubble--order-link';
        try { a.style.setProperty('float', 'none', 'important'); } catch {}
        a.style.setProperty('color', 'inherit', 'important');
        a.dataset.tmLinkBubbled = '1';
        a.replaceWith(bubble);
        bubble.appendChild(a);
    }

    // NEW: bubble inline entities when a cell has controls/buttons
    function tryInlineEntityBubbles(td) {
        let found = false;
        const patterns = [
            { re: EMAIL_RE,  name: 'email' },
            { re: PHONE_RE,  name: 'phone' },
            { re: new RegExp(`(?:[€£$]\\s*)?${MONEY_CORE}(?:\\s*${MONEY_SUFFIX.source})?(?:\\s*(?:${CODES.source}))?`, 'i'), name: 'money' },
            { re: /\b\d{4}-\d{2}-\d{2}\b/, name: 'date' },
            { re: /\b\d{4,}\b/, name: 'id' }
        ];

        // 1) wrap obvious inline elements
        qsa(':scope > strong, :scope > b, :scope > span, :scope > i, :scope > em', td).forEach(el => {
            const t = norm(el.textContent || '');
            if (!t || el.closest('.tm-bubble')) return;
            if (patterns.some(p => p.re.test(t))) {
                const bubble = document.createElement('span');
                bubble.className = 'tm-bubble';
                bubble.title = gate.isOn()? 'Click: copy value • Double-click: copy row' : 'Enable “Copy Buttons” in ExtraNav to copy';
                el.replaceWith(bubble);
                bubble.appendChild(el);
                found = true;
            }
        });
        if (found) return true;

        // 2) split a text node once to wrap the first match
        const walker = document.createTreeWalker(td, NodeFilter.SHOW_TEXT, {
            acceptNode(node) {
                if (!node || !node.nodeValue) return NodeFilter.FILTER_REJECT;
                if (!node.parentElement) return NodeFilter.FILTER_REJECT;
                if (node.parentElement.closest('a,button,select,input,textarea,.tm-bubble')) return NodeFilter.FILTER_REJECT;
                const s = node.nodeValue;
                for (const p of patterns) if (p.re.test(s)) return NodeFilter.FILTER_ACCEPT;
                return NodeFilter.FILTER_SKIP;
            }
        });
        let textNode;
        while ((textNode = walker.nextNode())) {
            const s = textNode.nodeValue;
            const pattern = patterns.find(p => p.re.test(s));
            if (!pattern) continue;
            const m = s.match(pattern.re);
            if (!m) continue;
            const idx = m.index;
            const before = s.slice(0, idx);
            const mid = m[0];
            const after = s.slice(idx + mid.length);
            const frag = document.createDocumentFragment();
            if (before) frag.appendChild(document.createTextNode(before));
            const bubble = document.createElement('span');
            bubble.className = 'tm-bubble';
            bubble.title = gate.isOn()? 'Click: copy value • Double-click: copy row' : 'Enable “Copy Buttons” in ExtraNav to copy';
            bubble.textContent = mid;
            frag.appendChild(bubble);
            if (after) frag.appendChild(document.createTextNode(after));
            textNode.replaceWith(frag);
            found = true; break;
        }
        return found;
    }

    /* =========================
     Form styling passthrough
     ========================= */
    function styleControlsIn(root) {
        root.querySelectorAll?.('input[type="text"], input:not([type]), input[type="number"], textarea, select')
            .forEach(el => { if (!el.classList.contains('tm-field')) el.classList.add('tm-field'); });
    }
    function styleLooseControls(root = document) {
        root.querySelectorAll('input[type="text"], input:not([type]), input[type="number"], textarea, select')
            .forEach(el => {
            if (el.closest('table tbody tr')) return;
            if (!el.classList.contains('tm-field')) el.classList.add('tm-field');
        });
    }

    /* =========================
     Classification & scanning
     ========================= */
    function cleanNodeText(el) {
        const c = el.cloneNode(true);
        qsa(`script,style,noscript,svg,[aria-hidden="true"],.tm-copy-wrap, ${BUTTON_SEL}`, c).forEach(n => n.remove());
        return norm(c.innerText || c.textContent || '');
    }

    function detectMessageColumnIndex(table) {
        // 1) Use header names when present
        const headers = Array.from(table.querySelectorAll('thead tr th')).map(th => norm(cleanNodeText(th)));
        if (headers.length) {
            const idx = headers.findIndex(h => /^(message|messages|note|notes|comment|comments|detail|details?)$/i.test(h));
            if (idx >= 0) return idx;
        }
        // 2) Fallback: if col-0 is an order link bubble/anchor and row has >=5 cols, assume col-4 is the message
        const firstRow = table.querySelector('tbody tr');
        if (firstRow) {
            const c0 = firstRow.querySelector(':scope > td:nth-child(1), :scope > th:nth-child(1)');
            const hasOrder = !!(c0 && (c0.querySelector('.tm-bubble--order-link') || c0.querySelector(ORDER_LINK_SEL)));
            const colCount = firstRow.querySelectorAll(':scope > td, :scope > th').length;
            if (hasOrder && colCount >= 5) return 4;
        }
        // 3) Heuristic: pick the column with longest average "sentence-like" content across first few rows
        const rows = Array.from(table.querySelectorAll('tbody tr')).slice(0, 8);
        if (!rows.length) return -1;
        const colLen = Math.max(...rows.map(r => r.querySelectorAll(':scope > td, :scope > th').length));
        const scores = new Array(colLen).fill(0);
        rows.forEach(r => {
            const cells = Array.from(r.querySelectorAll(':scope > td, :scope > th'));
            cells.forEach((td, i) => {
                if (!td) return;
                if (td.querySelector(':scope > a, :scope > button, :scope > input, :scope > select, :scope > textarea')) return;
                const t = norm(td.textContent);
                if (!t) return;
                if (isSentenceLike(t)) scores[i] += Math.min(80, t.length) + t.split(' ').length * 2;
            });
        });
        const best = scores.reduce((bi, s, i) => (s > scores[bi] ? i : bi), 0);
        return scores[best] > 0 ? best : -1;
    }

    function scanTable(table) {
        const tbodyRows = qsa(':scope > tbody > tr', table);
        const msgColIdx = detectMessageColumnIndex(table);

        tbodyRows.forEach(tr => {
            const cells = Array.from(tr.querySelectorAll(':scope > td, :scope > th'));
            if (!cells.length) return;

            // Label:Value pattern → bubble the value cell
            if (cells.length >= 2) {
                const first = norm(cells[0].textContent);
                if (looksLikeLabel(first) && !cells[1].querySelector(':scope > .tm-bubble')) {
                    const b = wrapValueCell(cells[1]);
                    if (b && isTokenish(b.textContent)) ensureUnbroken(b);
                }
            }

            cells.forEach((td, i) => {
                // Bubble order-link anchors
                const a = td.querySelector(LINK_BUBBLE_SEL);
                if (a) bubbleOrderLinkAnchor(a);

                // If interactive content present: attempt inline entity bubbling (emails/phones/money/date/id)
                if (td.querySelector(':scope > a, :scope > button, :scope > input, :scope > select, :scope > textarea')) {
                    tryInlineEntityBubbles(td);
                    return;
                }

                if (td.dataset.tmBubbled === '1' || td.querySelector(':scope > .tm-bubble')) return;

                const text = norm(td.textContent);
                if (!text) return;

                // Message column (explicit or heuristic)
                if (i === msgColIdx && isSentenceLike(text)) { wrapValueCell(td); return; }

                // Name <br> Company
                if (/<br\s*\/?>/i.test(td.innerHTML)) {
                    const t = text; if (t.length >= 6 && t.length <= 72 && /[A-Za-z]/.test(t)) { wrapValueCell(td); return; }
                }

                // Naked entities (exact cell)
                if (isPureId(text) || isHyphId(text) || isIsoDate(text) || isZeroDate(text) || isMoneyish(text)) {
                    wrapValueCell(td); return;
                }

                // Containing money (e.g., "$122k order")
                if (text.length <= 120 && containsMoneyish(text)) { wrapValueCell(td); return; }

                // Short human-ish chips (status/platform/etc.)
                if (isShortPlainLabelish(text)) { wrapValueCell(td); return; }

                // Long tokens (refs, hashes)
                if (text.length <= 64 && isTokenish(text)) { const b = wrapValueCell(td); if (b) ensureUnbroken(b); return; }
            });
        });
    }

    function scan(root = document) {
        // Bubble targeted hrefs anywhere (including inside existing text bubbles)
        qsa(LINK_BUBBLE_SEL, root)
            .filter(a => a && a.dataset.tmLinkBubbled !== '1')
            .forEach(bubbleOrderLinkAnchor);

        // Main tables
        qsa('table', root).forEach(scanTable);

        // Loose controls
        styleLooseControls(root);
    }

    /* =========================
     Gate (ExtraNav)
     ========================= */
    const gate = (() => {
        function getNavShadowRoot(){ const host = document.getElementById('scx-nav-host'); return host?.shadowRoot || null; }
        function findToggle(){
            const sr = getNavShadowRoot();
            return (
                (sr && (sr.querySelector('#st_s2') || sr.querySelector('[data-name="copy"] input[type="checkbox"]'))) ||
                document.querySelector('#st_s2') ||
                document.querySelector('[data-name="copy"] input[type="checkbox"]')
            );
        }
        const isOn = () => !!(findToggle() && findToggle().checked);
        function reflectAttr(){
            const on = isOn();
            document.documentElement.setAttribute('data-tm-copy-enabled', on ? '1' : '0');
            qsa('.tm-bubble').forEach(b => {
                b.title = on ? 'Click: copy value • Double-click: copy row' : 'Enable “Copy Buttons” in ExtraNav to copy';
            });
        }
        let toggleBound = false;
        function bindWatcher(){
            const t = findToggle();
            if (t && !toggleBound){ toggleBound = true; t.addEventListener('change', reflectAttr, { passive:true }); }
            const host = document.getElementById('scx-nav-host') || document.documentElement;
            const mo = new MutationObserver(() => {
                const tt = findToggle();
                if (tt && !toggleBound){ toggleBound = true; tt.addEventListener('change', reflectAttr, { passive:true }); reflectAttr(); }
            });
            mo.observe(document.documentElement, { childList:true, subtree:true });
            if (host && host !== document.documentElement) mo.observe(host, { childList:true, subtree:true });
        }
        async function init(){ for (let i=0;i<50 && !getNavShadowRoot();i++) await sleep(100); bindWatcher(); reflectAttr(); }
        return { init, isOn, reflectAttr };
    })();

    /* =========================
     Copy & events
     ========================= */
    function labelForBubble(bubble) {
        const td = bubble.closest('td,th');
        const tr = td?.closest('tr');
        if (!td || !tr) return '';
        const idx = Array.from(tr.children).indexOf(td);
        const table = tr.closest('table');
        if (table) {
            const ths = table.querySelectorAll('thead tr th');
            if (ths && ths[idx]) {
                const h = norm(cleanNodeText(ths[idx]));
                if (h) return h.replace(/:$/, '');
            }
        }
        const first = tr.querySelector(':scope > td:first-child, :scope > th:first-child');
        return norm((first && cleanNodeText(first)) || '').replace(/:$/, '');
    }
    const valueForBubble = (bubble) => {
        const v = bubble.querySelector('.tm-val');
        return norm(cleanNodeText(v || bubble));
    };
    function formatRow(tr) {
        const tds = Array.from(tr.querySelectorAll(':scope > td, :scope > th'));
        const values = tds.map(td => cleanNodeText(td)).filter(Boolean);
        if (!values.length) return '';
        const table = tr.closest('table');
        let headers = [];
        if (table) headers = Array.from(table.querySelectorAll('thead tr th')).map(th => norm(cleanNodeText(th)));
        if (headers.length && headers.length >= values.length) {
            return values.map((v, i) => (headers[i] ? `${headers[i]}: ${v}` : v)).join(' | ');
        }
        if (values.length >= 2) {
            const lhs = values[0].replace(/:$/, ''), rhs = values[1], tail = values.slice(2);
            return tail.length ? `${lhs}: ${rhs} | ${tail.join(' | ')}` : `${lhs}: ${rhs}`;
        }
        return values.join(' | ');
    }
    async function copyText(txt) {
        try { await navigator.clipboard.writeText(txt); return true; }
        catch {
            const ta = document.createElement('textarea');
            ta.value = txt; ta.style.position = 'fixed'; ta.style.top = '-2000px'; ta.setAttribute('readonly','readonly');
            document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); } catch {}
            ta.remove(); return true;
        }
    }
    const pulse = (el) => { el.setAttribute('data-copied','1'); setTimeout(() => el.removeAttribute('data-copied'), 600); };

    const clickTimers = new WeakMap();

    document.addEventListener('click', (e) => {
        if (e.target && (isButtonLike(e.target) || e.target.closest(BUTTON_SEL))) return;
        const bubble = e.target.closest?.('.tm-bubble');
        if (!bubble) return;
        // Let real links behave normally, even when copy mode is ON
        if (bubble.classList.contains('tm-bubble--order-link') && bubble.querySelector('a')) return;
        if (e.button !== 0 || e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;
        if (!gate.isOn()) return;
        const sel = window.getSelection?.();
        if (sel && sel.toString().length) return;
        e.preventDefault(); e.stopPropagation();
        if (clickTimers.has(bubble)) clearTimeout(clickTimers.get(bubble));
        const t = setTimeout(async () => {
            const label = labelForBubble(bubble);
            const value = valueForBubble(bubble);
            const line = label ? `${label}: ${value}` : value;
            const ok = await copyText(line);
            if (ok) pulse(bubble);
            clickTimers.delete(bubble);
        }, 220);
        clickTimers.set(bubble, t);
    }, true);

    document.addEventListener('dblclick', (e) => {
        if (e.target && (isButtonLike(e.target) || e.target.closest(BUTTON_SEL))) return;
        const bubble = e.target.closest?.('.tm-bubble');
        if (!bubble) return;
        if (bubble.classList.contains('tm-bubble--order-link') && bubble.querySelector('a')) return;
        if (!gate.isOn()) return;
        e.preventDefault(); e.stopPropagation();
        if (clickTimers.has(bubble)) { clearTimeout(clickTimers.get(bubble)); clickTimers.delete(bubble); }
        const tr = bubble.closest('tr'); if (!tr) return;
        const text = formatRow(tr); if (!text) return;
        copyText(text).then(ok => { if (ok) pulse(bubble); });
    }, true);

    /* =========================
     Forced bubble targets (legacy)
     ========================= */
    const $x = (xp, ctx = document) => {
        try {
            const snap = document.evaluate(xp, ctx, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null);
            const out = []; for (let i = 0; i < snap.snapshotLength; i++) out.push(snap.snapshotItem(i));
            return out;
        } catch { return []; }
    };
    const FORCE_XPATHS = [
        '/html/body/div[3]/div/div[2]/div/div/div[2]/table/tbody/tr[4]/td[5]',
        '/html/body/div[3]/div/div[2]/div/div/div[2]/table/tbody/tr[9]/td[5]',
        '/html/body/div[3]/div/div[2]/div/div/div[2]/div/div[2]/div/table/tbody/tr[1]/td[4]',
        '/html/body/div[3]/div/div[2]/div/div/div[2]/div/div[2]/div/table/tbody/tr[6]/td[2]'
    ];
    function forceBubbleTargets(root = document){
        FORCE_XPATHS.forEach(xp => {
            $x(xp, root).forEach(td => {
                if (td && td.nodeType === 1 && td.matches?.('td,th')) wrapValueCell(td);
            });
        });
    }

    /* =========================
     Observer (batched rescans)
     ========================= */
    let scheduled = false;
    const scheduleScan = (node = document) => {
        if (scheduled) return;
        scheduled = true;
        ric(() => { scheduled = false; scan(node); gate.reflectAttr(); });
    };

    const mo = new MutationObserver(muts => {
        let relevant = false;
        for (const m of muts) {
            if (m.type !== 'childList') continue;
            if (m.addedNodes?.length || m.removedNodes?.length) relevant = true;
        }
        if (relevant) scheduleScan(document);
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });

    // Initial run
    scan(document);
    forceBubbleTargets(document);
    gate.init();

    // Maintain fit on resize
    window.addEventListener('resize', () => {
        qsa('.tm-bubble').forEach(b => { if (isTokenish(b.textContent)) ensureUnbroken(b); });
    }, { passive: true });
})();
