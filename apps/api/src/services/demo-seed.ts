import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  canonicalJson,
  ENGINE_VERSION,
  RULE_REGISTRY_VERSION,
  normalizeDependencyKey,
  type AnalysisOptions,
} from '@jky/radar-core';
import { ADAPTER_VERSION } from '@jky/radar-adapters';
import {
  Analysis,
  AuditEvent,
  Consumer,
  ConsumerDependency,
  FindingModel,
  Membership,
  Policy,
  Project,
  Review,
  SpecFile,
  SpecVersion,
  User,
  Workspace,
} from '../models/index.js';
import { randomToken, sha256 } from '../lib/crypto.js';
import { logger } from '../lib/logger.js';
import { createVersion } from './versions.js';
import { ensurePolicy, releasePolicyVersion, toReleasePolicy } from './policies.js';
import type { AnalysisRunner } from './analysis-runner.js';

export const DEMO_WORKSPACE_SLUG = 'jky-radar-public-demo';
const DEMO_EMAIL = 'demo-bot@jky-radar.invalid';

interface ManifestEntry {
  id: string;
  name: string;
  protocol: string;
  baseline: string;
  candidate: string;
  options?: AnalysisOptions;
  demo?: boolean;
  baselineLabel?: string;
  candidateLabel?: string;
}

/** Synthetic consumers for the public demo. These are illustrative registrations, not discovered usage. */
const DEMO_CONSUMERS: Record<
  string,
  Array<{
    name: string;
    owner: string;
    team: string;
    criticality: 'low' | 'medium' | 'high' | 'critical';
    description: string;
    deps: string[];
  }>
> = {
  'openapi-ecommerce': [
    {
      name: 'ShopWave iOS app',
      owner: 'Priya N.',
      team: 'Mobile',
      criticality: 'critical',
      description: 'Customer shopping app (synthetic).',
      deps: ['GET /orders/{orderId}', 'POST /payments', 'GET /orders'],
    },
    {
      name: 'Warehouse picker',
      owner: 'Luis M.',
      team: 'Fulfilment',
      criticality: 'high',
      description: 'Handheld picking app (synthetic).',
      deps: ['GET /orders', 'POST /orders'],
    },
    {
      name: 'CRM sync job',
      owner: 'Ana K.',
      team: 'Marketing',
      criticality: 'medium',
      description: 'Nightly customer sync (synthetic).',
      deps: ['GET /customers/{customerId}'],
    },
    {
      name: 'Finance reconciliation',
      owner: 'Tom B.',
      team: 'Finance',
      criticality: 'high',
      description: 'Payment ledger reconciliation (synthetic).',
      deps: ['POST /payments'],
    },
  ],
  'graphql-bookstore': [
    {
      name: 'Storefront web',
      owner: 'Mei L.',
      team: 'Web',
      criticality: 'critical',
      description: 'Bookstore website (synthetic).',
      deps: ['Query.books', 'Book.isbn', 'Book.title'],
    },
    {
      name: 'E-reader sync',
      owner: 'Omar S.',
      team: 'Devices',
      criticality: 'medium',
      description: 'Syncs library to devices (synthetic).',
      deps: ['BookFormat', 'Query.book'],
    },
  ],
  'postman-payments': [
    {
      name: 'Partner checkout SDK',
      owner: 'Ivy R.',
      team: 'Partners',
      criticality: 'high',
      description: 'Partner-facing SDK (synthetic).',
      deps: ['POST /payments', 'GET /payments/{paymentId}/refunds'],
    },
  ],
  'protobuf-orders': [
    {
      name: 'Order events bridge',
      owner: 'Ken T.',
      team: 'Platform',
      criticality: 'high',
      description: 'Streams order updates (synthetic).',
      deps: ['shopwave.orders.v1.OrderService/WatchOrder', 'shopwave.orders.v1.OrderService/CancelOrder'],
    },
  ],
};

const DEMO_REVIEWS: Record<string, { decision: 'request_changes' | 'comment'; rationale: string }> = {
  'openapi-ecommerce': {
    decision: 'request_changes',
    rationale:
      'Blocked: keep GET /orders/{orderId} deprecated for one release and make currency optional with a default before shipping v2.',
  },
  'openapi-uncertain': {
    decision: 'comment',
    rationale:
      'Inconclusive because Pet.oneOf gained a Bird branch. Confirm that the iOS client ignores unknown pet kinds.',
  },
};

