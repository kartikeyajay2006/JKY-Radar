import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { ApiToken, AuditEvent } from '../src/models/index.js';
import { bootTestApp, Client, fx } from './harness.js';

/** @type {Awaited<ReturnType<typeof bootTestApp>>} */
let ctx;
/** @type {Client} */
let owner;
/** @type {string} */
let wid;
/** @type {string} */
let projectId;
/** @type {string} */
let secret;
/** @type {string} */
let tokenId;

/**
 * @param {string} token
 * @param {unknown} body
 */
const check = (token, body) =>
  request(ctx.app)
    .post('/api/v1/ci/check')
    .set('Authorization', `Bearer ${token}`)
    .send(/** @type {object} */ (body));

/**
 * @param {Client} admin
 * @param {Client} member
 * @param {string} role
 */
async function invite(admin, member, role) {
  expect(
    (await admin.post(`/api/v1/workspaces/${wid}/invitations`, { email: member.user.email, role })).status,
  ).toBe(201);
  const list = await member.get('/api/v1/invitations');
  expect((await member.post(`/api/v1/invitations/${list.body.data[0].id}/accept`)).status).toBe(200);
}

beforeAll(async () => {
  ctx = await bootTestApp();
  owner = await new Client(ctx.app).register('ci-owner@example.com', 'Cora Owner');
  wid = await owner.workspaceId();
  const p = await owner.post(`/api/v1/workspaces/${wid}/projects`, {
    name: 'Commerce API',
    protocol: 'openapi',
  });
  projectId = p.body.data.id;
});
afterAll(async () => ctx.close());

describe('CI token management', () => {
  it('creates a token, returns the secret once and stores only its hash', async () => {
    const r = await owner.post(`/api/v1/projects/${projectId}/tokens`, {
      name: 'GitHub Actions',
      expiresInDays: 30,
    });
    expect(r.status).toBe(201);
    secret = r.body.data.secret;
    tokenId = r.body.data.token.id;
    expect(secret).toMatch(/^jkyr_[A-Za-z0-9_-]{40,}$/);
    expect(r.body.data.token).toMatchObject({ name: 'GitHub Actions', status: 'active', lastUsedAt: null });
    expect(secret.startsWith(r.body.data.token.prefix)).toBe(true);

    const stored = await ApiToken.findById(tokenId).lean();
    expect(JSON.stringify(stored)).not.toContain(secret);

    const list = await owner.get(`/api/v1/projects/${projectId}/tokens`);
    expect(list.body.data).toHaveLength(1);
    expect(JSON.stringify(list.body)).not.toContain(secret);
    expect(JSON.stringify(list.body)).not.toMatch(/tokenHash/);
  });

  it('is limited to admins', async () => {
    const maintainer = await new Client(ctx.app).register('ci-maint@example.com', 'Max Maintainer');
    await invite(owner, maintainer, 'MAINTAINER');
    expect((await maintainer.get(`/api/v1/projects/${projectId}/tokens`)).status).toBe(403);
    expect((await maintainer.post(`/api/v1/projects/${projectId}/tokens`, { name: 'x' })).status).toBe(403);
    const outsider = await new Client(ctx.app).register('ci-out@example.com', 'Otto Outsider');
    expect((await outsider.get(`/api/v1/projects/${projectId}/tokens`)).status).toBe(404);
  });

  it('validates input', async () => {
    expect((await owner.post(`/api/v1/projects/${projectId}/tokens`, { name: '' })).status).toBe(422);
    expect(
      (await owner.post(`/api/v1/projects/${projectId}/tokens`, { name: 'x', expiresInDays: 9999 })).status,
    ).toBe(422);
  });
});

