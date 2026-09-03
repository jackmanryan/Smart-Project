/**
 * UPS claim composer.
 *
 * Every UPS "Submit Claim" link on an order gets two pills beside it: one opens a Gmail
 * compose window prefilled with the claim template UPS insists on (shipper block,
 * consignee block, package value, goods description), the other searches Gmail for that
 * tracking number so you can see whether the claim was already filed.
 *
 * The page data all comes from ../lib/order-data.js, which is the SCX mini-core this
 * script used to publish on `window.SCX` — nothing else ever read it, so it is a plain
 * import now.
 *
 * Ported from legacy/userscripts/extraclaims.user.js (v3.3):
 *   - the `window.__UPS_GMAIL_V2_SOLO__` re-entry guard is gone; the registry starts a
 *     module once
 *   - the MutationObserver over documentElement plus its 300 ms kick is one
 *     ctx.observe.each subscription on the claim-link selector
 *   - the inline style attributes moved to styles.css
 */

import css from './styles.css';
import { getClaimsByTracking, getConsignee, getCurrency, getInvoice, getOrderBits } from '../lib/order-data.js';

/* ------------------------------------------------------------------ config */

const STYLE_ID = 'orders-claims';
const WRAP_CLASS = '__ups_gmail_injected'; // also the "already injected" marker
const BTN_TEXT = 'Compose Gmail Claim';
const SEARCH_TEXT = 'Search Gmail';

const CLAIM_SEL = 'a[href*="sales_shipment_claim"][href*="tracking_number="]';
const GMAIL_SEARCH = 'https://mail.google.com/mail/u/0/#search/';

/** Ours, and static — UPS wants it repeated in the body of every claim. */
const SHIPPER = {
  company: 'Strip-curtains.com',
  contact: 'Daniel',
  phone: '8772099344',
  address: 'Unit 3 - 1350 Valmont Way, Richmond, BC V6V 1Y4',
  email: 'order-management@strip-curtains.com',
};

/** Optional page-set recipient. Blank leaves the To: field for Gmail to prompt for. */
const defaultTo = () => String(window.UPS_CLAIMS_EMAIL || '').trim();

/* ------------------------------------------------------- compose URL + body */

function gmailComposeURL({ to = '', subject = '', body = '' }) {
  const base = 'https://mail.google.com/mail/?view=cm&fs=1&tf=1';
  const enc = encodeURIComponent;
  return `${base}&to=${enc(to)}&su=${enc(subject)}&body=${enc(body)}`;
}

/**
 * UPS's claim form rejects anything outside plain ASCII and truncates past 300 chars,
 * so smart quotes, dashes and accents are folded before the description goes in.
 */
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
  const consignee = getConsignee();
  const currency = getCurrency();
  const invoice = getInvoice();

  const claims = getClaimsByTracking();
  const c = claims[trk] || { valueSum: 0, descs: new Set() };
  const val = Math.max(0, +(c.valueSum || 0).toFixed(2));

  const desc = sanitizeAscii300(Array.from(c.descs || []).join(', '));

  return `Please see the required details below,

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
- Has a replacement package been shipped? No, and yes we will be sending a replacement`;
}

function buildComposeURLForTracking(trk) {
  const bits = getOrderBits();
  const invoice = bits.invoice || 'NA';
  const subject = ['UPS Claim', trk && `Tracking ${trk}`, `Invoice ${invoice}`].filter(Boolean).join(' — ');
  return gmailComposeURL({ to: defaultTo(), subject, body: buildBodyForTracking(trk) });
}

/* ------------------------------------------------------------------ injection */

function parseTracking(a) {
  try {
    return new URL(a.getAttribute('href'), location.href).searchParams.get('tracking_number') || '';
  } catch {
    return '';
  }
}

function injectFor(anchor, dom) {
  if (anchor.nextElementSibling?.classList?.contains(WRAP_CLASS)) return;

  const trk = parseTracking(anchor);
  const wrap = dom.el(
    'span',
    { class: WRAP_CLASS },
    dom.el(
      'a',
      {
        class: 'sc-claim-pill sc-claim-pill--compose',
        href: buildComposeURLForTracking(trk),
        target: '_blank',
        rel: 'noopener',
        title: 'Open Gmail compose prefilled for UPS claim',
      },
      BTN_TEXT,
    ),
    dom.el(
      'a',
      {
        class: 'sc-claim-pill sc-claim-pill--search',
        href: GMAIL_SEARCH + encodeURIComponent(trk || ''),
        target: '_blank',
        rel: 'noopener',
        title: 'Search Gmail for this tracking #',
      },
      SEARCH_TEXT,
    ),
  );

  anchor.insertAdjacentElement('afterend', wrap);
}

/** The legacy `window.__upsGmailSolo_debug()` global, reachable through ctx.events now. */
function debugTable(ctx) {
  const rows = ctx.dom.$$(CLAIM_SEL).map((a, i) => ({
    i,
    text: a.textContent.trim(),
    trk: parseTracking(a),
    injected: a.nextElementSibling?.classList?.contains(WRAP_CLASS) || false,
    compose: a.nextElementSibling?.querySelector('a')?.href || '',
  }));
  console.table(rows);
  return rows.length;
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'orders.claims',
  title: 'UPS claim composer',
  runAt: 'idle',
  pages: ['orders-view'],
  enabledByDefault: true,

  init(ctx) {
    ctx.style.add(css, { id: STYLE_ID });

    // One pass per claim link, for the ones on the page now and any a redraw adds.
    ctx.observe.each(CLAIM_SEL, (anchor) => injectFor(anchor, ctx.dom));

    ctx.events.on('orders.claims:debug', () => debugTable(ctx));
  },
};
