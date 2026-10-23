import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express, { type RequestHandler } from 'express';
import helmet from 'helmet';
import cors from 'cors';
import compression from 'compression';
import cookieParser from 'cookie-parser';
import rateLimit from 'express-rate-limit';
import { allowedOrigins, type Env } from './config/env.js';
import { accessLog, errorHandler, notFoundHandler, requestId } from './middleware/core.js';
import { csrfProtection, loadSession } from './middleware/auth.js';
import { authRouter } from './modules/auth.js';
import { workspacesRouter } from './modules/workspaces.js';
import { projectsRouter } from './modules/projects.js';
import { analysesRouter } from './modules/analyses.js';
import { consumersRouter } from './modules/consumers.js';
import { notificationsRouter } from './modules/notifications.js';
import { metaRouter } from './modules/meta.js';
import { demoRouter } from './modules/demo.js';
import { AnalysisRunner } from './services/analysis-runner.js';

export interface AppDeps {
  env: Env;
  runner?: AnalysisRunner;
}

const limiter = (env: Env, windowMs: number, limit: number, key: 'ip' | 'user' = 'ip'): RequestHandler => {
  if (!env.RATE_LIMIT_ENABLED) return (_req, _res, next) => next();
  return rateLimit({
    windowMs,
    limit,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: key === 'user' ? (req) => req.auth?.userId?.toString() ?? req.ip ?? 'anon' : undefined,
    handler: (req, res) => {
      res
        .status(429)
        .json({
          error: {
            code: 'RATE_LIMITED',
            message: 'Too many requests. Please slow down and retry shortly.',
            requestId: req.requestId,
          },
        });
    },
  });
};

export function createApp({ env, runner = new AnalysisRunner(env) }: AppDeps) {
  const app = express();
  const origins = allowedOrigins(env);
  app.disable('x-powered-by');
  app.set('trust proxy', env.TRUST_PROXY);
  app.set('runner', runner);

  app.use(requestId);
  app.use(
    helmet({
      contentSecurityPolicy: {
        useDefaults: true,
        directives: {
          'default-src': ["'self'"],
          'script-src': ["'self'"],
          'style-src': ["'self'", "'unsafe-inline'"],
          'img-src': ["'self'", 'data:'],
          'font-src': ["'self'", 'data:'],
          'connect-src': ["'self'", ...origins],
          'frame-ancestors': ["'none'"],
          'object-src': ["'none'"],
          'base-uri': ["'self'"],
          'form-action': ["'self'"],
        },
      },
      crossOriginEmbedderPolicy: false,
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );
  app.use(
    cors({
      origin: (origin, cb) => cb(null, !origin || origins.includes(origin)),
      credentials: true,
      methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
      allowedHeaders: ['Content-Type', 'X-CSRF-Token', 'X-Request-Id'],
      maxAge: 600,
    }),
  );
  app.use(compression());
  app.use(cookieParser());
  // JSON bodies carry contract text; allow a little headroom above the spec limit for escaping.
  app.use(express.json({ limit: Math.ceil(env.MAX_SPEC_BYTES * 1.5) + 64 * 1024 }));
  app.use(accessLog);

  const api = express.Router();
  api.use((_req, res, next) => {
    res.setHeader('Cache-Control', 'no-store');
    next();
  });
  api.use(loadSession(env));
  api.use(csrfProtection(env, origins));
  api.use(limiter(env, 60_000, 600));

  api.use(metaRouter(env));
  api.use(demoRouter());
  api.use('/auth', authRouter(env, limiter(env, 15 * 60_000, 30)));
  api.use(workspacesRouter());
  api.use(
    projectsRouter(env, runner, {
      upload: limiter(env, 60_000, 30, 'user'),
      analysis: limiter(env, 60_000, 20, 'user'),
    }),
  );
  api.use(analysesRouter());
  api.use(consumersRouter());
  api.use(notificationsRouter());

  app.use('/api/v1', api);
  app.use('/api', notFoundHandler);

  // Optional same-origin deployment: serve the built web app from the API.
  if (env.SERVE_WEB) {
    const here = path.dirname(fileURLToPath(import.meta.url));
    const webDist = [path.resolve(here, '../../web/dist'), path.resolve(process.cwd(), 'apps/web/dist')].find(
      (p) => existsSync(path.join(p, 'index.html')),
    );
    if (webDist) {
      app.use(
        express.static(webDist, {
          index: false,
          maxAge: '1h',
          setHeaders: (res, file) =>
            file.includes('/assets/') &&
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable'),
        }),
      );
      app.get(/^(?!\/api\/).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
    }
  }

  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
