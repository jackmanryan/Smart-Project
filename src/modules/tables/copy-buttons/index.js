/**
 * Copy Buttons — a "Copy" button on every panel header that lifts the panel as clean,
 * ready-to-paste `Key: value` lines.
 *
 * A panel's two-column table is the interesting part: the first cell is the label, the
 * second the value, and the output keeps them in document order with the panel title on
 * the first line. Panels with no such table fall back to their whole cleaned text. The
 * buttons only exist while ExtraNav's "Copy Buttons" switch is on.
 *
 * Ported from legacy/userscripts/copy-buttons.user.js (v1.2). Differences from the
 * original are listed here rather than hidden in the code:
 *
 *  - The gate no longer digs ExtraNav's `#st_s2` checkbox out of the nav shadow root.
 *    It reads the switch grid's own store — `st:switches:v1`, key `s2` — through
 *    ctx.settings.json, picks flips up from the `nav:switch` event, and re-reads on
 *    every pass. Nothing stored still reads as off, the same as the missing checkbox
 *    did, but a stored `true` now arms the buttons on a page where ExtraNav never
 *    mounted, where the legacy script would have found no checkbox and stayed off.
 *  - That also fixes a flip the legacy script could miss: it listened for `change` on
 *    the checkbox, and ExtraNav sets `.checked` programmatically, which fires no such
 *    event. `nav:switch` is emitted on every flip.
 *  - With the shadow-root hunt goes its five-second startup wait, so buttons appear on
 *    the first pass instead of once the navbar mounts.
 *  - Both of the script's MutationObservers are gone: the panel watcher and the one
 *    that hunted for the checkbox. Rescans ride ctx.observe.onChange — one shared
 *    observer for the bundle, batched into an animation frame.
 *  - While the switch is off, the sweep now runs once and then stops re-querying the
 *    document on every mutation batch. The legacy refresh() called removeAllButtons()
 *    blind each time; with nothing attached, both settle in the same place.
 *  - Copying goes through ctx.dom.copyText, which prefers GM_setClipboard. The legacy
 *    fallback reported success even when `document.execCommand('copy')` threw, so a
 *    copy that truly fails now says "Failed" instead of "Copied".
 *  - The stylesheet moved to styles.css and is injected once at start rather than on
 *    the first time the switch turns on.
 *  - The script's own `cleanInline` is core's `norm`; `sleep` and `qsa` go with the
 *    startup wait and core's `$$`. The unused PANEL_BODY constant is dropped.
 */

import { $$, el, norm } from '../../../core/dom.js';
import css from './styles.css';

/* ------------------------------------------------------------------ config */

const STYLE_ID = 'tables-copy-buttons';

const PANEL_HEADER = '.panel .panel-heading';
const BTN_CLASS = 'tm-copy-btn';
const POSREL_CLASS = 'tm-copy-posrel';
const WRAP_CLASS = 'tm-copy-wrap';

const ATTACHED_FLAG = 'tmCopyAttached'; // header.dataset.tmCopyAttached = '1'
const LABEL = 'Copy';
const BTN_TITLE = 'Copy panel (smart formatted)';
const RESET_MS = 900;

/** ExtraNav's settings grid, verbatim: `s2` is the "Copy Buttons" switch, off by default. */
const NAV_SWITCH_KEY = 'st:switches:v1';
const COPY_SWITCH = 's2';

/** Chrome and our own furniture: never part of what the user asked to copy. */
const STRIP_SEL = [
  'script', 'style', 'noscript', 'button', 'input', 'select', 'textarea', 'svg',
  '[aria-hidden="true"]', `.${WRAP_CLASS}`, `.${BTN_CLASS}`,
].join(',');

/* ------------------------------------------------------------- text helpers */