describe('POST /ci/check', () => {
  it('rejects missing, malformed and unknown tokens with one generic error', async () => {
    const none = await request(ctx.app).post('/api/v1/ci/check').send({});
    expect(none.status).toBe(401);
    expect(none.body.error.code).toBe('INVALID_TOKEN');
    expect((await check('not-a-token', {})).status).toBe(401);
    const unknown = await check(`jkyr_${'a'.repeat(43)}`, {});
    expect(unknown.status).toBe(401);
    expect(unknown.body.error.message).toBe(none.body.error.message);
  });

  it('explains when there is nothing to compare with yet', async () => {
    const r = await check(secret, {
      candidate: { label: 'v1.4.0', content: fx('openapi/breaking/ecommerce-v1.yaml'), fileName: 'v1.yaml' },
    });
    expect(r.status).toBe(422);
    expect(r.body.error.code).toBe('NO_BASELINE');
  });

  it('uploads the candidate, compares it with the previous version and returns the gate', async () => {
    const r = await check(secret, {
      candidate: { label: 'v2.0.0', content: fx('openapi/breaking/ecommerce-v2.yaml'), fileName: 'v2.yaml' },
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({
      state: 'completed',
      gate: { decision: 'block' },
      baseline: { label: 'v1.4.0' },
      candidate: { label: 'v2.0.0', uploaded: true },
      cached: false,
      coverage: 'full',
    });
    expect(r.body.data.counts.breaking).toBeGreaterThan(0);
    expect(r.body.data.url).toMatch(/\/app\/analyses\/[a-f0-9]{24}$/);

    // The analysis is visible in the web app like any other, attributed to the token's creator.
    const a = await owner.get(`/api/v1/analyses/${r.body.data.analysisId}`);
    expect(a.status).toBe(200);
    expect(a.body.data.gate).toBe('block');

    const events = await AuditEvent.find({ action: 'analysis.requested', 'metadata.via': 'ci' }).lean();
    expect(events).toHaveLength(1);
    expect(String(events[0].metadata.ciCredential)).toContain('GitHub Actions');
    expect(JSON.stringify(events)).not.toContain(secret);

    const listed = await owner.get(`/api/v1/projects/${projectId}/tokens`);
    expect(listed.body.data[0].lastUsedAt).not.toBeNull();
  });

  it('reuses the stored version and analysis when a pipeline re-runs on identical content', async () => {
    const r = await check(secret, {
      candidate: { label: 'v2.0.0-rerun', content: fx('openapi/breaking/ecommerce-v2.yaml') },
      baseline: 'v1.4.0',
    });
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ cached: true, candidate: { label: 'v2.0.0', uploaded: false } });
  });

  it('can poll an analysis of its own project only', async () => {
    const first = await check(secret, {
      candidate: { label: 'v2.0.0', content: fx('openapi/breaking/ecommerce-v2.yaml') },
      baseline: 'v1.4.0',
    });
    const id = first.body.data.analysisId;
    const poll = await request(ctx.app)
      .get(`/api/v1/ci/analyses/${id}`)
      .set('Authorization', `Bearer ${secret}`);
    expect(poll.status).toBe(200);
    expect(poll.body.data.gate.decision).toBe('block');

    const other = await owner.post(`/api/v1/workspaces/${wid}/projects`, {
      name: 'Other API',
      protocol: 'openapi',
    });
    const t = await owner.post(`/api/v1/projects/${other.body.data.id}/tokens`, { name: 'other' });
    const foreign = await request(ctx.app)
      .get(`/api/v1/ci/analyses/${id}`)
      .set('Authorization', `Bearer ${t.body.data.secret}`);
    expect(foreign.status).toBe(404);
  });

  it('reports a named baseline that does not exist and rejects unknown fields', async () => {
    const missing = await check(secret, {
      candidate: { label: 'v3', content: fx('openapi/breaking/ecommerce-v2.yaml') },
      baseline: 'v0.0.1',
    });
    expect(missing.status).toBe(404);
    const extra = await check(secret, {
      candidate: { label: 'v3', content: fx('openapi/breaking/ecommerce-v2.yaml') },
      projectId: 'something-else',
    });
    expect(extra.status).toBe(422);
  });

  it('ignores session cookies and needs no CSRF token', async () => {
    // A signed-in browser session alone cannot reach the CI routes.
    const r = await owner.agent.post('/api/v1/ci/check').send({});
    expect(r.status).toBe(401);
  });

  it('stops working when the token is revoked', async () => {
    const rev = await owner.del(`/api/v1/projects/${projectId}/tokens/${tokenId}`);
    expect(rev.status).toBe(200);
    expect(rev.body.data.status).toBe('revoked');
    const r = await check(secret, {
      candidate: { label: 'v9', content: fx('openapi/breaking/ecommerce-v2.yaml') },
    });
    expect(r.status).toBe(401);
  });

  it('stops working when it expires', async () => {
    const t = await owner.post(`/api/v1/projects/${projectId}/tokens`, { name: 'short-lived' });
    await ApiToken.updateOne(
      { _id: t.body.data.token.id },
      { $set: { expiresAt: new Date(Date.now() - 1000) } },
    );
    const r = await check(t.body.data.secret, {
      candidate: { label: 'v9', content: fx('openapi/breaking/ecommerce-v2.yaml') },
    });
    expect(r.status).toBe(401);
    const list = await owner.get(`/api/v1/projects/${projectId}/tokens`);
    expect(list.body.data.find((x) => x.id === t.body.data.token.id).status).toBe('expired');
  });

  it('stops working when its creator loses access to the workspace', async () => {
    const admin = await new Client(ctx.app).register('ci-admin@example.com', 'Ada Admin');
    await invite(owner, admin, 'ADMIN');
    const t = await admin.post(`/api/v1/projects/${projectId}/tokens`, { name: 'admin pipeline' });
    expect(t.status).toBe(201);
    const members = (await owner.get(`/api/v1/workspaces/${wid}/members`)).body.data;
    const m = members.find((x) => x.userId === admin.user.id);
    expect((await owner.del(`/api/v1/workspaces/${wid}/members/${m.id}`)).status).toBe(204);
    const r = await check(t.body.data.secret, {
      candidate: { label: 'v9', content: fx('openapi/breaking/ecommerce-v2.yaml') },
    });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('TOKEN_OWNER_LACKS_ACCESS');
  });
});
