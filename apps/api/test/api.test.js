import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { SpecVersion, AuditEvent, FindingModel } from '../src/models/index.js';
import { seedDemo } from '../src/services/demo-seed.js';
import { bootTestApp, Client, fx, waitForAnalysis, WEB_ORIGIN } from './harness.js';

/** @type {Awaited<ReturnType<typeof bootTestApp>>} */
let ctx;
/** @type {Client} */
let owner;
/** @type {string} */
let wid;
/** @type {string} */
let projectId;
/** @type {string} */
let v1;
/** @type {string} */
let v2;
/** @type {string} */
let analysisId;

beforeAll(async () => {
  ctx = await bootTestApp();
  owner = await new Client(ctx.app).register('owner@example.com', 'Olivia Owner');
  wid = await owner.workspaceId();
});
afterAll(async () => ctx.close());

describe('public endpoints', () => {
  it('health reports db status without secrets', async () => {
    const r = await request(ctx.app).get('/api/v1/health');
    expect(r.status).toBe(200);
    expect(r.body.data).toMatchObject({ status: 'ok', db: 'up' });
    expect(JSON.stringify(r.body)).not.toMatch(/mongodb:\/\//);
  });
  it('capabilities expose honest support statuses and rule counts', async () => {
    const r = await request(ctx.app).get('/api/v1/capabilities');
    const adapters =
      /** @type {Array<{ id: string; status: string; rules: { registered: number; tested: number }; }>} */ (
        r.body.data.adapters
      );
    expect(adapters.find((a) => a.id === 'postman-3').status).toBe('unsupported');
    expect(adapters.find((a) => a.id === 'asyncapi').status).toBe('experimental');
    expect(adapters.find((a) => a.id === 'openapi-3.1').rules.tested).toBeGreaterThan(50);
    expect(r.body.data.remoteUrlImport).toBe(false);
  });
  it('sets security headers', async () => {
    const r = await request(ctx.app).get('/api/v1/health');
    expect(r.headers['x-content-type-options']).toBe('nosniff');
    expect(r.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(r.headers['x-powered-by']).toBeUndefined();
    expect(r.headers['x-request-id']).toBeTruthy();
  });
});

describe('authentication', () => {
  it('rejects state-changing requests without a CSRF token', async () => {
    const r = await request(ctx.app)
      .post('/api/v1/auth/register')
      .send({ email: 'x@example.com', password: 'correct-horse-42', name: 'X' });
    expect(r.status).toBe(403);
    expect(r.body.error.code).toBe('CSRF_FAILED');
  });
  it('rejects cross-origin state-changing requests', async () => {
    const c = await new Client(ctx.app).init();
    const r = await c.agent
      .post('/api/v1/auth/login')
      .set('Origin', 'https://evil.example')
      .set('x-csrf-token', c.csrf)
      .send({ email: 'owner@example.com', password: 'x' });
    expect(r.status).toBe(403);
  });
  it('issues HttpOnly SameSite session cookies and never returns password hashes', async () => {
    const c = await new Client(ctx.app).init();
    const r = await c.post('/api/v1/auth/register', {
      email: 'cookie@example.com',
      password: 'correct-horse-42',
      name: 'Cookie',
    });
    expect(r.status).toBe(201);
    const cookies = /** @type {string[]} */ ([]).concat(r.headers['set-cookie'] ?? []);
    const sid = cookies.find((x) => x.startsWith('jky_sid='));
    expect(sid).toMatch(/HttpOnly/i);
    expect(sid).toMatch(/SameSite=Lax/i);
    expect(JSON.stringify(r.body)).not.toMatch(/passwordHash|argon2/);
  });
  it('validates input and rejects duplicate accounts', async () => {
    const c = await new Client(ctx.app).init();
    expect(
      (await c.post('/api/v1/auth/register', { email: 'weak@example.com', password: 'short', name: 'W' }))
        .status,
    ).toBe(422);
    expect(
      (
        await c.post('/api/v1/auth/register', {
          email: 'owner@example.com',
          password: 'correct-horse-42',
          name: 'O',
        })
      ).status,
    ).toBe(409);
  });
  it('login rotates the session and wrong passwords fail uniformly', async () => {
    const c = await new Client(ctx.app).init();
    expect(
      (await c.post('/api/v1/auth/login', { email: 'owner@example.com', password: 'wrong-password-1' }))
        .status,
    ).toBe(401);
    expect(
      (await c.post('/api/v1/auth/login', { email: 'nobody@example.com', password: 'wrong-password-1' })).body
        .error.message,
    ).toBe('Email or password is incorrect.');
    const ok = await c.post('/api/v1/auth/login', {
      email: 'owner@example.com',
      password: 'correct-horse-42',
    });
    expect(ok.status).toBe(200);
    c.csrf = ok.body.data.csrfToken;
    expect((await c.get('/api/v1/auth/me')).status).toBe(200);
    expect((await c.post('/api/v1/auth/logout')).status).toBe(204);
    expect((await c.get('/api/v1/auth/me')).status).toBe(401);
  });
  it('requires authentication for workspace data', async () => {
    expect((await request(ctx.app).get('/api/v1/workspaces')).status).toBe(401);
  });
});

describe('projects and immutable versions', () => {
  it('creates a project with a default release policy', async () => {
    const r = await owner.post(`/api/v1/workspaces/${wid}/projects`, {
      name: 'ShopWave API',
      protocol: 'openapi',
      description: 'Commerce',
    });
    expect(r.status).toBe(201);
    projectId = r.body.data.id;
    const p = await owner.get(`/api/v1/projects/${projectId}/policy`);
    expect(p.body.data.current.revision).toBe(1);
    expect(p.body.data.current.actions.breaking).toBe('block');
  });
  it('uploads a baseline as JSON and a candidate as multipart with content hashes', async () => {
    const a = await owner.post(`/api/v1/projects/${projectId}/versions`, {
      label: 'v1.4.0',
      content: fx('openapi/breaking/ecommerce-v1.yaml'),
      fileName: 'ecommerce-v1.yaml',
    });
    expect(a.status).toBe(201);
    expect(a.body.data.rawHash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.body.data.protocol).toBe('openapi');
    v1 = a.body.data.id;
    const b = await owner.agent
      .post(`/api/v1/projects/${projectId}/versions`)
      .set('Origin', WEB_ORIGIN)
      .set('x-csrf-token', owner.csrf)
      .field('label', 'v2.0.0')
      .attach('file', Buffer.from(fx('openapi/breaking/ecommerce-v2.yaml')), 'ecommerce-v2.yaml');
    expect(b.status).toBe(201);
    expect(b.body.data.fileName).toBe('ecommerce-v2.yaml');
    v2 = b.body.data.id;
  });
  it('rejects duplicate content, invalid contracts, wrong protocols, traversal names and oversized uploads', async () => {
    const dup = await owner.post(`/api/v1/projects/${projectId}/versions`, {
      label: 'again',
      content: fx('openapi/breaking/ecommerce-v1.yaml'),
    });
    expect(dup.status).toBe(409);
    expect(dup.body.error.details.existingVersionId).toBe(v1);
    const bad = await owner.post(`/api/v1/projects/${projectId}/versions`, {
      label: 'bad',
      content: fx('adversarial/malformed.yaml'),
    });
    expect(bad.status).toBe(422);
    expect(bad.body.error.details.diagnostics[0].source.line).toBeGreaterThan(0);
    const gql = await owner.post(`/api/v1/projects/${projectId}/versions`, {
      label: 'gql',
      content: fx('graphql/bookstore-v1.graphql'),
      fileName: 'b.graphql',
    });
    expect(gql.status).toBe(422);
    expect(gql.body.error.code).toBe('PROTOCOL_MISMATCH');
    const trav = await owner.agent
      .post(`/api/v1/projects/${projectId}/versions`)
      .set('Origin', WEB_ORIGIN)
      .set('x-csrf-token', owner.csrf)
      .field('label', 'x')
      .attach('file', Buffer.from('{}'), { filename: 'evil.sh' });
    expect(trav.status).toBe(415);
    const big = await owner.post(`/api/v1/projects/${projectId}/versions`, {
      label: 'big',
      content: `{"openapi":"3.1.0","x":"${'a'.repeat(300 * 1024)}"}`,
    });
    expect(big.status).toBe(413);
  });
  it.each(['# API contract\n', '---\n'])(
    'redacts secrets before storing YAML prefixed with %j',
    async (prefix) => {
      const project = await owner.post(`/api/v1/workspaces/${wid}/projects`, {
        name: `Redaction ${prefix.trim()}`,
        protocol: 'openapi',
      });
      const result = await owner.post(`/api/v1/projects/${project.body.data.id}/versions`, {
        label: 'v1',
        content: `${prefix}openapi: 3.0.3\ninfo: { title: Example, version: 1.0.0 }\npaths: {}\nx-example:\n  password: example-secret-123\n`,
      });
      expect(result.status).toBe(201);
      expect(result.body.data.redactions).toHaveLength(1);
      const stored = await owner.get(`/api/v1/versions/${result.body.data.id}/content`);
      expect(stored.status).toBe(200);
      expect(stored.body.data.content).not.toContain('example-secret-123');
      expect(stored.body.data.content).toContain('[REDACTED]');
    },
  );
  it('stored versions are immutable', async () => {
    await expect(SpecVersion.updateOne({ _id: v1 }, { $set: { label: 'hacked' } })).rejects.toThrow(
      /immutable/,
    );
  });
  it('never fetches remote $refs during upload', async () => {
    const spy = vi.spyOn(globalThis, 'fetch');
    const p = await owner.post(`/api/v1/workspaces/${wid}/projects`, {
      name: 'Remote ref project',
      protocol: 'openapi',
    });
    const r = await owner.post(`/api/v1/projects/${p.body.data.id}/versions`, {
      label: 'v1',
      content: fx('adversarial/remote-ref.yaml'),
    });
    expect(r.status).toBe(201);
    expect(r.body.data.diagnostics.map(/** @param {{ code: string }} d */ (d) => d.code)).toContain(
      'REF_REMOTE_NOT_FETCHED',
    );
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
  it('redacts secrets from stored Postman collections', async () => {
    const p = await owner.post(`/api/v1/workspaces/${wid}/projects`, {
      name: 'Payments collection',
      protocol: 'postman2',
    });
    const r = await owner.post(`/api/v1/projects/${p.body.data.id}/versions`, {
      label: 'v1',
      content: fx('adversarial/postman-secrets.postman_collection.json'),
    });
    expect(r.status).toBe(201);
    expect(r.body.data.redactions.length).toBeGreaterThanOrEqual(3);
    const c = await owner.get(`/api/v1/versions/${r.body.data.id}/content`);
    expect(c.body.data.content).not.toMatch(/sk_live_|ghp_|eyJhbGci/);
    expect(c.body.data.content).toContain('{{token}}');
  });
});

describe('analysis lifecycle', () => {
  it('runs a real analysis asynchronously and blocks the release', async () => {
    const r = await owner.post(`/api/v1/projects/${projectId}/analyses`, { baselineId: v1, candidateId: v2 });
    expect(r.status).toBe(202);
    analysisId = r.body.data.id;
    const done = await waitForAnalysis(owner, analysisId);
    expect(done.state).toBe('completed');
    expect(done.gate).toBe('block');
    expect(done.counts.breaking).toBeGreaterThanOrEqual(5);
    expect(done.versions.engine).toBeTruthy();
    expect(done.baselineVersion.rawHash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('returns the cached analysis for identical inputs (idempotent)', async () => {
    const r = await owner.post(`/api/v1/projects/${projectId}/analyses`, { baselineId: v1, candidateId: v2 });
    expect(r.status).toBe(200);
    expect(r.body.data.id).toBe(analysisId);
    expect(r.body.data.cached).toBe(true);
  });
  it('records declared operation renames in the audit log', async () => {
    const r = await owner.post(`/api/v1/projects/${projectId}/analyses`, {
      baselineId: v1,
      candidateId: v2,
      options: { operationAliases: { 'GET /orders/{orderId}': 'GET /orders' } },
    });
    expect(r.status).toBe(202);
    await waitForAnalysis(owner, r.body.data.id);
    const audit = await owner.get(`/api/v1/workspaces/${wid}/audit?pageSize=100`);
    const ev = audit.body.data.find(
      /** @param {{ action: string; resourceId: string }} e */ (e) =>
        e.action === 'analysis.requested' && e.resourceId === r.body.data.id,
    );
    expect(ev.metadata.operationAliases).toEqual({ 'GET /orders/{orderId}': 'GET /orders' });
  });
  it('paginates, filters and searches findings', async () => {
    const all = await owner.get(`/api/v1/analyses/${analysisId}/findings?pageSize=5`);
    expect(all.body.data).toHaveLength(5);
    expect(all.body.meta.total).toBeGreaterThan(5);
    expect(all.body.meta.facets.severity.breaking).toBeGreaterThan(0);
    const breaking = await owner.get(
      `/api/v1/analyses/${analysisId}/findings?severity=breaking&pageSize=100`,
    );
    expect(
      breaking.body.data.every(/** @param {{ severity: string }} f */ (f) => f.severity === 'breaking'),
    ).toBe(true);
    const search = await owner.get(`/api/v1/analyses/${analysisId}/findings?search=currency`);
    expect(search.body.data[0].ruleId).toBe('REQ_PROPERTY_REQUIRED_ADDED');
    const rule = await owner.get(`/api/v1/analyses/${analysisId}/findings?ruleId=HTTP_OPERATION_REMOVED`);
    expect(rule.body.data).toHaveLength(1);
    expect(rule.body.data[0].baselineSource.line).toBeGreaterThan(0);
  });
  it('findings are persisted immutably', async () => {
    const f = await FindingModel.findOne({ analysisId });
    await expect(
      FindingModel.updateOne({ _id: f._id }, { $set: { severity: 'informational' } }),
    ).rejects.toThrow(/immutable/);
  });
  it('serves both sources for the compare panel', async () => {
    const r = await owner.get(`/api/v1/analyses/${analysisId}/sources`);
    expect(r.body.data.baseline.content).toContain('ShopWave');
    expect(r.body.data.candidate.label).toBe('v2.0.0');
  });
});

describe('consumers and impact', () => {
  it('maps registered dependencies to changed operations', async () => {
    const c = await owner.post(`/api/v1/projects/${projectId}/consumers`, {
      name: 'iOS app',
      owner: 'Mobile team',
      criticality: 'critical',
    });
    expect(c.status).toBe(201);
    const d = await owner.post(`/api/v1/consumers/${c.body.data.id}/dependencies`, {
      operationKey: 'get /orders/{id}',
    });
    expect(d.status).toBe(201);
    expect(d.body.data.consumer.dependencies[0].normalizedKey).toBe('GET /orders/{}');
    expect(
      (
        await owner.post(`/api/v1/consumers/${c.body.data.id}/dependencies`, {
          operationKey: 'GET /orders/{orderId}',
        })
      ).status,
    ).toBe(409);
    const impact = await owner.get(`/api/v1/analyses/${analysisId}/impact`);
    const ios = impact.body.data.consumers.find(
      /** @param {{ name: string }} x */ (x) => x.name === 'iOS app',
    );
    expect(ios.known.map(/** @param {{ ruleId: string }} k */ (k) => k.ruleId)).toContain(
      'HTTP_OPERATION_REMOVED',
    );
    expect(impact.body.data.disclaimer).toMatch(/Unregistered clients/);
  });
  it('exposes the entity catalog from the latest version', async () => {
    const r = await owner.get(`/api/v1/projects/${projectId}/entities`);
    expect(r.body.data.map(/** @param {{ key: string }} e */ (e) => e.key)).toContain('POST /payments');
  });
});

describe('reports', () => {
  it('exports JSON, Markdown and a valid PDF', async () => {
    const j = await owner.get(`/api/v1/analyses/${analysisId}/report?format=json`);
    expect(j.status).toBe(200);
    expect(j.headers['content-disposition']).toMatch(
      /attachment; filename="jky-radar_shopwave-api_.+\.json"/,
    );
    const body = JSON.parse(j.text);
    expect(body.reportSchemaVersion).toBe('1.0');
    expect(body.gate.decision).toBe('block');
    const md = await owner.get(`/api/v1/analyses/${analysisId}/report?format=md`);
    expect(md.headers['content-type']).toMatch(/text\/markdown/);
    expect(md.text).toContain('Release gate: BLOCK');
    expect(md.text).toContain('HTTP_OPERATION_REMOVED');
    const pdf = await owner
      .get(`/api/v1/analyses/${analysisId}/report?format=pdf`)
      .buffer(true)
      .parse((res, cb) => {
        /** @type {Buffer[]} */
        const chunks = [];
        res.on('data', /** @param {Buffer} c */ (c) => chunks.push(c));
        res.on('end', () => cb(null, Buffer.concat(chunks)));
      });
    expect(pdf.headers['content-type']).toBe('application/pdf');
    const buf = /** @type {Buffer} */ (pdf.body);
    expect(buf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(buf.length).toBeGreaterThan(3000);
  });
});

describe('roles, reviews and tenant isolation', () => {
  /** @type {Client} */
  let reviewer;
  /** @type {Client} */
  let viewer;
  /** @type {Client} */
  let outsider;
  beforeAll(async () => {
    reviewer = await new Client(ctx.app).register('reviewer@example.com', 'Rita Reviewer');
    viewer = await new Client(ctx.app).register('viewer@example.com', 'Victor Viewer');
    outsider = await new Client(ctx.app).register('outsider@example.com', 'Oscar Outsider');
    for (const [c, role] of /** @type {const} */ ([
      [reviewer, 'REVIEWER'],
      [viewer, 'VIEWER'],
    ])) {
      const inv = await owner.post(`/api/v1/workspaces/${wid}/invitations`, { email: c.user.email, role });
      expect(inv.status).toBe(201);
      const list = await c.get('/api/v1/invitations');
      expect((await c.post(`/api/v1/invitations/${list.body.data[0].id}/accept`)).status).toBe(200);
    }
  });

  it('outsiders cannot read or modify another workspace (IDOR → 404)', async () => {
    for (const url of [
      `/api/v1/projects/${projectId}`,
      `/api/v1/analyses/${analysisId}`,
      `/api/v1/analyses/${analysisId}/findings`,
      `/api/v1/analyses/${analysisId}/sources`,
      `/api/v1/analyses/${analysisId}/report?format=json`,
      `/api/v1/versions/${v1}/content`,
      `/api/v1/workspaces/${wid}/projects`,
      `/api/v1/workspaces/${wid}/audit`,
    ]) {
      expect((await outsider.get(url)).status, url).toBe(404);
    }
    expect(
      (
        await outsider.post(`/api/v1/projects/${projectId}/versions`, {
          label: 'x',
          content: fx('openapi/safe/inventory-v1.json'),
        })
      ).status,
    ).toBe(404);
    expect(
      (await outsider.post(`/api/v1/projects/${projectId}/analyses`, { baselineId: v1, candidateId: v2 }))
        .status,
    ).toBe(404);
  });
  it('viewers can read but not write (vertical escalation → 403)', async () => {
    expect((await viewer.get(`/api/v1/analyses/${analysisId}`)).status).toBe(200);
    expect(
      (
        await viewer.post(`/api/v1/projects/${projectId}/versions`, {
          label: 'x',
          content: fx('openapi/safe/inventory-v1.json'),
        })
      ).status,
    ).toBe(403);
    expect(
      (
        await viewer.post(`/api/v1/analyses/${analysisId}/reviews`, {
          decision: 'approve',
          rationale: 'looks fine',
        })
      ).status,
    ).toBe(403);
    expect((await viewer.get(`/api/v1/workspaces/${wid}/audit`)).status).toBe(403);
    const members = await owner.get(`/api/v1/workspaces/${wid}/members`);
    const viewerMember = members.body.data.find(
      /** @param {{ email: string }} m */ (m) => m.email === 'viewer@example.com',
    );
    expect(
      (await viewer.patch(`/api/v1/workspaces/${wid}/members/${viewerMember.id}`, { role: 'ADMIN' })).status,
    ).toBe(403);
  });
  it('only owners can remove another admin, while admins can leave themselves', async () => {
    const first = await new Client(ctx.app).register('first-admin@example.com', 'First Admin');
    const second = await new Client(ctx.app).register('second-admin@example.com', 'Second Admin');
    for (const client of [first, second]) {
      expect(
        (
          await owner.post(`/api/v1/workspaces/${wid}/invitations`, {
            email: client.user.email,
            role: 'ADMIN',
          })
        ).status,
      ).toBe(201);
      const invites = await client.get('/api/v1/invitations');
      expect((await client.post(`/api/v1/invitations/${invites.body.data[0].id}/accept`)).status).toBe(200);
    }
    const members = (await owner.get(`/api/v1/workspaces/${wid}/members`)).body.data;
    const firstMember = members.find((m) => m.userId === first.user.id);
    const secondMember = members.find((m) => m.userId === second.user.id);
    const ownerMember = members.find((m) => m.userId === owner.user.id);
    const url = (id) => `/api/v1/workspaces/${wid}/members/${id}`;
    expect((await first.del(url(secondMember.id))).status).toBe(403);
    expect((await first.del(url(ownerMember.id))).status).toBe(403);
    expect((await viewer.del(url(secondMember.id))).status).toBe(403);
    expect((await second.get(`/api/v1/workspaces/${wid}`)).status).toBe(200);
    expect((await owner.del(url(secondMember.id))).status).toBe(204);
    expect((await second.get(`/api/v1/workspaces/${wid}`)).status).toBe(404);
    expect((await first.del(url(firstMember.id))).status).toBe(204);
  });
  it('maintainers cannot change the release policy', async () => {
    const members = await owner.get(`/api/v1/workspaces/${wid}/members`);
    const rev = members.body.data.find(
      /** @param {{ email: string }} m */ (m) => m.email === 'reviewer@example.com',
    );
    const policy = (await owner.get(`/api/v1/projects/${projectId}/policy`)).body.data.current;
    const body = {
      name: policy.name,
      actions: policy.actions,
      onCoverageGap: policy.onCoverageGap,
      onPartialCoverage: policy.onPartialCoverage,
      ruleOverrides: [],
      requireReview: true,
      forbidSelfApproval: true,
      minApprovals: 1,
      protectedEnvironments: ['production'],
    };
    expect((await reviewer.put(`/api/v1/projects/${projectId}/policy`, body)).status).toBe(403);
    expect(rev.role).toBe('REVIEWER');
  });
  it('forbids self-approval and requires an explicit override to approve a blocked gate', async () => {
    const self = await owner.post(`/api/v1/analyses/${analysisId}/reviews`, {
      decision: 'approve',
      rationale: 'ship it',
      overrideBlock: false,
    });
    expect(self.status).toBe(403);
    const noOverride = await reviewer.post(`/api/v1/analyses/${analysisId}/reviews`, {
      decision: 'approve',
      rationale: 'ship it',
    });
    expect(noOverride.status).toBe(409);
    const shortRationale = await reviewer.post(`/api/v1/analyses/${analysisId}/reviews`, {
      decision: 'approve',
      rationale: 'ok',
      overrideBlock: true,
    });
    expect(shortRationale.status).toBe(422);
    const ok = await reviewer.post(`/api/v1/analyses/${analysisId}/reviews`, {
      decision: 'approve',
      rationale:
        'Approved with override: all registered clients migrated off GET /orders/{orderId} last sprint.',
      overrideBlock: true,
    });
    expect(ok.status).toBe(201);
    expect(ok.body.data.reviewStatus).toBe('approved');
    const a = await owner.get(`/api/v1/analyses/${analysisId}`);
    expect(a.body.data.gate).toBe('block');
    expect(a.body.data.reviewStatus).toBe('approved');
  });
  it('records an append-only audit trail and notifications', async () => {
    const audit = await owner.get(`/api/v1/workspaces/${wid}/audit?pageSize=100`);
    const actions = audit.body.data.map(/** @param {{ action: string }} e */ (e) => e.action);
    expect(actions).toEqual(
      expect.arrayContaining([
        'project.created',
        'version.uploaded',
        'analysis.completed',
        'gate.override_approved',
        'member.invited',
        'dependency.added',
      ]),
    );
    await expect(AuditEvent.updateOne({}, { $set: { action: 'tamper' } })).rejects.toThrow(/immutable/);
    const n = await owner.get('/api/v1/notifications');
    expect(n.body.data.some(/** @param {{ kind: string }} x */ (x) => x.kind === 'review.decision')).toBe(
      true,
    );
    const id = n.body.data[0].id;
    expect((await owner.patch(`/api/v1/notifications/${id}/read`)).status).toBe(200);
    expect((await outsider.patch(`/api/v1/notifications/${id}/read`)).status).toBe(404);
  });
  it('policy revisions are versioned and change the analysis input hash', async () => {
    const policy = (await owner.get(`/api/v1/projects/${projectId}/policy`)).body.data.current;
    const put = await owner.put(`/api/v1/projects/${projectId}/policy`, {
      name: 'Strict with exceptions',
      actions: policy.actions,
      onCoverageGap: 'inconclusive',
      onPartialCoverage: 'warn',
      ruleOverrides: [
        {
          ruleId: 'HTTP_OPERATION_REMOVED',
          severity: 'potentially_breaking',
          justification: 'Deprecated for 2 releases; no registered dependents.',
        },
        {
          ruleId: 'RES_PROPERTY_REMOVED',
          severity: 'potentially_breaking',
          justification: 'email moved to /customers/{id}/contact.',
        },
        {
          ruleId: 'REQ_PROPERTY_REQUIRED_ADDED',
          severity: 'potentially_breaking',
          justification: 'All SDKs send currency since 1.3.',
        },
        {
          ruleId: 'REQ_ENUM_VALUE_REMOVED',
          severity: 'potentially_breaking',
          justification: 'bank_transfer volume is zero.',
        },
        {
          ruleId: 'HTTP_SECURITY_SCOPES_ADDED',
          severity: 'potentially_breaking',
          justification: 'Scope granted to all clients on 1 May.',
        },
      ],
      requireReview: true,
      forbidSelfApproval: true,
      minApprovals: 1,
      protectedEnvironments: ['production'],
    });
    expect(put.status).toBe(201);
    expect(put.body.data.revision).toBe(2);
    const rerun = await owner.post(`/api/v1/projects/${projectId}/analyses`, {
      baselineId: v1,
      candidateId: v2,
    });
    expect(rerun.status).toBe(202);
    const done = await waitForAnalysis(owner, rerun.body.data.id);
    expect(done.gate).toBe('warn');
    expect(done.counts.breaking).toBeGreaterThan(0);
    const old = await owner.get(`/api/v1/analyses/${analysisId}`);
    expect(old.body.data.gate).toBe('block');
  });
  it('workspace overview analytics come from persisted data', async () => {
    const r = await owner.get(`/api/v1/workspaces/${wid}/overview`);
    expect(r.body.data.counts.analyses).toBeGreaterThanOrEqual(2);
    expect(r.body.data.gateTotals.block).toBeGreaterThanOrEqual(1);
    expect(r.body.data.topEntities.length).toBeGreaterThan(0);
    expect(r.body.data.timeline).toHaveLength(14);
  });
});

describe('public demo', () => {
  it('seeds genuinely executed read-only demo analyses idempotently', async () => {
    const first = await seedDemo(ctx.runner, ctx.env.MAX_SPEC_BYTES);
    expect(first.status).toBe('seeded');
    const second = await seedDemo(ctx.runner, ctx.env.MAX_SPEC_BYTES);
    expect(second.status).toBe('up-to-date');
    const list = await request(ctx.app).get('/api/v1/demo/analyses');
    expect(list.status).toBe(200);
    expect(list.body.data.length).toBe(first.analyses);
    const ecommerce = list.body.data.find(
      /** @param {{ projectName: string }} a */ (a) => /ShopWave/.test(a.projectName),
    );
    expect(ecommerce.gate).toBe('block');
    const detail = await request(ctx.app).get(`/api/v1/demo/analyses/${ecommerce.id}/impact`);
    expect(detail.body.data.knownImpactedCount).toBeGreaterThan(0);
    const pdf = await request(ctx.app).get(`/api/v1/demo/analyses/${ecommerce.id}/report?format=md`);
    expect(pdf.status).toBe(200);
  });
  it('private analyses are not reachable through demo routes', async () => {
    expect((await request(ctx.app).get(`/api/v1/demo/analyses/${analysisId}`)).status).toBe(404);
  });
  it('demo system user cannot log in', async () => {
    const c = await new Client(ctx.app).init();
    expect(
      (await c.post('/api/v1/auth/login', { email: 'demo-bot@jky-radar.invalid', password: 'anything-123' }))
        .status,
    ).toBe(401);
  });
});
