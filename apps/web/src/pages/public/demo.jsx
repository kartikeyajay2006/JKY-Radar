import { Link, useParams } from 'react-router';
import { useEffect } from 'react';
import { ArrowLeft } from 'lucide-react';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { GateBadge, ProtocolBadge, SeverityBar } from '@/components/radar/badges';
import { useDemoAnalyses } from '@/lib/queries';
import { AnalysisView } from '@/features/analysis/analysis-view';

export function DemoIndex() {
  const q = useDemoAnalyses();
  useEffect(() => {
    document.title = 'Public demo · JKY-Radar';
  }, []);
  return (
    <div className="mx-auto max-w-7xl px-4 py-12 sm:px-6">
      <div className="max-w-3xl">
        <h1 className="text-[36px] leading-tight font-semibold">Public demo analyses</h1>
        <p className="mt-3 text-fg-soft">
          Each analysis below was produced by running the JKY-Radar engine on synthetic contract pairs when
          the server started. Nothing is precomputed by hand. They are read-only; create a workspace to
          analyse your own contracts.
        </p>
      </div>
      <div className="mt-10 grid grid-cols-1 gap-4 md:grid-cols-2">
        {q.isLoading && Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="h-40" />)}
        {q.error && <ErrorState error={q.error} retry={() => q.refetch()} className="md:col-span-2" />}
        {q.data?.length === 0 && (
          <EmptyState
            className="md:col-span-2"
            title="The demo is not seeded yet"
            body="Run npm run seed:demo, or start the API with DEMO_SEED_ENABLED=true."
          />
        )}
        {q.data?.map((d) => (
          <Link
            key={d.id}
            to={`/demo/${d.id}`}
            className="panel group flex flex-col gap-4 p-5 transition-colors hover:border-line-strong"
          >
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <ProtocolBadge protocol={d.protocol} />
                <h2 className="mt-2 text-lg font-semibold group-hover:text-accent">{d.projectName}</h2>
                <p className="mt-1 text-sm text-muted">{d.description}</p>
              </div>
              <GateBadge decision={d.gate} />
            </div>
            <SeverityBar counts={d.counts} legend={false} />
            <p className="text-xs text-muted">
              {d.baseline.label} compared with {d.candidate.label}, {d.coverageLevel} coverage
            </p>
          </Link>
        ))}
      </div>
    </div>
  );
}

export function DemoAnalysis() {
  const { aid } = useParams();
  useEffect(() => {
    document.title = 'Demo analysis · JKY-Radar';
  }, []);
  return (
    <div className="mx-auto max-w-[1360px] px-4 py-8 sm:px-6">
      <Link to="/demo" className="mb-5 inline-flex items-center gap-1.5 text-sm text-muted hover:text-fg">
        <ArrowLeft className="size-4" /> All demo analyses
      </Link>
      <AnalysisView scope="demo" analysisId={aid} />
    </div>
  );
}
