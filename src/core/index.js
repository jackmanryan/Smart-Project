/**
 * Assembles the runtime object (`ctx`) every module receives, and starts the shared
 * services in the order they depend on each other.
 *
 * A module never reaches for `window`, never builds its own MutationObserver and never
 * patches the network. It asks ctx.
 */

import { createLogger } from './log.js';
import { createPage } from './page.js';
import { createObserver } from './observe.js';
import { createRoute } from './route.js';
import { createNetTap } from './net-tap.js';
import { createStyle } from './style.js';
import { createSettings } from './settings.js';
import { createTheme } from './theme.js';
import { createEvents } from './events.js';
import { createRegistry } from './registry.js';
import * as dom from './dom.js';

export function createRuntime({ bundle, version }) {
  const log = createLogger('core');
  const settings = createSettings(log);
  const theme = createTheme(settings);

  // Before anything paints, so a dark session never flashes light.
  theme.applyStored();

  const ctx = {
    bundle,
    version,
    dom,
    log,
    page: createPage(),
    settings,
    theme,
    style: createStyle(log),
    observe: createObserver(log),
    route: createRoute(log),
    net: createNetTap(log),
    events: createEvents(log),
  };

  return {
    ctx,
    /** Start the shared services, then every module that applies to this page. */
    run(modules) {
      ctx.net.start();
      ctx.route.start();

      const startObserver = () => ctx.observe.start();
      if (document.documentElement) startObserver();
      else document.addEventListener('readystatechange', startObserver, { once: true });

      const registry = createRegistry(ctx);
      const report = registry.run(modules);

      log.info(
        `${bundle} v${version} — ${report.started.length} module(s) on ${ctx.page.id || 'dashboard'}` +
          (report.failed.length ? `, ${report.failed.length} failed` : ''),
      );
      log.debug('skipped:', report.skipped);
      return report;
    },
  };
}
