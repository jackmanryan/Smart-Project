/**
 * ExtraClean — removes the small, named set of stylesheets, <style> blocks, Summernote
 * includes and panels the extranet ships that fight the rest of the tooling, and cleans
 * the `\9` IE hacks the site's CSS still carries.
 *
 * Ported from legacy/userscripts/extraclean.user.js (v1.3). Everything here is targeted:
 * nothing is removed unless it matches one of the patterns below.
 *
 * The DOM-insertion patches are the point of running at document-start — a killed
 * stylesheet must never get the chance to apply, and the observer only sees a node after
 * it is already in the tree.
 */

import css from './styles.css';

/* --------------------------------------------------------------- matchers */

/** Styles the site inlines, tagged with the file they were inlined from. */
const STYLE_DATA_ATTR = [
  /vendor\/metisMenu\/metisMenu\.min\.css/i,
  /dist\/css\/jquery\.modal\.css/i,
];

/** Whole <style> blocks to kill, identified by distinctive text. */
const STYLE_TEXT = [
  /#Packages-Block-Toronto[\s\S]*?display:\s*none\s*!important;?/i,
  // the "emailsPane/img/iframe/link[rel=icon]" block (any of these lines)
  /Reserve space so late email HTML|#emailsPane|content-visibility:\s*auto|link\[rel=["']icon["']\]/i,
  // icon-font override
  /\.fa\s*,\s*\.fas\s*,\s*\.far\s*,\s*\.fal\s*,\s*\.fab\s*,\s*\.glyphicon\s*\{[\s\S]*?font-family:[\s\S]*?sans-serif\s*!important;?\s*\}/i,
];

const LINK_HREF = [/summernote/i];
const SCRIPT_SRC = [/summernote/i];

/** Broken IE hacks: `\9` poisons the declaration it sits in, so strip both forms. */
const IE_HACK_TOKEN = /\\9\s*;?/g;
const BAD_BG_LINE = /background-color\s*:\s*#[0-9a-f]{3,6}\s*\\9\s*;?/ig;

/** CSSRule.STYLE_RULE, read off window so the module stays lint-clean. */
const STYLE_RULE = window.CSSRule ? window.CSSRule.STYLE_RULE : 1;

/** Set once in init(); the removals are chatty, so they go to the debug channel. */
let log = { debug() {} };

/* ---------------------------------------------------------- kill decisions */

function isKillStyle(el) {
  if (el.tagName !== 'STYLE') return false;
  const dif = el.getAttribute('data-inlined-from') || '';
  if (dif && STYLE_DATA_ATTR.some((r) => r.test(dif))) return true;
  const txt = el.textContent || '';
  return !!(txt && STYLE_TEXT.some((r) => r.test(txt)));
}

function isKillLink(el) {
  if (el.tagName !== 'LINK') return false;
  const rel = (el.getAttribute('rel') || '').toLowerCase();
  if (!rel.includes('stylesheet')) return false;
  const href = el.getAttribute('href') || '';
  return LINK_HREF.some((r) => r.test(href));
}

function isKillScript(el) {
  if (el.tagName !== 'SCRIPT') return false;
  const src = el.getAttribute('src') || '';
  return !!(src && SCRIPT_SRC.some((r) => r.test(src)));
}

function drop(node, why = '') {
  try {
    node.remove();
    log.debug('removed', node.tagName, why);
  } catch { /* already detached */ }
}

/* ------------------------------------------------------------- sanitisers */

function sanitizeStyleText(txt) {
  if (!txt) return txt;
  txt = txt.replace(BAD_BG_LINE, '');
  txt = txt.replace(IE_HACK_TOKEN, ';');
  return txt;
}

function sanitizeStyleAttr(el) {
  const styleVal = el.getAttribute('style');
  if (!styleVal) return;
  const cleaned = sanitizeStyleText(styleVal);
  if (cleaned !== styleVal) el.setAttribute('style', cleaned);
}

function sanitizeStyleElement(s) {
  const txt = s.textContent || '';
  const cleaned = sanitizeStyleText(txt);
  if (cleaned !== txt) s.textContent = cleaned;
  if (isKillStyle(s)) drop(s, '(style match)');
}

/* --------------------------------------------------- document-start hooks */

/**
 * Intercept DOM insertions so a matched <style>/<link>/<script> is never inserted at
 * all. Deliberately narrow: only the three insertion methods the site actually uses,
 * plus setAttribute for the href/src/style set-after-insert pattern.
 */
function installInsertionPatches() {
  const patch = (proto, method) => {
    const orig = proto[method];
    Object.defineProperty(proto, method, {
      value: function (...args) {
        const node = args[0];
        if (node && node.nodeType === 1) {
          if (node.tagName === 'STYLE') {
            const t = node.textContent || '';
            const s = sanitizeStyleText(t);
            if (t !== s) node.textContent = s;
            if (isKillStyle(node)) { drop(node, '(style match)'); return node; }
          } else if (node.tagName === 'LINK' && isKillLink(node)) {
            drop(node, '(summernote link)'); return node;
          } else if (node.tagName === 'SCRIPT' && isKillScript(node)) {
            drop(node, '(summernote script)'); return node;
          } else {
            sanitizeStyleAttr(node);
          }
        }
        return orig.apply(this, args);
      },
      configurable: true,
      writable: false,
    });
  };

  patch(Node.prototype, 'appendChild');
  patch(Node.prototype, 'insertBefore');
  patch(Element.prototype, 'replaceChild');

  const origSetAttr = Element.prototype.setAttribute;
  Object.defineProperty(Element.prototype, 'setAttribute', {
    value: function (name, value) {
      const ret = origSetAttr.apply(this, arguments);
      const tag = this.tagName;
      if (tag === 'LINK' && name === 'href' && isKillLink(this)) drop(this, '(summernote link set)');
      else if (tag === 'SCRIPT' && name === 'src' && isKillScript(this)) drop(this, '(summernote script set)');
      else if (name === 'style') sanitizeStyleAttr(this);
      return ret;
    },
    configurable: true,
    writable: false,
  });
}

