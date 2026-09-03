/**
 * The bundle's single patch of fetch and XMLHttpRequest.
 *
 * TabName and TurboKit each installed their own patch at document-start, which meant the
 * load order between them decided whether either one saw a given request. One tap with
 * subscribers removes that race:
 *   net.onResponse(cb)   observe completed requests
 *   net.dedupe(rule)     collapse repeat requests, on BOTH transports
 *   net.request(url)     an outbound call, through GM_xmlhttpRequest when granted
 *
 * The dedupe rule covers XHR as well as fetch on purpose: the extranet issues its AJAX
 * through jQuery, which is XMLHttpRequest, so a fetch-only implementation would never
 * fire on the traffic it was written for.
 */

export function createNetTap(log) {
  const responseSubs = new Set();
  /** @type {Array<{key:Function, windowMs:number, cache:{ttlMs:number, prefix:string}|null}>} */
  const dedupeRules = [];
  /** fetch: key -> in-flight promise, so concurrent callers share one response */
  const inflight = new Map();
  /** xhr: key -> time of the last send, so a repeat inside the window is dropped */
  const recent = new Map();
  let patched = false;

  function emit(detail) {
    if (!responseSubs.size) return;
    for (const cb of responseSubs) {
      try {
        cb(detail);
      } catch (err) {
        log.error('response subscriber threw:', err);
      }
    }
  }

  /** The first rule that claims this request, with the key it produced. */
  function ruleFor(url, method, body) {
    for (const rule of dedupeRules) {
      let key = null;
      try {
        key = rule.key(url, method, body);
      } catch (err) {
        log.error('dedupe key function threw:', err);
      }
      if (key) return { rule, key };
    }
    return null;
  }

  function readCache(rule, key) {
    if (!rule.cache) return null;
    try {
      const raw = sessionStorage.getItem(rule.cache.prefix + key);
      if (!raw) return null;
      const entry = JSON.parse(raw);
      if (Date.now() - entry.t >= rule.cache.ttlMs) return null;
      return entry;
    } catch {
      return null;
    }
  }

  function writeCache(rule, key, response) {
    if (!rule.cache) return;
    response
      .clone()
      .text()
      .then((body) => {
        try {
          const headers = [];
          response.headers.forEach((v, k) => headers.push([k, v]));
          sessionStorage.setItem(
            rule.cache.prefix + key,
            JSON.stringify({ t: Date.now(), body, headers, status: response.status, statusText: response.statusText }),
          );
        } catch { /* quota or disabled storage; the cache is an optimisation */ }
      })
      .catch(() => {});
  }

  function patch() {
    if (patched) return;
    patched = true;

    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    if (nativeFetch) {
      window.fetch = async function tappedFetch(input, init = {}) {
        const url = typeof input === 'string' ? input : input?.url || '';
        const method = (init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
        const hit = ruleFor(url, method, init.body);

        if (hit) {
          const cached = readCache(hit.rule, hit.key);
          if (cached) {
            // Serve the cached body now, refresh it behind the response.
            nativeFetch(input, init)
              .then((fresh) => writeCache(hit.rule, hit.key, fresh))
              .catch(() => {});
            return new Response(cached.body, {
              status: cached.status,
              statusText: cached.statusText,
              headers: new Headers(cached.headers),
            });
          }
          const flight = inflight.get(hit.key);
          if (flight) return (await flight).clone();
        }

        const run = (async () => {
          const res = await nativeFetch(input, init);
          if (responseSubs.size) {
            let text = '';
            try {
              text = await res.clone().text();
            } catch { /* body not text, or already consumed */ }
            emit({ via: 'fetch', method, url, status: res.status, text });
          }
          if (hit) writeCache(hit.rule, hit.key, res);
          return res;
        })();

        if (hit) {
          inflight.set(hit.key, run);
          run.catch(() => {}).finally(() => inflight.delete(hit.key));
          return (await run).clone();
        }
        return run;
      };
    }

    const NativeXHR = window.XMLHttpRequest;
    if (NativeXHR) {
      const open = NativeXHR.prototype.open;
      const send = NativeXHR.prototype.send;

      NativeXHR.prototype.open = function tappedOpen(method, url, ...rest) {
        this.__scMethod = String(method || 'GET').toUpperCase();
        try {
          this.__scUrl = new URL(url, location.href).href;
        } catch {
          this.__scUrl = String(url || '');
        }
        return open.call(this, method, url, ...rest);
      };

      NativeXHR.prototype.send = function tappedSend(body) {
        const hit = ruleFor(this.__scUrl, this.__scMethod, body);
        if (hit) {
          const now = Date.now();
          const last = recent.get(hit.key) || 0;
          if (now - last < hit.rule.windowMs) {
            // A duplicate inside the window: drop it rather than let it reach the server.
            try {
              this.abort();
            } catch { /* nothing sent yet; aborting is best effort */ }
            return undefined;
          }
          recent.set(hit.key, now);
          setTimeout(() => recent.delete(hit.key), hit.rule.windowMs);
        }

        if (responseSubs.size) {
          this.addEventListener('load', () => {
            let text = '';
            try {
              text = this.responseType === '' || this.responseType === 'text' ? this.responseText : '';
            } catch { /* opaque response type */ }
            emit({ via: 'xhr', method: this.__scMethod, url: this.__scUrl, status: this.status, text });
          });
        }
        return send.call(this, body);
      };
    }
  }

  return {
    start: patch,

    /** Observe every completed request: cb({via, method, url, status, text}). */
    onResponse(cb) {
      responseSubs.add(cb);
      return () => responseSubs.delete(cb);
    },

    /**
     * Collapse repeat requests on both transports.
     *
     *   key(url, method, body)  the identity of a request, or null to ignore it
     *   windowMs                an XHR repeat inside this window is aborted
     *   cache                   optional {ttlMs, prefix} sessionStorage cache for fetch
     *
     * Returns an unsubscribe function.
     */
    dedupe({ key, windowMs = 5000, cache = null }) {
      if (typeof key !== 'function') throw new TypeError('net.dedupe needs a key function');
      const rule = { key, windowMs, cache };
      dedupeRules.push(rule);
      return () => {
        const i = dedupeRules.indexOf(rule);
        if (i >= 0) dedupeRules.splice(i, 1);
      };
    },

    /** GET a URL through GM_xmlhttpRequest when granted, else a credentialed fetch. */
    request(url, { method = 'GET', headers = {}, body = null, timeoutMs = 15000 } = {}) {
      if (typeof GM_xmlhttpRequest === 'function') {
        return new Promise((resolve, reject) => {
          GM_xmlhttpRequest({
            method,
            url,
            headers,
            data: body,
            timeout: timeoutMs,
            onload: (r) => resolve({ status: r.status, text: r.responseText }),
            onerror: () => reject(new Error(`network error for ${url}`)),
            ontimeout: () => reject(new Error(`timeout for ${url}`)),
          });
        });
      }
      return fetch(url, { method, headers, body, credentials: 'include' }).then(async (r) => ({
        status: r.status,
        text: await r.text(),
      }));
    },
  };
}
