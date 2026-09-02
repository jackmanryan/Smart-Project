/**
 * The Gmail bridge bundle.
 *
 * Two modules only. The 2FA relay ships here rather than with the extranet bundle
 * because its two halves share one script identity, and therefore one GM storage
 * area — that shared area is the channel they talk over.
 */

import gmailLinks from './gmail-links/index.js';
import twofa from './twofa/index.js';

export default [gmailLinks, twofa];
