// ==UserScript==
// @name         Order Timeline & Overview
// @namespace    jack.tools
// @version      1.4
// @description  Move action buttons into Order Overview H1 (right-aligned). Put dynamic Shipment Control inline in the Order Timeline header and remove its old body block.
// @match        https://extranet.strip-curtains.com/*
// @exclude      https://extranet.strip-curtains.com/?p=orders-review&review=*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor*
// @exclude      https://extranet.strip-curtains.com/?p=quotes_editor&priceCheck=true*
// @run-at       document-idle
// @grant        GM_addStyle
// ==/UserScript==

(function () {
  const addCSS = `
    ._tm-enhanced{display:flex!important;align-items:center!important;justify-content:space-between!important;gap:12px;flex-wrap:wrap}
    ._tm-title{display:inline-block}
    ._tm-header-right, ._tm-right{margin-left:auto;display:inline-flex;align-items:center;justify-content:flex-end;flex-wrap:wrap;gap:8px;text-align:right}
    ._tm-right h4, ._tm-right h5{margin:0;line-height:1.2}
    h1.page-header._tm-enhanced{gap:14px}
    ._tm-header-right .btn, ._tm-header-right a.btn{float:none!important;margin:0!important}
    ._tm-header-right .btn i{margin-right:4px}
    /* status badge pill */
    ._tm-badge{
      display:inline-block;
      padding:2px 8px;
      border-radius:9999px;
      font-weight:600;
      line-height:1.2;
      text-decoration:none!important;
      vertical-align:baseline;
      box-shadow:0 0 0 1px rgba(0,0,0,.08) inset;
    }
  `;
  (typeof GM_addStyle === 'function' ? GM_addStyle : (s => {
    const st = document.createElement('style'); st.textContent = s; document.head.appendChild(st);
  }))(addCSS);

  // --- Shipment Control helpers ---
  function findLegacyShipmentBlock() {
    // Look for a container in any .panel-body that has an h4 starting with "Shipment Control:"
    const bodies = document.querySelectorAll('.panel-body');
    for (const body of bodies) {
      const h4s = body.querySelectorAll('h4');
      for (const h4 of h4s) {
        const t = (h4.textContent || '').replace(/\s+/g,' ').trim();
        if (/^Shipment\s*Control\s*:/i.test(t)) {
          // Use the nearest div ancestor or parent as the block container
          return h4.closest('div') || h4.parentElement || null;
        }
      }
    }
    return null;
  }

  function populateShipmentRight(container, legacyBlock) {
    if (!container) return;
    container.innerHTML = '';

    const h4 = legacyBlock?.querySelector('h4');
    const controlVal = (h4?.querySelector('strong')?.textContent || '')
      .replace(/\s+/g,' ').trim()
      || ((h4?.textContent || '').split(':')[1] || '').trim();

    // Build the <h4> using the variable value (label itself is always "Shipment Control:")
    if (controlVal) {
      const h4New = document.createElement('h4');
      h4New.innerHTML = `Shipment Control: <strong>${controlVal}</strong>`;
      container.appendChild(h4New);
    }

    // Clone all <h5> lines (preserves colors and onclick handlers)
    const lines = legacyBlock ? legacyBlock.querySelectorAll('h5') : [];
    lines.forEach(h5 => {
      const clone = h5.cloneNode(true);
      container.appendChild(clone);
    });
  }
   // Turn inline-colored status <span> into a badge with white text and colored background
   function badgeifyStatuses(root = document) {
     const targets = root.querySelectorAll('._tm-right h5 strong span, ._tm-right h5 span[onclick]');
     targets.forEach(el => {
       if (el.dataset.tmBadge === '1') return;
       // prefer inline color; fallback to computed
       const computed = getComputedStyle(el);
       const orig = (el.style.color && el.style.color.trim()) || computed.color;
       if (!orig) return;
       el.classList.add('_tm-badge');
       el.style.setProperty('background-color', orig, 'important');
       el.style.setProperty('color', '#fff', 'important');
       el.style.setProperty('cursor', 'pointer'); // preserve pointer affordance
       el.dataset.tmBadge = '1';
     });
   }

  function buildOrUpdateShipmentRight() {
    const legacy = findLegacyShipmentBlock();
    if (!legacy) return null;

    // Find the Order Timeline header
    const headers = document.querySelectorAll('.panel .panel-heading, .panel-heading');
    let targetHeader = null;
    headers.forEach(h => {
      const txt = (h.textContent || '').trim();
      if (/^Order\s*Timeline/i.test(txt) || /^Order\s*Timeline/i.test(h.querySelector('._tm-title')?.textContent || '')) {
        targetHeader = h;
      }
    });
    if (!targetHeader) return null;

    // Ensure title wrapper exists
    if (!targetHeader.querySelector('._tm-title')) {
      const wrap = document.createElement('span');
      wrap.className = '_tm-title';
      while (targetHeader.firstChild) wrap.appendChild(targetHeader.firstChild);
      targetHeader.appendChild(wrap);
    }

    // Ensure right container exists
    let right = targetHeader.querySelector('._tm-right');
    if (!right) {
      right = document.createElement('div');
      right.className = '_tm-right';
      targetHeader.appendChild(right);
    }

    // Populate from the legacy block (dynamic values & colors)
    populateShipmentRight(right, legacy);
    // Convert colored spans (e.g., Shipped/Pending) into pills
    badgeifyStatuses(right);
    // Style header
    targetHeader.classList.add('_tm-enhanced');

    // Remove the old body block (now mirrored in header)
    try { legacy.remove(); } catch (e) {}

    return right;
  }

  // --- Buttons into Order Overview header ---
  function findActionBar() {
    const bars = Array.from(document.querySelectorAll('div.col-lg-12[style]'));
    return bars.find(div => /padding\s*:\s*10px/i.test(div.getAttribute('style') || '') &&
                             div.querySelector('button.btn, a.btn')) || null;
  }

  function directChildrenButtons(node) {
    return Array.from(node.children).filter(el =>
      el.classList?.contains('btn') ||
      (el.tagName === 'A' && el.classList?.contains('btn')) ||
      (el.tagName === 'BUTTON' && el.classList?.contains('btn'))
    );
  }

  function moveButtonsIntoPageHeader() {
    const h1 = document.querySelector('h1.page-header');
    if (!h1 || !/Order\s*Overview/i.test((h1.textContent || '').trim())) return;

    if (!h1.querySelector('._tm-title')) {
      const wrap = document.createElement('span');
      wrap.className = '_tm-title';
      while (h1.firstChild) wrap.appendChild(h1.firstChild);
      h1.appendChild(wrap);
    }

    let right = h1.querySelector('._tm-header-right');
    if (!right) {
      right = document.createElement('div');
      right.className = '_tm-header-right';
      h1.appendChild(right);
    }

    const src = findActionBar();
    if (src) {
      directChildrenButtons(src).forEach(btn => {
        if (btn.dataset.tmMoved === '1') return;
        right.appendChild(btn);
        btn.dataset.tmMoved = '1';
        btn.style.float = 'none';
        btn.style.margin = '0';
      });
      src.style.padding = '0';
      src.style.minHeight = '0';
    }

    h1.classList.add('_tm-enhanced');
  }

  function scan() {
    const right = buildOrUpdateShipmentRight(); // now dynamic
    // Re-assert badge styling in case content changed without legacy block
    badgeifyStatuses(right || document);
    moveButtonsIntoPageHeader();
  }

  scan();
  const mo = new MutationObserver(scan);
  mo.observe(document.documentElement, { childList: true, subtree: true });
})();
