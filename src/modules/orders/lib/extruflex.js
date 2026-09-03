/**
 * The ExtruFlex price list, and the SKU aliases that map extranet SKUs onto its rows.
 *
 * This exists because the rereview batch needed a manual price lookup on nearly every
 * order, and because the SKU-to-vendor-part mapping lived in one reviewer's head. Both
 * are data, so they belong in the repo where a diff can be reviewed.
 *
 * INCOMPLETE ON PURPOSE. Only the rows confirmed during the 08-31 batch are here. A SKU
 * that is not listed returns null, and every caller treats null as "stop and ask" rather
 * than "assume it is fine" — an unknown price must never be signed off automatically.
 * Add rows as they are confirmed against the published list; keep the effective date
 * accurate, because the review screen shows it and a stale date is worse than none.
 *
 * Rules encoded here, from the batch:
 *   - cut strips take the per-foot strip price; a full roll takes the roll-length row
 *   - when the SKU and the description disagree, the SKU wins
 *   - cutting charges are left alone
 *   - a MISCSERVICE line with a negative price is a discount and is ignored; a positive
 *     one stops the run, because it means notes on the PO that a human has to read
 */

/** Printed on the review screen so a reviewer can see which list was applied. */
export const EFFECTIVE_DATE = '2026-04-13';
export const LIST_NAME = 'ExtruFlex 2026';

/**
 * Extranet SKU -> the vendor's own part name, for reading the printed list.
 * Confirmed during the 08-31 batch.
 */
export const SKU_ALIASES = [
  ['SC-08-08-AZTEC-RED', 'Screenflex Red 8" x .080"'],
  ['SC-08-08-EXTRA-RIBBED-LOW-TEMP', 'Low Temp DuraRib 8" x .072"'],
  ['SC-08-.08-STD-RIBBED', 'Standard DuraRib 8" x .072"'],
  ['SC-12x120-STD-ORANGE', 'Safety Orange 12" x .120"'],
];

/**
 * Net price rows. `unit` is 'ft' for cut strip stock and 'roll' for a full roll.
 * Matching is case-insensitive substring on the extranet SKU, first hit wins, so keep
 * the more specific keys above the general ones.
 */
export const PRICE_ROWS = [
  { sku: 'SC-08-08-RIBBED-LOW-TEMP', unit: 'ft', price: 0.69, part: 'Low Temp DuraRib 8" x .072"' },
  { sku: 'SC-08-.08 - FROSTED', unit: 'ft', price: 0.65, part: 'Standard Frosted (Matte) 8" x .080"' },
  { sku: 'SC-12IN-0120IN-STANDARD', unit: 'ft', price: 1.31, part: 'Standard Smooth 12" x .120"' },
  { sku: 'HARD-GALV', unit: 'ft', price: 3.0, part: 'Bolt-On Galvanized hardware' },
];

/** Lines whose price is never checked. */
const IGNORED = [/cutting charge/i];

/** A MISCSERVICE line: negative is a discount and fine, positive needs a human. */
const MISCSERVICE = /^\s*MISCSERVICE/i;

const up = (v) => String(v == null ? '' : v).toUpperCase();

/** The vendor's part name for a SKU, or null when the mapping is not recorded. */
export function aliasFor(sku) {
  const key = up(sku);
  const hit = SKU_ALIASES.find(([alias]) => key.includes(up(alias)));
  return hit ? hit[1] : null;
}

/**
 * What this PO line should cost, and why.
 *
 * Returns one of:
 *   {kind:'ignore'}                     a cutting charge or a MISCSERVICE discount
 *   {kind:'stop', reason}               needs a human before the PO can go out
 *   {kind:'price', price, unit, part}   the list price to compare the line against
 *   {kind:'unknown', sku}               not in the list; the caller must stop or skip
 */
export function priceFor({ sku, description = '', unitPrice = null, fullRoll = false } = {}) {
  const label = `${sku || ''} ${description || ''}`;

  if (IGNORED.some((re) => re.test(label))) return { kind: 'ignore', reason: 'cutting charge' };

  if (MISCSERVICE.test(sku || '') || MISCSERVICE.test(description || '')) {
    // A credit is routine. A charge means someone wrote notes onto the PO by hand.
    if (unitPrice != null && Number(unitPrice) > 0) {
      return { kind: 'stop', reason: 'extra notes on po needed (positive MISCSERVICE line)' };
    }
    return { kind: 'ignore', reason: 'MISCSERVICE discount' };
  }

  // The SKU wins over the description when they disagree.
  const wanted = fullRoll ? 'roll' : 'ft';
  const row =
    PRICE_ROWS.find((r) => up(sku).includes(up(r.sku)) && r.unit === wanted) ||
    PRICE_ROWS.find((r) => up(sku).includes(up(r.sku)));

  if (!row) return { kind: 'unknown', sku: String(sku || '') };
  return { kind: 'price', price: row.price, unit: row.unit, part: row.part };
}

/** True when a line's price on the page is zero — never let one of those onto a PO. */
export const isZeroPriced = (unitPrice) => Number(unitPrice) === 0;
