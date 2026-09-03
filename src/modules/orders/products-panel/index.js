/**
 * Order products panel — layout-only fixes.
 *
 * Ported from legacy/userscripts/order-products-panel-layout-only-fixes.user.js (v1.0).
 * Everything here is spacing, structure and typography: the legacy script was written
 * deliberately to leave the site's colour scheme alone, and so is this one.
 *
 * What it does, in the order the legacy `run()` did it:
 *   1. wires each product row's "Fix SKU" toggle and tidies its panel
 *   2. drops the Weight column from the products grid
 *   3. folds a subparts table's last subtotal row into its own headers
 *   4. tags subparts tables so the stylesheet can unlock their widths
 *   5. removes the FedEx / Chase Price side tables and the Package Details table
 *   6. centres panel headings and makes the ones that toggle something clickable
 *   7. makes the Order Products panel collapsible, and auto-collapses three panels
 *
 * Three things it used to do for itself now come from ctx:
 *   - its `injectCss('op-layout-only-css', CSS)` is styles.css through ctx.style
 *   - its `new MutationObserver(run)` on document.body is ctx.observe.onChange
 *   - it reached for the bare `jQuery` global; that is window.jQuery here, because the
 *     page owns Bootstrap's collapse plugin and the bundle must not assume it exists
 */

import css from './styles.css';

/** Products grid, minus the activity log another module marks with this class. */
const PRODUCTS_SEL = '#products-list:not(.scx-activity-log)';

/** Panels that start closed. Matched as a substring of the heading text, lowercased. */
const AUTO_COLLAPSE_TITLES = ['Emails sent recently', 'Email Archives', 'Packages'];

/* ------------------------------------------------------------------ text helpers */

/**
 * Trim only — deliberately not ctx.dom.norm, which also collapses inner whitespace.
 * These strings are written straight back into product names and weights.
 */
const txt = (node) => (node?.textContent || '').trim();

/* -------------------------------------------------------------- collapse helpers */

/** The page's own Bootstrap collapse plugin, when the page loaded one. */
function hasCollapse() {
  const jq = window.jQuery;
  return !!(jq && jq.fn && jq.fn.collapse);
}

/** Open or close a panel body; without Bootstrap, fall back to the hidden attribute. */
function setCollapsed(node, collapsed) {
  if (hasCollapse()) window.jQuery(node).collapse(collapsed ? 'hide' : 'show');
  else node.hidden = collapsed;
}

/**
 * Toggle a panel body. `canCollapse` is passed in rather than re-checked, because a
 * body set up with the `hidden` fallback must keep being toggled that way even if the
 * page loads Bootstrap later — a collapse('toggle') on it would leave it hidden.
 */
function toggleCollapsed(node, canCollapse) {
  if (canCollapse) window.jQuery(node).collapse('toggle');
  else node.hidden = !node.hidden;
}

/** Clicks on real controls inside a heading must reach the control, not the toggle. */
const isInteractive = (target) => !!target.closest('a,button,input,select,textarea,label');

/* ------------------------------------------------------------- product row pieces */

function removeImmediateNextBR(node) {
  const n = node.nextSibling;
  if (n && n.nodeType === 1 && n.tagName === 'BR') n.remove();
}

function extractWeightFromDetails(td) {
  // Prefer existing span.weight
  const wEl = td.querySelector('.op-titlebar .weight, .weight');
  if (wEl) return txt(wEl);

  // Fallback: parse subparts header "Total weight (97.748)"
  const sub = td.querySelector('table.subparts-table thead');
  if (sub) {
    const ths = Array.from(sub.rows?.[0]?.cells || []);
    const i = ths.findIndex((th) => /total\s*weight/i.test(th.textContent));
    if (i >= 0) {
      const m = ths[i].textContent.match(/\(([^)]+)\)/);
      if (m && m[1]) return m[1].trim() + ' lbs';
    }
  }
  return '';
}

function findNameNode(td) {
  // Prefer an existing titlebar .name
  const nameNode = td.querySelector('.op-titlebar .name, .name');
  if (nameNode) return nameNode;

  // Legacy: sometimes product name was in <strong>
  return td.querySelector('strong') || null;
}