export function findFixturesDir(): string | null {
  const candidates = [
    process.env.FIXTURES_DIR,
    path.resolve(process.cwd(), 'fixtures'),
    path.resolve(process.cwd(), '../../fixtures'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../../fixtures'),
    path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures'),
  ].filter((x): x is string => !!x);
  return candidates.find((d) => existsSync(path.join(d, 'manifest.json'))) ?? null;
}

export async function seedDemo(
  runner: AnalysisRunner,
  maxBytes: number,
): Promise<{ status: 'seeded' | 'up-to-date' | 'skipped'; analyses: number }> {
  const dir = findFixturesDir();
  if (!dir) {
    logger.warn('demo seed skipped: fixtures directory not found');
    return { status: 'skipped', analyses: 0 };
  }
  const manifest = (
    JSON.parse(readFileSync(path.join(dir, 'manifest.json'), 'utf8')) as ManifestEntry[]
  ).filter((m) => m.demo);
  const files = manifest
    .flatMap((m) => [m.baseline, m.candidate])
    .map((f) => readFileSync(path.join(dir, f), 'utf8'));
  const seedVersion = sha256(
    canonicalJson({
      manifest,
      files,
      ENGINE_VERSION,
      RULE_REGISTRY_VERSION,
      ADAPTER_VERSION,
      consumers: DEMO_CONSUMERS,
    }),
  );

  const existing = await Workspace.findOne({ slug: DEMO_WORKSPACE_SLUG });
  if (existing && (existing.settings as { seedVersion?: string })?.seedVersion === seedVersion) {
    const n = await Analysis.countDocuments({
      workspaceId: existing._id,
      isPublicDemo: true,
      state: 'completed',
    });
    if (n === manifest.length) return { status: 'up-to-date', analyses: n };
  }
  if (existing) {
    const wid = existing._id;
    // Demo data is synthetic and owned by the system user; it is safe to rebuild.
    await Promise.all([
      FindingModel.deleteMany({ workspaceId: wid }),
      Analysis.deleteMany({ workspaceId: wid }),
      Review.collection.deleteMany({ workspaceId: wid }),
      SpecVersion.collection.deleteMany({ workspaceId: wid }),
      SpecFile.collection.deleteMany({ workspaceId: wid }),
      Policy.collection.deleteMany({ workspaceId: wid }),
      ConsumerDependency.deleteMany({ workspaceId: wid }),
      Consumer.deleteMany({ workspaceId: wid }),
      Project.deleteMany({ workspaceId: wid }),
      AuditEvent.collection.deleteMany({ workspaceId: wid }),
    ]);
  }

  let bot = await User.findOne({ email: DEMO_EMAIL });
  if (!bot)
    bot = await User.create({
      email: DEMO_EMAIL,
      name: 'JKY-Radar Demo',
      passwordHash: `!disabled!${randomToken(24)}`,
      isSystem: true,
    });
  let ws = existing;
  if (!ws)
    ws = await Workspace.create({
      name: 'JKY-Radar public demo',
      slug: DEMO_WORKSPACE_SLUG,
      ownerId: bot._id,
      isDemo: true,
      settings: {},
    });
  await Membership.updateOne(
    { workspaceId: ws._id, userId: bot._id },
    { $setOnInsert: { role: 'OWNER', status: 'active' } },
    { upsert: true },
  );

  const ids: string[] = [];
  for (const m of manifest) {
    const project = await Project.create({
      workspaceId: ws._id,
      name: m.name,
      slug: m.id,
      description: `Synthetic ${m.protocol} demo contract pair (${m.baseline.split('/').pop()} → ${m.candidate.split('/').pop()}).`,
      protocol: m.protocol,
      visibility: 'public_demo',
      createdBy: bot._id,
    });
    const policy = await ensurePolicy(ws._id, project._id, bot._id);
    const labelOf = (f: string) => (f.match(/v(\d+)/)?.[0] ?? path.basename(f)).replace(/^v/, 'v');
    const read = (f: string) => readFileSync(path.join(dir, f), 'utf8');
    const bv = await createVersion(
      project,
      bot._id,
      {
        label: m.baselineLabel ?? labelOf(m.baseline),
        content: read(m.baseline),
        fileName: path.basename(m.baseline),
      },
      maxBytes,
    );
    const cv = await createVersion(
      project,
      bot._id,
      {
        label: m.candidateLabel ?? labelOf(m.candidate),
        content: read(m.candidate),
        fileName: path.basename(m.candidate),
      },
      maxBytes,
    );
    const options = { includeInformational: true, ...(m.options ?? {}) };
    const inputHash = sha256(
      canonicalJson({
        b: bv.rawHash,
        c: cv.rawHash,
        engine: ENGINE_VERSION,
        rules: RULE_REGISTRY_VERSION,
        adapter: ADAPTER_VERSION,
        policy: releasePolicyVersion(policy),
        options,
      }),
    );
    const analysis = await Analysis.create({
      workspaceId: ws._id,
      projectId: project._id,
      baselineId: bv._id,
      candidateId: cv._id,
      protocol: cv.protocol,
      inputHash,
      options,
      policyId: policy._id,
      policyRevision: policy.revision,
      policyName: policy.name,
      policySnapshot: toReleasePolicy(policy),
      createdBy: bot._id,
      isPublicDemo: true,
      timings: { queuedAt: new Date() },
    });
    for (const c of DEMO_CONSUMERS[m.id] ?? []) {
      const consumer = await Consumer.create({
        workspaceId: ws._id,
        projectId: project._id,
        name: c.name,
        owner: c.owner,
        team: c.team,
        criticality: c.criticality,
        description: c.description,
        createdBy: bot._id,
      });
      await ConsumerDependency.insertMany(
        c.deps.map((k) => ({
          workspaceId: ws._id,
          projectId: project._id,
          consumerId: consumer._id,
          operationKey: k,
          normalizedKey: normalizeDependencyKey(k),
          evidenceSource: 'documentation',
        })),
      );
    }
    const wait = runner.waitFor(analysis._id.toString());
    runner.enqueue(analysis._id.toString());
    await wait;
    const done = await Analysis.findById(analysis._id).lean();
    if (done?.state !== 'completed')
      throw new Error(`Demo analysis ${m.id} did not complete: ${JSON.stringify(done?.error)}`);
    const review = DEMO_REVIEWS[m.id];
    if (review) {
      await Review.create({
        workspaceId: ws._id,
        projectId: project._id,
        analysisId: analysis._id,
        reviewerId: bot._id,
        decision: review.decision,
        rationale: review.rationale,
      });
      if (review.decision === 'request_changes')
        await Analysis.updateOne({ _id: analysis._id }, { $set: { reviewStatus: 'changes_requested' } });
    }
    ids.push(analysis._id.toString());
  }
  await Workspace.updateOne({ _id: ws._id }, { $set: { settings: { seedVersion } } });
  logger.info('demo workspace seeded', { analyses: ids.length });
  return { status: 'seeded', analyses: ids.length };
}
