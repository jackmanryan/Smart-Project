/**
 * Everything that runs on the extranet.
 *
 * One installed script means load order is decided here rather than by whichever
 * Tampermonkey entry happened to sort first, which is what made shared helpers
 * unreliable when these were twenty-four separate installs.
 */

import { createRuntime } from '../core/index.js';
import modules from '../modules/index.js';

const runtime = createRuntime({ bundle: __BUNDLE_NAME__, version: __BUNDLE_VERSION__ });
runtime.run(modules);
