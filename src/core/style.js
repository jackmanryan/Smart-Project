/**
 * Stylesheet injection for the light DOM and for shadow roots.
 *
 * CSS ships as .css files next to each module and is imported as text by the build, so
 * no module hand-writes a style string. Each stylesheet is injected at most once.
 */

export function createStyle(log) {
  const injected = new Set();

  function intoDocument(css, id) {
    if (typeof GM_addStyle === 'function') {
      try {
        GM_addStyle(css);
        return;
      } catch (err) {
        log.warn('GM_addStyle failed, falling back to a style element:', err);
      }
    }
    const tag = document.createElement('style');
    if (id) tag.dataset.scStyle = id;
    tag.textContent = css;
    (document.head || document.documentElement).append(tag);
  }

  return {
    /** Inject CSS into the page. Repeat calls with the same id are ignored. */
    add(css, { id = null } = {}) {
      if (!css) return;
      const key = id || css.length + ':' + css.slice(0, 64);
      if (injected.has(key)) return;
      injected.add(key);
      if (document.head) intoDocument(css, id);
      else document.addEventListener('DOMContentLoaded', () => intoDocument(css, id), { once: true });
    },

    /** Inject CSS into a shadow root. Each root keeps its own copy. */
    addToShadow(root, css, { id = null } = {}) {
      if (!root || !css) return;
      const key = `${id || css.length}`;
      root.__scStyles ||= new Set();
      if (root.__scStyles.has(key)) return;
      root.__scStyles.add(key);
      const tag = document.createElement('style');
      if (id) tag.dataset.scStyle = id;
      tag.textContent = css;
      root.append(tag);
    },
  };
}
