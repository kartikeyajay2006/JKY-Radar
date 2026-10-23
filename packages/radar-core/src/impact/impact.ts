import type { Finding, FindingSeverity } from '../domain/types.js';

export type Criticality = 'low' | 'medium' | 'high' | 'critical';

export interface ConsumerInput {
  id: string;
  name: string;
  owner?: string;
  team?: string;
  criticality: Criticality;
  dependencies: Array<{ operationKey: string; id?: string }>;
}

export interface ImpactedConsumer {
  consumerId: string;
  name: string;
  owner?: string;
  team?: string;
  criticality: Criticality;
  /** Findings that hit an operation/entity this consumer explicitly registered. */
  known: Array<{
    fingerprint: string;
    ruleId: string;
    severity: FindingSeverity;
    entityKey: string;
    dependency: string;
  }>;
  /** Findings with contract-wide scope or a parent/child relation to a registered dependency. */
  potential: Array<{
    fingerprint: string;
    ruleId: string;
    severity: FindingSeverity;
    entityKey?: string;
    reason: string;
  }>;
  worstSeverity: FindingSeverity | null;
}

export interface ImpactReport {
  consumers: ImpactedConsumer[];
  knownImpactedCount: number;
  potentiallyImpactedCount: number;
  /** Risky findings that no registered consumer depends on. They can still affect unregistered clients. */
  unmatchedRiskyFindings: Array<{
    fingerprint: string;
    ruleId: string;
    severity: FindingSeverity;
    entityKey?: string;
    logicalPath: string;
  }>;
  disclaimer: string;
}

const RISKY: ReadonlySet<FindingSeverity> = new Set(['breaking', 'potentially_breaking', 'needs_review']);
const RANK: Record<FindingSeverity, number> = {
  breaking: 0,
  potentially_breaking: 1,
  needs_review: 2,
  non_breaking: 3,
  informational: 4,
};

/** Normalise dependency keys so "get /orders/{orderId}" matches finding key "GET /orders/{}". */
export function normalizeDependencyKey(raw: string): string {
  const t = raw.trim();
  const m = /^(get|put|post|delete|patch|head|options|trace|query)\s+(\S+)$/i.exec(t);
  if (m) {
    let path = m[2]!;
    if (!path.startsWith('/')) path = `/${path}`;
    path = path.replace(/\/+/g, '/');
    if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
    path = path.replace(/\{[^}]*\}/g, '{}').replace(/:([A-Za-z_]\w*)/g, '{}');
    return `${m[1]!.toUpperCase()} ${path}`;
  }
  return t;
}

function related(dep: string, entity: string): boolean {
  // GraphQL "Book" vs "Book.isbn", gRPC "pkg.Svc" vs "pkg.Svc/Method", Async "channel:x" vs "channel:x/op"
  return (
    entity.startsWith(`${dep}.`) ||
    entity.startsWith(`${dep}/`) ||
    dep.startsWith(`${entity}.`) ||
    dep.startsWith(`${entity}/`)
  );
}

export function computeImpact(findings: Finding[], consumers: ConsumerInput[]): ImpactReport {
  const risky = findings.filter((f) => RISKY.has(f.severity));
  const matchedFingerprints = new Set<string>();
  const out: ImpactedConsumer[] = [];

  for (const c of consumers) {
    const deps = c.dependencies.map((d) => ({
      raw: d.operationKey,
      key: normalizeDependencyKey(d.operationKey),
    }));
    const ic: ImpactedConsumer = {
      consumerId: c.id,
      name: c.name,
      criticality: c.criticality,
      known: [],
      potential: [],
      worstSeverity: null,
    };
    if (c.owner) ic.owner = c.owner;
    if (c.team) ic.team = c.team;
    for (const f of risky) {
      if (f.entityKey) {
        const exact = deps.find((d) => d.key === f.entityKey);
        if (exact) {
          ic.known.push({
            fingerprint: f.fingerprint,
            ruleId: f.ruleId,
            severity: f.severity,
            entityKey: f.entityKey,
            dependency: exact.raw,
          });
          matchedFingerprints.add(f.fingerprint);
          continue;
        }
        const rel = deps.find((d) => related(d.key, f.entityKey!));
        if (rel) {
          const p: ImpactedConsumer['potential'][number] = {
            fingerprint: f.fingerprint,
            ruleId: f.ruleId,
            severity: f.severity,
            entityKey: f.entityKey,
            reason: `Related to registered dependency "${rel.raw}".`,
          };
          ic.potential.push(p);
          matchedFingerprints.add(f.fingerprint);
        }
      } else if (deps.length > 0) {
        ic.potential.push({
          fingerprint: f.fingerprint,
          ruleId: f.ruleId,
          severity: f.severity,
          reason:
            'Contract-wide change (servers, security schemes, package) affects every consumer of this API.',
        });
      }
    }
    const all = [...ic.known, ...ic.potential];
    ic.worstSeverity = all.length
      ? all.reduce((w, x) => (RANK[x.severity] < RANK[w] ? x.severity : w), all[0]!.severity)
      : null;
    out.push(ic);
  }

  out.sort(
    (a, b) =>
      (a.worstSeverity === null ? 9 : RANK[a.worstSeverity]) -
        (b.worstSeverity === null ? 9 : RANK[b.worstSeverity]) ||
      b.known.length - a.known.length ||
      a.name.localeCompare(b.name),
  );

  return {
    consumers: out,
    knownImpactedCount: out.filter((c) => c.known.length > 0).length,
    potentiallyImpactedCount: out.filter((c) => c.known.length === 0 && c.potential.length > 0).length,
    unmatchedRiskyFindings: risky
      .filter((f) => !matchedFingerprints.has(f.fingerprint))
      .map((f) => {
        const r: ImpactReport['unmatchedRiskyFindings'][number] = {
          fingerprint: f.fingerprint,
          ruleId: f.ruleId,
          severity: f.severity,
          logicalPath: f.logicalPath,
        };
        if (f.entityKey) r.entityKey = f.entityKey;
        return r;
      }),
    disclaimer:
      'Impact is computed only from consumers and dependencies registered in JKY-Radar. Unregistered clients may also be affected; a change with no registered dependents is not harmless.',
  };
}
