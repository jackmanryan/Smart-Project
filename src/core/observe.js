/**
 * One MutationObserver for the whole bundle.
 *
 * The legacy scripts ran twenty of these against the same document. Each module now
 * subscribes here instead; callbacks are batched into a single animation frame so a
 * DataTables redraw costs one pass rather than twenty.
 */

export function createObserver(log) {
  /** @type {Set<{selector:string, cb:Function, seen:WeakSet, root:ParentNode}>} */
  const selectorSubs = new Set();
  const changeSubs = new Set();
  let observer = null;
  let scheduled = false;
  let started = false;

  function scanFor(sub) {
    let nodes;
    try {
      nodes = sub.root.querySelectorAll(sub.selector);
    } catch (err) {
      log.error(`bad selector ${sub.selector}:`, err);
      selectorSubs.delete(sub);
      return;
    }
    for (const node of nodes) {
      if (sub.seen.has(node)) continue;
      sub.seen.add(node);
      try {
        sub.cb(node);
      } catch (err) {
        log.error(`observer callback for ${sub.selector} threw:`, err);
      }
    }
  }

  function flush() {
    scheduled = false;
    for (const sub of selectorSubs) scanFor(sub);
    for (const cb of changeSubs) {
      try {
        cb();
      } catch (err) {
        log.error('change subscriber threw:', err);
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(flush);
  }

  const api = {
    /** Begin observing. Safe to call more than once; the registry calls it for you. */
    start() {
      if (started) return;
      const target = document.documentElement || document;
      observer = new MutationObserver(schedule);
      observer.observe(target, { childList: true, subtree: true });
      started = true;
      schedule();
    },

    /**
     * Call cb once for every element matching selector — those present now and any
     * added later. Returns an unsubscribe function.
     */
    each(selector, cb, { root = document } = {}) {
      const sub = { selector, cb, seen: new WeakSet(), root };
      selectorSubs.add(sub);
      if (started) scanFor(sub);
      else schedule();
      return () => selectorSubs.delete(sub);
    },

    /** Call cb after any batch of mutations. Returns an unsubscribe function. */
    onChange(cb) {
      changeSubs.add(cb);
      return () => changeSubs.delete(cb);
    },

    /** Resolve with the first element matching selector, or null once timeout passes. */
    ready(selector, { timeout = 10000, root = document } = {}) {
      const existing = root.querySelector(selector);
      if (existing) return Promise.resolve(existing);
      return new Promise((resolve) => {
        let done = false;
        const stop = api.each(
          selector,
          (node) => {
            if (done) return;
            done = true;
            stop();
            clearTimeout(timer);
            resolve(node);
          },
          { root },
        );
        const timer = setTimeout(() => {
          if (done) return;
          done = true;
          stop();
          resolve(null);
        }, timeout);
      });
    },

    /** Run fn without the observer reacting to the DOM writes it performs. */
    silently(fn) {
      if (!observer) return fn();
      observer.disconnect();
      try {
        return fn();
      } finally {
        observer.observe(document.documentElement || document, { childList: true, subtree: true });
      }
    },
  };

  return api;
}
