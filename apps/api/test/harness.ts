import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import mongoose from 'mongoose';
import request from 'supertest';
import type { Express } from 'express';
import { loadEnv } from '../src/config/env.js';
import { createApp } from '../src/app.js';
import { ensureIndexes } from '../src/models/index.js';
import { AnalysisRunner } from '../src/services/analysis-runner.js';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
export const fx = (rel: string) => readFileSync(path.join(FIXTURES, rel), 'utf8');
export const WEB_ORIGIN = 'http://localhost:5173';

export async function bootTestApp(overrides: Record<string, string> = {}) {
  const base = process.env.MONGODB_URI_TEST ?? 'mongodb://127.0.0.1:27017';
  const dbName = `jky_radar_test_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const env = loadEnv({
    NODE_ENV: 'test',
    MONGODB_URI: `${base.replace(/\/$/, '')}/${dbName}`,
    SESSION_SECRET: 'test-secret-test-secret-test-secret-1234',
    WEB_ORIGIN,
    API_ORIGIN: 'http://localhost:4000',
    ANALYSIS_ISOLATION: 'inline',
    RATE_LIMIT_ENABLED: 'false',
    DEMO_SEED_ENABLED: 'false',
    MAX_SPEC_BYTES: String(256 * 1024),
    ...overrides,
  });
  await mongoose.connect(env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 });
  await ensureIndexes();
  const runner = new AnalysisRunner(env);
  const app = createApp({ env, runner });
  return {
    app,
    env,
    runner,
    async close() {
      await mongoose.connection.dropDatabase();
      await mongoose.disconnect();
    },
  };
}

/** Browser-like client: keeps cookies and sends the CSRF header on unsafe requests. */
export class Client {
  agent: ReturnType<typeof request.agent>;
  csrf = '';
  user: { id: string; email: string; name: string } | null = null;
  constructor(public app: Express) {
    this.agent = request.agent(app);
  }
  async init() {
    const r = await this.agent.get('/api/v1/auth/csrf');
    this.csrf = r.body.data.csrfToken;
    return this;
  }
  get(url: string) {
    return this.agent.get(url).set('Origin', WEB_ORIGIN);
  }
  send(method: 'post' | 'put' | 'patch' | 'delete', url: string, body?: unknown) {
    const req = this.agent[method](url).set('Origin', WEB_ORIGIN).set('x-csrf-token', this.csrf);
    return body === undefined ? req : req.send(body as object);
  }
  post(url: string, body?: unknown) {
    return this.send('post', url, body);
  }
  put(url: string, body?: unknown) {
    return this.send('put', url, body);
  }
  patch(url: string, body?: unknown) {
    return this.send('patch', url, body);
  }
  del(url: string) {
    return this.send('delete', url);
  }
  async register(email: string, name = email.split('@')[0]!) {
    await this.init();
    const r = await this.post('/api/v1/auth/register', { email, password: 'correct-horse-42', name });
    if (r.status !== 201) throw new Error(`register failed ${r.status} ${JSON.stringify(r.body)}`);
    this.csrf = r.body.data.csrfToken;
    this.user = r.body.data.user;
    return this;
  }
  async workspaceId(): Promise<string> {
    const r = await this.get('/api/v1/workspaces');
    return r.body.data[0].id;
  }
}

export async function waitForAnalysis(c: Client, id: string, prefix = '/api/v1/analyses') {
  for (let i = 0; i < 100; i++) {
    const r = await c.get(`${prefix}/${id}`);
    if (r.body.data?.state === 'completed' || r.body.data?.state === 'failed') return r.body.data;
    await new Promise((res) => setTimeout(res, 50));
  }
  throw new Error('analysis did not finish');
}
