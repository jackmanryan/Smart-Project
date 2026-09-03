/**
 * Adaptive table filters + column menu.
 *
 * Two compact buttons ride in the toolbar of every grid on the page:
 *
 *   Columns   show/hide each column, remembered per table under `scx.colmenu.v1`
 *   Filters   one control per column, chosen from what the column actually holds —
 *             numbers and dates get a range, repeated labels/IDs get a multi-select —
 *             plus Reset (filters only) and Full (filters and column visibility)
 *
 * Column choices persist. Filter modifiers deliberately do not: RESET_FILTERS_ON_LOAD
 * wipes `scx.filters.v3` for a table every time its menu is built, so a page load always
 * starts unfiltered. The read-back path is kept because that flag is the switch for it.
 *
 * It is DataTables-aware throughout: when the page has initialised a grid, filtering runs
 * through a `dataTable.ext.search` plugin and column visibility through `column().visible()`,
 * so hidden columns, paging and redraws all keep working. Plain tables fall back to
 * per-cell and per-row classes.
 *
 * Ported from
 * legacy/userscripts/adaptive-table-filters-column-menu-dt-aware-compact-ui.user.js (v3.5.0).
 * Both storage namespaces and every `scx-` class name are verbatim. Differences from the
 * original, all of them deliberate:
 *
 *  - Its four MutationObservers (one on documentElement, one per table thead, one per
 *    table tbody) are gone. Everything hangs off `ctx.observe.onChange`, which gives one
 *    batched pass per animation frame: re-scan for tables, rebuild a table's menus when
 *    its header row actually changed, re-apply filters to plain tables whose rows moved.
 *  - A menu is rebuilt when the header labels or the column count change, rather than on
 *    any node added or removed inside the thead. DataTables wrapping a header title in a
 *    span no longer costs a full rebuild.
 *  - `draw.dt` no longer calls applyFilters. For a DataTable the search plugin already
 *    re-filters during the draw, so the legacy handler's `dt.draw(false)` was both
 *    redundant and re-entrant — it re-triggered the very event that called it. Column
 *    section visibility is still synced on every draw, and applyFilters now refuses to
 *    re-enter a draw it is already inside.
 *  - Mutation-driven re-application is limited to plain tables, for the same reason.
 *  - `window.__scxFilters` and its six console helpers are not published; this bundle
 *    adds no globals. Reset and Full Reset are unchanged and still on the panel.
 *  - Labels and option values are written as text nodes instead of interpolated into
 *    innerHTML. Header text and cell values are site data, and a value containing `<`
 *    or a quote used to break the menu.
 *  - The dead free-text profile branch is gone. It sat behind a hard-coded
 *    DISABLE_TEXT_FILTER and nothing downstream could filter on `kind:'text'` anyway.
 *    Saved text filters are still dropped on read, as before.
 *  - Dark styling also follows the bundle's own theme attribute, not just the OS
 *    preference. See the note at the bottom of styles.css.
 *  - `location`-derived state, debounce and the SPA route hook come from ctx.
 */

import css from './styles.css';
import { $$, debounce, el, norm, onReady } from '../../../core/dom.js';

const STYLE_ID = 'tables.filters';

/* ------------------------------------------------------------------- config */

const TABLE_SELECTORS = [
  '#dataTable-orders',
  'table[id^="dataTable-"]',
  'table[data-colmenu]',
  'table.dataTable',
];

/** localStorage namespaces, verbatim — users have saved state under both. */
const LS_NS_COLS = 'scx.colmenu.v1';
const LS_NS_FILTER = 'scx.filters.v3';

/** Clear filter modifiers when a menu is built; column visibility persists. */
const RESET_FILTERS_ON_LOAD = true;

/** Categorical gating: a multi-select only appears when a column really looks like labels. */
const CAT_MIN_COUNT = 2; // a "pair" is a value seen at least twice
const MIN_DUPLICATE_BUCKETS = 2; // and we want at least two such pairs
const MIN_DISTINCT_FOR_MENU = 3; // over at least three distinct normalised values

/** Profiling thresholds. */
const NUM_TH = 0.7;
const DATE_TH = 0.7;
const SAMPLE_MAX = 500;
const CATEG_MAX = 60;
const DELIMS = [',', '|', ';', '/'];

/** Legacy timings, kept so the menus land at the same point in a page load. */
const FIRST_SCAN_MS = 150;
const ROUTE_SCAN_MS = 60;
const REAPPLY_MS = 120;
const SAVE_MS = 120;
const REOPEN_MS = 60;

const COLS_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 5h4v14H4V5zm6 0h4v14h-4V5zm6 0h4v14h-4V5z"/></svg>';
const FILTERS_ICON =
  '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 5h18v2H3V5zm4 6h10v2H7v-2zm3 6h4v2h-4v-2z"/></svg>';
const SEARCH_ICON =
  '<svg viewBox="0 0 24 24"><path d="M15.5 14h-.79l-.28-.27A6.471 6.471 0 0016 9.5 6.5 6.5 0 109.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79L20 21.5 21.5 20l-6-6zM4 9.5C4 6.46 6.46 4 9.5 4S15 6.46 15 9.5 12.54 15 9.5 15 4 12.54 4 9.5z"/></svg>';

/* ------------------------------------------------------------------ helpers */

