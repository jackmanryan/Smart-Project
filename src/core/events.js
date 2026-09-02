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
          window.dispatchEvent(new CustomEvent(name, { detail }));
        } catch { /* dispatch is best effort */ }
      }
    },

    /** Listen to a window event as if it were one of ours. */
    bridge(name) {
      window.addEventListener(name, (e) => {
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