function cleanSkuPanel(panel) {
  const input = panel.querySelector('input[type="text"]');
  if (input && !input.placeholder) input.placeholder = 'Fix Product SKU';
  const first = panel.firstChild;
  if (first && first.nodeType === 3 && /Fix\s*Product\s*SKU/i.test(first.nodeValue || '')) first.remove();
}

/* ------------------------------------------------------------------ table pieces */

/** The activity log reuses the #products-list id but is a Description/Author grid. */
function isActivityLogTable(tbl) {
  const ths = Array.from(tbl.tHead?.rows?.[0]?.cells || []).map((th) => (th.textContent || '').trim().toLowerCase());
  return ths.includes('description') && (ths.includes('author') || ths.includes('date'));
}

/** Heading text as the auto-collapse matcher sees it: own text plus simple children. */
function headingText(heading) {
  const bits = [];
  heading.childNodes.forEach((n) => {
    if (n.nodeType === 3) {
      const t = n.nodeValue.trim();
      if (t) bits.push(t);
    } else if (n.nodeType === 1 && n.matches('.sc-title,.sc-titlewrap,span,a')) {
      const t = (n.textContent || '').trim();
      if (t) bits.push(t);
    }
  });
  return bits.join(' ').replace(/\s+/g, ' ').trim().toLowerCase();
}

/* ------------------------------------------------------------------ the sweep */

