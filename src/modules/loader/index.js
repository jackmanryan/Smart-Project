/**
 * Hamilton the Hamster (and Lizard) — the full-page loading overlay.
 *
 * From document-start a flat #EAE8F2 sheet covers the page with a randomly chosen
 * hamster or lizard running on it, and it fades out once the document has loaded and the
 * other document-idle work has had its buffer. The point is that the extranet paints in
 * stages and the tooling rearranges it afterwards; the overlay hides that reflow.
 *
 * The interesting half is the bridge. A click on a link may be a real cross-document
 * navigation, or it may be an SPA mutation that never leaves the page — showing the
 * overlay for the second one would flash the screen for nothing. So a click only *arms*
 * an attempt: the overlay appears after a short delay and is torn down again unless the
 * document confirms it is actually leaving (pagehide, the Navigation API, or the tab
 * going hidden). SPA signals cancel the attempt instead.
 *
 * Ported from legacy/userscripts/hamilton-the-hamster-and-lizard.user.js (v1.4.0).
 * Differences from the legacy script are listed in the PR; the load-bearing ones:
 *   - no `window.TopLoader` and no patching of HTMLDialogElement/HTMLElement prototypes;
 *   - show/hide is driven by, and reported through, the `hamilton:loading` event.
 */

import lockCss from './styles.css';
import overlayCss from './overlay.css';
import hamsterCss from './hamster.css';
import hamsterHtml from './hamster.html';
import lizardCss from './lizard.css';
import lizardHtml from './lizard.html';

/* ---------------------------------------------------------------- config */

const EXTRA_IDLE_WAIT_MS = 700; // after window 'load', to cover the other idle-stage work
const FADE_MS = 200; // fade-out duration; must match the transition in overlay.css
const BACKDROP_COLOR = '#EAE8F2'; // must match #backdrop's background in overlay.css

// Bridge heuristics.
const ARM_DELAY_MS = 80; // wait a beat to see if the SPA intercepts before showing
const CONFIRM_DEADLINE_MS = 300; // no unload confirmation by then means it was an SPA mutation

/** Tab-storage key for the cross-document handoff. Verbatim from the legacy script. */
const HANDOFF_KEY = 'TopLoaderHandoff';

/** Marker for the same payload when it has to ride along in window.name. */
const NAME_PREFIX = '[TL]';

/** NAME_PREFIX plus its JSON payload, anchored to the end of window.name. */
const NAME_PAYLOAD = /\[TL\](\{.*\})$/;

/** Tag on every event this module emits, so its own echo can be ignored. */
const SOURCE = 'loader';

/* -------------------------------------------------------------- handoff */

/*
 * The next document is told which colour and fade it should carry on with, through the
 * per-tab store when the bundle has the grants and through window.name when it does not.
 * GM_saveTab/GM_getTab have no core wrapper, so they are called directly here.
 */

function saveTabData(obj) {
  try {
    if (typeof window.GM?.saveTab === 'function') {
      window.GM.saveTab(obj);
      return;
    }
    if (typeof GM_saveTab === 'function') GM_saveTab(obj);
  } catch { /* the handoff is best effort */ }
}

async function getTabData() {
  try {
    if (typeof window.GM?.getTab === 'function') return await window.GM.getTab();
    if (typeof GM_getTab === 'function') return await new Promise((resolve) => GM_getTab(resolve));
  } catch { /* the handoff is best effort */ }
  return null;
}

function writeNameHandoff(payload) {
  try {
    const current = String(window.name || '').replace(NAME_PAYLOAD, '');
    window.name = current + NAME_PREFIX + JSON.stringify(payload);
  } catch { /* window.name can be denied */ }
}

/** Read the payload back and strip it, so window.name is left as the page found it. */
function readNameHandoff() {
  try {
    const current = String(window.name || '');
    const match = current.match(NAME_PAYLOAD);
    if (!match) return null;
    window.name = current.replace(NAME_PAYLOAD, '');
    return JSON.parse(match[1]);
  } catch { /* not our payload */ }
  return null;
}

function markHandoff() {
  const payload = { t: Date.now(), color: BACKDROP_COLOR, fade: FADE_MS };
  saveTabData({ [HANDOFF_KEY]: payload });
  writeNameHandoff(payload);
}

/* ---------------------------------------------------------- force route */

/**
 * The auto-search route drives a search from the hash and repaints as it goes, so the
 * overlay is meant to stay up there rather than fade on load.
 */
