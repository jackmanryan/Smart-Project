/**
 * Stylesheet injection for the light DOM and for shadow roots.
 *
 * CSS ships as .css files next to each module and is imported as text by the build, so
 * no module hand-writes a style string. Each stylesheet is injected at most once.
 *
 * Every sheet injected here is marked as the bundle's own, in two places: the text opens
 * with an `sc-style: <id>` comment and the element carries `data-sc-style="<id>"`. Two
 * marks because of GM_addStyle — it appends the element before handing it back, so by
 * the time an attribute can be set the insertion hooks in hygiene/clean have already
 * seen the node; the comment is there from the start on every path. `owns(node)` reads
 * either, and is how a module that cleans the site's CSS tells the site's stylesheets
 * from the bundle's.
 */

/** Matches the comment that opens every stylesheet the bundle injects. */
const MARK_RE = /^\s*\/\* sc-style\b/;

const withMark = (css, id) => `/* sc-style${id ? `: ${id}` : ''} */\n${css}`;

/** Tag the element with the id it was injected under, when there is one to tag. */
function setId(el, id) {
  if (id && el && el.dataset) el.dataset.scStyle = id;
}

export function createStyle(log) {
  const injected = new Set();

  function intoDocument(css, id) {
    const text = withMark(css, id);
    if (typeof GM_addStyle === 'function') {
      try {
        // Tampermonkey and Violentmonkey hand back the element they appended.
        setId(GM_addStyle(text), id);
        return;
      } catch (err) {
        log.warn('GM_addStyle failed, falling back to a style element:', err);
      }
    }
    const el = document.createElement('style');
    setId(el, id);
    el.textContent = text;
    (document.head || document.documentElement).append(el);
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
      const el = document.createElement('style');
      setId(el, id);
      el.textContent = withMark(css, id);
      root.append(el);
    },

    /**
     * Is this node a <style> the bundle injected itself? True for everything that came
     * through add() or addToShadow(), and for an element a module built by hand and
     * tagged `data-sc-style`. A <style> holding the *site's* CSS — perf's `data-lac`
     * cache inlines — is not the bundle's own, and stays subject to whatever cleans the
     * site's stylesheets.
     */
    owns(node) {
      if (!node || node.nodeType !== 1) return false;
      if (node.dataset && node.dataset.scStyle !== undefined) return true;
      return node.tagName === 'STYLE' && MARK_RE.test(node.textContent || '');
    },
  };
}
