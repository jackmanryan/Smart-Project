/**
 * The sourcing, freight and price rules decide what goes on a purchase order, so they
 * are the one part of this repo worth pinning with assertions. Everything here is a
 * pure function — no DOM, no network — which is why these rules live in their own
 * libraries rather than inside the modules that use them.
 *
 * Run with `npm test`.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';

import { classify, isWholeFeet, EXTRUFLEX, RICHMOND } from '../src/modules/orders/lib/sourcing.js';
import { shipmentFor, parseMoney } from '../src/modules/orders/lib/freight.js';
import { priceFor, aliasFor, isZeroPriced } from '../src/modules/orders/lib/extruflex.js';

test('sourcing: PVC and Polymer Quick Snap go to ExtruFlex', () => {
  assert.equal(classify({ sku: 'SC-08-.08-STD-RIBBED' }).vendor, EXTRUFLEX);
  assert.equal(classify({ sku: 'SC-12x120-STD-ORANGE' }).vendor, EXTRUFLEX);
  assert.equal(classify({ sku: 'POLYMER QUICK SNAP' }).vendor, EXTRUFLEX);
});

test('sourcing: GALV splits on whole versus partial footage', () => {
  assert.equal(classify({ sku: 'HARD-GALV', lengthFt: 6 }).vendor, EXTRUFLEX);
  assert.equal(classify({ sku: 'HARD-GALV', lengthFt: 12.0 }).vendor, EXTRUFLEX);
  // Invoice 150712: a 5.33 ft GALV line reached a sent ExtruFlex PO.
  assert.equal(classify({ sku: 'HARD-GALV', lengthFt: 5.33 }).vendor, RICHMOND);
});

test('sourcing: a GALV line with no length is not guessed at', () => {
  const verdict = classify({ sku: 'HARD-GALV' });
  assert.equal(verdict.vendor, RICHMOND, 'the safe side');
  assert.equal(verdict.needsLength, true, 'and it says so');
});

test('sourcing: other hardware goes to Richmond, unknowns are flagged', () => {
  assert.equal(classify({ sku: 'HARD-BRACKET' }).vendor, RICHMOND);
  const unknown = classify({ sku: 'ZZZ-MYSTERY-PART' });
  assert.equal(unknown.vendor, RICHMOND);
  assert.equal(unknown.uncertain, true);
});

test('isWholeFeet tolerates float noise but not real fractions', () => {
  assert.equal(isWholeFeet(6), true);
  assert.equal(isWholeFeet(6.0001), true);
  assert.equal(isWholeFeet(5.33), false);
  assert.equal(isWholeFeet(''), false);
});

test('freight: $0.00 selects Best Way', () => {
  const v = shipmentFor(0);
  assert.equal(v.action, 'set');
  assert.match(v.reason, /Best Way/);
  assert.ok(v.match.some((re) => re.test('UPS Standard')));
});

test('freight: up to $100 keeps the default, above it keeps the customer method', () => {
  assert.equal(shipmentFor(0.01).action, 'keep');
  assert.match(shipmentFor(100).reason, /at or under/);
  assert.match(shipmentFor(100.01).reason, /customer/);
  assert.match(shipmentFor('$1,234.56').reason, /customer/);
});

test('freight: a missing charge is unknown, never a guess', () => {
  assert.equal(shipmentFor(null).action, 'unknown');
  assert.equal(shipmentFor('n/a').action, 'unknown');
  assert.ok(Number.isNaN(parseMoney('n/a')));
});

test('prices: known SKUs resolve, unknown ones stop the caller', () => {
  assert.equal(priceFor({ sku: 'SC-12IN-0120IN-STANDARD' }).price, 1.31);
  assert.equal(priceFor({ sku: 'SC-08-.08 - FROSTED' }).price, 0.65);
  assert.equal(priceFor({ sku: 'NOT-ON-THE-LIST' }).kind, 'unknown');
});

test('prices: cutting charges are left alone', () => {
  assert.equal(priceFor({ sku: 'X', description: 'Cutting Charge' }).kind, 'ignore');
});

test('prices: a MISCSERVICE credit is fine, a charge needs a human', () => {
  assert.equal(priceFor({ sku: 'MISCSERVICE', unitPrice: -25 }).kind, 'ignore');
  const charge = priceFor({ sku: 'MISCSERVICE', unitPrice: 25 });
  assert.equal(charge.kind, 'stop');
  assert.match(charge.reason, /extra notes on po needed/);
});

test('prices: zero is always wrong on a priced line', () => {
  assert.equal(isZeroPriced(0), true);
  assert.equal(isZeroPriced('0.00'), true);
  assert.equal(isZeroPriced(0.65), false);
});

test('SKU aliases resolve to the vendor part name', () => {
  assert.equal(aliasFor('SC-08-08-AZTEC-RED'), 'Screenflex Red 8" x .080"');
  assert.equal(aliasFor('SC-08-08-EXTRA-RIBBED-LOW-TEMP'), 'Low Temp DuraRib 8" x .072"');
  assert.equal(aliasFor('NOT-A-SKU'), null);
});
