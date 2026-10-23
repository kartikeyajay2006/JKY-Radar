import { loadDotEnv, loadEnv } from './config/env.js';
import { connectDb, disconnectDb } from './db.js';
import { createApp } from './app.js';
import { ensureIndexes } from './models/index.js';
import { AnalysisRunner } from './services/analysis-runner.js';
import { seedDemo } from './services/demo-seed.js';
import { logger } from './lib/logger.js';

async function main() {
  loadDotEnv();
  const env = loadEnv();
  await connectDb(env.MONGODB_URI);
  await ensureIndexes();
  const runner = new AnalysisRunner(env);
  const app = createApp({ env, runner });
  const server = app.listen(env.PORT, () =>
    logger.info('JKY-Radar API listening', {
      port: env.PORT,
      env: env.NODE_ENV,
      isolation: env.ANALYSIS_ISOLATION,
    }),
  );
  await runner.resumePending();
  if (env.DEMO_SEED_ENABLED) {
    seedDemo(runner, env.MAX_SPEC_BYTES)
      .then((r) => logger.info('demo seed', r))
      .catch((e) => logger.error('demo seed failed', { err: /** @type {Error} */ (e).message }));
  }
  /** @param {string} signal */
  const shutdown = (signal) => {
    logger.info('shutting down', { signal });
    server.close(() => {
      void disconnectDb().finally(() => process.exit(0));
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((e) => {
  logger.error('fatal startup error', { err: /** @type {Error} */ (e).message });
  process.exit(1);
});
