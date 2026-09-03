/**
 * Cross-module signals.
 *
 * Modules used to talk to each other through window events and ad-hoc globals. They now
 * publish here. Names that other software already listens for (`hamilton:loading`,
 * `sc:instant-back`) are mirrored onto window so nothing outside the bundle breaks.
 */

const MIRRORED = new Set(['hamilton:loading', 'sc:instant-back', 'tm:route']);

export function createEvents(log) {
  const subs = new Map();

  return {
    on(name, cb) {
      if (!subs.has(name)) subs.set(name, new Set());
      subs.get(name).add(cb);
      return () => subs.get(name)?.delete(cb);
    },

    emit(name, detail = null) {
      for (const cb of subs.get(name) || []) {
        try {
          cb(detail);
        } catch (err) {
          log.error(`listener for ${name} threw:`, err);
        }
      }
      if (MIRRORED.has(name)) {
        try {
          const event = new CustomEvent(name, { detail });
          // Marked so bridge() can tell our own mirror apart from a genuine outside
          // dispatch. Without this a module that both emits and bridges the same
          // mirrored name receives every emit twice.
          event.__scMirrored = true;
          window.dispatchEvent(event);
        } catch { /* dispatch is best effort */ }
      }
    },

    /** Listen to a window event as if it were one of ours. */
    bridge(name) {
      window.addEventListener(name, (e) => {
        // Our own mirror already ran the local subscribers.
        if (e.__scMirrored) return;
        for (const cb of subs.get(name) || []) {
          try {
            cb(e.detail ?? null);
          } catch (err) {
            log.error(`bridged listener for ${name} threw:`, err);
          }
        }
      });
    },
  };
}
