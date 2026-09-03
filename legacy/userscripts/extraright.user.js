// ==UserScript==
// @name         ExtraRight
// @namespace    sc/extranet/tools
// @version      1.0
// @description  Replace right-click with a compact action menu on order pages: Gmail Search, Copy All Trackings, Shipping Address, Packing List. (No on-page buttons. Shift+Right-Click = native menu.)
// @match        https://extranet.strip-curtains.com/?p=orders-view&view=*
// @match        https://extranet.strip-curtains.com//?p=orders-view&view=*
// @run-at       document-end
// @grant        GM_setClipboard
// @license      MIT
// ==/UserScript==

(() => {
    'use strict';

    // ===========================
    // Utils
    // ===========================
    const S = v => (v == null ? '' : String(v));
    const norm = v => S(v).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();
    const toNum = s => {
        const n = parseFloat(S(s).replace(/[^\d.+-]/g, ''));
        return Number.isFinite(n) ? n : NaN;
    };
    const uniq = arr => {
        const seen = new Set();
        return (arr || []).filter(x => {
            const k = String(x).toUpperCase();
            if (!k || seen.has(k)) return false;
            seen.add(k);
            return true;
        });
    };
    const isBadSku = v => {
        const t = S(v).toUpperCase();
        return !t || /^(QTY|AMOUNT|DESCRIPTION|TOTAL|SUBTOTAL|WEIGHT)\b/.test(t) || /\b(LB|LBS|KG|G)\b/.test(t);
    };
    function sanitizeAscii300(input) {
        let s = S(input);
        s = s.replace(/[\u2018\u2019\u201B]/g,"'").replace(/[\u201C\u201D]/g,'"')
            .replace(/[\u2013\u2014\u2212]/g,'-').replace(/\u2026/g,'...')
            .replace(/_x000a_/gi,' ');
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g,'');
        s = s.replace(/[^A-Za-z0-9`~!@#$%^&*\-_=+,.\/\?;:'\[\]\{\}\\\|\(\)\s]/g,'');
        s = s.replace(/\s+/g,' ').trim();
        return s.length > 300 ? s.slice(0,300) : s;
    }

    // ===========================
    // Panel helpers (userscript-aware)
    // ===========================
    function __panelKV() {
        const map = Object.create(null);
        const canon = k => {
            const t = String(k || '').replace(/[:：]\s*$/, '').trim().toLowerCase();
            if (t==='sage sale/invoice #'||t==='sage invoice #'||t==='invoice #'||t==='invoice number'||t==='sage invoice'||t==='sage sale') return 'sage-invoice';
            if (t==='order #'||t==='order number') return 'order';
            if (t==='zip code'||t==='zipcode'||t==='zip'||t==='postal code'||t==='post code') return 'zip';
            if (t==='country/region'||t==='country') return 'country';
            if (t==='state'||t==='province') return 'state';
            if (t==='email'||t==='shipping email'||t==='e-mail'||t==='billing email') return 'email';
            if (t==='address'||t==='address 1') return 'address1';
            if (t==='address 2') return 'address2';
            if (t==='shipping company'||t==='company') return 'company';
            if (t==='phone'||t==='phone 1') return 'phone1';
            if (t==='phone 2') return 'phone2';
            if (t==='city') return 'city';
            return t;
        };
        document.querySelectorAll('.panel .table tr').forEach(tr => {
            const tds = tr.querySelectorAll('td,th');
            if (tds.length < 2) return;
            const k = canon(norm(tds[0].textContent || ''));
            const v = norm(tds[1].textContent || '');
            if (!k || !v) return;
            if (!(k in map)) map[k] = v;
        });
        return map;
    }

    // ===========================
    // Inline JSON + Gmail query
    // ===========================
    function takeInlineJSON() {
        const keys = /(po_number|sage_sales_number|order_number|quote_number|shipping_email|billing_email|shipping_firstname|shipping_lastname|shipping_phone1|billing_phone1)/i;
        for (const sc of [...document.scripts]) {
            const txt = sc?.textContent || '';
            if (sc.src || txt.length < 80) continue;
            const idx = txt.search(keys);
            if (idx < 0) continue;
            let start = txt.lastIndexOf('{', idx), depth = 0, s = -1, e = -1;
            for (let i = start; i < txt.length; i++) {
                const c = txt[i];
                if (c === '{') { if (depth === 0) s = i; depth++; }
                else if (c === '}') { depth--; if (depth === 0) { e = i + 1; break; } }
            }
            if (s >= 0 && e > s) { try { return JSON.parse(txt.slice(s, e)); } catch {} }
        }
        return null;
    }
    // ---- Auto extract Account ID (no typing) ----
    function autoAccountId() {
        if (window.__AID_CACHE__) return window.__AID_CACHE__;

        // 1) URL ?aid=
        const aidQS = new URL(location.href).searchParams.get('aid');
        if (aidQS && /^\d+$/.test(aidQS)) return (window.__AID_CACHE__ = aidQS);

        // 2) Visible "Account #123"
        const txt = (document.body.innerText || '');
        const mHead = txt.match(/Account\s*#\s*([0-9]+)/i);
        if (mHead) return (window.__AID_CACHE__ = mHead[1]);

        // 3) Any link/form containing aid=
        for (const el of document.querySelectorAll('a[href],form[action]')) {
            const h = el.getAttribute('href') || el.getAttribute('action') || '';
            const m = h.match(/[?&#]aid=(\d+)/i);
            if (m) return (window.__AID_CACHE__ = m[1]);
        }

        // 4) Inputs that might hold it
        const inp = document.querySelector('input[name="account_id"],input[id="account_id"],input[name="aid"],input[id="aid"]');
        const val = inp && (inp.value || inp.getAttribute('value'));
        if (val && /^\d+$/.test(val)) return (window.__AID_CACHE__ = val);

        // 5) Inline scripts first (cheap scan)
        const re = /account[_-]?id["']?\s*[:=]\s*["']?(\d+)/i;
        for (const sc of document.scripts) {
            const t = sc && sc.textContent;
            if (!t || sc.src || t.length < 40) continue;
            const m = t.match(re);
            if (m) return (window.__AID_CACHE__ = m[1]);
        }

        // 6) Last resort: narrow innerHTML window around the first match (your idea)
        const H = document.documentElement.innerHTML;
        const i = H.search(/account[_-]?id["']?\s*[:=]\s*["']?\d+/i);
        if (i >= 0) {
            const c = H.slice(Math.max(0, i - 1500), i + 1500);
            const m = c.match(re);
            if (m) return (window.__AID_CACHE__ = m[1]);
        }

        return '';
    }

    // ---- Minimal popup URL builder (no &lpid / no &lid) ----
    function buildAccountPopupLinks(aid) {
        const AID = String(aid || '').trim();
        if (!/^\d+$/.test(AID)) return { quotes: '', orders: '' };
        const base = 'https://extranet.strip-curtains.com/';
        return {
            quotes: `${base}?p=quotes_list_popup&aid=${encodeURIComponent(AID)}`,
            orders: `${base}?p=orders_list_popup&aid=${encodeURIComponent(AID)}`
  };
    }

    function openPopup(url, titleBase = 'Popup') {
        if (!url) return alert('Missing URL.');
        const w = Math.min(screen.availWidth || 1920, 1920);
        const h = Math.min(screen.availHeight || 1080, 1032);
        const feats = `width=${w},height=${h},menubar=0,toolbar=0,resizable=1,location=0,scrollbars=1`;
        window.open(url, titleBase, feats);
    }

    function actionOpenQuotesPopup() {
        const aid = autoAccountId();
        if (!aid) return alert('Account # not found on this page.');
        const { quotes } = buildAccountPopupLinks(aid);
        openPopup(quotes, `Quotes — Account #${aid}`);
    }

    function actionOpenOrdersPopup() {
        const aid = autoAccountId();
        if (!aid) return alert('Account # not found on this page.');
        const { orders } = buildAccountPopupLinks(aid);
        openPopup(orders, `Orders — Account #${aid}`);
    }



    function extractBitsForGmail() {
        const out = { invoice: '', order: '', quote: '', po: '', email: '' };
        const j = takeInlineJSON();
        const jf = k => (j && j[k] != null ? S(j[k]) : '');

        out.invoice = jf('sage_sales_number') || out.invoice;
        out.order   = jf('order_number')      || out.order;
        out.quote   = jf('quote_number')      || out.quote;
        out.po      = jf('po_number')         || out.po;
        out.email   = jf('shipping_email')    || jf('billing_email') || out.email;

        // panel fallbacks
        const kv = __panelKV();
        out.invoice ||= kv['sage-invoice'] || '';
        out.order   ||= kv['order'] || '';
        out.email   ||= kv['email'] || '';

        // if Quote row removed by other scripts, try window.Qlink
        if (!out.quote && window.Qlink) {
            const m = String(window.Qlink).match(/(\d{4,})/);
            if (m) out.quote = m[1];
        }
        return out;
    }

    function buildGmailQuery() {
        const bits = extractBitsForGmail();
        const qtok = v => {
            v = norm(v);
            if (!v) return '';
            return /[^A-Za-z0-9]/.test(v) ? `"${v}"` : v;
        };
        const SKIP = new Set(['gmail.com','google.com','yahoo.com','aol.com','strip-curtains.com']);
        let domain = '';
        const m = S(bits.email).match(/@([^>\s"'();:,]+)$/);
        if (m) {
            domain = m[1].toLowerCase().replace(/[),.;]+$/, '');
            if (SKIP.has(domain)) domain = '';
        }
        const terms = [];
        if (bits.invoice) terms.push(qtok(bits.invoice));
        if (bits.order)   terms.push(qtok(bits.order));
        if (bits.quote)   terms.push(qtok(bits.quote));
        if (bits.po)      terms.push(qtok(bits.po));
        if (domain)       terms.push(`from:*@${domain}`);
        if (!terms.length) return '';
        return `(${terms.join(' OR ')})`;
    }

    // ===========================
    // Shipping + products + tracking
    // ===========================
    function buildShippingBlock() {
        const j = takeInlineJSON();
        const S0 = v => (v == null ? '' : String(v));

        const fn = S0(j?.shipping_firstname);
        const ln = S0(j?.shipping_lastname);
        const name = [fn, ln].filter(Boolean).join(' ');

        const lines = [];
        if (name) lines.push(name);
        if (j?.shipping_company)  lines.push(S0(j.shipping_company));
        if (j?.shipping_address1) lines.push(S0(j.shipping_address1));
        if (j?.shipping_address2) lines.push(S0(j.shipping_address2));

        const city = S0(j?.shipping_city);
        const st   = S0(j?.shipping_state);
        const zip  = S0(j?.shipping_zipcode);
        const line4 = [city, [st, zip].filter(Boolean).join(' ')].filter(Boolean).join(', ');
        if (line4) lines.push(line4);

        if (j?.shipping_country) lines.push(S0(j.shipping_country));
        if (j?.shipping_phone1)  lines.push('Phone: ' + S0(j.shipping_phone1));
        if (j?.shipping_email)   lines.push('Email: ' + S0(j.shipping_email));

        if (lines.length <= 2) {
            const kv = __panelKV();
            const extra = [
                kv['company'],
                kv['address1'],
                kv['address2'],
                [
                    kv['city'],
                    [kv['state'], kv['zip']].filter(Boolean).join(' ')
                ].filter(Boolean).join(', '),
                kv['country'],
                (kv['email']  ? ('Email: ' + kv['email']) : ''),
                (kv['phone1'] ? ('Phone: ' + kv['phone1']) : '')
            ].filter(Boolean);
            if (extra.length) lines.push(...extra);
        }
        return lines.filter(Boolean).join('\n');
    }

    function collectUniqueTrackings() {
        const trackingSet = new Set();
        ['#shipmentsRow', '#Packages-Block', '#dataTables-example'].forEach(sel => {
            const container = document.querySelector(sel);
            if (!container) return;
            (container.innerText || '').split(/\s+/).forEach(tok => {
                let t = (tok || '').trim();
                if (!t) return;
                if (t.includes('-')) return;
                t = t.replace(/^[^\w]+|[^\w]+$/g, '');
                const isUPS   = /^1Z[0-9A-Z]{16}$/i.test(t);
                const isFedEx = /^[0-9]{12,15}$/.test(t);
                const isUSPS  = /^[0-9]{20,22}$/.test(t);
                if (isUPS || isFedEx || isUSPS) trackingSet.add(t.toUpperCase());
            });
        });
        return [...trackingSet];
    }

    function getPartsList() {
        const out = [];
        const parts = Array.isArray(window.parts) ? window.parts : [];
        if (parts.length) {
            parts.forEach(p => out.push({
                sku: norm(p.sku || ''),
                qty: Number.isFinite(+p.qty) ? +p.qty : toNum(p.qty),
                description: norm(p.description || '')
            }));
            return out;
        }
        document.querySelectorAll('#products-list:not(.scx-activity-log) tbody>tr[id^="item-id-"]').forEach(tr => {
            const detail = tr.children[0];
            const table = detail?.querySelector('table.subparts-table, table.table-striped.table-bordered');
            if (!table) return;
            const ths = [...table.querySelectorAll('thead th')].map(th => norm(th.textContent).toLowerCase());
            const iQty = ths.indexOf('qty');
            const iSku = ths.indexOf('sku');
            const ix = (i, d) => (i >= 0 ? i : d);
            [...table.querySelectorAll('tbody tr')].forEach(r => {
                const td = r.querySelectorAll('td');
                if (td.length < 3) return;
                const sku = norm(td[ix(iSku, 2)]?.textContent || '');
                if (!sku || isBadSku(sku)) return;

                let description = '';
                const ta = detail.querySelector('textarea[id^="textarea-"]');
                if (ta) description = norm(ta.value);
                if (!description) {
                    const lines = (detail.innerText || '').split('\n').map(norm).filter(Boolean)
                    .sort((A,B)=>B.length-A.length);
                    description = lines[0] || '';
                }

                out.push({
                    sku,
                    qty: toNum(td[ix(iQty, 0)]?.textContent),
                    description
                });
            });
        });
        return out;
    }

    // ===========================
    // Clipboard helpers
    // ===========================
    async function copyText(text) {
        try {
            await navigator.clipboard.writeText(String(text || ''));
            return true;
        } catch {
            try { if (typeof GM_setClipboard === 'function') { GM_setClipboard(String(text||'')); return true; } } catch {}
            try {
                const ta = document.createElement('textarea');
                ta.style.position = 'fixed'; ta.style.opacity = '0'; ta.value = String(text||'');
                document.body.appendChild(ta); ta.focus(); ta.select(); document.execCommand('copy'); ta.remove();
                return true;
            } catch {}
        }
        return false;
    }

    async function copyHTMLWithFallback(html, plaintext) {
        const PLAIN = String(plaintext || '');
        const HTML  = String(html || '');
        if (navigator.clipboard && window.ClipboardItem) {
            try {
                const item = new ClipboardItem({
                    'text/html':  new Blob([HTML],  { type:'text/html' }),
                    'text/plain': new Blob([PLAIN], { type:'text/plain' })
                });
                await navigator.clipboard.write([item]);
                return;
            } catch {}
        }
        await copyText(PLAIN);
    }

    // ===========================
    // Actions
    // ===========================
    async function actionOpenGmailSearch() {
        const q = buildGmailQuery();
        if (!q) { alert('No Invoice/Order/Quote/PO/email domain found to build Gmail search.'); return; }
        const url = `https://mail.google.com/mail/u/0/#search/${encodeURIComponent(q)}`;
        window.open(url, '_blank', 'noopener,noreferrer');
    }

    async function actionCopyAllTracking() {
        const tracks = collectUniqueTrackings();
        if (!tracks.length) { alert('No tracking numbers found.'); return; }
        await copyText(tracks.join('\n'));
    }

    async function actionCopyShippingContact() {
        const block = buildShippingBlock();
        if (!block) { alert('No shipping contact found.'); return; }
        await copyText(block);
    }

    async function actionCopyPackingList() {
        const items = getPartsList();
        if (!items.length) { alert('No parts found.'); return; }
        const rows = items.map(p => [
            (p.sku || '').trim(),
            (p.description || '').replace(/"/g,'""'),
            Number.isFinite(p.qty) ? String(p.qty) : ''
        ]);
        const cellStyle = 'border:1px solid #cbd5e1;padding:6px 8px;vertical-align:top;font-size:13px;line-height:1.35;';
        const thStyle   = `${cellStyle}background:#f1f5f9;font-weight:600;`;
        const tblStyle  = 'border-collapse:collapse;border:1px solid #cbd5e1;table-layout:auto;';
        const html =
              `<table style="${tblStyle}"><thead><tr>` +
              `<th style="${thStyle}">SKU</th>` +
              `<th style="${thStyle}">Description</th>` +
              `<th style="${thStyle};text-align:right;">Qty</th>` +
              `</tr></thead><tbody>` +
              rows.map(r => (
                  `<tr><td style="${cellStyle}">${r[0]}</td>` +
                  `<td style="${cellStyle}">${sanitizeAscii300(r[1])}</td>` +
                  `<td style="${cellStyle};text-align:right;">${r[2]}</td></tr>`
      )).join('') +
              `</tbody></table>`;
        const tsv = ['SKU\tDescription\tQty'].concat(rows.map(r => r.join('\t'))).join('\n');
        await copyHTMLWithFallback(html, tsv);
    }

    // ===========================
    // Context Menu (closed shadow, Creator-Dock vibe)
    // ===========================
    const host = document.createElement('div');
    host.id = 'extranet-ctx-host';
    host.style.cssText = 'position:fixed;z-index:2147483647;left:0;top:0;display:none;';
    (document.documentElement || document.head || document.body).appendChild(host);
    const sr = host.attachShadow({ mode: 'closed' });

    const root = document.createElement('div');
    root.className = 'cd-root';
    const style = document.createElement('style');
    style.textContent = `
/* Reset + tokens */
.cd-root,
.cd-root *,.cd-root *::before,.cd-root *::after{box-sizing:border-box}
.cd-root{
  all:initial;display:block;
  --ink:#e8edf3;--muted:#b8c3e0;--accent:#9b87f5;
  --surface-0:#121621;--surface-1:#0e1118;--bd:#1c1f2a;
  --tb:44px;--ic:22px;
  --tip-bg:#1a1f30;--tip-bd:#2a3150;--tip-ink:#e8edf3;
  font:14px/1.5 -apple-system,system-ui,Segoe UI,Roboto,Inter,Arial,sans-serif;
  color:var(--ink);
}

/* Shell */
.menu-wrap,.flyout{position:relative;z-index:10}
.flyout{display:grid;grid-template-rows:1fr;border-radius:18px;overflow:visible}
.flyout--creator{background:linear-gradient(180deg,var(--surface-1),var(--surface-0));border:1px solid var(--bd);box-shadow:0 12px 40px rgba(0,0,0,.45)}
.body{max-height:60vh;overflow:auto;padding:8px}
.flyout .body{border-radius:18px;clip-path:inset(0 round 18px)}
.group{padding:6px}
.kicker{font-weight:700;font-size:11px;letter-spacing:.18em;text-transform:uppercase;opacity:.85;padding:6px 8px}
.menu{list-style:none;margin:6px 0 0;padding:0}

/* Items */
.item{position:relative;display:grid;grid-template-columns:24px 1fr auto 18px;align-items:center;gap:10px;min-height:44px;padding:8px 10px;border-radius:10px;cursor:pointer}
.item:hover{background:rgba(155,135,245,.08)}
.item.is-active{background:rgba(155,135,245,.16);outline:1px solid rgba(155,135,245,.25)}
.item.is-active::before{content:"";position:absolute;inset:6px auto 6px 0;width:3px;border-radius:2px;background:var(--accent)}
.icon{width:18px;height:18px;border-radius:6px;background:currentColor;opacity:.9;box-shadow:inset 0 0 0 1px rgba(255,255,255,.15)}
.label{font-weight:700;letter-spacing:.01em}
.meta{font:12px/1 ui-monospace,Menlo,Consolas,monospace;background:var(--tip-bg);border:1px solid var(--tip-bd);border-radius:999px;padding:3px 8px;color:var(--muted)}
.chev{width:18px;height:18px;display:grid;place-items:center;color:#b7c0d9}
.chev::before{content:'›'}
.i-blue{color:#3b82f6}.i-green{color:#22c55e}.i-amber{color:#f59e0b}.i-pink{color:#ec4899}

/* Toolbar (sizeable) */
.toolbar{display:flex;gap:8px;padding:6px 8px 2px}
.tbtn{
  position:relative;
  width:var(--tb);height:var(--tb);
  display:grid;place-items:center;
  border-radius:calc(var(--tb)/3);
  background:var(--tip-bg);border:1px solid var(--tip-bd);cursor:pointer
}
.tbtn:hover{background:#222640}
.tbtn:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
.tbtn svg{width:var(--ic);height:var(--ic);display:block;color:var(--muted)}
.tbtn svg path{fill:currentColor}

/* Tooltips */
.tbtn[data-tip]::after{
  content:attr(data-tip);
  position:absolute;bottom:calc(100% + 10px);left:50%;
  transform:translateX(-50%) translateY(8px) scale(.98);
  opacity:0;pointer-events:none;z-index:20;
  background:var(--tip-bg);color:var(--tip-ink);
  border:1px solid var(--tip-bd);border-radius:10px;
  padding:8px 10px;white-space:nowrap;
  font-size:14px;line-height:1.35;font-weight:700;letter-spacing:.01em;
  box-shadow:0 8px 24px rgba(0,0,0,.45);
  transition:opacity .18s ease-out,transform .28s cubic-bezier(.2,.9,.15,1.5);
  animation:none
}
.tbtn[data-tip]::before{
  content:"";
  position:absolute;bottom:calc(100% + 2px);left:50%;
  transform:translateX(-50%) rotate(45deg);
  width:10px;height:10px;opacity:0;pointer-events:none;z-index:20;
  background:var(--tip-bg);
  border-left:1px solid var(--tip-bd);border-top:1px solid var(--tip-bd);
  transition:opacity .18s ease-out
}
.tbtn:is(:hover,:focus-visible)::after{
  opacity:1;transform:translateX(-50%) translateY(0) scale(1);
  animation:tip-bounce-up .28s cubic-bezier(.2,.9,.15,1.5) both
}
.tbtn:is(:hover,:focus-visible)::before{opacity:1}

@keyframes tip-bounce-up{
  0%{opacity:0;transform:translateX(-50%) translateY(10px) scale(.98)}
  60%{opacity:1;transform:translateX(-50%) translateY(-2px) scale(1)}
  100%{transform:translateX(-50%) translateY(0)}
}

/* Reduced motion */
@media (prefers-reduced-motion:reduce){
  .tbtn[data-tip]::after,.tbtn[data-tip]::before{
    transition:none;animation:none;transform:translateX(-50%) translateY(0)!important
  }
}
/* Let the flyout allow overflow, but clip only the scrollable body */
.flyout{ overflow: visible; }
.flyout > .body{
  overflow: auto;
  border-radius: 18px;
  clip-path: inset(0 round 18px);
}

/* Toolbar now sits above the clipped region, tooltips can escape */
.flyout > .toolbar{ position: relative; z-index: 20; padding: 6px 8px 2px; }

/* Ensure tooltip bubbles render on top */
.tbtn[data-tip]::before,
.tbtn[data-tip]::after{ z-index: 30; }

`;
    const menu = document.createElement('nav');
    menu.className = 'menu-wrap';
    menu.setAttribute('role','menu');
    menu.setAttribute('aria-hidden','true');
    menu.innerHTML = `
    <div class="flyout flyout--creator">
      <div class="body" role="region" aria-label="Extranet Tools">
        <div class="group">
          <div class="toolbar" role="toolbar" aria-label="Quick actions">
  <button class="tbtn" type="button"
          aria-label="Account Orders" data-icon="orders"
          data-tip="Orders" title="Orders"></button>

  <button class="tbtn" type="button"
          aria-label="Account Quotes" data-icon="quotes"
          data-tip="Quotes" title="Quotes"></button>

  <button class="tbtn" type="button"
          aria-label="Gmail Search"  data-icon="gmail"
          data-tip="Email"  title="Email"></button>
</div>


          <ul class="menu">
         <li class="item" data-action="open-orders">
  <span class="icon i-blue"></span><span class="label">Acct Orders</span>
  <span class="meta">open</span><span class="chev" aria-hidden="true"></span>
</li>
          <li class="item" data-action="open-quotes">
  <span class="icon i-blue"></span><span class="label">Acct Quotes</span>
  <span class="meta">open</span><span class="chev" aria-hidden="true"></span>
</li>


            <li class="item" data-action="gmail"><span class="icon i-blue"></span><span class="label">Gmail Search</span><span class="meta">open</span><span class="chev" aria-hidden="true"></span></li>
            <li class="item" data-action="copy-tracks"><span class="icon i-green"></span><span class="label">Copy Tracking</span><span class="meta">copy</span><span class="chev" aria-hidden="true"></span></li>
            <li class="item" data-action="copy-ship"><span class="icon i-amber"></span><span class="label">Shipping Address</span><span class="meta">copy</span><span class="chev" aria-hidden="true"></span></li>

          </ul>
        </div>
      </div>
    </div>
  `;
    {
  const flyout  = menu.querySelector('.flyout');
  const body    = flyout.querySelector('.body');
  const toolbar = body.querySelector('.toolbar');
  if (toolbar) flyout.insertBefore(toolbar, body); // make toolbar a sibling of .body
}
    root.appendChild(style);
    root.appendChild(menu);
    sr.appendChild(root);

    /* Mount toolbar SVGs (edit paths here to change icons) */
    (() => {
        const NS = 'http://www.w3.org/2000/svg';
        const ICONS = {
            // simple "list" / orders icon
            orders: 'M3 5h18v2H3zM3 11h18v2H3zM3 17h12v2H3z',
            // quotation marks / quotes icon
            quotes: 'M7 7h6v4H9v6H7zM15 7h6v4h-4v6h-2z',
            // envelope / gmail icon
            gmail:  'M2 6h20v12H2zM2 6l10 7 10-7'
        };

        root.querySelectorAll('.toolbar .tbtn').forEach(btn => {
            const key = btn.getAttribute('data-icon');
            const d = ICONS[key];
            if (!d) return;
            const svg = document.createElementNS(NS, 'svg');
            svg.setAttribute('viewBox', '0 0 24 24');
            svg.setAttribute('aria-hidden', 'true');
            const path = document.createElementNS(NS, 'path');
            path.setAttribute('d', d);
            svg.appendChild(path);
            btn.replaceChildren(svg);
        });

        // (Optional) bump sizes at runtime (instead of editing CSS)
        // root.style.setProperty('--tb', '48px');
        // root.style.setProperty('--ic', '24px');
    })();

    // Remove top-level Orders/Quotes/Gmail (moved to toolbar)
    ['open-orders','open-quotes','gmail'].forEach(a => {
        const el = root.querySelector(`.menu .item[data-action="${a}"]`);
        if (el) el.remove();
    });

    // Wire toolbar: Circle = Orders, Triangle = Quotes, Square = Gmail
    (() => {
        const [btnCircle, btnTriangle, btnSquare] = root.querySelectorAll('.toolbar .tbtn');
        if (btnCircle) btnCircle.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            actionOpenOrdersPopup(); hideMenu();
        });
        if (btnTriangle) btnTriangle.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            actionOpenQuotesPopup(); hideMenu();
        });
        if (btnSquare) btnSquare.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            actionOpenGmailSearch(); hideMenu();
        });
    })();

    // Remove any top-level "Packing List" if present (we move it into the submenu)
    const maybeTopPL = root.querySelector('.menu .item[data-action="copy-skus"]');
    if (maybeTopPL) maybeTopPL.remove();


    // ===== Copy Sets submenu (flyout) =====
    // Helpers specific to Copy Sets (reuse existing S/norm/copyText/takeInlineJSON)
    function getOrderData(){
        let j = (typeof takeInlineJSON==='function') ? takeInlineJSON() : null;
        if (!j || typeof j !== 'object') j = {};
        if (typeof j.review_partsHandling === 'string') { try { j.review_partsHandling = JSON.parse(j.review_partsHandling); } catch {} }
        return j;
    }
    function render(tpl, data){
        return tpl.replace(/{{\s*([^}]+)\s*}}/g, (_, k) => {
            const v = S(data && data[k]);
            return v ? v : '';
        });
    }
    const COPY_SETS = [
        {
            key:'SHIP_TO_BLOCK', label:'Ship To (Block)',
            template:
            `{{shipping_company}}
  {{shipping_firstname}} {{shipping_lastname}}
  {{shipping_address1}}
  {{shipping_address2}}
  {{shipping_city}}, {{shipping_state}} {{shipping_zipcode}}
  {{shipping_country}}
  Phone: {{shipping_phone1}}
  Email: {{shipping_email}}`,
            post: s => s.split('\n').map(norm).filter(Boolean).join('\n')
        },
        {
            key:'BILL_TO_BLOCK', label:'Bill To (Block)',
            template:
            `{{billing_company}}
  {{billing_firstname}} {{billing_lastname}}
  {{billing_address1}}
  {{billing_address2}}
  {{billing_city}}, {{billing_state}} {{billing_zipcode}}
  {{billing_country}}
  Phone: {{billing_phone1}}
  Email: {{billing_email}}`,
            post: s => s.split('\n').map(norm).filter(Boolean).join('\n')
        },
        {
            key:'ORDER_SNAPSHOT', label:'Order Snapshot (Inline)',
            template:
            `Order {{order_number}} | Acct {{account_id}} | Sage {{sage_sales_number}} | {{site_source}} | Status {{sales_status}} ({{sales_status_id}}) | {{sales_date}} | {{currency}} {{sales_total}} [Sub {{sales_subtotal}} • Disc {{sales_discount}} • Ship {{sales_shipping_amount}} • Tax {{sales_tax_total}}] | Ship Via {{shipment_type}} • Control {{shipment_control}} | Lead {{expected_leadtime}} | ETA Ship {{expected_shippingdate}}`,
            post: s => norm(s)
        },
        {
            key:'PAYMENT_SUMMARY', label:'Payment Summary (Inline)',
            template:
            `{{payment_gateway}} | {{payment_type}} {{payment_mcardtype}} | {{payment_status}} | {{currency}} {{payment_mtransamount}} | Receipt {{payment_mreceiptid}} | Ref {{payment_referencenum}} | Resp {{payment_responsecode}} | Auth {{payment_mauthcode}} | {{payment_mtransdate}} {{payment_mtranstime}}`,
            post: s => norm(s)
        },
        {
            key:'FULFILLMENT_OPS', label:'Fulfillment Ops (Inline)',
            template:
            `Ship {{shipment_type}} • Control {{shipment_control}} | Lead {{expected_leadtime}} | ETA Ship {{expected_shippingdate}} | Flags: {{flag}} {{flag_lateshipment}} {{flag_needsattention}} {{flag_lostpackage}} {{flag_customerservice_level2}} {{flag_shipmentweight_inconsistent}} | PU {{pick_up}} | Pkgs {{packages_added}} | Docs: PS {{packingslip_printed}} • Sticker {{packingsticker_printed}} • P&P {{pickandpack_printed}}`,
            post: s => norm(s.replace(/\s+/g,' ').replace(/\s\|\s/g,' | ').replace(/\s•\s/g,' • ')).replace(/\s{2,}/g,' ')
        }
    ];

    (function initCopySetsSubmenu(){
        // anchor into the existing main menu inside the closed shadow root
        const mainMenu = root.querySelector('.menu');
        if (!mainMenu) return;

        // parent item
        const liParent = document.createElement('li');
        liParent.className = 'item has-sub';
        liParent.setAttribute('data-sub','copysets');
        liParent.innerHTML = `<span class="icon i-amber"></span><span class="label">Copy Sets</span><span class="meta">flyout</span><span class="chev" aria-hidden="true"></span>`;
        mainMenu.appendChild(liParent);

        // floating flyout
        const fly = document.createElement('div');
        fly.id = 'copysets-flyout';
        fly.setAttribute('role','menu');
        fly.style.cssText = 'position:fixed;display:none;z-index:2147483647;';
        const flyInner = document.createElement('div');
        flyInner.className = 'flyout flyout--creator';
        flyInner.innerHTML = `
            <div class="body" role="region" aria-label="Copy Sets">
              <div class="group">
                <div class="kicker">Copy Sets</div>
                <ul class="menu" id="copysets-list" style="min-width:360px"></ul>
              </div>
            </div>`;
        fly.appendChild(flyInner);
        root.appendChild(fly);

        // populate items (Copy Sets)
        const ul = fly.querySelector('#copysets-list');
        COPY_SETS.forEach(cs => {
            const li = document.createElement('li');
            li.className = 'item';
            li.dataset.key = cs.key;
            li.innerHTML = `<span class="icon i-green"></span><span class="label">${cs.label}</span><span class="meta">copy</span><span class="chev" aria-hidden="true"></span>`;
            ul.appendChild(li);
        });

        // also add: Packing List (moved here)
        const liPL = document.createElement('li');
        liPL.className = 'item';
        liPL.dataset.action = 'copy-skus';
        liPL.innerHTML = `<span class="icon i-pink"></span><span class="label">Packing List</span><span class="meta">copy</span><span class="chev" aria-hidden="true"></span>`;
        ul.appendChild(liPL);

        // positioning
        function openFly(anchorLi){
            const rect = anchorLi.getBoundingClientRect();
            const pad = 8;
            fly.style.display = 'block';
            let x = rect.right + 10, y = rect.top;
            const fRect = flyInner.getBoundingClientRect();
            if (x + fRect.width + pad > window.innerWidth) x = Math.max(pad, rect.left - fRect.width - 10);
            if (y + fRect.height + pad > window.innerHeight) y = Math.max(pad, window.innerHeight - fRect.height - pad);
            fly.style.left = `${x}px`;
            fly.style.top  = `${y}px`;
        }
        function closeFly(){ fly.style.display='none'; }

        // toggle from parent
        liParent.addEventListener('click', (e) => {
            e.preventDefault(); e.stopPropagation();
            if (fly.style.display === 'block') closeFly(); else openFly(liParent);
        });

        // copy on item click
        ul.addEventListener('click', async (e) => {
            const li = e.target.closest('.item'); if (!li) return;
            // special action: Packing List
            if (li.dataset.action === 'copy-skus') {
                await actionCopyPackingList();
                closeFly();
                return;
            }
            // otherwise: COPY_SETS templated item
            const key = li.dataset.key;
            const cs = COPY_SETS.find(x => x.key === key); if (!cs) return;
            const data = getOrderData();
            let out = render(cs.template, data);
            out = cs.post ? cs.post(out) : out;
            out = out.replace(/\|\s*(\||$)/g,'| ').replace(/\|\s*\|/g,'| ').replace(/\s*\|\s*$/,'').trim();
            await copyText(out);
            closeFly();
        });

        // global close hooks
        function hideAll(){ closeFly(); }
        document.addEventListener('click', hideAll, true);
        window.addEventListener('blur', hideAll, true);
        window.addEventListener('scroll', hideAll, true);
        window.addEventListener('resize', hideAll, true);

        // tiny style nudge
        const style2 = document.createElement('style');
        style2.textContent = `
            .has-sub { position: relative; }
            #copysets-flyout .menu .item .icon { color:#22c55e; }
          `;
        root.appendChild(style2);
    })();


    // Click handling inside shadow (ignore submenu toggler/no-action items)
    root.addEventListener('click', async (e) => {
        const li = e.target.closest?.('.item');
        if (!li) return;
        const isSub = li.classList.contains('has-sub');
        const action = li.getAttribute('data-action');
        if (!action) { if (isSub) return; else return; }
        e.preventDefault(); e.stopPropagation();

        try {
            if (action === 'gmail')            await actionOpenGmailSearch();
            else if (action === 'copy-tracks') await actionCopyAllTracking();
            else if (action === 'copy-ship')   await actionCopyShippingContact();
            else if (action === 'copy-skus')   await actionCopyPackingList();
            else if (action === 'open-quotes') actionOpenQuotesPopup();  // <- auto AID
            else if (action === 'open-orders') actionOpenOrdersPopup();  // <- auto AID
        } catch (err) {
            console.error('[Extranet RC] action error:', err);
            alert('Action error: ' + (err?.message || err));
        } finally {
            hideMenu();
        }
    });


    // Show/hide
    document.addEventListener('contextmenu', (e) => {
        // Shift+Right-Click => native menu
        if (e.shiftKey) return;
        // Only intercept on our matched pages (already limited by @match), and inside document body
        if (!document.body.contains(e.target)) return;
        e.preventDefault();
        e.stopImmediatePropagation(); // avoid other global menus
        showMenuAt(e.clientX, e.clientY);
    }, { capture: true });

    document.addEventListener('click', dismissIfOpen, true);
    window.addEventListener('blur', hideMenu, true);
    window.addEventListener('scroll', hideMenu, true);
    window.addEventListener('resize', hideMenu, true);
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') hideMenu(); }, true);

    function dismissIfOpen(ev) {
        if (host.style.display === 'none') return;
        const path = ev.composedPath?.() || [];
        if (!path.includes(host)) hideMenu();
    }
    function showMenuAt(x, y) {
        host.style.display = 'block';
        menu.setAttribute('aria-hidden','false');
        host.style.left = `${x}px`;
        host.style.top  = `${y}px`;
        // nudge if overflow
        const rect = menu.getBoundingClientRect();
        const pad = 8;
        let left = x, top = y;
        if (x + rect.width + pad > window.innerWidth)  left = Math.max(pad, window.innerWidth - rect.width - pad);
        if (y + rect.height + pad > window.innerHeight) top = Math.max(pad, window.innerHeight - rect.height - pad);
        host.style.left = `${left}px`;
        host.style.top  = `${top}px`;
    }
    function hideMenu() {
        host.style.display = 'none';
        menu.setAttribute('aria-hidden','true');
    }
    // lightweight toast
    function toast(msg='Copied!'){
        const n=document.createElement('div'); n.textContent=msg;
        n.style.cssText='position:fixed;right:14px;bottom:14px;padding:8px 10px;font:12px/1.3 ui-monospace; background:#1a1f30;color:#e8edf3;border:1px solid #2a3150;border-radius:8px;z-index:2147483647;opacity:.98';
        document.body.appendChild(n); setTimeout(()=>n.remove(),1300);
    }
})();
