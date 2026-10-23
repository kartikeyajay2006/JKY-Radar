import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootTestApp, Client, fx, waitForAnalysis } from '../../apps/api/test/harness.js';

describe('security: worker isolation, rate limits, XSS, IDOR on writes', () => {
  /** @type {Awaited<ReturnType<typeof bootTestApp>>} */
  let ctx;
  /** @type {Client} */
  let a;
  /** @type {Client} */
  let b;
  /** @type {string} */
  let projectId;
  /** @type {string} */
  let consumerId;
  /** @type {string} */
  let analysisId;

  beforeAll(async () => {
    ctx = await bootTestApp({
      ANALYSIS_ISOLATION: 'worker',
      RATE_LIMIT_ENABLED: 'true',
      ANALYSIS_TIMEOUT_MS: '15000',
    });
    a = await new Client(ctx.app).register('alice@example.com', 'Alice');
    b = await new Client(ctx.app).register('bob@example.com', 'Bob');
    const wid = await a.workspaceId();
    projectId = (
      await a.post(`/api/v1/workspaces/${wid}/projects`, {
        name: 'XSS <img src=x onerror=alert(1)>',
        protocol: 'openapi',
      })
    ).body.data.id;
    consumerId = (
      await a.post(`/api/v1/projects/${projectId}/consumers`, { name: 'Victim app', criticality: 'high' })
    ).body.data.id;
  });
  afterAll(async () => ctx.close());

  it('runs analyses in an isolated worker thread', async () => {
    const v1 = (
      await a.post(`/api/v1/projects/${projectId}/versions`, {
        label: 'v1',
        content: fx('adversarial/xss-description.yaml'),
      })
    ).body.data.id;
    const v2 = (
      await a.post(`/api/v1/projects/${projectId}/versions`, {
        label: 'v2',
        content: fx('adversarial/xss-description.yaml').replace(
          '<svg onload=alert(1)>',
          '<script>steal()</script>',
        ),
      })
    ).body.data.id;
    const r = await a.post(`/api/v1/projects/${projectId}/analyses`, { baselineId: v1, candidateId: v2 });
    analysisId = r.body.data.id;
    const done = await waitForAnalysis(a, analysisId);
    expect(done.error ?? null).toBeNull();
    expect(done.state).toBe('completed');
    expect(done.gate).toBe('pass');
  });

  it('XSS payloads stay inert: JSON-encoded and served as attachments with nosniff', async () => {
    const f = await a.get(`/api/v1/analyses/${analysisId}/findings`);
    expect(f.headers['content-type']).toMatch(/application\/json/);
    expect(JSON.stringify(f.body)).toContain('<script>steal()</script>');
    const md = await a.get(`/api/v1/analyses/${analysisId}/report?format=md`);
    expect(md.headers['content-disposition']).toMatch(/^attachment/);
    expect(md.headers['x-content-type-options']).toBe('nosniff');
  });

  it('blocks IDOR on every mutating consumer and project route', async () => {
    expect((await b.patch(`/api/v1/consumers/${consumerId}`, { name: 'owned' })).status).toBe(404);
    expect((await b.del(`/api/v1/consumers/${consumerId}`)).status).toBe(404);
    expect(
      (await b.post(`/api/v1/consumers/${consumerId}/dependencies`, { operationKey: 'GET /x' })).status,
    ).toBe(404);
    expect((await b.patch(`/api/v1/projects/${projectId}`, { name: 'owned' })).status).toBe(404);
    expect(
      (await b.post(`/api/v1/analyses/${analysisId}/reviews`, { decision: 'reject', rationale: 'sabotage' }))
        .status,
    ).toBe(404);
    expect((await b.get('/api/v1/projects/not-an-id')).status).toBe(404);
  });

  it('rejects operator-injection style payloads through validation', async () => {
    const r = await b.post('/api/v1/auth/login', { email: { $ne: null }, password: { $ne: null } });
    expect([401, 422]).toContain(r.status);
    expect(r.status).toBe(422);
  });

  it('rate-limits authentication attempts', async () => {
    const c = await new Client(ctx.app).init();
    let limited = false;
    for (let i = 0; i < 40 && !limited; i++) {
      const r = await c.post('/api/v1/auth/login', {
        email: 'alice@example.com',
        password: `wrong-password-${i}`,
      });
      if (r.status === 429) limited = true;
    }
    expect(limited).toBe(true);
  });

  it('private API responses are never cacheable; only the public demo is', async () => {
    const priv = await a.get(`/api/v1/analyses/${analysisId}`);
    expect(priv.headers['cache-control']).toBe('no-store');
    const me = await a.get('/api/v1/auth/session');
    expect(me.headers['cache-control']).toBe('no-store');
    const demo = await request(ctx.app).get('/api/v1/demo/analyses');
    expect(demo.headers['cache-control']).toMatch(/public/);
  });

  it('unknown API routes return a JSON 404 envelope', async () => {
    const r = await request(ctx.app).get('/api/v1/nope');
    expect(r.status).toBe(404);
    expect(r.body.error.code).toBe('NOT_FOUND');
    expect(r.body.error.requestId).toBeTruthy();
  });
});
