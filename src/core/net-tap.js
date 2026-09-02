/**
 * The bundle's single patch of fetch and XMLHttpRequest.
 *
 * TabName and TurboKit each installed their own patch at document-start, which meant the
 * load order between them decided whether either one saw a given request. One tap with
 * subscribers removes that race:
 *   net.onResponse(cb)   observe completed requests (TabName reads the order JSON)
 *   net.dedupe(match)    coalesce identical in-flight requests (TurboKit's email loader)
 */

export function createNetTap(log) {
  const responseSubs = new Set();
  const dedupeRules = [];
  /** @type {Map<string, Promise<{status:number,text:string}>>} */
  const inflight = new Map();
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

  const dedupeKey = (method, url, body) => {
    for (const match of dedupeRules) {
      let hit = false;
      try {
        hit = match(url, method, body);
      } catch (err) {
        log.error('dedupe matcher threw:', err);
      }
      if (hit) return `${method} ${url} ${typeof body === 'string' ? body : ''}`;
    }
    return null;
  };

  function patch() {
    if (patched) return;
    patched = true;

    const nativeFetch = window.fetch ? window.fetch.bind(window) : null;
    if (nativeFetch) {
      window.fetch = async function tappedFetch(input, init = {}) {
        const url = typeof input === 'string' ? input : input?.url || '';
        const method = (init.method || (typeof input === 'object' && input?.method) || 'GET').toUpperCase();
        const key = dedupeKey(method, url, init.body);

        if (key && inflight.has(key)) {
          const shared = await inflight.get(key);
          return new Response(shared.text, { status: shared.status });
        }

        const run = (async () => {
          const res = await nativeFetch(input, init);
          const clone = res.clone();
          let text = '';
          try {
            text = await clone.text();
          } catch { /* body already consumed or not text */ }
          emit({ via: 'fetch', method, url, status: res.status, text });
          return { status: res.status, text, res };
        })();

        if (key) {
          inflight.set(
            key,
            run.then((r) => ({ status: r.status, text: r.text })),
          );
          run.finally(() => inflight.delete(key));
        }
        return (await run).res;
      };
    }

    const NativeXHR = window.XMLHttpRequest;
    if (NativeXHR) {
      const open = NativeXHR.prototype.open;
      const send = NativeXHR.prototype.send;

      NativeXHR.prototype.open = function tappedOpen(method, url, ...rest) {
        this.__scMethod = String(method || 'GET').toUpperCase();
        this.__scUrl = String(url || '');
        return open.call(this, method, url, ...rest);
      };

      NativeXHR.prototype.send = function tappedSend(body) {
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
     * Coalesce concurrent identical requests. `match(url, method, body)` returning true
     * means "a second call to this while the first is in flight should reuse the result".
     */
    dedupe(match) {
      dedupeRules.push(match);
      return () => {
        const i = dedupeRules.indexOf(match);
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