/** Listeners default to passive, as in the legacy script; click handlers opt out. */
const on = (node, type, fn, opt) => {
  try {
    if (node) node.addEventListener(type, fn, opt || { passive: true });
  } catch { /* a missing node must not stop the rest of the menu */ }
};

const slug = (t) =>
  (t || '')
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9-]/g, '')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '') || 'col';

const djb2 = (str) => {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) ^ str.charCodeAt(i);
  return (h >>> 0).toString(36);
};

const stripHTML = (s) => (s == null ? '' : String(s).replace(/<[^>]*>/g, ' '));

/** Bucket key for categorical values: case- and whitespace-insensitive. */
const catKey = (v) => norm(v == null ? '' : String(v)).toLowerCase();

const tryParseNumber = (s) => {
  if (s == null) return null;
  const c = (s + '').replace(/[^0-9.+\-eE]/g, '');
  if (!c || /^[-+.eE]+$/.test(c)) return null;
  const n = Number(c);
  return Number.isFinite(n) ? n : null;
};

const tryParseDate = (s) => {
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : null;
};

const getHead = (t) => (t?.tHead?.rows?.[0] ? Array.from(t.tHead.rows[0].cells) : []);
const getHeadRow = (t) => t?.tHead?.rows?.[0] || null;

/**
 * The per-column key used in both caches. First writer wins and the answer is cached on
 * the element, exactly as the legacy script did — call sites pass their own fallback for
 * an empty header, and they disagree, so the cache is what keeps them consistent.
 */
const slugOf = (th, fallback) => th.dataset.scxSlug || (th.dataset.scxSlug = slug(norm(th.textContent) || fallback));

/* ------------------------------------------------------------ table identity */

const tableSignature = (t) =>
  djb2(getHead(t).map((th, i) => slug(norm(th.textContent)) || `col-${i}`).join('|'));

// This app selects pages with ?p=, not the path: location.pathname is always
// '/', so the old key was identical on every page and column prefs bled
// across them. Fold the page id in.
const pageKey = () => {
  try {
    return new URLSearchParams(location.search).get('p') || '';
  } catch {
    return '';
  }
};

// Two id-less tables with the same headers on one page hash to the same
// signature, so they shared one entry. Disambiguate by document order,
// cached on the element so repeat calls stay cheap.
const tableOrdinal = (t) => {
  if (t.dataset.scxTableOrd == null) {
    const sig = tableSignature(t);
    const peers = $$('table').filter((x) => !x.id && tableSignature(x) === sig);
    const i = peers.indexOf(t);
    t.dataset.scxTableOrd = String(i > 0 ? i : 0);
  }
  return t.dataset.scxTableOrd;
};

const tableUID = (t) => {
  const path = location.pathname.replace(/\/+$/, '');
  const base = `${location.hostname}${path}/${pageKey()}`;
  if (t.id) return `${base}:#${t.id}`;
  const ord = tableOrdinal(t);
  return `${base}:${tableSignature(t)}${ord === '0' ? '' : `~${ord}`}`;
};

const cacheKeyCols = (t) => `${LS_NS_COLS}:${tableUID(t)}`;
const cacheKeyFilters = (t) => `${LS_NS_FILTER}:${tableUID(t)}`;

/** Header labels plus column count — what a rebuild actually needs to react to. */
const headSignature = (t) => {
  const cells = getHead(t);
  return `${cells.length}|${cells.map((th) => norm(th.textContent)).join('|')}`;
};

/* ------------------------------------------------------------- DataTables ---
 * The page owns jQuery and DataTables, not the bundle, so every access stays optional.
 */

const dtPlugin = () => window.jQuery?.fn?.dataTable;

const isDT = (table) => {
  try {
    return !!dtPlugin()?.isDataTable?.(table);
  } catch {
    return false;
  }
};

const dtFor = (table) => window.jQuery(table).DataTable();

/* -------------------------------------------------------------- profiling */

function sampleColumn(table, idx) {
  if (isDT(table)) {
    try {
      const arr = dtFor(table).column(idx, { search: 'none' }).data().toArray();
      return arr.slice(0, SAMPLE_MAX).map((v) => (typeof v === 'string' ? v : v?.toString?.() || ''));
    } catch { /* fall through to reading the DOM */ }
  }
  const tb = table.tBodies?.[0];
  if (!tb) return [];
  const out = [];
  for (const tr of Array.from(tb.rows || [])) {
    out.push(norm(tr.cells?.[idx]?.textContent || ''));
    if (out.length >= SAMPLE_MAX) break;
  }
  return out;
}

/** Aggregate counted values into a multi-select, or `none` when the gates say no. */
function buildCategorical(pairs, reprMap, total) {
  const distinctAll = pairs.length;
  if (distinctAll < MIN_DISTINCT_FOR_MENU) return { kind: 'none' };
  const dupPairs = pairs.filter(([, c]) => c >= CAT_MIN_COUNT);
  if (dupPairs.length < MIN_DUPLICATE_BUCKETS) return { kind: 'none' };
  const list = dupPairs
    .sort((a, b) => b[1] - a[1] || String(reprMap.get(a[0]) || '').localeCompare(String(reprMap.get(b[0]) || '')))
    .slice(0, CATEG_MAX)
    .map(([key, count]) => ({ key, label: reprMap.get(key) || key, count }));
  return list.length ? { kind: 'categorical', options: list, totalRows: total } : { kind: 'none' };
}

