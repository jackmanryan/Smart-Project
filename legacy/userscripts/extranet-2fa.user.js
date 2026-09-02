// ==UserScript==
// @name         Extranet 2FA
// @namespace    jack.tools
// @version      2.3.0
// @description  From the verify_2fa page: arm + open Gmail, (optional) POP3 "Check mail now", poll Atom for a fresh 6-digit code (<5m+15s), send back, fill & submit. Fully gated to prevent misfires outside our flow.
// @match        https://extranet.strip-curtains.com/?p=verify_2fa*
// @match        https://mail.google.com/*
// @run-at       document-idle
// @grant        GM_setValue
// @grant        GM_getValue
// @grant        GM_addValueChangeListener
// @grant        GM_saveTab
// ==/UserScript==

(() => {
  'use strict';

  /* =========================
   * Config
   * ========================= */
  const CONFIG = {
    // Freshness windows
    FRESH_MS: 5 * 60 * 1000 + 15000,              // 5 min + 15s grace to avoid clock skew
    ARM_MS:   2 * 60 * 1000,                      // must open Gmail within 2 minutes of arming

    // Email heuristics
    SUBJECT:   '2FA Verification Code',
    SUBJECT_RE:/\b2FA\b/i,                        // extra guard if SUBJECT differs
    SENDER_RE: null,                               // e.g. /@strip-curtains\.com$/i  (leave null to disable)

    // POP3 refresh (optional speed-up)
    ENABLE_POP3_REFRESH: true,
    POP3_ACCOUNT_EMAIL: 'order-management@strip-curtains.com',
    POP3_BTN_RE:        /check mail now/i,
    POP3_TIMEOUT_MS:    30000,
    POP3_POLL_MS:       150,
    POP3_SETTLE_MS:     800
  };

  // Cross-tab channel keys
  const CHANNEL_KEY = 'strip2fa_code';
  const CHANNEL_TS  = 'strip2fa_ts';
  const ARM_KEY     = 'strip2fa_arm';

  // Env
  const HOST         = location.hostname;
  const isGmail      = HOST === 'mail.google.com';
  const isExtranet   = HOST === 'extranet.strip-curtains.com';
  const params       = new URLSearchParams(location.search);
  const isVerify2FA  = isExtranet && params.get('p') === 'verify_2fa';

  // Small helpers
  const now = () => Date.now();
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const mirror = (k, v) => { try { localStorage.setItem('strip2fa:' + k, String(v)); } catch {} };
  const safeSet = (k, v) => { try { GM_setValue(k, v); } catch {} };
  const safeGet = (k, d) => { try { return GM_getValue(k, d); } catch { return d; } };

  const CODE_RE = /\b(\d{6})\b/;

  /* =========================
   * Extranet: verify_2fa page
   * ========================= */
  if (isVerify2FA) {
    console.info('[2FA] Extranet armed. Page ready.');
    try { GM_saveTab({ role: 'extranet-verify_2fa', when: now() }); } catch {}

    const fillAndSubmit = (code) => {
      if (!/^\d{6}$/.test(code)) return false;

      const input =
        document.querySelector('#verification_code') ||
        document.querySelector('input[name="verification_code"]') ||
        document.querySelector('input[autocomplete="one-time-code"]') ||
        document.querySelector('input[type="text"][maxlength="6"]');

      if (!input) return false;

      if (input.focus) input.focus();
      input.value = code;
      input.dispatchEvent(new Event('input',  { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));

      const form =
        input.closest('form') ||
        document.querySelector('form[action*="verify_2fa"]') ||
        document.querySelector('form');

      if (form) {
        if (typeof form.requestSubmit === 'function') form.requestSubmit();
        else if (typeof form.submit === 'function') form.submit();
      } else {
        document.querySelector('[type="submit"], button.primary, .btn-primary, .verify-submit')?.click();
      }
      return true;
    };

    // Consume a fresh code immediately (handles reload races)
    {
      const cached = safeGet(CHANNEL_KEY, null);
      const ts     = safeGet(CHANNEL_TS, 0);
      if (cached && (now() - ts) <= CONFIG.FRESH_MS) {
        console.info('[2FA] Using fresh cached code.');
        fillAndSubmit(String(cached));
      }
    }

    // Live listener for codes pushed from Gmail tab
    try {
      GM_addValueChangeListener(CHANNEL_KEY, (_name, _old, val, remote) => {
        if (!remote) return;
        if (typeof val === 'string' && /^\d{6}$/.test(val)) {
          setTimeout(() => fillAndSubmit(val), 50);
        }
      });
    } catch {}

    // Minimal launcher button
    const mountButton = () => {
      if (document.getElementById('strip2faFetchBtn')) return;

      const input = document.querySelector('#verification_code');
      const host  = input?.parentElement || document.body;

      const btn = document.createElement('button');
      btn.id = 'strip2faFetchBtn';
      btn.type = 'button';
      btn.textContent = 'Fetch 2FA from Gmail';
      btn.style.marginLeft = '8px';

      (input ? input : host).insertAdjacentElement?.('afterend', btn) || host.appendChild(btn);

      btn.addEventListener('click', () => {
        const t = now();
        safeSet(ARM_KEY, t);
        mirror('arm', t);
        console.info('[2FA] Arm set; opening Gmail helper…');
        window.open('https://mail.google.com/mail/u/0/#inbox', '_blank', 'noopener,noreferrer');
      });
    };

    new MutationObserver(mountButton).observe(document.documentElement, { childList: true, subtree: true });
    mountButton();
  }

  /* =========================
   * Gmail helper (only when armed)
   * ========================= */
  if (isGmail) {
    const armed = (() => {
      const t = safeGet(ARM_KEY, 0);
      return !!t && (now() - t) <= CONFIG.ARM_MS;
    })();

    if (!armed) {
      // Absolutely no action if not armed by the verify page.
      return;
    }

    const FEED_PATH = () => {
      const m = location.pathname.match(/\/u\/(\d+)\//);
      const uIdx = (m && m[1]) || '0';
      return `/mail/u/${uIdx}/feed/atom`;
    };

    const poll = async (fn, timeoutMs, stepMs, label) => {
      const t0 = now();
      for (;;) {
        const v = fn();
        if (v) return v;
        if (now() - t0 > timeoutMs) throw new Error('Timeout: ' + (label || 'poll'));
        await sleep(stepMs);
      }
    };

    const getAllDocs = () => {
      const out = new Set();
      const crawl = (win) => {
        try {
          if (!win || !win.document || out.has(win.document)) return;
          out.add(win.document);
          win.document.querySelectorAll('iframe, frame').forEach(f => {
            try { if (f.contentWindow) crawl(f.contentWindow); } catch {}
          });
        } catch {}
      };
      crawl(window.top || window);
      return [...out];
    };

    // Optional POP3 refresh – isolated & guarded
    const pop3Refresh = async () => {
      if (!CONFIG.ENABLE_POP3_REFRESH) return false;

      const startHash = location.hash;
      const toAccounts = () => {
        if (!/settings\/accounts/.test(location.hash)) {
          location.hash = '#settings/accounts';
        }
      };

      const findPop3Row = (docs) => {
        for (const doc of docs) {
          const nodes = doc.querySelectorAll('tr, div, section, tbody, table');
          for (const el of nodes) {
            const txt = (el.innerText || '').trim();
            // Row must contain target POP3 account AND "Check mail now"
            // Additional guard: expect "Last checked" to avoid false positives.
            if (
              txt.includes(CONFIG.POP3_ACCOUNT_EMAIL) &&
              CONFIG.POP3_BTN_RE.test(txt) &&
              /last\s+checked/i.test(txt)
            ) {
              return { doc, row: el };
            }
          }
        }
        return null;
      };

      const findCheckBtn = (row) =>
        [...row.querySelectorAll('button, [role="button"], a, span, div')]
          .find(n => CONFIG.POP3_BTN_RE.test(n.textContent || ''));

      try {
        toAccounts();
        await sleep(CONFIG.POP3_SETTLE_MS);

        const { doc, row } = await poll(
          () => findPop3Row(getAllDocs()),
          CONFIG.POP3_TIMEOUT_MS,
          CONFIG.POP3_POLL_MS,
          'POP3 row'
        );

        row.scrollIntoView({ block: 'center' });
        await sleep(CONFIG.POP3_SETTLE_MS);

        const before = row.innerText || '';
        const btn = await poll(
          () => findCheckBtn(row),
          CONFIG.POP3_TIMEOUT_MS,
          CONFIG.POP3_POLL_MS,
          'Check mail now button'
        );

        ['mouseover', 'mousedown', 'mouseup', 'click'].forEach(type =>
          btn.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: doc.defaultView || window }))
        );

        await poll(
          () => {
            const t = row.innerText || '';
            return t !== before || /checking mail/i.test(t);
          },
          CONFIG.POP3_TIMEOUT_MS,
          CONFIG.POP3_POLL_MS,
          'row update'
        );

        // Restore prior view if needed
        if (startHash && !/settings\/accounts/.test(startHash)) {
          location.hash = startHash;
        }
        return true;
      } catch (e) {
        console.warn('[2FA] POP3 refresh skipped/failed:', e.message || e);
        return false;
      }
    };

    const fetchCodeOnce = () => new Promise(resolve => {
      const xhr = new XMLHttpRequest();
      xhr.open('GET', FEED_PATH(), true);
      xhr.responseType = 'document';
      xhr.overrideMimeType('text/xml');

      xhr.onload = () => {
        let xml = xhr.responseXML || null;
        if (!xml && xhr.responseText) {
          try { xml = new DOMParser().parseFromString(xhr.responseText, 'text/xml'); } catch {}
        }
        if (!xml) return resolve(null);

        const entries = [...xml.querySelectorAll('entry')].map(e => {
          const issuedStr = e.querySelector('issued')?.textContent || e.querySelector('modified')?.textContent || '';
          const issued = issuedStr ? new Date(issuedStr) : null;
          const subj   = e.querySelector('title')?.textContent?.trim() || '';
          const body   = e.querySelector('summary')?.textContent?.trim() || '';
          const from   = e.querySelector('author > email')?.textContent?.trim()
                      || e.querySelector('author > name')?.textContent?.trim()
                      || '';
          // simple score for ordering
          let score = 0;
          if (issued && (now() - issued.getTime()) < CONFIG.FRESH_MS) score += 10;
          if (subj === CONFIG.SUBJECT) score += 5;
          else if (CONFIG.SUBJECT_RE && CONFIG.SUBJECT_RE.test(subj)) score += 3;
          if (CONFIG.SENDER_RE && CONFIG.SENDER_RE.test(from)) score += 4;
          const codeMatch = (subj + ' ' + body).match(CODE_RE);
          if (codeMatch) score += 2;
          return { issued, subj, body, from, codeMatch, score };
        });

        // Keep fresh first, then score descending, then newest
        const freshSorted = entries
          .filter(it => it.issued && (now() - it.issued.getTime()) < CONFIG.FRESH_MS)
          .sort((a, b) => (b.score - a.score) || ((b.issued?.getTime() || 0) - (a.issued?.getTime() || 0)));

        for (const it of freshSorted) {
          if (it.codeMatch) {
            resolve(it.codeMatch[1]);
            return;
          }
        }
        resolve(null);
      };

      xhr.onerror = () => resolve(null);
      xhr.send();
    });

    (async () => {
      console.info('[2FA] Gmail helper active. Armed within window:', armed, location.hash);

      // Optional: kick POP3 pull first to reduce wait
      await pop3Refresh().catch(() => {});

      // Backoff schedule
      const deadlines = [0, 300, 700, 1200, 1800, 2500, 3500, 5000, 7000, 9000, 12000, 15000, 20000, 25000, 30000, 35000, 40000];
      const t0 = now();
      let code = null;

      for (let i = 0; i < deadlines.length; i++) {
        const wait = Math.max(0, deadlines[i] - (now() - t0));
        if (wait) await sleep(wait);
        code = await fetchCodeOnce();
        if (code) break;
      }

      if (!code) {
        console.info('[2FA] No fresh code yet; leaving Gmail tab open.');
        return;
      }

      try {
        safeSet(CHANNEL_KEY, code);
        safeSet(CHANNEL_TS, now());
        // Clear arm so we don't re-run on further navigation
        safeSet(ARM_KEY, 0);
        mirror('code', code);
        mirror('ts', now());
        console.info('[2FA] Code delivered to Extranet:', code);
      } finally {
        // Try to close; if blocked, at least blank
        window.close();
        setTimeout(() => { try { location.replace('about:blank'); } catch {} }, 200);
      }
    })();
  }
})();
