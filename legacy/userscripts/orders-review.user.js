// ==UserScript==
// @name         Orders Review
// @namespace    jack.tools
// @version      1.2.1
// @match        https://extranet.strip-curtains.com/?p=orders-review&review=*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(function () {
    'use strict';

    const onReady = (fn) =>
    document.readyState !== 'loading'
    ? fn()
    : document.addEventListener('DOMContentLoaded', fn);

    const isOrdersReview = () =>
    /(?:^|[?&])p=orders-review(?:&|$)/.test(location.search) &&
          /(?:^|[?&])review=/.test(location.search);

    // ---------- 1) INLINE "Back to top" ----------
    function addBackToTopInline() {
        if (!isOrdersReview()) return;

        const saveBtn = document.querySelector('#savechanges.btn');
        if (!saveBtn || document.getElementById('backtotop')) return;

        const backBtn = document.createElement('button');
        backBtn.type = 'button';
        backBtn.id = 'backtotop';
        backBtn.className = saveBtn.className; // clone look: "btn btn-outline btn-primary btn-lg"
        backBtn.textContent = 'Back to top';
        backBtn.style.marginLeft = '10px'; // small gap next to Save
        backBtn.addEventListener('click', (e) => {
            e.preventDefault();
            // snap (or change to behavior: 'smooth' if you want)
            window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
        });

        // Ensure both buttons share the same parent line
        const parent = saveBtn.parentElement || saveBtn.closest('.form-group') || saveBtn.closest('div') || document.body;
        parent.appendChild(backBtn);
    }

    // ---------- 2) BOTTOM FLOATING WARNING POPUP ----------
    function buildWarningBottomPop() {
        if (!isOrdersReview()) return;

        // Find the "Warning" panels (the red ones you showed)
        const warningHeadings = Array.from(
            document.querySelectorAll('.panel-heading._tm-enhanced')
        ).filter(h => /warning/i.test(h.textContent || ''));

        if (!warningHeadings.length) return;

        // Create bottom popup shell once
        let pop = document.getElementById('sc-warning-pop');
        if (!pop) {
            pop = document.createElement('div');
            pop.id = 'sc-warning-pop';
            pop.setAttribute('role', 'dialog');
            pop.setAttribute('aria-label', 'Warning');
            pop.innerHTML = `<div class="sc-pop-body"></div>`;
            document.body.appendChild(pop);
        }

        const body = pop.querySelector('.sc-pop-body');

        // Move each warning panel into the popup (once)
        for (const h of warningHeadings) {
            const panel = h.closest('.panel');
            if (!panel || panel.dataset.popified === '1') continue;
            panel.dataset.popified = '1';
            body.appendChild(panel); // keep existing heading + body intact
        }

    }

    // ---- Styles ----
    GM_addStyle(`
     /* ---------- Bottom floating warning popup ---------- */
     #sc-warning-pop {
       position: fixed;
       left: 0; right: 0; bottom: 0;
       z-index: 2147483647; /* top priority */
       display: flex;
       justify-content: center;
       pointer-events: none; /* allow page beneath, but... */
     }
     #sc-warning-pop .sc-pop-body {
       pointer-events: auto; /* ...interact with the popup */
       margin: 12px;
       width: clamp(320px, 70vw, 960px);
       max-height: 50vh;
       overflow: auto;
       border-radius: 12px 12px 0 0;
       box-shadow: 0 -10px 30px rgba(0,0,0,.28);
       background: #fff;
       padding: 12px;
     }
     #sc-warning-pop .panel {
       margin: 0 0 8px 0 !important;
     }
     #sc-warning-pop .panel:last-child {
       margin-bottom: 0 !important;
     }
  `);

    // Run once and also re-try if the page mutates
    function runAll() {
        addBackToTopInline();
        buildWarningDrawer();
        buildWarningBottomPop();
    }
    onReady(runAll);

    const mo = new MutationObserver(() => runAll());
    mo.observe(document.documentElement, { childList: true, subtree: true });
    (function compactPanels() {
        if (!/(^|[?&])p=orders-review(?:&|$)/.test(location.search) || !/(^|[?&])review=/.test(location.search)) return;

        const css = `
  /* ---------- Panel compaction ---------- */
  #page-wrapper .panel { margin-bottom: 12px !important; }
  #page-wrapper .panel-body { padding: 10px 12px !important; }

  /* Reduce generic vertical gaps inside panels */
  #page-wrapper .panel-body > * { margin-top: 8px; margin-bottom: 8px; }
  #page-wrapper .panel-body > *:first-child { margin-top: 0; }
  #page-wrapper .panel-body > *:last-child { margin-bottom: 0; }

  /* ---------- Tables inside panels ---------- */
  #page-wrapper .panel .table { margin-bottom: 0 !important; }
  #page-wrapper .panel .table > tbody > tr > td {
    padding: 6px 8px !important;
    vertical-align: middle !important;
  }

  /* ---------- Form controls ---------- */
  /* Kill any aggressive min-heights set by theme */
  #page-wrapper .panel .form-control {
    min-height: 0 !important;
    height: auto !important;
    line-height: 1.3 !important;
    padding: 6px 10px !important;
  }

  /* Selects should look like a normal control, not a boxy block */
  #page-wrapper select.form-control {
    height: 36px !important;
  }

  /* Textareas: keep useful space but not huge */
  #page-wrapper textarea.form-control {
    min-height: 140px !important;   /* adjust to taste */
    resize: vertical !important;
  }

  /* The specific "Load template" control often inherits extra spacing */
  #emailTemplate { margin: 0 !important; }

  /* ---------- Grid gutters (optional tighter columns) ---------- */
  #page-wrapper .row { margin-left: -8px; margin-right: -8px; }
  #page-wrapper [class*="col-"] { padding-left: 8px; padding-right: 8px; }

  /* ---------- Dark block fixes ----------
     If your theme assigns big min-heights to editor/well blocks, neutralize them. */
  #page-wrapper .panel .well,
  #page-wrapper .panel .note-editor,
  #page-wrapper .panel .panel-body > div[class*="editor"],
  #page-wrapper .panel .panel-body > .form-group > .note-editor {
    min-height: unset !important;
    height: auto !important;
  }
  `;
        (window.GM_addStyle ? GM_addStyle : (s=>{const el=document.createElement('style');el.textContent=s;document.head.appendChild(el);}))(css);

        /* Optional: target specific panels like "Billing Info" to force compact mode only there */
        document.querySelectorAll('.panel-heading .sc-title').forEach(t => {
            const name = (t.textContent || '').trim().toLowerCase();
            if (['billing info','shipping info','lead time notification'].includes(name)) {
                const panel = t.closest('.panel');
                if (panel) panel.classList.add('sc-compact-panel');
            }
        });

        /* If you prefer compaction ONLY on marked panels, scope rules to .sc-compact-panel:
     Replace occurrences of "#page-wrapper .panel" with ".sc-compact-panel" above. */
    })();

})();