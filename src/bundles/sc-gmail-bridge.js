/**
 * The Gmail half of the toolkit, plus the extranet page that talks to it.
 *
 * This stays a separate installed script for two reasons: the 2FA relay uses
 * per-script GM storage as its cross-tab channel, so both ends must share one
 * script identity; and Gmail should never load the extranet bundle.
 */

import { createRuntime } from '../core/index.js';
import modules from '../modules/gmail.js';

const runtime = createRuntime({ bundle: __BUNDLE_NAME__, version: __BUNDLE_VERSION__ });
runtime.run(modules);
