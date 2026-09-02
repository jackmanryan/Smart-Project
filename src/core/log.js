/** Console logging that always says which module spoke, plus the shared error boundary. */

const PREFIX = '[SC]';

export function createLogger(scope) {
  const tag = scope ? `${PREFIX}[${scope}]` : PREFIX;
  return {
    debug: (...a) => console.debug(tag, ...a),
    info: (...a) => console.info(tag, ...a),
    warn: (...a) => console.warn(tag, ...a),
    error: (...a) => console.error(tag, ...a),
    /** Run fn, log and swallow anything it throws. Returns fallback on failure. */
    guard(fn, fallback = undefined) {
      try {
        const out = fn();
        if (out && typeof out.catch === 'function') {
          return out.catch((err) => {
            console.error(tag, 'async failure:', err);
            return fallback;
          });
        }
        return out;
      } catch (err) {
        console.error(tag, 'failure:', err);
        return fallback;
      }
    },
  };
}
