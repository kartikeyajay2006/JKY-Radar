import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { z } from 'zod';

/**
 * Loads the repository-root .env file when it exists. Variables already present in the
 * environment win, so CI and hosting platforms can override anything.
 * @returns {string | null} the loaded file path, or null when there is no .env
 */
export function loadDotEnv() {
  const file = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../.env');
  if (!existsSync(file)) return null;
  process.loadEnvFile(file);
  return file;
}

const bool = z.enum(['true', 'false']).transform((v) => v === 'true');

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  MONGODB_URI: z.string().min(1).default('mongodb://127.0.0.1:27017/jky_radar'),
  SESSION_SECRET: z
    .string()
    .min(32, 'SESSION_SECRET must be at least 32 characters')
    .default('dev-only-insecure-session-secret-change-me-please'),
  WEB_ORIGIN: z.string().default('http://localhost:5173'),
  API_ORIGIN: z.string().default('http://localhost:4000'),
  MAX_SPEC_BYTES: z.coerce
    .number()
    .int()
    .min(1024)
    .max(8 * 1024 * 1024)
    .default(2 * 1024 * 1024),
  ANALYSIS_TIMEOUT_MS: z.coerce.number().int().min(1000).max(120_000).default(20_000),
  ANALYSIS_ISOLATION: z.enum(['worker', 'inline']).default('worker'),
  ANALYSIS_CONCURRENCY: z.coerce.number().int().min(1).max(8).default(2),
  ENABLE_REMOTE_URL_IMPORT: bool.default('false'),
  DEMO_SEED_ENABLED: bool.default('true'),
  SERVE_WEB: bool.default('false'),
  TRUST_PROXY: z.coerce.number().int().min(0).max(5).default(0),
  SESSION_TTL_HOURS: z.coerce
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .default(24 * 7),
  RATE_LIMIT_ENABLED: bool.default('true'),
});

/** @typedef {z.infer<typeof schema>} Env */

/**
 * @param {NodeJS.ProcessEnv} [source]
 * @returns {Env}
 */
export function loadEnv(source = process.env) {
  const parsed = schema.safeParse(source);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid environment configuration: ${msg}`);
  }
  const env = parsed.data;
  if (env.NODE_ENV === 'production') {
    if (env.SESSION_SECRET.startsWith('dev-only'))
      throw new Error('SESSION_SECRET must be set in production.');
    if (env.ENABLE_REMOTE_URL_IMPORT)
      throw new Error('ENABLE_REMOTE_URL_IMPORT is not implemented and must stay false.');
  }
  return env;
}

/**
 * @param {Env} env
 * @returns {string[]}
 */
export const allowedOrigins = (env) => [
  ...new Set(
    env.WEB_ORIGIN.split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .concat(env.API_ORIGIN),
  ),
];
