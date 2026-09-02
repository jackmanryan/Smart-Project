/**
 * Order info panels — strips the sensitive rows, normalises the label column and the
 * Country / State (Province) values on the order, billing and shipping cards.
 *
 * Ported from legacy/userscripts/order-info-panels.user.js (v1.1.1). Layout only: the
 * original shipped no CSS — its one style hook was a scoped-CSS injector that was only
 * ever called from a commented-out block, so it is gone.
 *
 * Two things the legacy script did through the global scope now go through ctx:
 *   - the Quote # link it froze onto `window.Qlink` is published on ctx.events
 *   - its per-card MutationObservers are one ctx.observe subscription
 */

/* ------------------------------------------------------------------ dictionaries */

const STATES_USA = {"Alabama":"AL","Alaska":"AK","Arizona":"AZ","Arkansas":"AR","California":"CA","Colorado":"CO","Connecticut":"CT","Delaware":"DE","Florida":"FL","Georgia":"GA","Hawaii":"HI","Idaho":"ID","Illinois":"IL","Indiana":"IN","Iowa":"IA","Kansas":"KS","Kentucky":"KY","Louisiana":"LA","Maine":"ME","Maryland":"MD","Massachusetts":"MA","Michigan":"MI","Minnesota":"MN","Mississippi":"MS","Missouri":"MO","Montana":"MT","Nebraska":"NE","Nevada":"NV","New Hampshire":"NH","New Jersey":"NJ","New Mexico":"NM","New York":"NY","North Carolina":"NC","North Dakota":"ND","Ohio":"OH","Oklahoma":"OK","Oregon":"OR","Pennsylvania":"PA","Rhode Island":"RI","South Carolina":"SC","South Dakota":"SD","Tennessee":"TN","Texas":"TX","Utah":"UT","Vermont":"VT","Virginia":"VA","Washington":"WA","West Virginia":"WV","Wisconsin":"WI","Wyoming":"WY","District of Columbia":"DC","Puerto Rico":"PR"};
const PROVINCES_CA = {"Alberta":"AB","British Columbia":"BC","Manitoba":"MB","New Brunswick":"NB","Newfoundland and Labrador":"NL","Nova Scotia":"NS","Ontario":"ON","Prince Edward Island":"PE","Quebec":"QC","Saskatchewan":"SK","Northwest Territories":"NT","Nunavut":"NU","Yukon":"YT"};

const invert = (obj) => Object.fromEntries(Object.entries(obj).map(([full, code]) => [code, full]));
const US_CODE2FULL = invert(STATES_USA);
const CA_CODE2FULL = invert(PROVINCES_CA);

const COUNTRY_CANON = new Map([
  ['US', 'UNITED STATES'], ['USA', 'UNITED STATES'], ['UNITED STATES', 'UNITED STATES'],
  ['CA', 'CANADA'], ['CAN', 'CANADA'], ['CANADA', 'CANADA'],
]);

/* ------------------------------------------------------------------ text helpers */

/**
 * Collapse whitespace, drop one trailing colon, then trim — in that order.
 *
 * ctx.dom.norm trims first, which would also strip the colon from a cell whose text
 * ends in whitespace. Every key lookup below runs through this, so the legacy order is
 * kept verbatim rather than "fixed" into a different set of matches.
 */
const normText = (s) => (s || '').replace(/\s+/g, ' ').replace(/:$/, '').trim();
const normKey = (s) => normText(s).toLowerCase();

const canonCountry = (raw) => COUNTRY_CANON.get((raw || '').replace(/\./g, '').trim().toUpperCase()) || (raw || '');

/** Expand a state/province code to its full name, disambiguated by the country. */
function regionFull(code, countryCanon) {
  const c = (countryCanon || '').toLowerCase();
  const up = (code || '').replace(/\./g, '').trim().toUpperCase();
  if (!up) return '';
  if (c === 'united states') return US_CODE2FULL[up] || code;
  if (c === 'canada') return CA_CODE2FULL[up] || code;
  if (US_CODE2FULL[up] && !CA_CODE2FULL[up]) return US_CODE2FULL[up];
  if (CA_CODE2FULL[up] && !US_CODE2FULL[up]) return CA_CODE2FULL[up];
  return code;
}

/* ------------------------------------------------------------------ row config */

/** Rows nobody wants on screen. Matched on the raw label key, not the canonical one. */
const REMOVE_KEYS = new Set(['fax', 'card number', 'card expiry', 'cvv']);

