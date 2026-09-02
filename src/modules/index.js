/**
 * Every module that runs on the extranet.
 *
 * Order matters only within a run stage: the registry groups by `runAt` first, then
 * starts each group in this order. Two places where that is load-bearing:
 *   - `nav` before `nav/search`, because the search box mounts into the nav shadow host
 *   - `messages` before `dock`, because the dock drives it over the messages:open event
 */

// document-start: page hygiene and the network-facing work, before anything paints
import clean from './hygiene/clean/index.js';
import defaultSort from './tables/default-sort/index.js';
import tabTitle from './tab-title/index.js';
import perf from './perf/index.js';
import loader from './loader/index.js';
import nav from './nav/index.js';
import navSearch from './nav/search/index.js';

// later stages: chrome, panels and table tooling
import killCustomCss from './hygiene/kill-custom-css/index.js';
import messages from './messages/index.js';
import dock from './dock/index.js';
import infoPanels from './orders/info-panels/index.js';
import productsPanel from './orders/products-panel/index.js';
import timeline from './orders/timeline/index.js';
import review from './orders/review/index.js';
import trackingPanel from './orders/tracking-panel/index.js';
import links from './orders/links/index.js';
import contextMenu from './orders/context-menu/index.js';
import claims from './orders/claims/index.js';
import radialMenu from './orders/radial-menu/index.js';
import fab from './fab/index.js';
import filters from './tables/filters/index.js';
import bubbles from './tables/bubbles/index.js';
import copyButtons from './tables/copy-buttons/index.js';
import autoReview from './automation/auto-review/index.js';

export default [
  clean,
  defaultSort,
  tabTitle,
  perf,
  loader,
  nav,
  navSearch,
  killCustomCss,
  messages,
  dock,
  infoPanels,
  productsPanel,
  timeline,
  review,
  trackingPanel,
  links,
  contextMenu,
  claims,
  radialMenu,
  fab,
  filters,
  bubbles,
  copyButtons,
  autoReview,
];