const isAutoSearchRoute = (ctx) => ctx.page.is('search') && /^#?autosearch=/.test(location.hash);

/* --------------------------------------------------------------- timing */

const windowLoad = () =>
  new Promise((resolve) => {
    if (document.readyState === 'complete') resolve();
    else window.addEventListener('load', () => resolve(), { once: true });
  });

/** One idle callback, then ms more, so late document-idle scripts get their turn. */
const idleBuffer = (ms) =>
  new Promise((done) => {
    const finish = () => setTimeout(done, ms);
    if (typeof requestIdleCallback === 'function') requestIdleCallback(finish, { timeout: ms });
    else finish();
  });

const nextTwoFrames = () => new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));

/* --------------------------------------------------------------- themes */

const THEMES = [
  { name: 'hamster', css: hamsterCss, html: hamsterHtml },
  { name: 'lizard', css: lizardCss, html: lizardHtml },
];

/** 50/50, decided once per document. */
const pickTheme = () => (Math.random() < 0.5 ? THEMES[0] : THEMES[1]);

/* -------------------------------------------------------------- overlay */

/**
 * The overlay itself: a shadow-rooted host that lives in the browser's top layer, so
 * nothing the page paints later can sit above it.
 */
function createOverlay(ctx) {
  const { dom, style, events, log } = ctx;
  const theme = pickTheme();

  const host = dom.el('div', {
    'data-toploader': 'true',
    style: {
      position: 'fixed',
      inset: '0',
      zIndex: '2147483647',
      pointerEvents: 'auto',
      contain: 'layout style paint',
      display: 'block',
    },
  });

  const shadow = host.attachShadow({ mode: 'open' });
  style.addToShadow(shadow, overlayCss, { id: 'loader-overlay' });
  style.addToShadow(shadow, theme.css, { id: `loader-${theme.name}` });

  const content = dom.el('div', { id: 'content' });
  content.innerHTML = theme.html;
  const backdrop = dom.el('div', { id: 'backdrop' }, content);
  shadow.append(backdrop);

  const lockStyle = dom.el('style', { 'data-sc-style': 'loader-lock' });
  lockStyle.textContent = lockCss;
  const lock = () => dom.onRoot(() => (document.head || document.documentElement).append(lockStyle));
  const unlock = () => lockStyle.remove();

  // Top layer, best available: a manual popover, else a modal <dialog>, else just a
  // very high z-index. Which one we got decides how the overlay is shown again later.
  const supportsPopover = 'showPopover' in HTMLElement.prototype;
  const supportsDialog = typeof window.HTMLDialogElement === 'function';
  let usingPopover = false;
  let usingDialog = false;
  let dialogEl = null;

  /** True until the overlay has been faded out once; gates the top-layer re-assert. */
  let active = true;

  /** Bumped by every show() and hide(); a pending teardown whose generation is stale is dropped. */
  let teardown = 0;

  function openPopover() {
    try {
      host.showPopover?.();
    } catch { /* already open */ }
  }

  function openDialog() {
    try {
      dialogEl?.showModal?.();
    } catch { /* already open, or detached */ }
  }

  function attach() {
    // document-start can beat the parser to <html>; onRoot defers until it exists.
    if (!document.documentElement) return dom.onRoot(attach);
    return attachNow();
  }

  function attachNow() {
    if (supportsPopover) {
      host.setAttribute('popover', 'manual');
      document.documentElement.append(host);
      openPopover();
      usingPopover = true;
    } else if (supportsDialog) {
      dialogEl = dom.el('dialog', {
        style: {
          padding: '0',
          margin: '0',
          border: 'none',
          width: '100vw',
          height: '100vh',
          maxWidth: '100vw',
          maxHeight: '100vh',
        },
      });
      dialogEl.append(host);
      document.documentElement.append(dialogEl);
      openDialog();
      usingDialog = true;
    } else {
      document.documentElement.append(host);
    }
    lock();
  }

  function show() {
    if (!document.documentElement) return;
    teardown += 1; // cancels any removal still pending from a hide() mid-fade
    if (usingPopover) {
      if (!host.isConnected) document.documentElement.append(host);
      openPopover();
    } else if (usingDialog) {
      if (!dialogEl.isConnected) document.documentElement.append(dialogEl);
      openDialog();
    } else if (!host.isConnected) {
      document.documentElement.append(host);
    }
    backdrop.classList.remove('hidden');
    lock();
    events.emit('hamilton:loading', { state: 'start', source: SOURCE });
  }

  async function hide() {
    active = false;
    events.emit('hamilton:loading', { state: 'stop', source: SOURCE });
    backdrop.classList.add('hidden');
    const generation = ++teardown;
    await dom.sleep(FADE_MS);
    // A show() during the fade bumps `teardown`, which cancels this removal. Without
    // this the overlay is torn out from under whoever just asked for it.
    if (generation !== teardown) return;
    if (usingDialog) {
      try {
        dialogEl?.close?.();
      } catch { /* never opened */ }
      dialogEl?.remove?.();
    }
    host.remove();
    unlock();
  }

  /**
   * Put the overlay back on top of the top layer.
   *
   * A dialog or popover the page opens while we are up would otherwise paint over us,
   * because the top layer stacks in the order things entered it. The legacy script
   * patched HTMLDialogElement.prototype.showModal and HTMLElement.prototype.showPopover
   * to re-enter on every call; a module may not touch those prototypes, so this runs off
   * the shared observer and fullscreenchange instead. Only while `active`, which is just
   * the initial load window — exactly when the legacy patches were installed.
   */
  function reassert() {
    if (!active) return;
    if (!document.documentElement) return;
    if (usingPopover) {
      if (!host.isConnected) document.documentElement.append(host);
      let open = false;
      try {
        open = host.matches(':popover-open');
      } catch { /* older engine; re-opening is harmless */ }
      if (!open) openPopover();
    } else if (usingDialog && !dialogEl?.open) {
      openDialog();
    }
  }

  log.debug(`overlay theme: ${theme.name}`);

  return {
    attach,
    show,
    hide,
    reassert,
    /** Re-arm the overlay and show it: the route wants it up until told otherwise. */
    assert() {
      active = true;
      show();
    },
  };
}

