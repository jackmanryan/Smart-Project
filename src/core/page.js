/**
 * One place that decides which extranet page we are on.
 *
 * The legacy scripts each re-derived this, and three of them carried a second @match
 * for the double-slash form (extranet.strip-curtains.com//?p=orders-view). Normalising
 * the path here means a module only ever declares the page names it wants.
 */

const EXTRANET_HOST = 'extranet.strip-curtains.com';

export function createPage() {
  const params = new URLSearchParams(location.search);

  const api = {
    host: location.hostname,
    isExtranet: location.hostname === EXTRANET_HOST,
    isGmail: location.hostname === 'mail.google.com',

    /** The ?p= value for the current page, lowercased, or '' on the dashboard. */
    get id() {
      return (new URLSearchParams(location.search).get('p') || '').toLowerCase();
    },

    /** The ?view= / ?review= record id, when the page has one. */
    get recordId() {
      const q = new URLSearchParams(location.search);
      return q.get('view') || q.get('review') || '';
    },

    param: (key) => new URLSearchParams(location.search).get(key),

    /** True when the current page id is any of the names given. */
    is(...names) {
      const here = api.id;
      return names.flat().some((n) => String(n).toLowerCase() === here);
    },

    /** Pages every bundle stays away from, matching the legacy @exclude lists. */
    get isExcluded() {
      return api.is('quotes_editor') || /\/quotepayment/i.test(location.pathname);
    },

    /**
     * Does a module's `pages` declaration match here?
     * An empty or missing list means "every page in the bundle's scope".
     */
    matches(pages) {
      if (!pages || !pages.length) return true;
      return api.is(pages);
    },

    /** Absolute URL for an extranet page, e.g. url('orders-view', {view: 123}). */
    url(pageId, query = {}) {
      const q = new URLSearchParams({ p: pageId, ...query });
      return `${location.origin}/?${q}`;
    },
  };

  // Kept for modules that want the value captured at load time.
  api.initialId = (params.get('p') || '').toLowerCase();
  return api;
}
