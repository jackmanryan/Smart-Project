/**
 * Kill custom.css
 *
 * The site serves /css/custom.css, which fights the layout work the rest of the bundle
 * does. Disabling it once is not enough: it comes back on late/SPA injection, and it can
 * also arrive as an @import inside one of the site's own stylesheets rather than as a new
 * <link>, so the sweep has to be repeatable and has to look at both.
 *
 * Ported from legacy/userscripts/kill-custom-css.user.js.
 */

const TARGET_PART = '/css/custom.css'; // match fragment
const LINK_SEL = `link[rel~="stylesheet"][href*="${TARGET_PART}"]`;

// CSSRule.IMPORT_RULE, inlined because CSSRule is not one of the bundle's lint globals.
const IMPORT_RULE = 3;

function nukeLink(link) {
  try {
    link.disabled = true;
  } catch {}
  try {
    link.remove();
  } catch {}
}

/** Remove any @import of the target from a same-origin stylesheet; returns how many went. */
function nukeImportsIn(sheet) {
  try {
    const rules = sheet.cssRules;
    if (!rules) return 0;
    let removed = 0;
    // walk backwards so indices don't shift
    for (let i = rules.length - 1; i >= 0; i--) {
      const r = rules[i];
      if (r && r.type === IMPORT_RULE && r.href && r.href.includes(TARGET_PART)) {
        sheet.deleteRule(i);
        removed++;
      }
    }
    return removed;
  } catch {
    // Cross-origin or inaccessible; ignore.
    return 0;
  }
}

/** One full pass: <link> tags, then stylesheet objects and their @imports. */
function disableCustomCssEverywhere(log) {
  let hits = 0;

  // 1) Direct <link> tags
  for (const link of document.querySelectorAll(LINK_SEL)) {
    nukeLink(link);
    hits++;
  }

  // 2) CSSStyleSheet objects (direct href or @imports)
  for (const sheet of Array.from(document.styleSheets)) {
    try {
      if (sheet.href && sheet.href.includes(TARGET_PART)) {
        // Disable and remove its owner node for good measure
        sheet.disabled = true;
        sheet.ownerNode?.remove();
        hits++;
        continue;
      }
    } catch {}
    hits += nukeImportsIn(sheet);
  }

  if (hits > 0) log.debug(`neutralized ${hits} occurrence(s).`);
}

export default {
  id: 'hygiene.kill-custom-css',
  title: 'Kill custom.css',
  runAt: 'idle',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    const sweep = () => disableCustomCssEverywhere(ctx.log);

    // The idle stage puts us after load, which is where the legacy script ran: sweeping
    // last is how we "win" against the site's own stylesheet.
    sweep();

    // Guard against late/SPA injections. Fires for the links present now and for any
    // added later, so it replaces both the load-time pass and the script's own observer.
    ctx.observe.each(LINK_SEL, (link) => {
      nukeLink(link);
      sweep(); // catch any @imports added with it
    });

    // Final sweep after a short delay, for an @import injected after load with no new
    // <link> for the observer to see.
    setTimeout(sweep, 1500);
  },
};
