/**
 * Shipment type from the freight charge.
 *
 * The rule, confirmed during the 08-31 rereview batch:
 *
 *   $0.00           Best Way — the UPS Standard default
 *   $0.01 – $100    keep the default
 *   over $100       keep the customer's exact selected method
 *
 * Like sourcing, this only ever recommends. The caller decides whether to apply it, and
 * shows the reason next to the field so the choice is auditable.
 */

/** The dollar figure above which the customer's own choice is authoritative. */
export const CUSTOMER_CHOICE_ABOVE = 100;

/** Read a money string off the page: "$1,234.56" -> 1234.56. */
export function parseMoney(text) {
  if (text == null) return NaN;
  const n = parseFloat(String(text).replace(/[^\d.-]/g, ''));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * What to do with #shipment_type for a given freight charge.
 *
 * Returns {action:'set'|'keep'|'unknown', match, reason}. `match` is a list of patterns
 * to try against the option text in order, so the caller does not need to know that
 * "Best Way" is realised as the UPS Standard default.
 */
export function shipmentFor(freightCharge) {
  const amount = typeof freightCharge === 'number' ? freightCharge : parseMoney(freightCharge);

  if (!Number.isFinite(amount)) {
    return { action: 'unknown', reason: 'no freight charge found on the page' };
  }

  if (amount === 0) {
    return {
      action: 'set',
      match: [/best\s*way/i, /ups\s*standard/i],
      reason: '$0.00, Best Way, UPS Standard',
    };
  }

  if (amount <= CUSTOMER_CHOICE_ABOVE) {
    return { action: 'keep', reason: `$${amount.toFixed(2)}, at or under $${CUSTOMER_CHOICE_ABOVE}, keep the default` };
  }

  return {
    action: 'keep',
    reason: `$${amount.toFixed(2)}, over $${CUSTOMER_CHOICE_ABOVE}, keep the customer's selected method`,
  };
}
