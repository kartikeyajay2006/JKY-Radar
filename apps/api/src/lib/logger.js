/** Minimal structured JSON logger with secret redaction. Never logs request bodies or contract content. */
const REDACT_KEYS = /pass(word)?|secret|token|authorization|cookie|session|content|raw/i;

/**
 * @param {unknown} value
 * @returns {unknown}
 */
function scrub(value, depth = 0) {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(/** @type {Record<string, unknown>} */ (value)).map(([k, v]) => [
      k,
      REDACT_KEYS.test(k) ? '[REDACTED]' : scrub(v, depth + 1),
    ]),
  );
}

/** @typedef {'debug' | 'info' | 'warn' | 'error'} Level */
/** @type {Record<Level, number>} */
const LEVELS = { debug: 10, info: 20, warn: 30, error: 40 };
const min =
  LEVELS[
    /** @type {Level} */ (process.env.LOG_LEVEL) ?? (process.env.NODE_ENV === 'test' ? 'warn' : 'info')
  ] ?? 20;

/**
 * @param {Level} level
 * @param {string} msg
 * @param {Record<string, unknown>} [fields]
 */
function write(level, msg, fields = {}) {
  if (LEVELS[level] < min) return;
  const line = JSON.stringify({
    t: new Date().toISOString(),
    level,
    msg,
    .../** @type {object} */ (scrub(fields)),
  });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  /**
   * @param {string} m
   * @param {Record<string, unknown>} [f]
   */
  debug: (m, f) => write('debug', m, f),
  /**
   * @param {string} m
   * @param {Record<string, unknown>} [f]
   */
  info: (m, f) => write('info', m, f),
  /**
   * @param {string} m
   * @param {Record<string, unknown>} [f]
   */
  warn: (m, f) => write('warn', m, f),
  /**
   * @param {string} m
   * @param {Record<string, unknown>} [f]
   */
  error: (m, f) => write('error', m, f),
};