/* -------------------------------------------------------- boot sequence */

async function runBootSequence(ctx, overlay, forcedAtBoot) {
  // Reserved for phase sync between pages: reading it also clears the window.name
  // payload the previous document left behind.
  const tab = await getTabData();
  const handoff = (tab && tab[HANDOFF_KEY]) || readNameHandoff();
  if (handoff) ctx.log.debug('handoff from previous document:', handoff);

  await windowLoad();
  await idleBuffer(EXTRA_IDLE_WAIT_MS);
  await nextTwoFrames();

  // The legacy script re-asserted the overlay here on the auto-search route and then
  // hid it unconditionally anyway, so the fade always happens on load. Kept: force mode
  // earns its keep afterwards, when the bridge re-evaluates the route.
  if (forcedAtBoot) overlay.assert();
  await overlay.hide();
}

/* --------------------------------------------------------------- bridge */

/**
 * Decide, per navigation attempt, whether the overlay should be up — and keep it out of
 * the way of anything that only looks like a navigation.
 */
function installBridge(ctx, overlay, forcedAtBoot) {
  let forceMode = forcedAtBoot;
  let pending = null;

  function armAttempt(reason) {
    cancelAttempt(); // only one at a time
    const attempt = { reason, shown: false, confirmed: false, showTimer: 0, deadlineTimer: 0 };

    // Show after a tiny delay, which gives an SPA handler the chance to intercept.
    attempt.showTimer = setTimeout(() => {
      if (attempt.confirmed) return;
      overlay.show();
      attempt.shown = true;
    }, ARM_DELAY_MS);

    // Nothing confirmed the navigation by the deadline, so it was a mutation.
    attempt.deadlineTimer = setTimeout(() => {
      if (!attempt.confirmed) cancelAttempt();
    }, CONFIRM_DEADLINE_MS);

    pending = attempt;
  }

  function confirmAttempt() {
    if (!pending) return;
    pending.confirmed = true;
    clearTimeout(pending.showTimer);
    if (!pending.shown) {
      overlay.show();
      pending.shown = true;
    }
    markHandoff();
    clearTimeout(pending.deadlineTimer);
    // `pending` deliberately stays set: this document is on its way out.
  }

  function cancelAttempt() {
    if (!pending) return;
    clearTimeout(pending.showTimer);
    clearTimeout(pending.deadlineTimer);
    if (pending.shown) overlay.hide(); // shown, but it turned out to be an SPA mutation
    pending = null;
  }

  /** The auto-search route may be entered or left without a document load. */
  function reevaluateForceMode() {
    const next = isAutoSearchRoute(ctx);
    if (next === forceMode) return;
    forceMode = next;
    if (forceMode) overlay.assert();
    else overlay.hide();
  }

  function isEligibleAnchor(ev) {
    if (ev.defaultPrevented) return false;
    if (ev.button !== 0) return false;
    if (ev.metaKey || ev.ctrlKey || ev.shiftKey || ev.altKey) return false;
    const target = ev.target;
    const a = target && target.nodeType === 1 ? target.closest('a') : null;
    if (!a) return false;
    const href = a.getAttribute('href');
    if (!href || href.startsWith('#')) return false;
    if (a.hasAttribute('download')) return false;
    return (a.getAttribute('target') || '_self').toLowerCase() === '_self';
  }

  // Anchor clicks are only a maybe: arm, and wait for confirmation.
  document.addEventListener(
    'click',
    (ev) => {
      if (isEligibleAnchor(ev)) armAttempt('anchor');
    },
    true,
  );

  // Same-tab form submits. The legacy form script marks the ones it means to send to a
  // new tab, and those never take the overlay with them.
  document.addEventListener(
    'submit',
    (ev) => {
      const form = ev.target;
      const wantsNewTab = !!form.__tmxNewTabIntent;
      const target = (form.getAttribute('target') || '_self').toLowerCase();
      const submitterTarget = (
        ev.submitter?.getAttribute('formtarget') ||
        ev.submitter?.getAttribute('target') ||
        ''
      ).toLowerCase();

      if (wantsNewTab || target === '_blank' || submitterTarget === '_blank') return;
      if (target === '_self') armAttempt('form');
    },
    true,
  );

  // Programmatic navigation confirms on the way out. BackBoost keeps the BFCache by
  // swallowing beforeunload, so pagehide is the signal, not beforeunload.
  window.addEventListener('pagehide', confirmAttempt, { capture: true });

  // Restored from the BFCache: whatever was on screen when we left is back, uncovered.
  window.addEventListener(
    'pageshow',
    (e) => {
      if (e.persisted || performance.getEntriesByType('navigation')[0]?.type === 'back_forward') {
        overlay.hide();
      }
    },
    { once: true },
  );

  // TurboKit's instant-back does its own visual swap; stay out of its way.
  ctx.events.bridge('sc:instant-back');
  ctx.events.on('sc:instant-back', () => overlay.hide());

  // Navigation API: it tells us outright whether the destination is same-document.
  const navigation = window.navigation;
  if (navigation && typeof navigation.addEventListener === 'function') {
    navigation.addEventListener('navigate', (e) => {
      if (e.destination && e.destination.sameDocument) cancelAttempt();
      else confirmAttempt();
    });
  }

  // Any SPA route change is a cancel — and may also move us in or out of force mode.
  // ctx.route covers pushState, replaceState, popstate and hashchange in one signal.
  ctx.route.onChange(() => {
    reevaluateForceMode();
    cancelAttempt();
  });

  // The tab going hidden is a strong sign of a real navigation.
  document.addEventListener(
    'visibilitychange',
    () => {
      if (document.visibilityState === 'hidden') confirmAttempt();
    },
    true,
  );

  // Direct requests from other modules: { state: 'start' | 'stop' }.
  // Core mirrors this name onto window already and ignores its own dispatch when
  // bridging, so this only picks up genuine outside dispatches.
  ctx.events.bridge('hamilton:loading');
  ctx.events.on('hamilton:loading', (detail) => {
    const d = detail || {};
    if (d.source === SOURCE) return; // our own echo
    if (d.state === 'start') {
      armAttempt('external');
      confirmAttempt();
    } else if (d.state === 'stop') {
      cancelAttempt(); // aborted without navigating
    }
  });
}

/* --------------------------------------------------------------- module */

export default {
  id: 'loader',
  title: 'Loading overlay',
  runAt: 'start',
  pages: [],
  enabledByDefault: true,

  init(ctx) {
    const overlay = createOverlay(ctx);
    overlay.attach();

    // Entering fullscreen empties the top layer underneath us.
    document.addEventListener('fullscreenchange', () => overlay.reassert(), true);
    ctx.observe.onChange(() => overlay.reassert());

    const forcedAtBoot = isAutoSearchRoute(ctx);
    ctx.log.guard(() => runBootSequence(ctx, overlay, forcedAtBoot));

    // The legacy TurboKit install owns the transition when it is present, so the
    // outgoing bridge stands down rather than fighting it for the screen.
    if ('SCTurbo' in window) {
      ctx.log.info('legacy TurboKit detected; navigation bridge disabled');
      return;
    }

    installBridge(ctx, overlay, forcedAtBoot);
  },
};
