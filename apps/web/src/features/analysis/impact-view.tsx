import { useMemo } from 'react';
import { Link } from 'react-router';
import { Users } from 'lucide-react';
import type { ImpactDTO } from '@jky/shared';
import type { FindingSeverity } from '@jky/radar-core';
import { SEVERITY_LABEL, SEVERITY_RANK } from '@jky/radar-core';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { SeverityBadge, SeverityIcon } from '@/components/radar/badges';
import { useImpact, type AnalysisScope } from '@/lib/queries';
import { cn } from '@/lib/cn';

const STROKE: Record<FindingSeverity, string> = {
  breaking: 'var(--breaking)',
  potentially_breaking: 'var(--potential)',
  needs_review: 'var(--review)',
  non_breaking: 'var(--safe)',
  informational: 'var(--info)',
};

/** Consumers (left) → changed entities (right). Only registered dependencies and matched findings are drawn. */
function DependencyGraph({ impact }: { impact: ImpactDTO }) {
  const { nodesL, nodesR, edges } = useMemo(() => {
    const consumers = impact.consumers.filter((c) => c.known.length || c.potential.some((p) => p.entityKey));
    const entities = new Map<string, FindingSeverity>();
    const e: Array<{ c: string; ent: string; sev: FindingSeverity; known: boolean }> = [];
    for (const c of consumers) {
      for (const k of c.known) {
        e.push({ c: c.consumerId, ent: k.entityKey, sev: k.severity, known: true });
        const cur = entities.get(k.entityKey);
        if (!cur || SEVERITY_RANK[k.severity] < SEVERITY_RANK[cur]) entities.set(k.entityKey, k.severity);
      }
      for (const p of c.potential) {
        if (!p.entityKey) continue;
        e.push({ c: c.consumerId, ent: p.entityKey, sev: p.severity, known: false });
        if (!entities.has(p.entityKey)) entities.set(p.entityKey, p.severity);
      }
    }
    const uniq = new Map<string, (typeof e)[number]>();
    for (const x of e) {
      const k = `${x.c}|${x.ent}`;
      const prev = uniq.get(k);
      if (!prev || SEVERITY_RANK[x.sev] < SEVERITY_RANK[prev.sev]) uniq.set(k, x);
    }
    return {
      nodesL: consumers,
      nodesR: [...entities.entries()].sort((a, b) => SEVERITY_RANK[a[1]] - SEVERITY_RANK[b[1]]).slice(0, 14),
      edges: [...uniq.values()],
    };
  }, [impact]);
  if (nodesL.length === 0) return null;
  const rowH = 38;
  const h = Math.max(nodesL.length, nodesR.length) * rowH + 16;
  const yL = (i: number) => 8 + i * rowH + rowH / 2 + (Math.max(0, nodesR.length - nodesL.length) * rowH) / 2;
  const yR = (i: number) => 8 + i * rowH + rowH / 2 + (Math.max(0, nodesL.length - nodesR.length) * rowH) / 2;
  return (
    <figure className="panel overflow-x-auto p-4">
      <svg
        viewBox={`0 0 760 ${h}`}
        className="min-w-[640px]"
        role="img"
        aria-label="Dependency graph between registered consumers and changed operations"
      >
        {edges.map((e, i) => {
          const li = nodesL.findIndex((n) => n.consumerId === e.c);
          const ri = nodesR.findIndex(([k]) => k === e.ent);
          if (li < 0 || ri < 0) return null;
          const y1 = yL(li);
          const y2 = yR(ri);
          return (
            <path
              key={i}
              d={`M 230 ${y1} C 380 ${y1}, 380 ${y2}, 470 ${y2}`}
              fill="none"
              stroke={STROKE[e.sev]}
              strokeWidth={e.known ? 2 : 1.25}
              strokeDasharray={e.known ? undefined : '4 4'}
              strokeOpacity={0.8}
            />
          );
        })}
        {nodesL.map((n, i) => (
          <g key={n.consumerId} transform={`translate(0 ${yL(i) - 14})`}>
            <rect width="230" height="28" rx="6" fill="var(--raised)" stroke="var(--line)" />
            <text x="10" y="18" fontSize="12" fill="var(--fg)">
              {n.name.length > 24 ? `${n.name.slice(0, 23)}…` : n.name}
            </text>
            <text x="220" y="18" fontSize="10" fill="var(--muted)" textAnchor="end">
              {n.criticality}
            </text>
          </g>
        ))}
        {nodesR.map(([k, sev], i) => (
          <g key={k} transform={`translate(470 ${yR(i) - 14})`}>
            <rect
              width="290"
              height="28"
              rx="6"
              fill="var(--code-bg)"
              stroke={STROKE[sev]}
              strokeOpacity="0.6"
            />
            <text x="10" y="18" fontSize="11.5" fill="var(--fg-soft)" fontFamily="var(--font-mono)">
              {k.length > 38 ? `${k.slice(0, 37)}…` : k}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-4 text-xs text-muted">
        <span>Solid line: the consumer registered this exact dependency</span>
        <span>Dashed line: related to a registered dependency</span>
      </figcaption>
    </figure>
  );
}

export function ImpactView({
  scope,
  analysisId,
  consumersHref,
  onEntity,
}: {
  scope: AnalysisScope;
  analysisId: string;
  consumersHref?: string;
  onEntity?: (entityKey: string) => void;
}) {
  const q = useImpact(scope, analysisId);
  if (q.isLoading) return <Skeleton className="h-72" />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const impact = q.data!;
  const impacted = impact.consumers.filter((c) => c.known.length || c.potential.length);
  return (
    <div className="space-y-5">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div className="panel p-4">
          <div className="tabular text-2xl font-semibold">{impact.knownImpactedCount}</div>
          <div className="text-sm text-muted">registered consumers directly affected</div>
        </div>
        <div className="panel p-4">
          <div className="tabular text-2xl font-semibold">{impact.potentiallyImpactedCount}</div>
          <div className="text-sm text-muted">possibly affected through related or contract-wide changes</div>
        </div>
        <div className="panel p-4">
          <div className="tabular text-2xl font-semibold">{impact.unmatchedRiskyFindings.length}</div>
          <div className="text-sm text-muted">risky findings with no registered dependent</div>
        </div>
      </div>
      <p className="rounded-md border border-line bg-raised px-3 py-2 text-sm text-fg-soft">
        {impact.disclaimer}
      </p>

      {impact.consumers.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="No consumers registered for this API"
          body="Register the applications that call this API and the operations they use. JKY-Radar then shows who is affected by each change."
          action={
            consumersHref ? (
              <Link to={consumersHref} className="text-sm font-medium text-accent hover:underline">
                Register consumers
              </Link>
            ) : undefined
          }
        />
      ) : (
        <>
          <DependencyGraph impact={impact} />
          <div className="panel overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Consumer</th>
                  <th className="px-4 py-2.5 font-medium">Criticality</th>
                  <th className="px-4 py-2.5 font-medium">Directly affected by</th>
                  <th className="px-4 py-2.5 font-medium">Worst</th>
                </tr>
              </thead>
              <tbody>
                {impact.consumers.map((c) => (
                  <tr
                    key={c.consumerId}
                    className={cn(
                      'border-b border-line last:border-0',
                      !c.known.length && !c.potential.length && 'text-muted',
                    )}
                  >
                    <td className="px-4 py-3 align-top">
                      <div className="font-medium text-fg">{c.name}</div>
                      <div className="text-xs text-muted">
                        {[c.owner, c.team].filter(Boolean).join(', ') || 'No owner recorded'}
                      </div>
                    </td>
                    <td className="px-4 py-3 align-top capitalize">{c.criticality}</td>
                    <td className="px-4 py-3 align-top">
                      {c.known.length === 0 && c.potential.length === 0 && (
                        <span className="text-xs">Not affected by risky findings</span>
                      )}
                      <ul className="space-y-1">
                        {[...new Map(c.known.map((k) => [k.entityKey, k])).values()].map((k) => (
                          <li key={k.entityKey} className="flex items-center gap-2">
                            <SeverityIcon severity={k.severity} className="size-3.5" />
                            <button
                              type="button"
                              className="font-mono text-xs text-fg-soft hover:text-accent hover:underline"
                              onClick={() => onEntity?.(k.entityKey)}
                            >
                              {k.dependency}
                            </button>
                          </li>
                        ))}
                        {c.potential.length > 0 && (
                          <li className="text-xs text-muted">
                            + {c.potential.length} possibly related (
                            {c.potential.some((p) => !p.entityKey)
                              ? 'includes contract-wide changes'
                              : 'related entities'}
                            )
                          </li>
                        )}
                      </ul>
                    </td>
                    <td className="px-4 py-3 align-top">
                      {c.worstSeverity ? (
                        <SeverityBadge severity={c.worstSeverity} />
                      ) : (
                        <span className="text-xs">—</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {impact.unmatchedRiskyFindings.length > 0 && (
        <section className="panel">
          <h3 className="border-b border-line px-4 py-3 text-sm font-semibold">
            Risky changes nobody registered a dependency on
          </h3>
          <ul className="divide-y divide-line">
            {impact.unmatchedRiskyFindings.slice(0, 30).map((f) => (
              <li key={f.fingerprint} className="flex items-center gap-3 px-4 py-2 text-sm">
                <SeverityIcon severity={f.severity} />
                <span className="sr-only">{SEVERITY_LABEL[f.severity]}</span>
                <span className="truncate font-mono text-xs">{f.logicalPath}</span>
                <span className="ml-auto shrink-0 font-mono text-[11px] text-faint">{f.ruleId}</span>
              </li>
            ))}
          </ul>
          <p className="border-t border-line px-4 py-2 text-xs text-muted">
            {impacted.length === 0 ? 'No registered consumer is affected, ' : ''}These changes can still break
            clients that are not registered in JKY-Radar.
          </p>
        </section>
      )}
    </div>
  );
}