const KEY_MAP = new Map([
  ['first name', 'first'], ['first', 'first'],
  ['last name', 'last'], ['last', 'last'],
  ['company', 'company'],
  ['address', 'address'],
  ['city', 'city'],
  ['state', 'state'], ['province', 'state'],
  ['zip code', 'zip'], ['zipcode', 'zip'], ['zip', 'zip'], ['postal code', 'zip'],
  ['country', 'country'],
  ['phone 1', 'phone1'], ['phone1', 'phone1'],
  ['phone 2', 'phone2'], ['phone2', 'phone2'],
  ['email', 'email'],
  ['internal status', 'internal_status'],
  ['shipment type', 'shipment_type'],
  ['change shipment type', 'change_shipment_type'],
  ['source', 'source'],
  ['order #', 'order_num'], ['order number', 'order_num'],
  ['sage sale/invoice #', 'sage_num'], ['sage invoice #', 'sage_num'],
  ['invoice pdf', 'invoice_pdf'],
  ['commercial invoice', 'commercial_invoice'],
  ['currency', 'currency'],
  ['payment method', 'payment'],
  ['card details', 'card_details'],
  ['purchase date', 'purchase_date'],
  ['last update', 'last_update'],
  ['shipment control', 'shipment_control'],
  ['expected lead time', 'lead_time'],
  ['expected shipping date', 'expected_ship_date'],
  ['pick up', 'pickup'],
  ['flags', 'flags'],
  ['comments', 'comments'],
]);

const DISPLAY_LABELS = new Map([
  ['first', 'First Name'],
  ['last', 'Last Name'],
  ['company', 'Company'],
  ['address', 'Address'],
  ['city', 'City'],
  ['state', 'State'], // becomes "Province" for Canada
  ['zip', 'Zip'],
  ['country', 'Country'],
  ['phone1', 'Phone 1'],
  ['phone2', 'Phone 2'],
  ['email', 'Email'],
  ['internal_status', 'Status'],
  ['shipment_type', 'Shipment Type'],
  ['change_shipment_type', 'Change Shipment Type'],
  ['source', 'Source'],
  ['order_num', 'Order #'],
  ['sage_num', 'Sage Invoice #'],
  ['invoice_pdf', 'Invoice PDF'],
  ['commercial_invoice', 'Commercial Invoice'],
  ['currency', 'Currency'],
  ['payment', 'Payment Method'],
  ['card_details', 'Card Details'],
  ['purchase_date', 'Purchase Date'],
  ['last_update', 'Last Update'],
  ['shipment_control', 'Shipment Control'],
  ['lead_time', 'Expected Lead Time'],
  ['expected_ship_date', 'Expected Shipping Date'],
  ['pickup', 'Pickup'],
  // 'flags' intentionally not normalized
  ['comments', 'Comments'],
]);

/** Keep the markup for these keys; every other value cell gets text-normalised. */
const KEEP_HTML = new Set([
  'email',
  'invoice_pdf',
  'commercial_invoice',
  'change_shipment_type',
  'card_details',
  'flags',
]);

/** Do not touch label or value for these keys. FLAGS keeps its own formatting. */
const DO_NOT_TOUCH = new Set(['flags']);

/* ------------------------------------------------------------------ cell helpers */

/** Truly interactive controls — .tm-bubble from Bubble Text is still editable. */
const hasInteractiveControl = (td) => !!td.querySelector('select, input, textarea, button, [contenteditable=""]');

/** Where the normalised text goes: the inner bubble/strong when there is one. */
function valueWriteTarget(td) {
  const bubble = td.querySelector('.tm-bubble');
  return bubble ? bubble.querySelector('strong, span, b') || bubble : td;
}

const panelTitle = (panel) => normText(panel.querySelector('.panel-heading .sc-title')?.textContent || '');

/* ------------------------------------------------------------------ the normaliser */

/** Event other modules listen on; it replaces the read-only `window.Qlink` global. */
const QUOTE_LINK_EVENT = 'orders:quote-link';

