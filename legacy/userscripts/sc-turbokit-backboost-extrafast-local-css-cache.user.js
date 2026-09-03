// ==UserScript==
// @name         SC TurboKit (BackBoost + ExtraFast + Local CSS Cache)
// @namespace    jack.turbokit
// @version      0.2.0
// @description  Consolidated perf suite: BFCache assist & keepalive instant-back, AJAX dedup for /ajax/emails/load_email.php, poll clamp, CLS+lazy-load, and local CSS cache (images optional).
// @match        https://extranet.strip-curtains.com/*
// @run-at       document-start
// @grant        GM_xmlhttpRequest
// @connect      extranet.strip-curtains.com
// @connect      *
// @noframes
// ==/UserScript==

(() => {
  'use strict';
  if (top !== self) return;

  // -------------------------------
  // Shared namespace + guards
  // -------------------------------
  const NS = (window.SCTurbo ||= {});
  if (NS.__installed) return;
  NS.__installed = true;

  // Quick util
  const onDOMReady = (fn) => {
    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', fn, { once: true });
    } else { fn(); }
  };

  // =========================================================
  // A) BackBoost — BFCache assist + keepalive instant-back
  //    (from your “BackBoost • Instant-Back Assist” script)
  // =========================================================
  (function BackBoost() {
    const ALLOW_UNLOAD_PATHS = [
      /[?&]p=quotes_editor\b/i,
      /[?&]p=orders_edit\b/i
    ];
    const SHOW_BACK_PILL = false;
    const HOTKEY = { altKey: true, key: '[' }; // Alt+[

    // Eagerly pre-loading the previous page in a hidden iframe made every
    // navigation load the whole app (and the whole userscript suite) twice.
    // Measured: ~3.0s extra post-interactive load time, 3,297 extra DOM nodes,
    // 41 extra resource loads and 22 extra script executions per navigation.
    // It is also why scripts appeared to run on pages their @match excludes:
    // the frame's URL really was an orders-view URL, so those scripts matched.
    // Off by default. Alt+[ still works, as a normal back.
    // Set to true to restore instant-back pre-loading.
    const KEEPALIVE_IFRAME = false;

    const onAllowedPage = ALLOW_UNLOAD_PATHS.some(rx => rx.test(location.href));

    // 1) Prefer BFCache by swallowing beforeunload/unload unless allowlisted.
    if (!onAllowedPage) {
      try {
        const swallow = new Set(['beforeunload','unload']);
        const origAdd = window.addEventListener;
        window.addEventListener = function (type, fn, opts) {
          if (swallow.has(type)) return;  // ignore unload hooks
          return origAdd.call(this, type, fn, opts);
        };
        for (const k of ['onbeforeunload','onunload']) {
          Object.defineProperty(window, k, { get(){return null;}, set(){ /* ignore */ } });
        }
      } catch {}
    }

    // 2) Telemetry (console)
    addEventListener('pageshow', e => console.debug('[TurboKit] pageshow persisted:', e.persisted));
    addEventListener('pagehide', e => console.debug('[TurboKit] pagehide  persisted:', e.persisted));

    // 3) Keepalive previous page (same-origin) for instant back
    const TAB_KEY_LAST_URL = 'bb:last:url';
    addEventListener('pagehide', () => {
      try { sessionStorage.setItem(TAB_KEY_LAST_URL, location.href); } catch {}
    });

    function mountKeepaliveIframe(prevUrl) {
      const f = document.createElement('iframe');
      f.src = prevUrl;
      f.title = 'BackBoost keepalive';
      Object.assign(f.style, {
        position:'fixed', inset:'0', width:'100vw', height:'100vh',
        border:'0', opacity:'0', pointerEvents:'none', zIndex:'-1'
      });
      document.body.appendChild(f);
      return f;
    }

    function promoteOverlayAndGoBack(frame) {
      if (!frame || !frame.contentWindow) { history.back(); return; }
      Object.assign(frame.style, { opacity:'1', pointerEvents:'auto', zIndex:'2147483645' });
      // Let Hamster know we’re doing an instant-back visual swap (so it stays out of the way)
      try { window.dispatchEvent(new CustomEvent('sc:instant-back')); } catch {}
      history.back();
    }

    function setupUI(frame) {
      if (!SHOW_BACK_PILL) return;
      const btn = document.createElement('button');
      btn.textContent = '⟵ Instant Back';
      btn.type = 'button';
      btn.style.cssText = [
        'position:fixed;bottom:12px;left:12px;z-index:2147483646;',
        'padding:8px 10px;font:600 12px Inter,system-ui;',
        'border-radius:10px;border:1px solid rgba(255,255,255,.16);',
        'background:rgba(20,22,27,.72);color:#e8edf3;backdrop-filter:saturate(180%) blur(6px);cursor:pointer'
      ].join('');
      btn.addEventListener('click', () => promoteOverlayAndGoBack(frame));
      document.body.appendChild(btn);
    }

    function setupHotkey(frame) {
      document.addEventListener('keydown', (ev) => {
        if (!!HOTKEY.altKey && !ev.altKey) return;
        if (!!HOTKEY.ctrlKey && !ev.ctrlKey) return;
        if (!!HOTKEY.shiftKey && !ev.shiftKey) return;
        if (ev.key !== HOTKEY.key) return;
        ev.preventDefault();
        promoteOverlayAndGoBack(frame);
      });
    }

    onDOMReady(() => {
      let frame = null;

      if (KEEPALIVE_IFRAME) {
        try {
          const prev = sessionStorage.getItem(TAB_KEY_LAST_URL);
          if (prev && prev !== location.href) {
            const u = new URL(prev, location.href);
            if (u.origin === location.origin) { // same-origin only
              frame = mountKeepaliveIframe(prev);
              frame.addEventListener('error', () => console.debug('[TurboKit] keepalive iframe failed (XFO?)'));
              setupUI(frame);
              console.debug('[TurboKit] keepalive ready for', prev, '(Alt+[ to trigger)');
            }
          }
        } catch (e) {
          console.debug('[TurboKit] keepalive skipped:', e);
          frame = null;
        }
      }

      // Alt+[ stays armed either way. With frame === null,
      // promoteOverlayAndGoBack() falls through to a plain history.back().
      setupHotkey(frame);
    });
  })();

  // =========================================================
  // B) ExtraFast — polling clamp + XHR/fetch de-dup + CLS/lazy
  //    (from your “ExtraFast” script)
  // =========================================================
  (function ExtraFast() {
    const EMAIL_ENDPOINT_PATH = '/ajax/emails/load_email.php';
    const DEDUP_WINDOW_MS = 5000;     // identical XHRs within 5s → cancel dup
    const POLL_MIN_MS = 30000;        // clamp intervals shorter than 30s
    const CACHE_TTL_MS = 60000;       // session cache for fetch (not XHR)
    const ENABLE_FETCH_CACHE = true;
    const MIN_EMAIL_PANE_HEIGHT = 640;

    const normalizeKey = (urlLike, method) => {
      try {
        const u = new URL(urlLike, location.href);
        if (u.pathname !== EMAIL_ENDPOINT_PATH) return null;
        u.searchParams.delete('_');
        const sp = Array.from(u.searchParams.entries()).sort((a,b)=>a[0].localeCompare(b[0]));
        const q = sp.map(kv => kv[0] + '=' + kv[1]).join('&');
        return u.origin + u.pathname + (q ? '?' + q : '') + '|' + (method || 'GET');
      } catch { return null; }
    };

    // 1) Clamp aggressive polling
    const _setInterval = window.setInterval.bind(window);
    window.setInterval = function (fn, delay, ...rest) {
      try {
        const d = Number(delay);
        if (!Number.isNaN(d) && d < POLL_MIN_MS) {
          return _setInterval(fn, POLL_MIN_MS, ...rest);
        }
      } catch {}
      return _setInterval(fn, delay, ...rest);
    };

    // 2) De-dup identical XHRs to email endpoint
    (function patchXHR() {
      const recent = new Map();
      const origOpen = XMLHttpRequest.prototype.open;
      const origSend = XMLHttpRequest.prototype.send;

      XMLHttpRequest.prototype.open = function (method, url, async, user, pass) {
        try { this.__tm_url = new URL(url, location.href).href; } catch { this.__tm_url = url; }
        this.__tm_method = String(method || 'GET').toUpperCase();
        return origOpen.apply(this, arguments);
      };

      XMLHttpRequest.prototype.send = function (body) {
        try {
          const key = normalizeKey(this.__tm_url, this.__tm_method);
          if (key) {
            const now = Date.now();
            const last = recent.get(key) || 0;
            if (now - last < DEDUP_WINDOW_MS) {
              try { this.abort(); } catch {}
              return;
            }
            recent.set(key, now);
            setTimeout(() => recent.delete(key), DEDUP_WINDOW_MS);
          }
        } catch {}
        return origSend.apply(this, arguments);
      };
    })();

    // 3) Fetch cache/dedup (same endpoint only)
    (function patchFetch() {
      if (!('fetch' in window)) return;
      const inFlight = new Map();
      const origFetch = window.fetch.bind(window);

      window.fetch = async function (input, init) {
        const method = (init && init.method) || 'GET';
        const url = (typeof input === 'string') ? input : (input && input.url);
        const key = normalizeKey(url, method);
        if (!key) return origFetch(input, init);

        if (ENABLE_FETCH_CACHE) {
          try {
            const cached = sessionStorage.getItem('tmCache:' + key);
            if (cached) {
              const { t, body, headers, status, statusText } = JSON.parse(cached);
              if (Date.now() - t < CACHE_TTL_MS) {
                // refresh in background
                origFetch(input, init).then(r => r.clone().text().then(text => {
                  const h = []; r.headers.forEach((v,k)=>h.push([k,v]));
                  sessionStorage.setItem('tmCache:' + key, JSON.stringify({
                    t: Date.now(), body: text, headers: h, status: r.status, statusText: r.statusText
                  }));
                })).catch(()=>{});
                return new Response(body, { status, statusText, headers: new Headers(headers) });
              }
            }
          } catch {}
        }

        const flight = inFlight.get(key);
        if (flight) return flight.then(resp => resp.clone());

        const p = origFetch(input, init).then(resp => {
          resp.clone().text().then(text => {
            try {
              const h = []; resp.headers.forEach((v,k)=>h.push([k,v]));
              sessionStorage.setItem('tmCache:' + key, JSON.stringify({
                t: Date.now(), body: text, headers: h, status: resp.status, statusText: resp.statusText
              }));
            } catch {}
          }).catch(()=>{});
          return resp;
        }).finally(() => inFlight.delete(key));

        inFlight.set(key, p);
        return p;
      };
    })();

    // 4) Reduce CLS + lazy-load images/iframes
    (function bootstrapCLS() {
      const css = `
        #emailsPane, [id*="email"], [class*="email"] { min-height: ${MIN_EMAIL_PANE_HEIGHT}px; overflow-anchor: none; }
        img, iframe { content-visibility: auto; }
        img { height: auto; }
      `;
      const s = document.createElement('style');
      s.textContent = css;
      document.documentElement.appendChild(s);
      if (!document.querySelector('link[rel="icon"]')) {
        const link = document.createElement('link'); link.rel = 'icon'; link.href = 'data:,';
        (document.head || document.documentElement).appendChild(link);
      }

      const markLazy = (root) => {
        root.querySelectorAll('img:not([loading])').forEach(img => img.setAttribute('loading','lazy'));
        root.querySelectorAll('iframe:not([loading])').forEach(el => el.setAttribute('loading','lazy'));
      };
      const mo = new MutationObserver(muts => {
        for (const m of muts) for (const n of m.addedNodes) if (n.nodeType === 1) markLazy(n);
      });
      markLazy(document);
      mo.observe(document.documentElement, { subtree: true, childList: true });

      // Fonts: avoid clobbering icon fonts (keep originals)
      try {
        const can = !!document.fonts?.check;
        const hasIcons = can && (
          document.fonts.check('1em "FontAwesome"') ||
          document.fonts.check('1em "Font Awesome 4"') ||
          document.fonts.check('1em "Font Awesome 5 Free"') ||
          document.fonts.check('1em "Font Awesome 6 Free"') ||
          document.fonts.check('1em "Font Awesome 6 Brands"') ||
          document.fonts.check('1em "Glyphicons Halflings"')
        );
        if (!hasIcons) {
          const s = document.createElement('style');
          s.textContent = `.glyphicon{font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial,sans-serif!important}`;
          document.documentElement.appendChild(s);
        }
      } catch {}
    })();

    // 5) Optional: surgically remove known heavy UI block (kept from your script)
    (function stripTorontoPackagesBlock() {
      const TARGET = '#Packages-Block-Toronto';
      const style = document.createElement('style');
      style.textContent = `${TARGET}, .panel:has(${TARGET}), .panel-heading:has(${TARGET}) { display:none!important; }`;
      (document.head || document.documentElement).appendChild(style);

      const removeTarget = (root=document) => {
        const el = root.querySelector(TARGET);
        if (!el) return;
        let n = el;
        while (n && n !== document.documentElement && !n.classList.contains('row')) n = n.parentElement;
        (n && n.classList.contains('row') ? n : el).remove();
      };
      const mo = new MutationObserver(muts => {
        for (const m of muts) for (const node of m.addedNodes)
          if (node.nodeType === 1 && (node.matches?.(TARGET) || node.querySelector?.(TARGET))) removeTarget(node);
      });
      mo.observe(document.documentElement, { childList: true, subtree: true });
      removeTarget();
    })();
  })();

  // =========================================================
  // C) Local CSS (and optional image) cache — light version
  //    (based on your “ExtraCache”: inline CSS from IDB on start,
  //     refresh after DOMContentLoaded; images optional)
  // =========================================================
  (function LocalAssetCache() {
    const CFG = {
      cacheCss: true,
      cacheImg: false,                 // set true if you want cached <img>/<source> too
      sameOriginOnly: true,
      maxBytes: 50 * 1024 * 1024,
      ttlMs: 30 * 24 * 3600 * 1000,    // 30 days
      warmOnDOMContentLoaded: true,
      updateLockKey: 'lac:update:lock',
      updateLockStaleMs: 120000
    };

    const DB_NAME = 'lac-db-v1', STORE = 'assets';
    const log = (...a) => console.debug('[LAC]', ...a);
    const absUrl = (u) => new URL(u, location.href).href;
    const isSameOrigin = (u) => new URL(u, location.href).origin === location.origin;
    let idb;

    function openDB() {
      return new Promise((resolve, reject) => {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const db = req.result;
          if (!db.objectStoreNames.contains(STORE)) {
            const os = db.createObjectStore(STORE, { keyPath: 'url' });
            os.createIndex('lastUsed', 'lastUsed');
          }
        };
        req.onsuccess = () => { idb = req.result; resolve(idb); };
        req.onerror = () => reject(req.error);
      });
    }
    function tx(mode='readonly') {
      const t = idb.transaction(STORE, mode);
      return [t, t.objectStore(STORE)];
    }
    const dbGet = (url) => new Promise((res, rej) => { const [t, os]=tx(); const r=os.get(url); r.onsuccess=()=>res(r.result||null); r.onerror=()=>rej(r.error); });
    const dbPut = (rec) => new Promise((res, rej) => { const [t, os]=tx('readwrite'); const r=os.put(rec); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });
    const dbAll = () => new Promise((res, rej) => { const [t, os]=tx(); const r=os.getAll(); r.onsuccess=()=>res(r.result||[]); r.onerror=()=>rej(r.error); });
    const dbDel = (url) => new Promise((res, rej) => { const [t, os]=tx('readwrite'); const r=os.delete(url); r.onsuccess=()=>res(); r.onerror=()=>rej(r.error); });

    const gmFetch = (url, headers = {}, responseType = 'arraybuffer') => new Promise((resolve, reject) => {
      GM_xmlhttpRequest({
        method: 'GET', url, headers, responseType,
        onload: (res) => resolve(res),
        onerror: reject, ontimeout: reject
      });
    });
    const headerMap = (raw) => {
      const map = {};
      for (const line of (raw||'').split(/\r?\n/)) {
        const m = line.match(/^([^:]+):\s*(.*)$/);
        if (m) map[m[1].toLowerCase()] = m[2];
      }
      return map;
    };

    async function getFreshOrFetch(url, kind) {
      const rec = await dbGet(url);
      const now = Date.now();
      if (rec && (now - (rec.fetchedAt || 0)) < CFG.ttlMs) {
        rec.lastUsed = now; await dbPut(rec);
        return { rec, notModified: true };
      }

      const hdrs = {};
      if (rec?.etag) hdrs['If-None-Match'] = rec.etag;
      if (rec?.lastModified) hdrs['If-Modified-Since'] = rec.lastModified;

      try {
        const r = await gmFetch(url, hdrs, 'arraybuffer');
        const hs = headerMap(r.responseHeaders || '');
        if (r.status === 304 && rec) {
          rec.fetchedAt = now; rec.lastUsed = now; await dbPut(rec);
          return { rec, notModified: true };
        }
        if (r.status >= 200 && r.status < 300) {
          const type = hs['content-type'] || (kind === 'css' ? 'text/css' : 'application/octet-stream');
          const blob = new Blob([r.response], { type });
          const bytes = blob.size || (r.response?.byteLength || 0);
          const next = {
            url, type, bytes,
            etag: hs['etag'] || '', lastModified: hs['last-modified'] || '',
            fetchedAt: now, lastUsed: now, blob
          };
          await dbPut(next);
          // prune simple (LRU-ish)
          let total = (await dbAll()).reduce((s, r) => s + (r.bytes || 0), 0);
          if (total > CFG.maxBytes) {
            const all = await dbAll();
            all.sort((a,b) => (a.lastUsed||0) - (b.lastUsed||0));
            for (const r of all) {
              if (total <= CFG.maxBytes) break;
              await dbDel(r.url); total -= (r.bytes || 0);
            }
          }
          return { rec: next, notModified: false };
        }
      } catch {
        if (rec) return { rec, notModified: true };
      }
      return { rec: null, notModified: false };
    }

    function swapLinkToInlineCSS(linkEl, cssText, baseUrl) {
      // naive url(...) fixup for relatives
      const base = new URL(baseUrl);
      const fixed = String(cssText).replace(/url\(\s*(['"]?)(?![a-z]+:|\/)/gi, (m, q) => `url(${q}${base.origin}${base.pathname.replace(/[^\/]+$/, '')}`);
      const st = document.createElement('style');
      st.setAttribute('data-lac', linkEl.href);
      st.textContent = fixed;
      linkEl.parentNode.insertBefore(st, linkEl);
      linkEl.remove();
    }

    (async function boot() {
      try { await openDB(); } catch (e) { log('IDB fail; abort cache', e); return; }

      // Early CSS inline from cache (best effort)
      if (CFG.cacheCss) {
        const observer = new MutationObserver(muts => {
          for (const m of muts) for (const n of m.addedNodes) {
            if (n.nodeType !== 1) continue;
            if (n.tagName === 'LINK' && n.rel === 'stylesheet' && n.href) {
              (async () => {
                const href = n.href;
                if (!href) return;
                if (CFG.sameOriginOnly && !isSameOrigin(href)) return;
                const got = await dbGet(absUrl(href));
                if (got?.blob) swapLinkToInlineCSS(n, await got.blob.text(), href);
              })();
            }
          }
        });
        observer.observe(document.documentElement, { childList: true, subtree: true });
        // anything already present
        const tryHead = () => document.querySelectorAll('link[rel="stylesheet"][href]')
          .forEach(async (link) => {
            const href = link.href;
            if (!href) return;
            if (CFG.sameOriginOnly && !isSameOrigin(href)) return;
            const got = await dbGet(absUrl(href));
            if (got?.blob) swapLinkToInlineCSS(link, await got.blob.text(), href);
          });
        if (document.head) tryHead(); else setTimeout(tryHead, 0);
      }

      // Warm/update cache after DOMContentLoaded
      if (CFG.warmOnDOMContentLoaded) {
        onDOMReady(async () => {
          // lock (cross-tab)
          const now = Date.now();
          try {
            const raw = localStorage.getItem(CFG.updateLockKey);
            if (raw) {
              const { t } = JSON.parse(raw);
              if (now - t < CFG.updateLockStaleMs) return; // someone else active
            }
            localStorage.setItem(CFG.updateLockKey, JSON.stringify({ t: now, id: Math.random() }));
          } catch {}
          try {
            const tasks = [];
            if (CFG.cacheCss) {
              document.querySelectorAll('link[rel="stylesheet"][href]').forEach(link => {
                const href = link.href; if (!href) return;
                if (CFG.sameOriginOnly && !isSameOrigin(href)) return;
                tasks.push(getFreshOrFetch(href, 'css'));
              });
            }
            if (CFG.cacheImg) {
              document.querySelectorAll('img[src]').forEach(img => {
                const u = img.src; if (!u) return;
                if (CFG.sameOriginOnly && !isSameOrigin(u)) return;
                tasks.push(getFreshOrFetch(u, 'img'));
              });
            }
            await Promise.allSettled(tasks);
          } finally {
            try { localStorage.removeItem(CFG.updateLockKey); } catch {}
          }
        });
      }
    })();
  })();

  console.debug('[TurboKit] loaded');
})();
