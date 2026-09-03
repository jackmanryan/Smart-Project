/**
 * Persistent settings.
 *
 * Legacy keys are preserved exactly. `raw` reads and writes the key a legacy script used
 * (`ui:theme`, `scx.filters.v3`, …) so migrating a module does not orphan a user's saved
 * state; module-level switches live under the `sc.tools.` prefix.
 */

const SWITCH_PREFIX = 'sc.tools.';

export function createSettings(log) {
  function readRaw(key, fallback = null) {
    try {
      const value = localStorage.getItem(key);
      return value == null ? fallback : value;
    } catch {
      return fallback;
    }
  }

  function writeRaw(key, value) {
    try {
      localStorage.setItem(key, String(value));
      return true;
    } catch (err) {
      log.warn(`could not persist ${key}:`, err);
      return false;
    }
  }

  const api = {
    /** String-valued access to a legacy key, verbatim. */
    raw: {
      get: readRaw,
      set: writeRaw,
      remove(key) {
        try {
          localStorage.removeItem(key);
        } catch { /* storage disabled */ }
      },
    },

    /** JSON-valued access to a legacy key, verbatim. */
    json: {
      get(key, fallback = null) {
        const value = readRaw(key, null);
        if (value == null) return fallback;
        try {
          return JSON.parse(value);
        } catch {
          return fallback;
        }
      },
      set(key, value) {
        try {
          return writeRaw(key, JSON.stringify(value));
        } catch (err) {
          log.warn(`could not serialise ${key}:`, err);
          return false;
        }
      },
    },

    /** Is a module switched on? Defaults come from the module's enabledByDefault. */
    isEnabled(id, fallback = true) {
      const value = readRaw(SWITCH_PREFIX + id, null);
      if (value == null) return fallback;
      return value !== 'false' && value !== '0';
    },

    setEnabled(id, on) {
      writeRaw(SWITCH_PREFIX + id, on ? 'true' : 'false');
    },

    /** Every module switch currently stored, for the settings panel. */
    allSwitches() {
      const out = {};
      try {
        for (let i = 0; i < localStorage.length; i++) {
          const key = localStorage.key(i);
          if (key && key.startsWith(SWITCH_PREFIX)) out[key.slice(SWITCH_PREFIX.length)] = readRaw(key) !== 'false';
        }
      } catch { /* storage disabled */ }
      return out;
    },

    /**
     * Rename a stored key while keeping the user's value.
     * Runs once per key; the old key is removed only after the new one is written.
     */
    migrate(fromKey, toKey) {
      const existing = readRaw(toKey, null);
      if (existing != null) return false;
      const old = readRaw(fromKey, null);
      if (old == null) return false;
      if (writeRaw(toKey, old)) {
        api.raw.remove(fromKey);
        log.info(`migrated ${fromKey} -> ${toKey}`);
        return true;
      }
      return false;
    },

    /** Cross-tab values, backed by GM storage when granted and localStorage otherwise. */
    shared: {
      get(key, fallback = null) {
        if (typeof GM_getValue === 'function') {
          try {
            return GM_getValue(key, fallback);
          } catch { /* fall through */ }
        }
        return readRaw(key, fallback);
      },
      set(key, value) {
        if (typeof GM_setValue === 'function') {
          try {
            GM_setValue(key, value);
            return true;
          } catch { /* fall through */ }
        }
        return writeRaw(key, value);
      },
      onChange(key, cb) {
        if (typeof GM_addValueChangeListener === 'function') {
          try {
            const id = GM_addValueChangeListener(key, (name, oldValue, newValue, remote) =>
              cb(newValue, oldValue, remote),
            );
            return () => id;
          } catch { /* fall through */ }
        }
        const handler = (e) => {
          if (e.key === key) cb(e.newValue, e.oldValue, true);
        };
        window.addEventListener('storage', handler);
        return () => window.removeEventListener('storage', handler);
      },
    },
  };

  return api;
}
