/**
 * ctx.style marks every stylesheet it injects as the bundle's own, and owns() reads the
 * mark back. hygiene/clean relies on that to leave the bundle's sheets alone while it
 * strips the site's, so the contract is pinned here on both injection paths: GM_addStyle
 * is there on the real site and absent in this runner.
 *
 * Run with `npm test`.
 */
import { test, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert/strict';

import { createStyle } from '../src/core/style.js';

/** The little bit of an element the style service touches. */
function fakeElement(tagName) {
  return { nodeType: 1, tagName, dataset: {}, textContent: '' };
}

const quiet = { warn() {} };
const CSS = 'img { height: auto; }';

let appended;

beforeEach(() => {
  appended = [];
  globalThis.document = {
    head: { append: (el) => appended.push(el) },
    createElement: (tag) => fakeElement(tag.toUpperCase()),
  };
});

afterEach(() => {
  delete globalThis.document;
  delete globalThis.GM_addStyle;
});

test('without GM_addStyle, add() appends a marked and tagged <style>', () => {
  const style = createStyle(quiet);
  style.add(CSS, { id: 'perf-turbokit' });

  assert.equal(appended.length, 1);
  const [el] = appended;
  assert.equal(el.dataset.scStyle, 'perf-turbokit');
  assert.ok(el.textContent.startsWith('/* sc-style: perf-turbokit */\n'), el.textContent);
  assert.ok(el.textContent.endsWith(CSS), 'the CSS itself is intact after the mark');
  assert.equal(style.owns(el), true);
});

test('with GM_addStyle, the text is marked before insertion and the element tagged after', () => {
  const style = createStyle(quiet);
  const atInsert = [];
  globalThis.GM_addStyle = (text) => {
    // What Tampermonkey does: build the element, append it, hand it back. The insertion
    // hooks in hygiene/clean see the node at this point, before add() can touch it.
    const el = fakeElement('STYLE');
    el.textContent = text;
    atInsert.push({ owned: style.owns(el), tagged: el.dataset.scStyle });
    appended.push(el);
    return el;
  };

  style.add(CSS, { id: 'perf-turbokit' });

  assert.equal(appended.length, 1);
  assert.deepEqual(atInsert, [{ owned: true, tagged: undefined }]);
  assert.equal(appended[0].dataset.scStyle, 'perf-turbokit');
});

test('a GM_addStyle that throws falls back to the DOM path, still marked', () => {
  const style = createStyle(quiet);
  globalThis.GM_addStyle = () => {
    throw new Error('no');
  };

  style.add(CSS, { id: 'x' });

  assert.equal(appended.length, 1);
  assert.equal(appended[0].dataset.scStyle, 'x');
  assert.equal(style.owns(appended[0]), true);
});

test("owns() is false for the site's stylesheets, including ones the bundle inlined", () => {
  const style = createStyle(quiet);

  const site = fakeElement('STYLE');
  site.textContent = '#emailsPane { min-height: 640px; } img { height: auto; }';
  assert.equal(style.owns(site), false);

  // perf serves the site's CSS out of its cache as <style data-lac="..."> — still the site's.
  const cached = fakeElement('STYLE');
  cached.dataset.lac = 'https://extranet.strip-curtains.com/css/custom.css';
  cached.textContent = site.textContent;
  assert.equal(style.owns(cached), false);

  assert.equal(style.owns(fakeElement('LINK')), false);
  assert.equal(style.owns(null), false);
  assert.equal(style.owns({ nodeType: 3, textContent: '/* sc-style */' }), false);
});

test('owns() accepts either mark on its own', () => {
  const style = createStyle(quiet);

  const byAttr = fakeElement('STYLE'); // the loader builds its lock style by hand
  byAttr.dataset.scStyle = 'loader-lock';
  byAttr.textContent = 'html { overflow: hidden; }';
  assert.equal(style.owns(byAttr), true);

  const byText = fakeElement('STYLE'); // a sheet seen while GM_addStyle is inserting it
  byText.textContent = '/* sc-style: nav */\n.x {}';
  assert.equal(style.owns(byText), true);
});

test('add() injects each id once; addToShadow() marks its copy too', () => {
  const style = createStyle(quiet);
  style.add(CSS, { id: 'once' });
  style.add('other {}', { id: 'once' });
  assert.equal(appended.length, 1);

  const root = { append: (el) => appended.push(el) };
  style.addToShadow(root, CSS, { id: 'shadow' });
  assert.equal(appended.length, 2);
  assert.equal(appended[1].dataset.scStyle, 'shadow');
  assert.equal(style.owns(appended[1]), true);
});