function detectProfile(values) {
  const nonEmpty = values.map(norm).filter((v) => v.length > 0);
  const total = nonEmpty.length || 1;

  let num = 0;
  let date = 0;
  const rawFreq = new Map();
  for (const v of nonEmpty) {
    if (tryParseNumber(v) != null) num++;
    if (tryParseDate(v) != null) date++;
    rawFreq.set(v, (rawFreq.get(v) || 0) + 1);
  }
  const numericRatio = num / total;
  const dateRatio = date / total;

  if (numericRatio >= NUM_TH) {
    const nums = nonEmpty.map(tryParseNumber).filter((v) => v != null);
    return { kind: 'number', min: Math.min(...nums), max: Math.max(...nums) };
  }
  if (dateRatio >= DATE_TH) {
    const tms = nonEmpty.map(tryParseDate).filter((v) => v != null);
    const minTs = Math.min(...tms);
    const maxTs = Math.max(...tms);
    return {
      kind: 'date',
      minTs,
      maxTs,
      minISO: new Date(minTs).toISOString().slice(0, 10),
      maxISO: new Date(maxTs).toISOString().slice(0, 10),
    };
  }

  // tokenized (labels with delimiters)
  let tokenBest = null;
  for (const d of DELIMS) {
    let rowsWithDelim = 0;
    const tokens = new Map();
    const repr = new Map();
    for (const v of nonEmpty) {
      if (v.includes(d)) rowsWithDelim++;
      for (const pRaw of v.split(d).map((s) => norm(s)).filter(Boolean)) {
        const k = catKey(pRaw);
        tokens.set(k, (tokens.get(k) || 0) + 1);
        if (!repr.has(k)) repr.set(k, pRaw);
      }
    }
    const top = [...tokens.entries()].sort((a, b) => b[1] - a[1])[0];
    if (!top) continue;
    const score = (rowsWithDelim / total) * (top[1] / total);
    if (!tokenBest || score > tokenBest.score) tokenBest = { d, tokens, repr, rowsWithDelim, score, total };
  }
  const tokenized = tokenBest && tokenBest.rowsWithDelim / total >= 0.25 && tokenBest.score >= 0.08;

  if (tokenized) {
    const cat = buildCategorical([...tokenBest.tokens.entries()], tokenBest.repr, total);
    if (cat.kind === 'none') return cat;
    return { ...cat, tokenized: true, delim: tokenBest.d };
  }

  // Non-tokenized categorical: fold case/whitespace variants together, then gate.
  const agg = new Map();
  const repr = new Map();
  for (const [raw, cnt] of rawFreq.entries()) {
    const k = catKey(raw);
    if (!k) continue;
    agg.set(k, (agg.get(k) || 0) + cnt);
    if (!repr.has(k)) repr.set(k, raw);
  }
  return buildCategorical([...agg.entries()], repr, total);
}

const isFilterable = (p) =>
  !!p &&
  (p.kind === 'number' ||
    p.kind === 'date' ||
    (p.kind === 'categorical' && Array.isArray(p.options) && p.options.length > 0));

/* ----------------------------------------------------- column visibility */

function setColumnVisible(table, colIdx, visible) {
  if (isDT(table)) {
    try {
      const dt = dtFor(table);
      dt.column(colIdx).visible(!!visible, false);
      // Note the optional call: on a grid without the Responsive extension the chain
      // short-circuits and no draw happens. That is how the legacy script behaved and
      // the site's grids all load Responsive, so it is left as it is.
      dt.columns.adjust().responsive?.recalc().draw(false);
      return;
    } catch { /* fall through to the class-based path */ }
  }
  const th = getHead(table)[colIdx];
  if (th) th.classList.toggle('scx-col-hidden', !visible);
  const tb = table.tBodies?.[0];
  if (!tb) return;
  for (const tr of Array.from(tb.rows || [])) {
    const td = tr.cells?.[colIdx];
    if (td) td.classList.toggle('scx-col-hidden', !visible);
  }
}

function applyVisibilityFromCache(table, cache) {
  getHead(table).forEach((th, idx) => {
    const key = slugOf(th, `col-${idx}`);
    const visible = Object.prototype.hasOwnProperty.call(cache, key) ? !!cache[key] : true;
    setColumnVisible(table, idx, visible);
  });
}

/* ------------------------------------------------------- filter evaluation */

