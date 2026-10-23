/** Minimal structured JSON logger with secret redaction. Never logs request bodies or contract content. */
const REDACT_KEYS = /pass(word)?|secret|token|authorization|cookie|session|content|raw/i;

function scrub(value: unknown, depth = 0): unknown {
  if (depth > 4 || value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 20).map((v) => scrub(v, depth + 1));
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([k, v]) => [
      k,
      REDACT_KEYS.test(k) ? '[REDACTED]' : scrub(v, depth + 1),
    ]),
  );
}

type Level = 'debug' | 'info' | 'warn' | 'error';
const LEVELS: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const min =
  LEVELS[(process.env.LOG_LEVEL as Level) ?? (process.env.NODE_ENV === 'test' ? 'warn' : 'info')] ?? 20;

function write(level: Level, msg: string, fields: Record<string, unknown> = {}) {
  if (LEVELS[level] < min) return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(scrub(fields) as object) });
  if (level === 'error' || level === 'warn') process.stderr.write(`${line}\n`);
  else process.stdout.write(`${line}\n`);
}

export const logger = {
  debug: (m: string, f?: Record<string, unknown>) => write('debug', m, f),
  info: (m: string, f?: Record<string, unknown>) => write('info', m, f),
  warn: (m: string, f?: Record<string, unknown>) => write('warn', m, f),
  error: (m: string, f?: Record<string, unknown>) => write('error', m, f),
};