function createNormaliser(ctx) {
  const { $$ } = ctx.dom;
  const cards = new Set();
  let quoteLink = '';

  /* --- the quote link ------------------------------------------------------- */

  function publishQuoteLink(href) {
    if (!href || quoteLink) return; // first one wins, exactly as the frozen global did
    quoteLink = href;
    ctx.log.debug('Qlink=', href);
    ctx.events.emit(QUOTE_LINK_EVENT, href);
  }

  function harvestQuoteLink(cell) {
    const a = cell?.querySelector?.('a[href]');
    publishQuoteLink(a?.href?.trim());
  }

  /** Prime once in case the Quote # row is already on the page. */
  function primeQuoteLink() {
    const row = $$('tr.gradeX').find((tr) => /^\s*quote\s*#\s*$/i.test(normText(tr.cells?.[0]?.textContent || '')));
    if (row) harvestQuoteLink(row.cells?.[1]);
  }

  /** Re-announce for a module that started after the link was found. */
  function replayQuoteLink() {
    if (quoteLink) ctx.events.emit(QUOTE_LINK_EVENT, quoteLink);
  }

  /* --- card targeting ------------------------------------------------------- */

  function isOrderInfoCard(panel) {
    // Heuristic: an order card contains a row whose first cell is "Order #"/"Order Number".
    const hasOrderRow = $$('tbody > tr', panel).some((tr) =>
      /^order\s*(#|number)$/i.test(normText(tr.cells?.[0]?.textContent || '')),
    );
    return hasOrderRow || /^(billing info|shipping info)$/i.test(panelTitle(panel));
  }

  /* --- processing (row-idempotent) ------------------------------------------ */

  function processTable(tbl) {
    const rows = $$('tbody > tr', tbl);
    if (!rows.length) return;

    // First pass: find the canonical country, so State can be expanded and relabelled.
    let countryCanonVal = '';
    for (const tr of rows) {
      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) continue;
      if (KEY_MAP.get(normKey(tds[0].textContent)) === 'country') {
        countryCanonVal = canonCountry(normText(tds[1].textContent));
        break;
      }
    }

    for (const tr of rows) {
      if (tr.dataset.tmProcessed === '1') continue;

      const tds = tr.querySelectorAll('td');
      if (tds.length < 2) {
        tr.dataset.tmProcessed = '1';
        continue;
      }

      const labelCell = tds[0];
      const valueCell = tds[1];
      const labelRaw = normText(labelCell.textContent);
      const keyLower = normKey(labelRaw);
      const canonical = KEY_MAP.get(keyLower) || keyLower;

      // SPECIAL: Quote # row -> capture the link, then remove the whole row.
      if (keyLower === 'quote #') {
        harvestQuoteLink(valueCell);
        tr.remove();
        continue;
      }

      if (REMOVE_KEYS.has(keyLower)) {
        tr.remove();
        continue;
      }

      // FLAGS row: leave 100% alone.
      if (DO_NOT_TOUCH.has(canonical)) {
        tr.dataset.tmProcessed = '1';
        continue;
      }

      // Normalise the VALUE cell only when it holds no real interactive UI; otherwise
      // leave the markup alone so dropdowns and carrier pickers survive.
      if (!hasInteractiveControl(valueCell)) {
        const tgt = valueWriteTarget(valueCell);
        if (canonical === 'country') {
          const v = canonCountry(normText(valueCell.textContent));
          if (tgt.textContent !== v) tgt.textContent = v;
          countryCanonVal = v || countryCanonVal;
        } else if (canonical === 'state') {
          const raw = normText(valueCell.textContent);
          const out = regionFull(raw, countryCanonVal) || raw;
          if (tgt.textContent !== out) tgt.textContent = out;
        } else if (!KEEP_HTML.has(canonical)) {
          const t = normText(valueCell.textContent);
          if (tgt.textContent !== t) tgt.textContent = t;
        }
      }

      // Normalise the LABEL only when it is simple text.
      if (labelCell.children.length === 0) {
        let display = DISPLAY_LABELS.get(canonical) || labelRaw || '';
        if (canonical === 'state' && (countryCanonVal || '').toLowerCase() === 'canada') display = 'Province';

        const target = display ? (display.endsWith(':') ? display : `${display}:`) : labelCell.textContent;
        if (`${normText(labelCell.textContent)}:` !== normText(target)) labelCell.textContent = target;
      }

      tr.dataset.tmProcessed = '1';
    }
  }

  /** Process every table under root; callers scope root to a single card. */
  function sweep(root = document) {
    for (const tbl of $$('table', root)) processTable(tbl);
  }

  function addCard(panel) {
    if (cards.has(panel)) return;
    cards.add(panel);
    panel.setAttribute('data-tm-orderinfo', ''); // legacy tag on every targeted card
    sweep(panel);
  }

  const sweepCards = () => {
    for (const card of cards) sweep(card);
  };

  return { addCard, isOrderInfoCard, primeQuoteLink, replayQuoteLink, sweep, sweepCards };
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'orders.info-panels',
  title: 'Order info panels',
  runAt: 'end',
  pages: [], // the legacy @match was the whole extranet
  enabledByDefault: true,

  init(ctx) {
    // Legacy @exclude list: quotes_editor is already handled by ctx.page.isExcluded,
    // the review workspace (?p=orders-review&review=…) is not.
    if (ctx.page.is('orders-review') && ctx.page.param('review')) return;

    const panels = createNormaliser(ctx);
    panels.primeQuoteLink();

    const found = ctx.dom.$$('.panel').filter((panel) => panels.isOrderInfoCard(panel));
    for (const panel of found) panels.addCard(panel);

    // Legacy fallback: with no order card on the page, every table gets one pass.
    if (!found.length) panels.sweep(document);

    // The legacy script read .panel once at document-end; keep watching so a card the
    // site re-renders later is normalised too.
    ctx.observe.each('.panel', (panel) => {
      if (panels.isOrderInfoCard(panel)) panels.addCard(panel);
    });

    // One subscription in place of the legacy per-card observers. Rows carry
    // data-tm-processed, so the sweep our own writes trigger is a no-op and the legacy
    // re-entrancy flag is not needed.
    ctx.observe.onChange(panels.sweepCards);

    // window.Qlink could be read at any time; an event cannot, so a module that starts
    // after us can ask for the link.
    ctx.events.on(`${QUOTE_LINK_EVENT}:request`, panels.replayQuoteLink);
  },
};
