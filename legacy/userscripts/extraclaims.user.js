// ==UserScript==
// @name         ExtraClaims
// @namespace    sc/extranet/ups-gmail
// @version      3.3
// @description  Adds a "Compose Gmail Claim" pill next to each UPS "Submit Claim" link, with required body template. Exposes SCX core helpers for other scripts.
// @match        https://extranet.strip-curtains.com/?p=orders-view&view=*
// @match        https://extranet.strip-curtains.com//?p=orders-view&view=*
// @run-at       document-idle
// @grant        none
// ==/UserScript==

(() => {
    'use strict';
    if (window.__UPS_GMAIL_V2_SOLO__) return;
    window.__UPS_GMAIL_V2_SOLO__ = Date.now();

    /** ===================== SCX mini-core (shared) ===================== **/
    const SCX = window.SCX || (() => {
        const S = v => (v == null ? '' : String(v));
        const norm = v => S(v).replace(/\u00A0/g, ' ').replace(/\s+/g, ' ').trim();

        // ---------- inline JSON + panels ----------
        function takeInlineJSON() {
            const keys = /(po_number|sage_sales_number|order_number|quote_number|shipping_email|billing_email|shipping_firstname|shipping_lastname|shipping_phone1|billing_phone1|shipping_company|shipping_address1|shipping_address2|shipping_city|shipping_state|shipping_zipcode|shipping_country|sales_shipping_type|expected_shippingdate)/i;
            for (const sc of document.scripts) {
                const txt = sc?.textContent || '';
                if (sc.src || txt.length < 80) continue;
                const idx = txt.search(keys);
                if (idx < 0) continue;
                let i = txt.lastIndexOf('{', idx), o = 0, s = -1, e = -1;
                for (let p = i; p < txt.length; p++) {
                    const c = txt[p];
                    if (c === '{') { if (o === 0) s = p; o++; }
                    else if (c === '}') { o--; if (o === 0) { e = p + 1; break; } }
                }
                if (s >= 0 && e > s) { try { return JSON.parse(txt.slice(s, e)); } catch {} }
            }
            return null;
        }
        function mapLabelTable(root) {
            const m = Object.create(null);
            (root ? root.querySelectorAll('tr') : []).forEach(tr => {
                const t = tr.querySelectorAll('td,th');
                if (t.length >= 2) {
                    const k = norm(t[0].textContent).replace(/[:：]\s*$/, '').toLowerCase();
                    const v = norm(t[1].textContent);
                    if (k) m[k] = v;
                }
            });
            return m;
        }
        function findPanelByHeading(re) {
            const h = [...document.querySelectorAll('.panel-heading')].find(x => re.test(norm(x.textContent || '')));
            return h ? h.closest('.panel') : null;
        }

        // ---------- generic utils ----------
        const toNum = s => {
            if (s == null) return NaN;
            const n = parseFloat(S(s).replace(/[^\d.+-]/g, ''));
            return Number.isNaN(n) ? NaN : n;
        };
        const uniq = arr => [...new Set((arr || []).map(x => String(x)))];

        // ---------- currency / invoice / consignee ----------
        function getCurrency() {
            let cur = 'USD';
            const row = [...document.querySelectorAll('tr.gradeX')].find(x => /currency\s*:/i.test(x.textContent || ''));
            if (row) {
                const td = row.querySelector('td:nth-child(2)');
                const c = norm(td?.textContent || '');
                if (c) cur = c;
            }
            return cur;
        }
        function getInvoice() {
            const j = takeInlineJSON() || {};
            if (j.sage_sales_number) return S(j.sage_sales_number);
            const rows = [...document.querySelectorAll('.panel .table tr')];
            const getVal = label => (rows.find(tr => norm(tr.children?.[0]?.textContent || '') === label)?.children?.[1]?.textContent || '').trim();
            return getVal('Sage Sale/Invoice #:') || getVal('Invoice #:') || getVal('Invoice Number:') || getVal('Sage Invoice:') || getVal('Sage Sale:') || 'NA';
        }
        function getConsignee() {
            const j = takeInlineJSON() || {};
            const fn = S(j.shipping_firstname), ln = S(j.shipping_lastname);
            const contact = [fn, ln].filter(Boolean).join(' ');
            const company = S(j.shipping_company);
            const phone   = S(j.shipping_phone1) || S(j.billing_phone1);
            const email   = S(j.shipping_email)  || S(j.billing_email);
            const a1 = S(j.shipping_address1), a2 = S(j.shipping_address2);
            const city = S(j.shipping_city), st = S(j.shipping_state), zip = S(j.shipping_zipcode), ctry = S(j.shipping_country);
            let address = [a1, a2, [city, [st, zip].filter(Boolean).join(' ')].filter(Boolean).join(', '), ctry]
            .filter(Boolean).join(', ');

            if (!company || !address || !email || !phone || !contact) {
                const other = mapLabelTable(findPanelByHeading(/other info/i) || document);
                const ship  = mapLabelTable(findPanelByHeading(/shipping info/i) || document);
                const name2 = [ship['first name'], ship['last name']].filter(Boolean).join(' ');
                return {
                    company: company || ship['shipping company'] || other['company'] || '',
                    contact: contact || name2 || ship['name'] || other['name'] || '',
                    phone:   phone   || ship['phone'] || other['billing phone'] || '',
                    email:   email   || ship['email'] || other['billing email'] || '',
                    address: address || [
                        ship['address 1'] || other['address 1'] || '',
                        ship['address 2'] || other['address 2'] || '',
                        [ship['city'] || '', [ship['state'] || ship['province'] || '', ship['zip code'] || ship['postal code'] || ship['zip'] || ''].filter(Boolean).join(' ')].filter(Boolean).join(', '),
                        ship['country'] || ship['country/region'] || ''
                    ].filter(Boolean).join(', ')
                };
            }
            return { company, contact, phone, address, email };
        }

        // ---------- robust product harvesting ----------
        function _detectProductCols(table) {
            const clean = s => norm(s).toLowerCase().replace(/[^a-z]/g, '');
            const ths = [...table.querySelectorAll('thead th, thead td')].map(th => clean(th.textContent));
            const iQtyHead   = ths.findIndex(h => h === 'qty' || h.startsWith('qty'));
            const iSkuHead   = ths.findIndex(h => h.startsWith('sku'));
            const iLenHead   = ths.findIndex(h => /length/.test(h));
            const iPriceHead = ths.findIndex(h => /partprice|price|total|amount|amt/.test(h));

            const rows = [...table.querySelectorAll('tbody tr')].slice(0, 8);
            const width = rows.reduce((m, r) => Math.max(m, r.querySelectorAll('td').length), 0) || Math.max(ths.length, 3);

            const score = Array.from({ length: width }, () => ({ sku:0, qty:0, len:0, money:0 }));
            const numOnly = t => /^\s*\d+(?:\.\d+)?\s*$/.test(t);
            const looksSku = t => {
                const u = S(t).toUpperCase();
                if (!u) return false;
                if (/\b(QTY|AMOUNT|DESCRIPTION|TOTAL|SUBTOTAL|WEIGHT|LB|LBS|KG|G)\b/.test(u)) return false;
                return /[A-Z]/.test(u) && /[-_]/.test(u) && !numOnly(u);
            };
            const looksLen = t => /(?:^|\s)(\d+(?:\.\d+)?)\s*(ft|feet)\b/i.test(t) || (numOnly(t) && !/\$|€|£|₹/.test(t));
            const looksMoney = t => /[$€£₹]\s*\d/.test(t) || (/\d\.\d{2}\b/.test(t) && !/\b(lb|lbs|kg|g)\b/i.test(t));

            rows.forEach(r => {
                const tds = [...r.querySelectorAll('td')];
                for (let j = 0; j < width; j++) {
                    const txt = norm(tds[j]?.textContent || '');
                    if (!txt) continue;
                    if (looksSku(txt))   score[j].sku++;
                    if (numOnly(txt))    score[j].qty++;
                    if (looksLen(txt))   score[j].len++;
                    if (looksMoney(txt)) score[j].money++;
                }
            });

            const pickMax = (arr, key) => {
                let best = 0; for (let i = 1; i < arr.length; i++) if (arr[i][key] > arr[best][key]) best = i;
                return best;
            };

            let iSku   = iSkuHead   >= 0 ? iSkuHead   : pickMax(score, 'sku');
            let iQty   = iQtyHead   >= 0 ? iQtyHead   : pickMax(score, 'qty');
            let iLen   = iLenHead   >= 0 ? iLenHead   : pickMax(score, 'len');
            let iPrice = iPriceHead >= 0 ? iPriceHead : pickMax(score, 'money');

            const clamp = i => Math.max(0, Math.min(i, width - 1));
            return { iSku:clamp(iSku), iQty:clamp(iQty), iLen:clamp(iLen), iPrice:clamp(iPrice) };
        }

        function _extractDescFromDetail(detail) {
            const isLabelish = s => /\b(qty|quantity|price|amount|total|subtotal|weight|lbs?|kg|g|sku|length|ft|feet)\b/i.test(s);
            const isLikelySku = s => /[A-Z]/.test(s) && /[-_]/.test(s) && !/\s/.test(s.replace(/[-_]/g, ''));

            // 1) textarea first
            const ta = detail.querySelector('textarea[id^="textarea-"]');
            if (ta && norm(ta.value)) return norm(ta.value);

            // 2) table cells
            const candidates = [];
            const tbl = detail.querySelector('table.table-striped.table-bordered');
            if (tbl) {
                [...tbl.querySelectorAll('tbody tr')].forEach(tr => {
                    [...tr.querySelectorAll('td')].forEach(td => {
                        const t = norm(td.textContent || ''); if (t) candidates.push(t);
                    });
                });
            }
            // 3) fallback: detail block
            if (!candidates.length) {
                const raw = (detail.innerText || '').split('\n').map(norm).filter(Boolean);
                candidates.push(...raw);
            }

            const cleaned = candidates
            .filter(t => t.length >= 4)
            .filter(t => !isLabelish(t))
            .filter(t => !/^\d+(\.\d+)?$/.test(t))
            .filter(t => !isLikelySku(t))
            .filter(t => !/https?:\/\//i.test(t));

            const rank = s => {
                let score = 0;
                if (/[A-Za-z]/.test(s) && /\s/.test(s)) score += 3;
                if (s.length >= 20) score += 2;
                if (s.length >= 50) score += 1;
                if (s.toUpperCase() !== s) score += 1;
                return score;
            };
            cleaned.sort((A,B) => rank(B) - rank(A) || B.length - A.length);

            let out = cleaned[0] || '';
            out = out.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, ' ').trim();
            if (out.length > 300) out = out.slice(0, 300);
            return out;
        }

        function getPartsList() {
            const out = [];
            // Prefer window.parts JSON when present
            const parts = Array.isArray(window.parts) ? window.parts : [];
            if (parts.length) {
                parts.forEach(p => out.push({
                    sku: norm(p.sku || ''),
                    qty: Number.isFinite(+p.qty) ? +p.qty : toNum(p.qty),
                    description: norm(p.description || ''),
                    lb_per_unit: toNum(p.lb_per_unit),
                    length_ft_each: NaN,
                    line_total_from_ui: NaN
                }));
                return out;
            }

            // Fallback: parse products table
            document.querySelectorAll('#products-list tbody>tr[id^="item-id-"]').forEach(tr => {
                const detail = tr.children[0];
                const table  = detail?.querySelector('table.table-striped.table-bordered');
                if (!table) return;

                const { iSku, iQty, iLen, iPrice } = _detectProductCols(table);
                [...table.querySelectorAll('tbody tr')].forEach(r => {
                    const td = r.querySelectorAll('td');
                    if (td.length < 3) return;

                    const rawSku = norm(td[iSku]?.textContent || '');
                    if (!rawSku) return;

                    const sku    = rawSku;
                    const qty    = toNum(td[iQty]?.textContent);
                    const lenFt  = toNum(td[iLen]?.textContent);      // may be NaN
                    const pTotal = toNum(td[iPrice]?.textContent);    // line total if present
                    const description = _extractDescFromDetail(detail);

                    out.push({
                        sku, qty, description,
                        lb_per_unit: NaN,
                        length_ft_each: lenFt,
                        line_total_from_ui: pTotal
                    });
                });
            });

            return out;
        }

        // Build and cache PRICE_CTX from products (single source of truth)
        function buildPriceCtx() {
            if (window.PRICE_CTX && Object.keys(window.PRICE_CTX).length) return window.PRICE_CTX;

            const items = getPartsList();
            const ctx = {}; // SKU -> { qtySum, lenSumFt, partTotal, ppu, ppf, descs[] }

            items.forEach(it => {
                const key = norm(it.sku).toUpperCase();
                if (!key) return;
                const a = (ctx[key] ||= { qtySum: 0, lenSumFt: 0, partTotal: 0, descs: [] });

                if (Number.isFinite(it.qty)) a.qtySum += it.qty;
                if (Number.isFinite(it.qty) && Number.isFinite(it.length_ft_each) && it.length_ft_each > 0) {
                    a.lenSumFt += it.qty * it.length_ft_each;
                }
                if (Number.isFinite(it.line_total_from_ui) && it.line_total_from_ui > 0) {
                    a.partTotal += it.line_total_from_ui;
                }
                if (!a._gotDesc && it.description) { a.descs.push(it.description); a._gotDesc = true; }
            });

            Object.values(ctx).forEach(a => {
                a.ppu = a.qtySum   > 0 ? a.partTotal / a.qtySum   : NaN;
                a.ppf = a.lenSumFt > 0 ? a.partTotal / a.lenSumFt : NaN;
                delete a._gotDesc;
            });

            window.PRICE_CTX = ctx;
            return ctx;
        }

        // Packages → values & descriptions per tracking (uses PRICE_CTX)
        function detectPkgCols(tbl) {
            const H = [...tbl.querySelectorAll('thead th, thead td')].map(c => norm(c.textContent).toLowerCase().replace(/[^a-z]/g,''));
            const iSku = H.findIndex(h => h.startsWith('sku'));
            const iQty = H.findIndex(h => h === 'qty' || h.startsWith('qty'));
            const iAmt = H.findIndex(h => /(length|price|total|amount|weight|lb|lbs)/.test(h));
            const head = H[iAmt] || '';
            let amtKind = 'unknown';
            if (/length|ft|feet/.test(head)) amtKind = 'length';
            else if (/price|total|amount|amt/.test(head)) amtKind = 'price';
            else if (/weight|lb|lbs|kg|g/.test(head)) amtKind = 'weight';
            return { iSku: Math.max(0,iSku), iQty: Math.max(0,iQty), iAmt: Math.max(0,iAmt), amtKind };
        }

        function getClaimsByTracking() {
            const ctx = buildPriceCtx();
            const up = s => S(s).trim().toUpperCase();

            function valueFromAgg(sku, qty, len, amtKind) {
                const a = ctx[up(sku)];
                const q = Number(qty), L = Number(len);
                if (amtKind === 'length' && Number.isFinite(q) && Number.isFinite(L) && L > 0 && a && Number.isFinite(a.ppf)) return a.ppf * (q * L);
                if (Number.isFinite(q) && a && Number.isFinite(a.ppu)) return a.ppu * q;
                return 0;
            }

            const byTrk = {}; // trk -> { valueSum:number, descs:Set<string> }
            const ensure = trk => (byTrk[trk] ||= { valueSum: 0, descs: new Set() });

            const block = document.querySelector('#Packages-Block');
            if (!block) return byTrk;

            block.querySelectorAll('tbody > tr.gradeX').forEach(row => {
                const tds = row.querySelectorAll(':scope > td');
                if (tds.length < 6) return;
                const category = norm(tds[2]?.textContent || '');
                const itemsTable = tds[3]?.querySelector('table');
                const tCell = tds[5];

                // tracking(s)
                let trackings = [...tCell.querySelectorAll('a')].map(a => norm(a.textContent)).filter(Boolean);
                if (!trackings.length) {
                    const raw = norm(tCell.textContent || '').replace(/[()]/g,'');
                    trackings = raw ? raw.split('|').map(norm).filter(Boolean) : [];
                }
                if (!trackings.length) trackings = [''];

                if (itemsTable) {
                    const { iSku, iQty, iAmt, amtKind: headKind } = detectPkgCols(itemsTable);
                    itemsTable.querySelectorAll('tbody tr').forEach(r => {
                        const cs = r.querySelectorAll('td');
                        if (cs.length < 3) return;
                        const sku = norm(cs[iSku]?.textContent || '');
                        const qtyTxt = norm(cs[iQty]?.textContent || '');
                        const qty = (function parseQty(t){
                            if (!t) return NaN;
                            if (/[A-Za-z]/.test(t) || (t.match(/-/g) || []).length >= 2) return NaN;
                            const m = t.match(/\b(?:qty[:\s]*)?(\d+(?:\.\d+)?)\b/i);
                            return m ? Number(m[1]) : NaN;
                        })(qtyTxt);
                        const amtText = norm(cs[iAmt]?.textContent || '');
                        let kind = headKind;
                        if (/\b(lb|lbs|kg|g)\b/i.test(amtText)) kind = 'weight';
                        else if (/[₹£€$]/.test(amtText)) kind = 'price';
                        const lenOrMoney = toNum(amtText);

                        const v = valueFromAgg(sku, qty, lenOrMoney, kind);

                        trackings.forEach(trk => {
                            const a = ensure(trk);
                            a.valueSum += v;

                            // Prefer rich description from PRICE_CTX, then category, then SKU
                            const agg = ctx[up(sku)];
                            if (agg && agg.descs && agg.descs.length) agg.descs.forEach(d => d && a.descs.add(d));
                            else if (category) a.descs.add(category);
                            else if (sku) a.descs.add(sku);
                        });
                    });
                } else if (category) {
                    trackings.forEach(trk => ensure(trk).descs.add(category));
                }
            });

            return byTrk;
        }

        function getOrderBits() {
            const j = takeInlineJSON() || {};
            const out = {
                invoice: S(j.sage_sales_number || ''),
                order:   S(j.order_number || ''),
                quote:   S(j.quote_number || ''),
                po:      S(j.po_number || ''),
                email:   S(j.shipping_email || j.billing_email || '')
            };
            const other = mapLabelTable(findPanelByHeading(/other info/i) || document);
            const ship  = mapLabelTable(findPanelByHeading(/shipping info/i) || document);
            out.invoice ||= other['sage sale/invoice #'] || other['invoice #'] || other['invoice number'] || other['sage invoice'] || other['sage sale'] || '';
            out.order   ||= other['order #'] || other['order number'] || '';
            out.quote   ||= other['quote #'] || other['quote number'] || '';
            out.po      ||= other['p.o. number'] || other['po number'] || other['customer po'] || other['purchase order'] || other['p.o.'] || other['po'] || '';
            out.email   ||= ship['email'] || ship['e-mail'] || ship['shipping email'] || other['billing email'] || '';
            return out;
        }

        return { S, norm, toNum, takeInlineJSON, getCurrency, getInvoice, getConsignee, getPartsList, buildPriceCtx, getClaimsByTracking, getOrderBits };
    })();
    window.SCX = SCX;

    /** ===================== Config ===================== **/
    const DEFAULT_TO = (window.UPS_CLAIMS_EMAIL || '').trim(); // optional global
    const BTN_TEXT   = 'Compose Gmail Claim';
    const SEARCH_TEXT = 'Search Gmail';

    // Shipper (static)
    const SHIPPER = {
        company: 'Strip-curtains.com',
        contact: 'Daniel',
        phone:   '8772099344',
        address: 'Unit 3 - 1350 Valmont Way, Richmond, BC V6V 1Y4',
        email:   'order-management@strip-curtains.com'
    };

    /** ===================== Compose URL builder + body ===================== **/
    function gmailComposeURL({ to = '', subject = '', body = '' }) {
        const base = 'https://mail.google.com/mail/?view=cm&fs=1&tf=1';
        const enc = encodeURIComponent;
        return `${base}&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
    }

    function sanitizeAscii300(input) {
        let s = String(input || '');
        s = s
            .replace(/[\u2018\u2019\u201B]/g, "'")
            .replace(/[\u201C\u201D]/g, '"')
            .replace(/[\u2013\u2014\u2212]/g, '-')
            .replace(/\u2026/g, '...')
            .replace(/_x000a_/gi, ' ');
        s = s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
        s = s.replace(/[^A-Za-z0-9`~!@#$%^&*\-_=+,.\/\?;:'\[\]\{\}\\\|\(\)\s]/g, '');
        s = s.replace(/\s+/g, ' ').trim();
        if (s.length > 300) s = s.slice(0, 300);
        return s;
    }

    function buildBodyForTracking(trk) {
        const consignee = SCX.getConsignee();
        const currency  = SCX.getCurrency();
        const invoice   = SCX.getInvoice();

        const claims = SCX.getClaimsByTracking();
        const c = claims[trk] || { valueSum: 0, descs: new Set() };
        const val = Math.max(0, +(c.valueSum || 0).toFixed(2));

        const desc = sanitizeAscii300(Array.from(c.descs || []).join(', '));

        return (
`Please see the required details below,

Shipper information:

- Company name: ${SHIPPER.company}
- Contact name: ${SHIPPER.contact}
- Telephone number: ${SHIPPER.phone}
- Complete address: ${SHIPPER.address}
- E-mail address: ${SHIPPER.email}

Consignee information:

- Company name: ${consignee.company || ''}
- Contact name: ${consignee.contact || ''}
- Telephone number: ${consignee.phone || ''}
- Complete address: ${consignee.address || ''}
- E-mail address: ${consignee.email || ''}

Shipment information:

- Value of the goods Total for that package: ${currency} ${val.toFixed(2)}
- Invoice #${invoice}
- Complete & detailed description of the goods (size, brand, color, model number, etc.): ${desc}
- Has a replacement package been shipped? No, and yes we will be sending a replacement`
    );
  }

    function buildComposeURLForTracking(trk) {
        const bits = SCX.getOrderBits();
        const invoice = bits.invoice || 'NA';
        const subject = ['UPS Claim', trk && `Tracking ${trk}`, `Invoice ${invoice}`].filter(Boolean).join(' — ');
        const to = DEFAULT_TO; // leave blank to let Gmail prompt
        const body = buildBodyForTracking(trk);
        return gmailComposeURL({ to, subject, body });
    }

    /** ===================== Inject buttons next to claim links ===================== **/
    const CLAIM_SEL = 'a[href*="sales_shipment_claim"][href*="tracking_number="]';

    function parseTracking(a) {
        try { return new URL(a.getAttribute('href'), location.href).searchParams.get('tracking_number') || ''; }
        catch { return ''; }
    }

    function inject() {
        const anchors = [...document.querySelectorAll(CLAIM_SEL)];
        if (!anchors.length) return;

        anchors.forEach(a => {
            if (a.nextElementSibling?.classList?.contains('__ups_gmail_injected')) return;

            const trk = parseTracking(a);

            const wrap = document.createElement('span');
            wrap.className = '__ups_gmail_injected';
            wrap.style.cssText = 'margin-left:8px;display:inline-flex;gap:6px;flex-wrap:wrap;';

            const compose = document.createElement('a');
            compose.href = buildComposeURLForTracking(trk);
            compose.target = '_blank';
            compose.rel = 'noopener';
            compose.textContent = BTN_TEXT;
            compose.title = 'Open Gmail compose prefilled for UPS claim';
            compose.style.cssText = 'background:#0b3d91;color:#fff;padding:4px 8px;border-radius:6px;border:1px solid #0b3d91;text-decoration:none;font-size:12px;';

            const search = document.createElement('a');
            search.href = 'https://mail.google.com/mail/u/0/#search/' + encodeURIComponent(trk || '');
            search.target = '_blank';
            search.rel = 'noopener';
            search.textContent = 'Search Gmail';
            search.title = 'Search Gmail for this tracking #';
            search.style.cssText = 'background:#1f2937;color:#fff;padding:4px 8px;border-radius:6px;border:1px solid #374151;text-decoration:none;font-size:12px;';

            wrap.appendChild(compose);
            wrap.appendChild(search);
            a.insertAdjacentElement('afterend', wrap);
        });
    }

    const mo = new MutationObserver(() => inject());
    mo.observe(document.documentElement, { childList: true, subtree: true });
    setTimeout(inject, 300);
    console.info('[UPS Gmail SOLO+SCX] armed. anchors:', document.querySelectorAll(CLAIM_SEL).length);

    // Debug helper
    window.__upsGmailSolo_debug = () => {
        const anchors = [...document.querySelectorAll(CLAIM_SEL)];
        const rows = anchors.map((a,i) => {
            let trk=''; try { trk = new URL(a.href, location.href).searchParams.get('tracking_number') || ''; } catch {}
            const injected = a.nextElementSibling?.classList?.contains('__ups_gmail_injected') || false;
            const compose = injected ? a.nextElementSibling.querySelector('a')?.href : '';
            return { i, text: a.textContent.trim(), trk, injected, compose };
        });
        console.table(rows);
        return rows.length;
    };
})();
