/**
 * Theme state, in one place.
 *
 * Four legacy scripts each decided light or dark for themselves. The stored key stays
 * `ui:theme` so an existing preference carries over, and the attribute is written before
 * first paint to keep the flash the old ExtraNav prologue was avoiding.
 */

const KEY = 'ui:theme';

export function createTheme(settings) {
  const subs = new Set();

  function stored() {
    const value = settings.raw.get(KEY, null);
    return value === 'dark' || value === 'light' ? value : null;
  }

  function systemPrefersDark() {
    try {
      return matchMedia('(prefers-color-scheme: dark)').matches;
    } catch {
      return false;
    }
  }

  function current() {
    return stored() || (systemPrefersDark() ? 'dark' : 'light');
  }

  function apply(mode) {
    const root = document.documentElement;
    if (!root) return;
    root.setAttribute('data-theme', mode);
  }

  const api = {
    key: KEY,
    current,
    isDark: () => current() === 'dark',

    /** Write the attribute from whatever is stored. Called before first paint. */
    applyStored() {
      const value = stored();
      if (value) apply(value);
    },

    set(mode) {
      const next = mode === 'dark' ? 'dark' : 'light';
      settings.raw.set(KEY, next);
      apply(next);
      for (const cb of subs) {
        try {
          cb(next);
        } catch { /* a listener must not break the toggle */ }
      }
      return next;
    },

    toggle: () => api.set(current() === 'dark' ? 'light' : 'dark'),

    onChange(cb) {
      subs.add(cb);
      return () => subs.delete(cb);
    },
  };

  return api;
}