/** Like norm, but newlines survive: block values keep their shape, runs of blanks do not. */
function cleanBlock(str) {
  return (str || '')
    .replace(/\u00A0/g, ' ')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

/** A node's text with the UI taken out first — read off a clone so the page is untouched. */
function textFromNode(node) {
  const clone = node.cloneNode(true);
  $$(STRIP_SEL, clone).forEach((n) => n.remove());
  return clone.innerText || clone.textContent || '';
}

function getPanelTitle(panelEl) {
  const hdr = panelEl.querySelector('.panel-heading') || panelEl;
  return norm(textFromNode(hdr)) || 'Panel';
}

/* ---------------------------------------------------------------- extraction */

/**
 * Pull the panel's two-column rows into ordered [label, value] pairs.
 *
 * Panels repeat labels — two Address rows, three Phone rows — so a repeat numbers both
 * itself and, retroactively, the first occurrence: Address, Address becomes
 * Address 1, Address 2. Empty values and the site's `-` / `—` placeholders are dropped.
 */
function extractKeyValues(panelEl) {
  const body = panelEl.querySelector('.panel-body') || panelEl;
  const rows = $$('tr', body).filter((tr) => tr.children && tr.children.length >= 2);
  const lines = [];
  const indexByLabel = new Map(); // label -> {count, firstIdx}

  for (const tr of rows) {
    const tds = Array.from(tr.children).filter((n) => n.tagName === 'TD');
    if (tds.length < 2) continue;

    const label = norm(textFromNode(tds[0])).replace(/:$/, '');
    const value = cleanBlock(textFromNode(tds[1]));

    if (!label) continue;
    if (!value || value === '-' || value === '—') continue;

    const entry = indexByLabel.get(label);
    if (!entry) {
      indexByLabel.set(label, { count: 1, firstIdx: lines.length });
      lines.push([label, value]);
      continue;
    }

    entry.count += 1;
    if (entry.count === 2) {
      const [oldLabel, oldVal] = lines[entry.firstIdx];
      lines[entry.firstIdx] = [`${oldLabel} 1`, oldVal];
    }
    lines.push([`${label} ${entry.count}`, value]);
  }

  return lines;
}

/** Title first, then one `Key: value` per line — or the whole panel's text when it has no rows. */
function formatSmart(panelEl) {
  const title = getPanelTitle(panelEl);
  const kv = extractKeyValues(panelEl);

  if (kv.length) {
    const body = kv.map(([k, v]) => `${k}: ${norm(v)}`).join('\n');
    return `${title}\n${body}`;
  }

  return `${title}\n${cleanBlock(textFromNode(panelEl))}`;
}

/* -------------------------------------------------------------- button wiring */

function addButton(header, ctx) {
  if (header.dataset[ATTACHED_FLAG] === '1') return;
  header.classList.add(POSREL_CLASS);

  const btn = el('button', { type: 'button', class: BTN_CLASS, title: BTN_TITLE }, LABEL);

  btn.addEventListener('click', async (e) => {
    // The heading itself is often a collapse toggle; copying must not fold the panel.
    e.stopPropagation();
    e.preventDefault();
    const panel = header.closest('.panel');
    if (!panel) return;

    const text = formatSmart(panel);
    btn.disabled = true;
    const ok = await ctx.dom.copyText(text);
    btn.textContent = ok ? 'Copied' : 'Failed';
    setTimeout(() => {
      btn.textContent = LABEL;
      btn.disabled = false;
    }, RESET_MS);
  });

  header.append(el('span', { class: WRAP_CLASS }, btn));
  header.dataset[ATTACHED_FLAG] = '1';
}

function addButtonsEverywhere(ctx) {
  $$(PANEL_HEADER).forEach((header) => addButton(header, ctx));
}

function removeAllButtons() {
  $$(`.${WRAP_CLASS}`).forEach((n) => n.remove());
  $$(PANEL_HEADER).forEach((header) => {
    if (header.dataset[ATTACHED_FLAG] === '1') delete header.dataset[ATTACHED_FLAG];
    header.classList.remove(POSREL_CLASS);
  });
}

/* ------------------------------------------------------------------- module */

export default {
  id: 'tables.copy-buttons',
  title: 'Copy Buttons',
  runAt: 'idle',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    ctx.style.add(css, { id: STYLE_ID });

    const isSwitchOn = () => {
      const saved = ctx.settings.json.get(NAV_SWITCH_KEY, null);
      return !!(saved && typeof saved === 'object' && saved[COPY_SWITCH]);
    };

    // null = unknown, so the first pass runs either way; after that a page with the
    // switch off costs one storage read per mutation batch and nothing else.
    let attached = null;

    const refresh = () => {
      if (isSwitchOn()) {
        addButtonsEverywhere(ctx);
        attached = true;
      } else if (attached !== false) {
        removeAllButtons();
        attached = false;
      }
    };

    refresh();

    ctx.events.on('nav:switch', (detail) => {
      if (!detail || detail.key === COPY_SWITCH) refresh();
    });

    // Panels arrive late with DataTables redraws, modals and accordion expansions.
    ctx.observe.onChange(refresh);
  },
};