/* ------------------------------------------------------- stylesheet purge */

/**
 * Delete specific rules out of live stylesheets. Text matching cannot reach a rule that
 * arrived in a linked sheet, and the sheets keep arriving, so this re-runs on change.
 */
function purgeRules() {
  const iconSelTargets = ['.fa', '.fas', '.far', '.fal', '.fab', '.glyphicon'];
  try {
    for (const sheet of Array.from(document.styleSheets)) {
      let rules;
      try { rules = sheet.cssRules; } catch { continue; } // cross-origin
      if (!rules) continue;

      for (let i = rules.length - 1; i >= 0; i--) {
        const r = rules[i];
        if (r.type !== STYLE_RULE) continue;

        const selText = (r.selectorText || '').trim();
        const sels = selText.split(',').map((s) => s.trim());
        const st = r.style;

        // 1) Icon-font override
        const touchesIcons = sels.some((s) => iconSelTargets.includes(s));
        const ff = st && st.getPropertyValue('font-family');
        const ffImp = st && st.getPropertyPriority && st.getPropertyPriority('font-family') === 'important';
        if (touchesIcons && ff && /system-ui|-apple-system|Segoe UI|Roboto|Arial|sans-serif/i.test(ff) && ffImp) {
          sheet.deleteRule(i); continue;
        }

        // 2) emailsPane / *email* block (min-height or overflow-anchor)
        if (sels.some((s) => /#emailsPane|\[id\*="email"\]|\[class\*="email"\]/i.test(s))) {
          const mh = st.getPropertyValue('min-height');
          const oa = st.getPropertyValue('overflow-anchor');
          if (mh || oa) { sheet.deleteRule(i); continue; }
        }

        // 3) img, iframe { content-visibility: auto; }
        const hasImg = sels.includes('img');
        const hasIframe = sels.includes('iframe');
        const cv = st.getPropertyValue('content-visibility');
        if (cv && /auto/i.test(cv) && (hasImg || hasIframe)) {
          sheet.deleteRule(i); continue;
        }

        // 4) img { height: auto; }
        if (selText === 'img') {
          const h = st.getPropertyValue('height');
          if (h && /auto/i.test(h)) { sheet.deleteRule(i); continue; }
        }

        // 5) link[rel="icon"] { }
        if (/link\[rel=["']icon["']\]/i.test(selText)) {
          sheet.deleteRule(i); continue;
        }

        // 6) input[type=search] { -webkit-appearance: none; }
        if (sels.some((s) => /^input\s*\[\s*type\s*=\s*["']?search["']?\s*\]$/i.test(s))) {
          const ap = st.getPropertyValue('-webkit-appearance') || st.getPropertyValue('appearance');
          if (ap && /none/i.test(ap)) { sheet.deleteRule(i); continue; }
        }
      }
    }
  } catch { /* one unreadable sheet must not stop the sweep */ }
}

/* ---------------------------------------------------------------- panels */

/** Remove the LTL Shipment Quote Request and Calls panels, however they are marked up. */
function watchTargetPanels(observe) {
  // A) match by the toggling target in the heading's onclick
  observe.each('[onclick*="#LTL-Block"], [onclick*="#Calls-Block"]', (a) => {
    const panel = a.closest('.panel') || a.closest('.row') || a.closest('.panel-heading') || a;
    if (panel) drop(panel, '(removed target panel via onclick)');
  });

  // B) match by the body id directly
  observe.each('#LTL-Block, #Calls-Block', (el) => {
    const panel = el.closest('.panel') || el.closest('.row') || el;
    if (panel) drop(panel, '(removed target panel via id)');
  });

  // C) safe fallback by heading text (in case markup differs)
  observe.each('.panel-heading', (h) => {
    const t = (h.querySelector('a')?.textContent || h.textContent || '')
      .toLowerCase().replace(/\s+/g, ' ').trim();
    if (t.includes('ltl shipment quote request') || t.startsWith('calls')) {
      const panel = h.closest('.panel') || h;
      if (panel) drop(panel, '(removed target panel via text)');
    }
  });
}

/* ---------------------------------------------------------------- module */

export default {
  id: 'hygiene.clean',
  title: 'Extranet cleanup',
  runAt: 'start',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    // The legacy @exclude: the order review screen is built out of the very panels and
    // styles this module strips, so it opts out there entirely.
    if (ctx.page.is('orders-review') && ctx.page.param('review')) return;

    log = ctx.log;

    installInsertionPatches();
    ctx.style.add(css, { id: 'hygiene-clean' });

    const { observe } = ctx;

    observe.each('style', sanitizeStyleElement);
    observe.each('link[rel*="stylesheet"]', (l) => { if (isKillLink(l)) drop(l, '(summernote link sweep)'); });
    observe.each('script[src]', (sc) => { if (isKillScript(sc)) drop(sc, '(summernote script sweep)'); });
    observe.each('[style]', sanitizeStyleAttr);

    watchTargetPanels(observe);

    // Drop the sidebar block inside the navbar; the top navbar itself stays.
    observe.each(
      'nav.navbar.navbar-default.navbar-static-top[role="navigation"] .navbar-static-side',
      (side) => drop(side, '(navbar sidebar)'),
    );

    // Sheets keep arriving after first paint, so purge on every batch of DOM changes.
    observe.onChange(purgeRules);
  },
};
