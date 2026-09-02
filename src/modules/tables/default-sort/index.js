/**
 * Default sort — Purchase Date DESC
 *
 * The site initialises its grids with `order: []`, so rows arrive in whatever order the
 * server emitted. This forces the Purchase Date column to sort descending, and it has to
 * be in place before the first draw or the wrong order paints first.
 *
 * Ported from legacy/userscripts/extrasort.user.js.
 */

const GIVE_UP_MS = 30000; // jQuery/DataTables never turned up; stop burning frames

/**
 * Poll for the page's own jQuery + DataTables, then hand jQuery to cb.
 *
 * DataTables is loaded by the page, not by us, so there is no element to wait on —
 * ctx.observe watches the DOM, and the thing we need is a global. Frame-paced polling
 * keeps us ahead of the first table init without a timer that outlives the page.
 */
function waitForDataTables(cb) {
  const start = performance.now();
  (function tick() {
    const jq = window.jQuery;
    if (jq && jq.fn && (jq.fn.dataTable || jq.fn.DataTable)) return cb(jq);
    if (performance.now() - start > GIVE_UP_MS) return;
    requestAnimationFrame(tick);
  })();
}

/** Index of the "Purchase Date" header cell, or -1 when the table has no such column. */
function purchaseDateIndex(table) {
  const thead = table.tHead || table.querySelector('thead');
  const ths = Array.from(thead ? thead.querySelectorAll('th') : []);
  return ths.findIndex((th) => /purchase\s*date/i.test(th.textContent));
}

/** Only target the main DataTables the site uses, not any stray grid a widget renders. */
function isSiteTable(table) {
  return /dataTable-/.test(table.id) || table.classList.contains('dataTable');
}

/** True when the table is already sorted by column idx, descending. */
function isSortedDesc(order, idx) {
  return Boolean(order && order[0] && order[0][0] === idx && String(order[0][1]).toLowerCase() === 'desc');
}

export default {
  id: 'tables.default-sort',
  title: 'Purchase Date sorts newest first',
  runAt: 'start',
  pages: ['orders', 'pocontrol', 'search'],
  enabledByDefault: true,

  init(ctx) {
    waitForDataTables((jq) => {
      // Set the initial sort before the first draw.
      jq(document).on('preInit.dt', (e, settings) =>
        ctx.log.guard(() => {
          const table = settings.nTable;
          if (!table || !isSiteTable(table)) return;

          const idx = purchaseDateIndex(table);
          if (idx < 0) return;
          settings.aaSorting = [[idx, 'desc']];
          settings.oInit = settings.oInit || {};
          settings.oInit.order = [[idx, 'desc']]; // overrides page's "order: []"
        }),
      );

      // Safety: if something else stomped the order, fix it once after init.
      jq(document).on('init.dt', (e, settings) =>
        ctx.log.guard(() => {
          const api = new jq.fn.dataTable.Api(settings);
          const table = settings.nTable;
          const idx = table ? purchaseDateIndex(table) : -1;
          if (idx < 0) return;
          if (!isSortedDesc(api.order(), idx)) api.order([idx, 'desc']).draw(false);
        }),
      );

      // If a table was already initialised before our handlers attached (rare), fix now.
      ctx.log.guard(() => {
        jq('table.dataTable').each(function eachTable() {
          const table = this;
          if (!jq.fn.dataTable.isDataTable(table)) return;
          const idx = purchaseDateIndex(table);
          if (idx >= 0) jq(table).DataTable().order([idx, 'desc']).draw(false);
        });
      });
    });
  },
};
