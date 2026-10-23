import type { AnalysisDTO } from '@jky/shared';
import { CoverageBadge } from '@/components/radar/badges';
import { cn } from '@/lib/cn';

export function CoveragePanel({ a }: { a: AnalysisDTO }) {
  const c = a.coverage;
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
      <section className="panel p-5">
        <div className="flex items-center justify-between gap-3">
          <h3 className="text-[15px] font-semibold">Coverage</h3>
          <CoverageBadge level={c?.level ?? null} />
        </div>
        <p className="mt-2 text-sm text-muted">
          Coverage is categorical, not a score. <strong className="font-medium text-fg">Full</strong> means
          every construct in both inputs is handled by rules that have positive and negative tests.{' '}
          <strong className="font-medium text-fg">Partial</strong> means something was present that JKY-Radar
          does not decide formally, so an empty list is not proof of safety.
        </p>
        {c && (
          <>
            <p className="mt-4 text-sm">
              <span className="tabular font-semibold">{c.testedRules}</span> of{' '}
              <span className="tabular font-semibold">{c.supportedRules}</span> rules registered for this
              protocol have positive and negative tests.
            </p>
            {c.reasons.length > 0 && (
              <ul className="mt-3 space-y-1.5 text-sm text-fg-soft">
                {c.reasons.map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="mt-2 size-1.5 shrink-0 rounded-full bg-review" aria-hidden />
                    {r}
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
      </section>
      <section className="panel p-5">
        <h3 className="text-[15px] font-semibold">Present but not compared</h3>
        {a.uncoveredConstructs.length === 0 ? (
          <p className="mt-2 text-sm text-muted">Every construct in these inputs was compared.</p>
        ) : (
          <ul className="mt-3 flex flex-wrap gap-1.5">
            {a.uncoveredConstructs.map((u) => (
              <li
                key={u}
                className="rounded-[4px] border border-line bg-raised px-2 py-1 text-xs text-fg-soft"
              >
                {u}
              </li>
            ))}
          </ul>
        )}
      </section>
      <section className="panel p-5 lg:col-span-2">
        <h3 className="text-[15px] font-semibold">Parser diagnostics</h3>
        {a.parserWarnings.length === 0 ? (
          <p className="mt-2 text-sm text-muted">No warnings from the parsers.</p>
        ) : (
          <ul className="mt-3 divide-y divide-line">
            {a.parserWarnings.map((w, i) => (
              <li key={i} className="flex flex-wrap items-baseline gap-x-3 gap-y-1 py-2 text-sm">
                <span
                  className={cn(
                    'w-16 text-xs font-medium capitalize',
                    w.severity === 'warning'
                      ? 'text-review'
                      : w.severity === 'error'
                        ? 'text-breaking'
                        : 'text-muted',
                  )}
                >
                  {w.severity}
                </span>
                <span className="font-mono text-xs text-faint">{w.code}</span>
                <span className="min-w-0 flex-1 text-fg-soft">{w.message}</span>
                {w.source?.line && <span className="text-xs text-muted">line {w.source.line}</span>}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
