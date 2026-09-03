/**
 * Which vendor a review line is sourced from.
 *
 * The decision is a fixed rule, confirmed during the 08-31 rereview batch:
 *
 *   PVC and Polymer Quick Snap        -> ExtruFlex
 *   GALV hardware in whole feet       -> ExtruFlex
 *   GALV hardware in partial footage  -> Richmond Warehouse
 *   other hardware                    -> Richmond Warehouse
 *
 * Encoding it here means the reviewer overrides exceptions instead of setting every row
 * by hand, which was the slowest part of the page and the step that put a 5.33 ft GALV
 * line onto a sent ExtruFlex PO (invoice 150712).
 *
 * classify() never writes anything. It returns a recommendation and the reason for it,
 * so the caller can show its work and a human can disagree.
 */

export const EXTRUFLEX = 'ExtruFlex';
export const RICHMOND = 'Richmond Warehouse';

/** Galvanised hardware: whole feet stay with ExtruFlex, partial footage goes to Richmond. */
const GALV = /\bGALV\b|HARD-GALV/i;

/** Hardware that is not galvanised. */
const HARDWARE = /\bHARD-|\bHARDWARE\b|\bBRACKET\b|\bBOLT\b|\bMOUNT\b/i;

/** Polymer Quick Snap is ExtruFlex stock despite reading like hardware. */
const QUICK_SNAP = /QUICK\s*SNAP|QUICKSNAP|POLYMER\s*QUICK/i;

/** PVC strip stock. */
const PVC = /\bPVC\b|\bSC-\d|RIBBED|SMOOTH|FROSTED|SCREENFLEX|DURARIB/i;

/** True when a length is a whole number of feet, within a hair of rounding. */
export function isWholeFeet(lengthFt) {
  // Number('') is 0, which is a whole number — but a blank length is not a length, and
  // answering "whole feet" for one would route an unmeasured GALV line to ExtruFlex.
  if (lengthFt == null || String(lengthFt).trim() === '') return false;
  const n = Number(lengthFt);
  if (!Number.isFinite(n)) return false;
  return Math.abs(n - Math.round(n)) < 0.001;
}

/**
 * Recommend a vendor for one line.
 *
 * `lengthFt` matters only for GALV; pass what the row shows. When it is missing on a GALV
 * line the answer is deliberately Richmond with a `needsLength` flag, because that is the
 * safe side: a partial-footage line reaching ExtruFlex is the error this rule exists to
 * prevent, and the opposite mistake is caught at the PO table.
 */
export function classify({ sku = '', description = '', lengthFt = null } = {}) {
  const text = `${sku} ${description}`;

  if (QUICK_SNAP.test(text)) return { vendor: EXTRUFLEX, reason: 'Polymer Quick Snap' };

  if (GALV.test(text)) {
    if (lengthFt == null || lengthFt === '') {
      return { vendor: RICHMOND, reason: 'GALV with no length on the row', needsLength: true };
    }
    return isWholeFeet(lengthFt)
      ? { vendor: EXTRUFLEX, reason: `GALV in whole feet (${lengthFt})` }
      : { vendor: RICHMOND, reason: `GALV in partial footage (${lengthFt})` };
  }

  if (HARDWARE.test(text)) return { vendor: RICHMOND, reason: 'hardware' };
  if (PVC.test(text)) return { vendor: EXTRUFLEX, reason: 'PVC' };

  // Anything unrecognised goes to the vendor that cannot ship the wrong thing silently:
  // a Richmond line routes to production and is seen, an ExtruFlex line leaves on a PO.
  return { vendor: RICHMOND, reason: 'unrecognised line, defaulted to Richmond', uncertain: true };
}

/** Classify a set of rows at once, returning only those whose vendor should change. */
export function flipsNeeded(rows) {
  return rows
    .map((row) => ({ row, ...classify(row) }))
    .filter((r) => r.vendor !== r.row.vendor);
}