/** `dataOrTr` is a DataTables row-data array during a draw, or a <tr> for a plain table. */
function rowPasses(table, dataOrTr, filters) {
  const ths = getHead(table);
  if (!filters || !Object.keys(filters).length) return true;

  const getCellText = (i) =>
    Array.isArray(dataOrTr) ? norm(stripHTML(dataOrTr[i] ?? '')) : norm(dataOrTr.cells?.[i]?.textContent || '');

  for (let i = 0; i < ths.length; i++) {
    const f = filters[slugOf(ths[i], `col-${i}`)];
    if (!f) continue;
    const v = getCellText(i);

    if (f.type === 'number') {
      const n = tryParseNumber(v);
      if (n == null) return false;
      const lo = Number.isFinite(f.minSel) ? f.minSel : f.min;
      const hi = Number.isFinite(f.maxSel) ? f.maxSel : f.max;
      if (!(n >= lo && n <= hi)) return false;
    } else if (f.type === 'date') {
      const t = tryParseDate(v);
      if (t == null) return false;
      const lo = f.minSelTs ?? f.minTs;
      const hi = f.maxSelTs ?? f.maxTs;
      if (!(t >= lo && t <= hi)) return false;
    } else if (f.type === 'categorical') {
      const want = f.selected;
      if (!want || !want.size) return false;
      if (f.tokenized) {
        const parts = v.split(f.delim).map((s) => catKey(s)).filter(Boolean);
        if (!parts.some((p) => want.has(p))) return false;
      } else if (!want.has(catKey(v))) {
        return false;
      }
    }
  }
  return true;
}

const hasActiveFilter = (filters) =>
  Object.values(filters).some((f) => {
    if (!f) return false;
    if (f.type === 'categorical') return f.selected && f.selected.size > 0;
    if (f.type === 'number') return f.minSel != null || f.maxSel != null;
    if (f.type === 'date') return f.minSelTs != null || f.maxSelTs != null;
    return false;
  });

/* ------------------------------------------------------------------ module */

