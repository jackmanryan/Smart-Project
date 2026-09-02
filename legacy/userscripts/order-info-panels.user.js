// ==UserScript==
// @name         Order Info Panels
// @namespace    jack.tamper
// @version      1.1.1
// @description  Remove sensitive rows; normalize labels/values (Country/State/Province); preserve FLAGS formatting; no CSS/layout.
// @match        https://extranet.strip-curtains.com/*
// @exclude      https://extranet.strip-curtains.com/?p=orders-review&review=*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor&priceCheck=true*
// @grant        none
// ==/UserScript==

(function () {
    'use strict';

    /* ===== utils ===== */
    const $$ = (s, r=document) => Array.from(r.querySelectorAll(s));
    const normText = (s) => (s||'').replace(/\s+/g,' ').replace(/:$/, '').trim();
    const normKey  = (s) => normText(s).toLowerCase();
    const $1 = (s, r=document) => r.querySelector(s);

    /* ===== dictionaries ===== */
    const STATES_USA = {"Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC","Puerto Rico":"PR"};
    const PROVINCES_CA = {"Alberta":"AB","British Columbia":"BC","Manitoba":"MB","New Brunswick":"NB","Newfoundland and Labrador":"NL","Nova Scotia":"NS","Ontario":"ON","Prince Edward Island":"PE","Quebec":"QC","Saskatchewan":"SK","Northwest Territories":"NT","Nunavut":"NU","Yukon":"YT"};
    const invert = (obj) => Object.fromEntries(Object.entries(obj).map(([full,code])=>[code,full]));
    const US_CODE2FULL = invert(STATES_USA);
    const CA_CODE2FULL = invert(PROVINCES_CA);

    const COUNTRY_CANON = new Map([
        ['US','UNITED STATES'], ['USA','UNITED STATES'], ['UNITED STATES','UNITED STATES'],
        ['CA','CANADA'], ['CAN','CANADA'], ['CANADA','CANADA'],
    ]);
    const canonCountry = (raw) => COUNTRY_CANON.get((raw||'').replace(/\./g,'').trim().toUpperCase()) || (raw||'');

    function regionFull(code, countryCanon){
        const c = (countryCanon||'').toLowerCase();
        const up = (code||'').replace(/\./g,'').trim().toUpperCase();
        if (!up) return '';
        if (c==='united states') return US_CODE2FULL[up] || code;
        if (c==='canada')       return CA_CODE2FULL[up] || code;
        if (US_CODE2FULL[up] && !CA_CODE2FULL[up]) return US_CODE2FULL[up];
        if (CA_CODE2FULL[up] && !US_CODE2FULL[up]) return CA_CODE2FULL[up];
        return code;
    }

    /* ===== config ===== */
    const REMOVE_KEYS = new Set(['fax','card number','card expiry','cvv']);

    const KEY_MAP = new Map([
        ['first name','first'], ['first','first'],
        ['last name','last'],   ['last','last'],
        ['company','company'],
        ['address','address'],
        ['city','city'],
        ['state','state'], ['province','state'],
        ['zip code','zip'], ['zipcode','zip'], ['zip','zip'], ['postal code','zip'],
        ['country','country'],
        ['phone 1','phone1'], ['phone1','phone1'],
        ['phone 2','phone2'], ['phone2','phone2'],
        ['email','email'],
        ['internal status','internal_status'],
        ['shipment type','shipment_type'],
        ['change shipment type','change_shipment_type'],
        ['source','source'],
        ['order #','order_num'], ['order number','order_num'],
        ['sage sale/invoice #','sage_num'], ['sage invoice #','sage_num'],
        ['invoice pdf','invoice_pdf'],
        ['commercial invoice','commercial_invoice'],
        ['currency','currency'],
        ['payment method','payment'],
        ['card details','card_details'],
        ['purchase date','purchase_date'],
        ['last update','last_update'],
        ['shipment control','shipment_control'],
        ['expected lead time','lead_time'],
        ['expected shipping date','expected_ship_date'],
        ['pick up','pickup'],
        ['flags','flags'],
        ['comments','comments']
    ]);

    const DISPLAY_LABELS = new Map([
        ['first','First Name'],
        ['last','Last Name'],
        ['company','Company'],
        ['address','Address'],
        ['city','City'],
        ['state','State'], // becomes "Province" for Canada
        ['zip','Zip'],
        ['country','Country'],
        ['phone1','Phone 1'],
        ['phone2','Phone 2'],
        ['email','Email'],
        ['internal_status','Status'],
        ['shipment_type','Shipment Type'],
        ['change_shipment_type','Change Shipment Type'],
        ['source','Source'],
        ['order_num','Order #'],
        ['sage_num','Sage Invoice #'],
        ['invoice_pdf','Invoice PDF'],
        ['commercial_invoice','Commercial Invoice'],
        ['currency','Currency'],
        ['payment','Payment Method'],
        ['card_details','Card Details'],
        ['purchase_date','Purchase Date'],
        ['last_update','Last Update'],
        ['shipment_control','Shipment Control'],
        ['lead_time','Expected Lead Time'],
        ['expected_ship_date','Expected Shipping Date'],
        ['pickup','Pickup'],
        // 'flags' intentionally not normalized
        ['comments','Comments']
    ]);

    // Keep HTML for these keys; others get text-normalized
    const KEEP_HTML = new Set([
        'email',
        'invoice_pdf',
        'commercial_invoice',
        'change_shipment_type',
        'card_details',
        'flags'
    ]);

    // Do not touch label/value for these keys
    const DO_NOT_TOUCH = new Set(['flags']);

    /* ===== card targeting & CSS scoping ===== */
    function getPanelTitle(panel){
        return normText(panel.querySelector('.panel-heading .sc-title')?.textContent || '');
    }
    function isOrderPanel(panel){
        // Heuristic: contains a row whose first cell is "Order #" or "Order Number"
        return $$('tbody > tr', panel).some(tr => {
            const k = normText(tr.cells?.[0]?.textContent || '');
            return /^order\s*(#|number)$/i.test(k);
        });
    }
    function findOrderInfoCards(){
        const panels = $$('.panel');
        return panels.filter(p => isOrderPanel(p) || /^(billing info|shipping info)$/i.test(getPanelTitle(p)));
    }
    // Inject CSS that cannot leak outside any targeted card(s).
    function injectScopedCSS(cssText){
        if (!cssText) return;
        const scopeSel = '[data-tm-orderinfo]'; // applied to all target cards
        const prefixed = cssText
        .replace(/:root\b/g, scopeSel)
        .replace(/(^|})\s*([^{@}][^{]*?)\s*\{/g, (m, sep, sel) => {
            const expanded = sel
            .split(',')
            .map(s => `${scopeSel} ${s.trim()}`)
            .join(', ');
            return `${sep} ${expanded}{`;
        });
        const style = document.createElement('style');
        style.setAttribute('data-tm-scoped-css', '1');
        style.textContent = prefixed;
        document.head.appendChild(style);
    }

    /* ===== Qlink extraction (read-only global) ===== */
    function setGlobalConst(name, value) {
        if (!value) return;
        if (!Object.prototype.hasOwnProperty.call(window, name)) {
            try {
                Object.defineProperty(window, name, {
                    value,
                    writable:false,
                    configurable:false,
                    enumerable:true
                });
            } catch (e) {
                window[name] = value;
            }
        }
        if (globalThis[name] !== value) globalThis[name] = value;
        console.debug(`[Order Info Panels] ${name}=`, value);
    }

    function extractQlinkFromCell(cell) {
        const a = cell?.querySelector?.('a[href]');
        const href = a?.href?.trim();
        if (href && !window.Qlink) setGlobalConst('Qlink', href);
    }

    // prime once in case it's already there
    (function primeQlink() {
        const row = [...document.querySelectorAll('tr.gradeX')].find(tr => {
            const t = normText(tr.cells?.[0]?.textContent || '');
            return /^\s*quote\s*#\s*$/i.test(t);
        });
        if (row) extractQlinkFromCell(row.cells?.[1]);
    })();

    /* ===== processing (row-idempotent) ===== */
    let inMutation = false;
    let CARDS = [];

    function processTable(tbl){
        const rows = $$('tbody > tr', tbl);
        if (!rows.length) return;

        // First pass: find canonical country
        let countryCanonVal = '';
        for (const tr of rows){
            const tds = tr.querySelectorAll('td');
            if (tds.length < 2) continue;
            const keyLower = normKey(tds[0].textContent);
            if (KEY_MAP.get(keyLower) === 'country'){
                countryCanonVal = canonCountry(normText(tds[1].textContent));
                break;
            }
        }

        for (const tr of rows){
            if (tr.dataset.tmProcessed === '1') continue;

            const tds = tr.querySelectorAll('td');
            if (tds.length < 2) { tr.dataset.tmProcessed = '1'; continue; }

            const labelCell = tds[0];
            const valueCell = tds[1];

            const labelRaw = normText(labelCell.textContent);
            const keyLower = normKey(labelRaw);
            const canonical = KEY_MAP.get(keyLower) || keyLower;

            // SPECIAL: Quote # row -> capture Qlink then remove entire row
            if (keyLower === 'quote #') {
                extractQlinkFromCell(valueCell);
                tr.remove();
                continue;
            }

            // strip sensitive rows
            if (REMOVE_KEYS.has(keyLower)){
                tr.remove();
                continue;
            }

            // FLAGS row: leave 100% alone
            if (DO_NOT_TOUCH.has(canonical)){
                tr.dataset.tmProcessed = '1';
                continue;
            }

            // Detect truly interactive controls (but allow .tm-bubble to be edited)
            const hasInteractive = !!valueCell.querySelector('select, input, textarea, button, [contenteditable=""]');

            // Where to write the normalized text (prefer inner bubble/strong if present)
            function valueWriteTarget(td){
                const b = td.querySelector('.tm-bubble');
                return b ? (b.querySelector('strong, span, b') || b) : td;
            }

            // Normalize the VALUE cell if it has no real interactive UI
            if (!hasInteractive) {
                const tgt = valueWriteTarget(valueCell);
                if (canonical === 'country'){
                    const v = canonCountry(normText(valueCell.textContent));
                    if (tgt.textContent !== v) tgt.textContent = v;
                    countryCanonVal = v || countryCanonVal;
                } else if (canonical === 'state'){
                    const raw = normText(valueCell.textContent);
                    const full = regionFull(raw, countryCanonVal);
                    const out = full || raw;
                    if (tgt.textContent !== out) tgt.textContent = out;
                } else if (!KEEP_HTML.has(canonical)){
                    const t = normText(valueCell.textContent);
                    if (tgt.textContent !== t) tgt.textContent = t;
                }
            }
            // else: leave innerHTML as-is so dropdowns / carrier pickers survive

            // Normalize the LABEL text if it's simple text-only
            if (labelCell.children.length === 0){
                let display = DISPLAY_LABELS.get(canonical) || labelRaw || '';
                if (canonical === 'state' &&
                    (countryCanonVal||'').toLowerCase() === 'canada') {
                    display = 'Province';
                }
                const target = display
                ? (display.endsWith(':') ? display : display + ':')
                : labelCell.textContent;

                if (normText(labelCell.textContent) + ':' !== normText(target)) {
                    labelCell.textContent = target;
                }
            }

            tr.dataset.tmProcessed = '1';
        }
    }

    function sweep(root=document){
        const tables = $$('table', root); // now scoped by caller to the single card
        if (!tables.length) return;
        inMutation = true;
        try {
            for (const tbl of tables){
                processTable(tbl);
            }
        } finally {
            inMutation = false;
        }
    }

    CARDS = findOrderInfoCards();
    CARDS.forEach(c => c.setAttribute('data-tm-orderinfo', '')); // tag all target cards

    // process each card once
    (CARDS.length ? CARDS : [document]).forEach(sweep);

    // Observe ONLY inside each targeted card
    CARDS.forEach(card => {
        const mo = new MutationObserver(() => {
            if (inMutation) return;
            sweep(card);
        });
        mo.observe(card, { childList:true, subtree:true });
    });

    // Optional styles (scoped to all tagged cards):
    // injectScopedCSS(`
    //   table { border-collapse: collapse; }
    //   td:first-child { font-weight: 600; }
    // `);
})();