function createPanelFixes(ctx) {
  const { $, $$, esc } = ctx.dom;

  /* --- product rows --------------------------------------------------------- */

  /** Build or extend the inline title bar: Name · Weight — [Fix SKU]. */
  function ensureTitleBar(tr) {
    const td = tr.cells?.[0];
    if (!td) return null;

    let bar = td.querySelector('.op-titlebar');
    const nameNode = findNameNode(td);
    if (!nameNode) return null;

    const weightText = extractWeightFromDetails(td);

    if (!bar) {
      bar = document.createElement('div');
      bar.className = 'op-titlebar';
      nameNode.replaceWith(bar);
      removeImmediateNextBR(bar);

      const nameSpan = document.createElement('span');
      nameSpan.className = 'name';
      nameSpan.textContent = txt(nameNode);
      bar.appendChild(nameSpan);
    }

    // Add weight if missing
    if (weightText && !bar.querySelector('.weight')) {
      const sep = document.createElement('span');
      sep.className = 'sep';
      sep.textContent = '·';
      const w = document.createElement('span');
      w.className = 'weight';
      w.textContent = weightText;
      bar.appendChild(sep);
      bar.appendChild(w);
    }

    // Add Fix SKU toggle if missing
    if (!bar.querySelector('.fixsku-toggle')) {
      const chkId = 'fixsku_chk_' + (tr.id || Math.random().toString(36).slice(2));
      const toggleWrap = document.createElement('span');
      toggleWrap.className = 'fixsku-toggle';
      // The whitespace in this template is load-bearing: it is the gap between the
      // native checkbox and its label.
      toggleWrap.innerHTML = `
        <label for="${esc(chkId)}" class="fixsku-label-wrap" title="Show/Hide Fix Product controls">
          <input type="checkbox" id="${esc(chkId)}" />
          <span class="fixsku-label">Fix SKU</span>
        </label>`;
      bar.appendChild(document.createTextNode(' — '));
      bar.appendChild(toggleWrap);
      return toggleWrap.querySelector('input');
    }
    return bar.querySelector('.fixsku-toggle input[type="checkbox"]');
  }

  function moveEditButtonIntoPanel(tdDetails, panel) {
    const triggerBtn = $$('.btn.btn-primary.btn-sm', tdDetails).find((b) =>
      /Edit Product Description/i.test(b.textContent),
    );
    if (triggerBtn) panel.insertAdjacentElement('afterbegin', triggerBtn);
  }

  /**
   * Hide a row's Fix SKU panel behind the title-bar checkbox.
   *
   * A row is only marked wired once its fixskubox panel exists, so a row the site
   * renders in two passes is picked up on a later sweep.
   */
  function wireRow(tr) {
    if (tr.dataset.opWired === '1') return;
    const tdDetails = tr.cells?.[0];
    if (!tdDetails) return;
    const panel = tdDetails.querySelector('[id^="fixskubox_"]');
    if (!panel) return;

    panel.classList.add('fixsku-panel');
    panel.setAttribute('aria-hidden', 'true');
    if (hasCollapse()) panel.classList.add('collapse');
    else panel.hidden = true;

    moveEditButtonIntoPanel(tdDetails, panel);
    cleanSkuPanel(panel);

    const inputToggle = ensureTitleBar(tr);
    if (inputToggle) {
      inputToggle.addEventListener('change', () => {
        const open = inputToggle.checked;
        panel.setAttribute('aria-hidden', String(!open));
        setCollapsed(panel, !open);
      });
    }
    tr.dataset.opWired = '1';
  }

  /* --- the products grid ---------------------------------------------------- */

  function removeWeightColumnFromProducts() {
    const products = $(PRODUCTS_SEL);
    if (!products) return;
    if (products.classList.contains('scx-activity-log') || isActivityLogTable(products)) return;

    const headRow = products.tHead?.rows?.[0];
    if (!headRow) return;
    let weightIdx = -1;
    Array.from(headRow.cells).forEach((th, i) => {
      if (/^\s*Weight\s*$/i.test(th.textContent)) weightIdx = i;
    });
    if (weightIdx < 0) return;

    headRow.cells[weightIdx]?.remove();
    Array.from(products.tBodies || []).forEach((tb) => {
      Array.from(tb.rows || []).forEach((tr) => tr.cells[weightIdx]?.remove());
    });
  }

  /** Fold a subparts table's last subtotal row into its header labels as "(value)". */
  function foldInnerSubtotalsIntoHeaders() {
    $$(PRODUCTS_SEL + ' td:first-child table').forEach((tbl) => {
      if (tbl.dataset.folded === '1') return;
      const thead = tbl.tHead;
      const tbody = tbl.tBodies?.[0];
      if (!thead || !tbody) return;
      const hdrRow = thead.rows?.[0];
      if (!hdrRow) return;
      const ths = Array.from(hdrRow.cells);
      const rows = Array.from(tbody.rows);
      if (rows.length < 2) return;

      const last = rows[rows.length - 1];
      const idxWeight = ths.findIndex((th) => /total\s*weight/i.test(th.textContent));
      const idxPrice = ths.findIndex((th) => /part\s*price/i.test(th.textContent));

      const getCellTxt = (i) => (i >= 0 && last.cells[i] ? txt(last.cells[i]) : '');

      const wVal = getCellTxt(idxWeight);
      const pVal = getCellTxt(idxPrice);

      const setHdr = (i, val) => {
        if (i < 0 || !val) return;
        const base = ths[i].textContent.replace(/\s*\(.*\)\s*$/, '').trim();
        ths[i].textContent = `${base} (${val})`;
      };
      setHdr(idxWeight, wVal);
      setHdr(idxPrice, pVal);

      last.remove();
      tbl.dataset.folded = '1';
    });
  }

  /** Tag subparts tables (.subparts-table) and drop their hard-coded width locks. */
  function normalizeSubpartsTables() {
    $$('#products-list tbody tr td:first-child table').forEach((tbl) => {
      if (tbl.classList.contains('subparts-table')) return;

      const thead = tbl.tHead;
      if (!thead) return;
      const ths = Array.from(thead.rows?.[0]?.cells || []).map((th) => th.textContent.trim().toLowerCase());

      const hasQty = ths.some((t) => /^qty$/.test(t));
      const hasSku = ths.some((t) => /^sku$/.test(t));
      const hasDesc = ths.some((t) => /^description$/.test(t));
      const hasTw = ths.some((t) => /^total\s*weight/i.test(t));
      const hasPrice = ths.some((t) => /^part\s*price/i.test(t));
      if (!(hasQty && hasSku && hasDesc && hasTw && hasPrice)) return;

      tbl.classList.add('subparts-table');
      tbl.querySelectorAll('[width], [style*="width"]').forEach((node) => {
        node.removeAttribute('width');
        if (node.style) node.style.width = '';
      });
    });
  }

  /* --- side cleanups -------------------------------------------------------- */

  /** Drop the FedEx weight table and the Chase / FedEx benchmark rows; UPS stays. */
  function removeFedExChaseKeepUPS() {
    $$('table.table').forEach((tbl) => {
      const txtAll = tbl.textContent || '';
      const headThs = $$('thead th', tbl).map((th) => th.textContent.trim());
      if (headThs.length && /Total\s*FedEx\s*Weight/i.test(headThs[0])) {
        (tbl.closest('.col-xs-4') || tbl.closest('.row') || tbl).remove();
        return;
      }
      if (/UPS\s*Benchmark/i.test(txtAll) || /FedEx\s*Benchmark/i.test(txtAll) || /Chase\s*Price/i.test(txtAll)) {
        const rows = $$('tr', tbl);
        // Each benchmark label is followed by its value row, so both go together.
        for (let i = 0; i < rows.length; i++) {
          const t = rows[i].textContent.trim();
          if (/^Chase\s*Price/i.test(t)) {
            rows[i].remove();
            if (rows[i + 1]) rows[i + 1].remove();
            i++;
            continue;
          }
          if (/^FedEx\s*Benchmark/i.test(t) || /^FedEx/i.test(t.replace(/\s+/g, ''))) {
            rows[i].remove();
            if (rows[i + 1]) rows[i + 1].remove();
            i++;
            continue;
          }
        }
      }
    });
  }

  function removePackageDetailsTable() {
    $$('table').forEach((tbl) => {
      const firstTh = $('thead th', tbl);
      if (firstTh && /^\s*Package\s*#\s*$/i.test(firstTh.textContent)) {
        (tbl.closest('.col-xs-7') || tbl.closest('.row') || tbl).remove();
      }
    });
  }

  /* --- headings and collapsers ---------------------------------------------- */

  /** Centre every panel heading, and make the ones that toggle something clickable. */
  function centerAndMakePanelHeadersClickable() {
    $$('.panel-heading').forEach((hdr) => {
      if (hdr.dataset.scHdrDone === '1') return;
      hdr.classList.add('_tm-enhanced');

      // Normalize: extract a title + optional meta (remove trailing colon)
      const rawTextNodes = Array.from(hdr.childNodes).filter((n) => n.nodeType === 3 && n.nodeValue.trim());
      if (rawTextNodes.length) {
        const combined = rawTextNodes
          .map((n) => n.nodeValue)
          .join(' ')
          .replace(/\s+/g, ' ')
          .trim();
        rawTextNodes.forEach((n) => n.remove());
        let title = combined;
        let meta = '';
        const m = combined.match(/^(.+?):\s*(.*)$/);
        if (m) {
          title = m[1].trim();
          meta = m[2].trim();
        }

        const wrap = document.createElement('span');
        wrap.className = 'sc-titlewrap';
        const tSpan = document.createElement('span');
        tSpan.className = 'sc-title';
        tSpan.textContent = title;
        wrap.appendChild(tSpan);
        if (meta) {
          const metaSpan = document.createElement('span');
          metaSpan.className = 'sc-meta';
          metaSpan.textContent = meta;
          wrap.appendChild(metaSpan);
        }
        const firstEl = hdr.querySelector('i,svg')?.nextSibling;
        if (firstEl) hdr.insertBefore(wrap, firstEl);
        else hdr.appendChild(wrap);
      }

      const hasOwnOnclick = !!hdr.getAttribute('onclick');
      const childToggle = hdr.querySelector(
        'a[data-toggle], [data-target], [onclick], a[href], button[data-toggle], button[onclick]',
      );
      if (hasOwnOnclick || childToggle) {
        hdr.classList.add('sc-clickable');
        hdr.addEventListener('click', (ev) => {
          if (isInteractive(ev.target)) return;
          // The heading's own onclick already fired on this event; re-firing the child
          // would toggle the panel twice.
          if (hasOwnOnclick) return;
          if (childToggle) {
            childToggle.dispatchEvent(new window.MouseEvent('click', { bubbles: true, cancelable: true }));
          }
        });
      }
      hdr.dataset.scHdrDone = '1';
    });
  }

  /** Make the Order Products panel collapsible. */
  function wireOrderProductsCollapsible() {
    const productsTbl = $('#products-list');
    if (!productsTbl) return;

    const panel = productsTbl.closest('.panel');
    const header = panel?.querySelector('.panel-heading');
    const body = panel?.querySelector('.panel-body');
    if (!panel || !header || !body || header.dataset.opCollapseWired === '1') return;

    if (!body.id) body.id = 'order-products-body';

    const canCollapse = hasCollapse();
    if (canCollapse) {
      // Bootstrap's .collapse without .in starts closed; the fallback starts open.
      body.classList.add('collapse');
      window.jQuery(body).collapse({ toggle: false });
    } else {
      body.hidden = false; // default open
    }

    header.classList.add('_tm-enhanced', 'sc-clickable');
    header.addEventListener(
      'click',
      (ev) => {
        if (isInteractive(ev.target)) return;
        toggleCollapsed(body, canCollapse);
      },
      { passive: true },
    );

    header.dataset.opCollapseWired = '1';
  }

  /** Auto-collapse panels whose heading matches one of the titles (closed by default). */
  function wirePanelsCollapsibleByTitles(titles = []) {
    const canCollapse = hasCollapse();
    $$('.panel').forEach((panel) => {
      const heading = panel.querySelector(':scope > .panel-heading');
      const body = panel.querySelector(':scope > .panel-body');
      if (!heading || !body) return;
      if (heading.dataset.scCollapseWired === '1') return;

      const label = headingText(heading);
      if (!titles.some((t) => label.includes(t.toLowerCase()))) return;

      if (!body.id) body.id = 'panel-body-' + Math.random().toString(36).slice(2);
      if (canCollapse) {
        body.classList.add('collapse');
        window.jQuery(body).collapse({ toggle: false });
        window.jQuery(body).collapse('hide');
      } else {
        body.hidden = true;
      }

      heading.classList.add('_tm-enhanced', 'sc-clickable');
      heading.addEventListener(
        'click',
        (ev) => {
          if (isInteractive(ev.target)) return;
          toggleCollapsed(body, canCollapse);
        },
        { passive: true },
      );

      heading.dataset.scCollapseWired = '1';
    });
  }

  /**
   * One pass, in the legacy order.
   *
   * Every step is either idempotent or carries its own data-* flag, so re-running is
   * cheap and the passes our own writes provoke settle after one no-op sweep.
   */
  function sweep() {
    // Products table rows
    $$(PRODUCTS_SEL + ' tbody tr').forEach(wireRow);
    removeWeightColumnFromProducts();
    foldInnerSubtotalsIntoHeaders();
    normalizeSubpartsTables();

    // side cleanups
    removeFedExChaseKeepUPS();
    removePackageDetailsTable();

    // headers + collapsers
    centerAndMakePanelHeadersClickable();
    wireOrderProductsCollapsible();
    wirePanelsCollapsibleByTitles(AUTO_COLLAPSE_TITLES);
  }

  return { sweep };
}

/* ------------------------------------------------------------------ module */

export default {
  id: 'orders.products-panel',
  title: 'Order products panel layout',
  runAt: 'idle',
  pages: [], // the legacy @match was the whole extranet; its @exclude is ctx.page.isExcluded
  enabledByDefault: true,

  init(ctx) {
    ctx.style.add(css, { id: 'orders-products-panel' });

    const fixes = createPanelFixes(ctx);
    fixes.sweep();

    // Was a MutationObserver on document.body: the grid, the subparts tables and the
    // side panels are all re-rendered after first paint, so the sweep has to repeat.
    ctx.observe.onChange(fixes.sweep);
  },
};