function createFilters(ctx) {
  const { log, settings } = ctx;

  /** Column profiles and live filter state, per table element. */
  const PROFILES = new WeakMap();
  const FILTERS = new WeakMap();
  /** The menus we built, so a rebuild can drop them even after the table's uid moved. */
  const ANCHORS = new WeakMap();
  /** Header signature at the time a table was wired. */
  const HEAD_SIG = new WeakMap();
  /** Tables currently inside a draw we asked for; see applyFilters. */
  const DRAWING = new WeakSet();

  let dtSearchInstalled = false;

  /* ---------------------------------------------------------------- cache */

  const readCache = (key) => {
    const value = settings.json.get(key, null);
    return value && typeof value === 'object' ? value : {};
  };
  const writeCache = (key, value) => settings.json.set(key, value);
  const dropCache = (key) => settings.raw.remove(key);

  /* --------------------------------------------------------- slot lookup */

  const findSlot = (uid, root = document) => $$('.scx-slot', root).find((s) => s.dataset.scxTableUid === uid) || null;

  const findAnchor = (slot, role, uid) =>
    (slot ? $$('.scx-anchor', slot).find((a) => a.dataset.role === role && a.dataset.scxTableUid === uid) : null) ||
    null;

  const rememberAnchor = (table, role, node) => {
    const map = ANCHORS.get(table) || {};
    map[role] = node;
    ANCHORS.set(table, map);
  };

  const forgetAnchor = (table, role) => {
    const map = ANCHORS.get(table);
    map?.[role]?.remove();
    if (map) delete map[role];
  };

  /** The toolbar cell our buttons live in, created once per table. */
  function rightSlot(table) {
    const uid = tableUID(table);
    const wrap = table.closest('.dataTables_wrapper') || table.parentElement || document.body;

    // Prefer a stable container inside the wrapper so redraws don't eat our slot.
    const bar =
      wrap.querySelector('.dataTables_wrapper') ||
      wrap.querySelector('.dataTables_filter') ||
      wrap.querySelector('.dataTables_length') ||
      wrap;

    const existing = findSlot(uid, bar);
    if (existing) return existing;

    const slot = el('span', { class: 'scx-slot', 'data-scx-table-uid': uid });
    bar.append(slot);
    return slot;
  }

  /* ------------------------------------------------------------ profiles */

  function ensureProfiles(table) {
    const cached = PROFILES.get(table);
    if (cached) return cached;
    const profs = getHead(table).map((_, i) => detectProfile(sampleColumn(table, i)));
    PROFILES.set(table, profs);
    return profs;
  }

  /* -------------------------------------------------------------- apply */

  /** One global DataTables search plugin, shared by every table we filter. */
  function installDTSearch() {
    if (dtSearchInstalled) return;
    const plugin = dtPlugin();
    if (!plugin?.ext?.search) return;
    dtSearchInstalled = true;
    plugin.ext.search.push((dtSettings, data) => {
      const t = dtSettings.nTable;
      const filters = FILTERS.get(t);
      if (!filters) return true;
      return rowPasses(t, data, filters);
    });
  }

  function applyFilters(table) {
    const filters = FILTERS.get(table) || {};

    if (isDT(table)) {
      installDTSearch();
      // A draw fires draw.dt, and anything reacting to that may call back in here. The
      // plugin above has already filtered this pass, so one draw is all that is wanted.
      if (DRAWING.has(table)) return;
      DRAWING.add(table);
      try {
        dtFor(table).draw(false);
      } catch (err) {
        log.warn('DataTables redraw failed:', err);
      } finally {
        DRAWING.delete(table);
      }
      return;
    }

    const tb = table.tBodies?.[0];
    if (!tb) return;
    const anyActive = hasActiveFilter(filters);
    for (const tr of Array.from(tb.rows || [])) {
      tr.classList.toggle('scx-row-hidden', anyActive ? !rowPasses(table, tr, filters) : false);
    }
  }

  /** A hidden column has no business showing a filter section. */
  function syncFilterSectionsVisibility(table) {
    const uid = tableUID(table);
    const panel = findAnchor(findSlot(uid), 'filters', uid)?.querySelector('.scx-panel');
    if (!panel) return;
    const ths = getHead(table);
    for (const sec of $$('.scx-filter-col', panel)) {
      const s = sec.getAttribute('data-slug');
      const idx = ths.findIndex((th) => slugOf(th, '') === s);
      if (idx < 0) continue;
      let hidden = false;
      if (isDT(table)) {
        try {
          hidden = !dtFor(table).column(idx).visible();
        } catch {
          hidden = false;
        }
      } else {
        hidden = ths[idx].classList.contains('scx-col-hidden');
      }
      sec.style.display = hidden ? 'none' : '';
    }
  }

  /* -------------------------------------------------------------- resets */

  function rebuildMenu(table, role, { reopen = false } = {}) {
    forgetAnchor(table, role);
    if (role === 'filters') table.dataset.scxFiltersBuilt = '';
    else table.dataset.scxColsBuilt = '';

    // Defer so we are not tearing the menu down inside its own click handler.
    setTimeout(
      () =>
        log.guard(() => {
          if (role === 'filters') buildFilterMenu(table, reopen);
          else buildColumnsMenu(table);
        }),
      0,
    );
  }

  function clearFilters(table, { rebuild = true } = {}) {
    dropCache(cacheKeyFilters(table));
    FILTERS.delete(table);

    if (rebuild) rebuildMenu(table, 'filters', { reopen: true });
    else applyFilters(table);
  }

  function fullReset(table) {
    dropCache(cacheKeyFilters(table));
    dropCache(cacheKeyCols(table));
    FILTERS.delete(table);

    // Show every column immediately, before the menus come back.
    getHead(table).forEach((_, i) => setColumnVisible(table, i, true));

    rebuildMenu(table, 'cols');
    rebuildMenu(table, 'filters', { reopen: true });
  }

  /* ------------------------------------------------------- columns menu */

  function buildColumnsMenu(table) {
    const uid = tableUID(table);
    const slot = rightSlot(table);
    if (table.dataset.scxColsBuilt === '1' && findAnchor(slot, 'cols', uid)) return;
    table.dataset.scxColsBuilt = '';

    if (!getHeadRow(table)) return;

    const anchor = el('span', { class: 'scx-anchor', 'data-role': 'cols', 'data-scx-table-uid': uid });
    const btn = el('button', { type: 'button', class: 'scx-btn', 'data-tip': 'Columns' });
    btn.innerHTML = COLS_ICON;
    const panel = el('div', { class: 'scx-panel', role: 'menu' });
    panel.innerHTML = '<div class="scx-head"><h4>Show / Hide Columns</h4></div>';
    anchor.append(btn, panel);
    slot.append(anchor);
    rememberAnchor(table, 'cols', anchor);

    const key = cacheKeyCols(table);
    const cache = readCache(key);
    getHead(table).forEach((th, idx) => {
      const label = norm(th.textContent) || `(Column ${idx + 1})`;
      const s = slugOf(th, `(Column ${idx + 1})`);
      const checked = Object.prototype.hasOwnProperty.call(cache, s) ? !!cache[s] : true;
      panel.append(
        el(
          'label',
          { class: 'scx-item' },
          el('input', { type: 'checkbox', checked, dataset: { colIdx: String(idx), slug: s } }),
          el('span', {}, label),
        ),
      );
    });
    applyVisibilityFromCache(table, cache);
    syncFilterSectionsVisibility(table);

    const close = () => panel.classList.remove('open');
    on(btn, 'click', (e) => {
      e.stopPropagation?.();
      panel.classList.toggle('open');
    }, { passive: false });
    on(document, 'click', (e) => {
      if (!panel.contains(e.target) && e.target !== btn) close();
    });
    on(document, 'keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    on(panel, 'change', (e) => {
      const cb = e.target;
      if (!(cb instanceof window.HTMLInputElement)) return;
      const idx = parseInt(cb.dataset.colIdx || '-1', 10);
      if (idx < 0) return;
      setColumnVisible(table, idx, cb.checked);
      const map = readCache(key);
      map[cb.dataset.slug] = !!cb.checked;
      writeCache(key, map);
      syncFilterSectionsVisibility(table);
    });

    // Column visibility has to be re-asserted after every DataTables redraw.
    if (dtPlugin()) {
      try {
        window.jQuery(table).on('draw.dt', () => log.guard(() => applyVisibilityFromCache(table, readCache(key))));
      } catch { /* the page's jQuery is not ours to rely on */ }
    }

    table.dataset.scxColsBuilt = '1';
  }

  /* -------------------------------------------------------- filters menu */

  /** Saved state -> the shape this version reads: no text filters, keys not labels. */
  function migrateSaved(savedRaw) {
    const out = {};
    for (const [k, v] of Object.entries(savedRaw)) {
      if (!v) continue;
      if (v.type === 'text') continue; // free-text filters are gone
      if (v.type === 'categorical') {
        const keys = v.selectedKeys ? v.selectedKeys : (v.selected || []).map(catKey);
        out[k] = { ...v, selectedKeys: [...new Set(keys)] };
        delete out[k].selected;
      } else {
        out[k] = v;
      }
    }
    return out;
  }

  /** Persisted form -> live form: categorical key lists become Sets. */
  function hydrate(saved) {
    const out = {};
    for (const [k, v] of Object.entries(saved)) {
      out[k] = v.type === 'categorical' ? { ...v, selected: new Set(v.selectedKeys || []) } : { ...v };
    }
    return out;
  }

  function buildFilterMenu(table, reopenAfterBuild = false) {
    const uid = tableUID(table);
    const slot = rightSlot(table);
    const existing = findAnchor(slot, 'filters', uid);
    if (table.dataset.scxFiltersBuilt === '1' && existing) {
      if (reopenAfterBuild) existing.querySelector('.scx-panel')?.classList.add('open');
      return;
    }
    table.dataset.scxFiltersBuilt = '';

    if (!getHeadRow(table)) return;

    const profs = ensureProfiles(table);
    const filtersCacheKey = cacheKeyFilters(table);
    if (RESET_FILTERS_ON_LOAD) dropCache(filtersCacheKey);
    const migrated = migrateSaved(readCache(filtersCacheKey));

    // Drop saved entries whose column is not filterable any more.
    const ths = getHead(table);
    const saved = {};
    for (const [k, v] of Object.entries(migrated)) {
      const idx = ths.findIndex((th) => slugOf(th, '') === k);
      if (isFilterable(profs[idx])) saved[k] = v;
    }

    const anchor = el('span', { class: 'scx-anchor', 'data-role': 'filters', 'data-scx-table-uid': uid });
    const btn = el('button', { type: 'button', class: 'scx-btn', 'data-tip': 'Filters' });
    btn.innerHTML = FILTERS_ICON;
    const panel = el('div', { class: 'scx-panel', role: 'menu' });
    panel.innerHTML = `
      <div class="scx-head">
        <h4>Filters</h4>
        <div class="scx-actions">
          <button type="button" class="scx-mini scx-reset">Reset</button>
          <button type="button" class="scx-mini danger scx-fullreset">Full</button>
        </div>
      </div>
      <div class="scx-subtle">numbers/dates → range · labels/IDs → multi-select</div>`;
    anchor.append(btn, panel);
    slot.append(anchor);
    rememberAnchor(table, 'filters', anchor);

    // Panel-level resets. Both rebuild the menu and leave it open.
    on(panel.querySelector('.scx-reset'), 'click', () => clearFilters(table, { rebuild: true }));
    on(panel.querySelector('.scx-fullreset'), 'click', () => fullReset(table));

    const current = {};
    const saveAndApply = debounce(() => {
      const toSave = {};
      for (const [k, v] of Object.entries(current)) {
        if (!v) continue;
        if (v.type === 'categorical') {
          toSave[k] = { ...v, selectedKeys: [...v.selected] };
          delete toSave[k].selected;
        } else {
          toSave[k] = { ...v };
        }
      }
      writeCache(filtersCacheKey, toSave);
      FILTERS.set(table, hydrate(toSave));
      applyFilters(table);
    }, SAVE_MS);

    ths.forEach((th, idx) => {
      const label = norm(th.textContent) || `(Column ${idx + 1})`;
      const s = slugOf(th, `(Column ${idx + 1})`);
      const prof = profs[idx];
      if (!isFilterable(prof)) return; // only filterable columns get a section

      const wrap = el('div', { class: 'scx-filter-col collapsed', 'data-slug': s });
      const ctrl = el('div', { class: 'scx-ctrl' });
      const header = el(
        'div',
        { class: 'scx-row' },
        el('div', { class: 'scx-flabel' }, label),
        ctrl,
        el('div', { class: 'scx-ftype' }, `${prof.kind}${prof.kind === 'categorical' && prof.tokenized ? '·tags' : ''}`),
      );
      wrap.append(header);

      if (prof.kind === 'number') buildNumberSection({ wrap, prof, saved: saved[s], state: current, slugKey: s, saveAndApply });
      else if (prof.kind === 'date') buildDateSection({ wrap, prof, saved: saved[s], state: current, slugKey: s, saveAndApply });
      else if (!buildCategoricalSection({ wrap, header, ctrl, prof, saved: saved[s], state: current, slugKey: s, saveAndApply })) return;

      panel.append(wrap);
    });

    FILTERS.set(table, hydrate(saved));
    applyFilters(table);
    syncFilterSectionsVisibility(table);

    const close = () => panel.classList.remove('open');
    on(btn, 'click', (e) => {
      e.stopPropagation?.();
      panel.classList.toggle('open');
    }, { passive: false });
    on(document, 'click', (e) => {
      if (!panel.contains(e.target) && e.target !== btn) close();
    });
    on(document, 'keydown', (e) => {
      if (e.key === 'Escape') close();
    });

    // Sections follow column visibility across redraws. The search plugin re-filters
    // during the draw itself, so nothing here needs to ask for another one.
    if (dtPlugin()) {
      try {
        window.jQuery(table).on('draw.dt', () => log.guard(() => syncFilterSectionsVisibility(table)));
      } catch { /* the page's jQuery is not ours to rely on */ }
    }

    table.dataset.scxFiltersBuilt = '1';
    if (reopenAfterBuild) setTimeout(() => panel.classList.add('open'), REOPEN_MS);
  }

  /* ------------------------------------------------------- section kinds */

  /**
   * Two number inputs over a two-handle range.
   * minSel/maxSel start at the column's own bounds rather than null, so from the first
   * edit made anywhere in the menu every number column counts as active and rows whose
   * cell does not parse as a number drop out of the table. That is the legacy behaviour;
   * until then FILTERS holds only what was restored from the cache.
   */
  function buildNumberSection({ wrap, prof, saved, state, slugKey, saveAndApply }) {
    const { min, max } = prof;
    const asInt = (v) => Math.round(Number(v || 0));
    const col = {
      type: 'number',
      min,
      max,
      minSel: asInt(saved?.minSel ?? min),
      maxSel: asInt(saved?.maxSel ?? max),
    };
    state[slugKey] = col;

    const ui = el('div', { class: 'scx-range' });
    ui.innerHTML = `
      <div class="nums">
        <input type="number" class="nlo" step="1" inputmode="numeric" pattern="\\d*" value="${col.minSel}">
        <input type="number" class="nhi" step="1" inputmode="numeric" pattern="\\d*" value="${col.maxSel}">
      </div>
      <div class="track">
        <input type="range" class="rlo" min="${asInt(min)}" max="${asInt(max)}" step="1" value="${col.minSel}">
        <input type="range" class="rhi" min="${asInt(min)}" max="${asInt(max)}" step="1" value="${col.maxSel}">
      </div>`;
    wrap.append(ui);

    const nlo = ui.querySelector('.nlo');
    const nhi = ui.querySelector('.nhi');
    const rlo = ui.querySelector('.rlo');
    const rhi = ui.querySelector('.rhi');
    const track = ui.querySelector('.track');

    const setTrackFill = () => {
      const pct = (v) => ((v - min) / (max - min)) * 100;
      const loP = pct(Number(rlo.value));
      const hiP = pct(Number(rhi.value));
      track.style.setProperty('--lo', `${Math.min(loP, hiP)}%`);
      track.style.setProperty('--hi', `${Math.max(loP, hiP)}%`);
    };

    const clamp = () => {
      let lo = asInt(nlo.value);
      let hi = asInt(nhi.value);
      if (Number.isNaN(lo)) lo = min;
      if (Number.isNaN(hi)) hi = max;
      if (lo > hi) [lo, hi] = [hi, lo];
      lo = Math.max(asInt(min), Math.min(lo, asInt(max)));
      hi = Math.max(asInt(min), Math.min(hi, asInt(max)));
      nlo.value = lo;
      nhi.value = hi;
      rlo.value = lo;
      rhi.value = hi;
      col.minSel = lo;
      col.maxSel = hi;
      setTrackFill();
      saveAndApply();
    };

    on(nlo, 'input', debounce(clamp, 100));
    on(nhi, 'input', debounce(clamp, 100));
    on(rlo, 'input', () => {
      nlo.value = rlo.value;
      clamp();
    });
    on(rhi, 'input', () => {
      nhi.value = rhi.value;
      clamp();
    });
    setTrackFill();
  }

  /** Two date inputs bounded by the column's own range. */
  function buildDateSection({ wrap, prof, saved, state, slugKey, saveAndApply }) {
    const col = {
      type: 'date',
      minTs: prof.minTs,
      maxTs: prof.maxTs,
      minSelTs: saved?.minSelTs ?? null,
      maxSelTs: saved?.maxSelTs ?? null,
    };
    state[slugKey] = col;

    const toISO = (ts) => new Date(ts).toISOString().slice(0, 10);
    const ui = el('div', { class: 'scx-range' });
    ui.innerHTML = `
      <div class="nums">
        <input type="date" class="dlo" value="${col.minSelTs ? toISO(col.minSelTs) : toISO(prof.minTs)}" min="${toISO(prof.minTs)}" max="${toISO(prof.maxTs)}">
        <input type="date" class="dhi" value="${col.maxSelTs ? toISO(col.maxSelTs) : toISO(prof.maxTs)}" min="${toISO(prof.minTs)}" max="${toISO(prof.maxTs)}">
      </div>`;
    wrap.append(ui);

    const dlo = ui.querySelector('.dlo');
    const dhi = ui.querySelector('.dhi');
    const clamp = () => {
      const loTs = Date.parse(dlo.value);
      const hiTs = Date.parse(dhi.value);
      let lo = Number.isFinite(loTs) ? loTs : prof.minTs;
      let hi = Number.isFinite(hiTs) ? hiTs : prof.maxTs;
      if (lo > hi) [lo, hi] = [hi, lo];
      col.minSelTs = lo;
      col.maxSelTs = hi;
      saveAndApply();
    };

    on(dlo, 'input', debounce(clamp, 120));
    on(dhi, 'input', debounce(clamp, 120));
  }

  /** Checkbox list with All / None and an optional search. Returns false if unbuildable. */
  function buildCategoricalSection({ wrap, header, ctrl, prof, saved, state, slugKey, saveAndApply }) {
    const opts = prof.options || [];
    if (!opts.length) return false;

    const col = {
      type: 'categorical',
      tokenized: !!prof.tokenized,
      delim: prof.delim,
      selected: new Set(saved?.selectedKeys || opts.map((o) => o.key)),
    };
    state[slugKey] = col;

    ctrl.innerHTML = `
      <button type="button" class="mini all">All</button>
      <button type="button" class="mini none">None</button>
      <button type="button" class="icon toggle-search" aria-label="Search">${SEARCH_ICON}</button>`;

    const ui = el('div');
    ui.innerHTML = `
      <div class="scx-search"><input type="text" class="q" placeholder="search options…"></div>
      <div class="scx-chiplist"></div>`;
    wrap.append(ui);

    const list = ui.querySelector('.scx-chiplist');
    const q = ui.querySelector('.q');
    let collapsed = true;
    wrap.classList.add('collapsed');

    const render = () => {
      const needle = catKey(q?.value || '');
      list.innerHTML = '';
      for (const o of opts) {
        if (needle && !catKey(o.label).includes(needle)) continue;
        const id = `${slugKey}-${o.key}`.replace(/[^a-z0-9\-_:.]/gi, '');
        list.append(
          el(
            'label',
            { class: 'scx-chip' },
            el('input', { type: 'checkbox', id, checked: col.selected.has(o.key), dataset: { key: o.key } }),
            el('span', {}, o.label),
            el('span', { class: 'scx-count' }, `(${o.count})`),
          ),
        );
      }
    };
    render();

    on(ctrl.querySelector('.all'), 'click', (e) => {
      e.stopPropagation();
      col.selected = new Set(opts.map((o) => o.key));
      render();
      saveAndApply();
    });
    on(ctrl.querySelector('.none'), 'click', (e) => {
      e.stopPropagation();
      col.selected = new Set();
      render();
      saveAndApply();
    });
    on(ctrl.querySelector('.toggle-search'), 'click', (e) => {
      e.stopPropagation();
      wrap.classList.toggle('show-search');
      if (wrap.classList.contains('show-search')) q.focus();
    });
    on(
      q,
      'input',
      debounce(() => {
        // Typing a search opens the list, otherwise the results have nowhere to show.
        if (q.value && collapsed) {
          collapsed = false;
          wrap.classList.remove('collapsed');
        }
        render();
      }, 120),
    );
    on(header, 'click', (e) => {
      if (e.target.closest('.scx-ctrl')) return;
      collapsed = !collapsed;
      wrap.classList.toggle('collapsed', collapsed);
    });
    on(list, 'change', (e) => {
      const cb = e.target;
      if (!(cb instanceof window.HTMLInputElement)) return;
      if (cb.checked) col.selected.add(cb.dataset.key);
      else col.selected.delete(cb.dataset.key);
      saveAndApply();
    });
    return true;
  }

  /* --------------------------------------------------------- wire tables */

  function matchingTables() {
    const seen = new Set();
    for (const sel of TABLE_SELECTORS) for (const t of $$(sel)) seen.add(t);
    return seen;
  }

  function wireTable(table) {
    if (!table) return;
    const uid = tableUID(table);
    // Rebuild when the slot went missing too: a redraw can take the toolbar with it.
    if (table.dataset.scxWired === '1' && findSlot(uid)) return;
    // Drop whatever we built last time. Hiding a column changes an id-less table's uid,
    // and the legacy script left the old buttons behind in the old slot when that
    // happened; keeping the anchors lets us take them with us.
    forgetAnchor(table, 'cols');
    forgetAnchor(table, 'filters');
    buildColumnsMenu(table);
    buildFilterMenu(table);
    table.dataset.scxWired = '1';
    HEAD_SIG.set(table, headSignature(table));
  }

  /**
   * The legacy script watched every thead with its own observer and rebuilt on any node
   * added or removed inside it. Comparing the header labels and column count instead
   * means a DataTables redraw that only re-wraps a title costs nothing.
   */
  function rebuildIfHeadChanged(table) {
    if (table.dataset.scxWired !== '1') return;
    const sig = headSignature(table);
    if (HEAD_SIG.get(table) === sig) return;
    HEAD_SIG.set(table, sig);

    forgetAnchor(table, 'cols');
    forgetAnchor(table, 'filters');
    table.dataset.scxColsBuilt = '';
    table.dataset.scxFiltersBuilt = '';
    buildColumnsMenu(table);
    buildFilterMenu(table);
  }

  function scan() {
    for (const table of matchingTables()) {
      wireTable(table);
      rebuildIfHeadChanged(table);
    }
  }

  /**
   * Rows moved. DataTables re-filters itself on every draw through the search plugin, so
   * only plain tables need this; asking a grid to redraw here would loop against its own
   * mutations.
   */
  const reapplyPlain = debounce(() => {
    for (const table of matchingTables()) {
      if (table.dataset.scxWired !== '1' || isDT(table)) continue;
      applyFilters(table);
    }
  }, REAPPLY_MS);

  return {
    start() {
      ctx.style.add(css, { id: STYLE_ID });

      onReady(() => setTimeout(() => log.guard(scan), FIRST_SCAN_MS));
      ctx.route.onChange(() => setTimeout(() => log.guard(scan), ROUTE_SCAN_MS));
      ctx.observe.onChange(() => {
        scan();
        reapplyPlain();
      });
    },
  };
}

export default {
  id: 'tables.filters',
  title: 'Table filters and column menu',
  runAt: 'idle',
  pages: [], // every page in the bundle's scope; the tables it wires turn up all over
  enabledByDefault: true,

  init(ctx) {
    createFilters(ctx).start();
  },
};
