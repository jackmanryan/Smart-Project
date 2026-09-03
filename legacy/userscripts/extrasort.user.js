// ==UserScript==
// @name         ExtraSort
// @namespace    jack.sc.sort.desc
// @version      0.2.0
// @description  Force Purchase Date to sort DESC immediately when DataTables initializes
// @match        https://extranet.strip-curtains.com/*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor&priceCheck=true*
// @run-at       document-start
// @grant        none
// ==/UserScript==
(() => {
  'use strict';
  const PAGES = [/\?p=orders(?:&|$)/i, /\?p=pocontrol(?:&|$)/i, /\?p=search(?:&|$)/i,];
  if (!PAGES.some(rx => rx.test(location.href))) return;

  function waitForDT(cb) {
    const start = performance.now();
    (function tick() {
      const $ = window.jQuery;
      if ($ && $.fn && ($.fn.dataTable || $.fn.DataTable)) return cb($);
      if (performance.now() - start > 30000) return; // give up after 30s
      requestAnimationFrame(tick);
    })();
  }

  function getPurchaseDateIndex(table) {
    const thead = table.tHead || table.querySelector('thead');
    const ths = Array.from(thead ? thead.querySelectorAll('th') : []);
    return ths.findIndex(th => /purchase\s*date/i.test(th.textContent));
  }

  waitForDT(($) => {
    // Set initial sort before first draw
    $(document).on('preInit.dt', (e, settings) => {
      const table = settings.nTable;
      if (!table) return;
      // Only target the main DataTables the site uses
      if (!/dataTable-/.test(table.id) && !table.classList.contains('dataTable')) return;

      const idx = getPurchaseDateIndex(table);
      if (idx >= 0) {
        settings.aaSorting = [[idx, 'desc']];
        settings.oInit = settings.oInit || {};
        settings.oInit.order = [[idx, 'desc']]; // overrides page's "order: []"
      }
    });

    // Safety: if something else stomped the order, fix it once after init
    $(document).on('init.dt', (e, settings) => {
      const api = new $.fn.dataTable.Api(settings);
      const table = settings.nTable;
      const idx = table ? getPurchaseDateIndex(table) : -1;
      if (idx >= 0) {
        const cur = api.order();
        if (!(cur && cur[0] && cur[0][0] === idx && String(cur[0][1]).toLowerCase() === 'desc')) {
          api.order([idx, 'desc']).draw(false);
        }
      }
    });

    // If a table was already initialized before our handlers attached (rare), fix now.
    $('table.dataTable').each(function () {
      const t = this;
      if ($.fn.dataTable.isDataTable(t)) {
        const api = $(t).DataTable();
        const idx = getPurchaseDateIndex(t);
        if (idx >= 0) api.order([idx, 'desc']).draw(false);
      }
    });
  });
})();
