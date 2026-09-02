/**
 * SPA route signalling.
 *
 * ExtraNav used to patch history.pushState and fire a `tm:route` window event that six
 * other scripts listened for. The patch lives here now; the event still fires under the
 * same name so anything outside the bundle keeps working.
 */

export function createRoute(log) {
  const subs = new Set();
  let patched = false;
  let lastUrl = location.href;

  function fire(reason) {
    if (location.href === lastUrl && reason !== 'force') return;
    lastUrl = location.href;
    try {
      window.dispatchEvent(new Event('tm:route'));
    } catch { /* dispatch is best effort */ }
    for (const cb of subs) {
      try {
        cb(location.href, reason);
      } catch (err) {
        log.error('route subscriber threw:', err);
      }
    }
  }

  function patch() {
    if (patched) return;
    patched = true;
    for (const method of ['pushState', 'replaceState']) {
      const original = history[method].bind(history);
      history[method] = function patchedHistory(...args) {
        const result = original(...args);
        fire(method);
        return result;
      };
    }
    window.addEventListener('popstate', () => fire('popstate'));
    window.addEventListener('hashchange', () => fire('hashchange'));
  }

  return {
    start: patch,
    /** Call cb whenever the URL changes. Returns an unsubscribe function. */
    onChange(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
    /** Fire the route signal by hand, e.g. after replacing a view in place. */
    signal: () => fire('force'),
  };
}
