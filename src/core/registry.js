/**
 * Module lifecycle.
 *
 * Every module declares when it wants to run and which pages it applies to; the registry
 * decides whether to start it and contains anything it throws. One module failing must
 * never stop the twenty-five beside it, which is the failure mode the separate scripts
 * had by accident and this bundle has to keep on purpose.
 */

import { createLogger } from './log.js';

const STAGES = ['start', 'end', 'idle'];

export function createRegistry(ctx) {
  const log = createLogger('registry');
  const started = [];
  const skipped = [];
  const failed = [];

  function shouldRun(mod) {
    if (!mod || typeof mod.init !== 'function') return { run: false, why: 'not a module' };
    if (mod.hosts && !mod.hosts.includes(location.hostname)) return { run: false, why: 'other host' };
    if (mod.respectExcludes !== false && ctx.page.isExcluded) return { run: false, why: 'excluded page' };
    if (!ctx.page.matches(mod.pages)) return { run: false, why: 'other page' };
    if (!ctx.settings.isEnabled(mod.id, mod.enabledByDefault !== false)) return { run: false, why: 'switched off' };
    return { run: true };
  }

  function startModule(mod) {
    const moduleCtx = { ...ctx, log: createLogger(mod.id) };
    try {
      mod.init(moduleCtx);
      started.push(mod.id);
    } catch (err) {
      failed.push(mod.id);
      log.error(`${mod.id} failed to start:`, err);
    }
  }

  function atStage(stage, fn) {
    if (stage === 'start') return fn();
    if (stage === 'end') {
      if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fn, { once: true });
      else fn();
      return undefined;
    }
    // idle: after load, on the first quiet frame, so layout work never blocks first paint
    const run = () =>
      typeof requestIdleCallback === 'function' ? requestIdleCallback(fn, { timeout: 2000 }) : setTimeout(fn, 0);
    if (document.readyState === 'complete') run();
    else window.addEventListener('load', run, { once: true });
    return undefined;
  }

  return {
    run(modules) {
      const queue = { start: [], end: [], idle: [] };

      for (const mod of modules.flat().filter(Boolean)) {
        const verdict = shouldRun(mod);
        if (!verdict.run) {
          skipped.push(`${mod?.id ?? '?'} (${verdict.why})`);
          continue;
        }
        const stage = STAGES.includes(mod.runAt) ? mod.runAt : 'idle';
        queue[stage].push(mod);
      }

      for (const stage of STAGES) {
        if (!queue[stage].length) continue;
        atStage(stage, () => {
          for (const mod of queue[stage]) startModule(mod);
        });
      }

      return { started, skipped, failed };
    },

    report() {
      return { started, skipped, failed };
    },
  };
}
