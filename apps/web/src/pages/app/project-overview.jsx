import { Link } from 'react-router';
import { GitCompareArrows, Upload } from 'lucide-react';
import { roleAllows } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { GateBadge, SeverityBar } from '@/components/radar/badges';
import { useCrumbs } from '@/components/layout/workspace';
import { useProjectAnalyses, useVersions } from '@/lib/queries';
import { dateTime, shortHash } from '@/lib/format';
import { AnalysisTable } from './overview';
import { useProjectCtx } from './project-layout';

export default function ProjectOverviewPage() {
  const { project } = useProjectCtx();
  useCrumbs([
    { label: 'Projects', to: `/app/workspaces/${project.workspaceId}/projects` },
    { label: project.name },
  ]);
  const versions = useVersions(project.id);
  const analyses = useProjectAnalyses(project.id);
  const latest = analyses.data?.find((a) => a.state === 'completed');
  const canWrite = roleAllows(project.role, 'version.create');

  if (versions.isLoading || analyses.isLoading) return <Skeleton className="h-72" />;
  if (versions.error) return <ErrorState error={versions.error} />;
  if (!versions.data.length)
    return (
      <EmptyState
        icon={<Upload className="size-5" />}
        title="Upload the first version"
        body="Start with the contract that is in production today. It becomes the baseline that future versions are compared against."
        action={
          canWrite && (
            <Link to="versions">
              <Button variant="primary">Upload a version</Button>
            </Link>
          )
        }
      />
    );

  return (
    <div className="grid grid-cols-1 gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
      <div className="space-y-6">
        <section className="panel p-5">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-[15px] font-semibold">Latest release check</h2>
              {latest ? (
                <p className="mt-1 text-sm text-muted">
                  {latest.baseline.label} to {latest.candidate.label}, {dateTime(latest.createdAt)}
                </p>
              ) : (
                <p className="mt-1 text-sm text-muted">No completed analysis yet.</p>
              )}
            </div>
            {latest && <GateBadge decision={latest.gate} size="lg" />}
          </div>
          {latest && <SeverityBar counts={latest.counts} className="mt-4" />}
          <div className="mt-4 flex flex-wrap gap-2">
            {latest && (
              <Link to={`/app/analyses/${latest.id}`}>
                <Button variant="secondary">Open analysis</Button>
              </Link>
            )}
            {canWrite && versions.data.length >= 2 && (
              <Link to="compare">
                <Button variant="primary" icon={<GitCompareArrows className="size-4" />}>
                  Run a new comparison
                </Button>
              </Link>
            )}
          </div>
        </section>
        <section className="panel p-5">
          <h2 className="text-[15px] font-semibold">Release history</h2>
          <div className="mt-3">
            {analyses.data.length ? (
              <AnalysisTable items={analyses.data} showProject={false} />
            ) : (
              <p className="text-sm text-muted">Compare two versions to create the first analysis.</p>
            )}
          </div>
        </section>
      </div>
      <aside className="panel h-fit p-5">
        <h2 className="text-[15px] font-semibold">Version timeline</h2>
        <ol className="relative mt-4 space-y-5 border-l border-line pl-5">
          {versions.data.map((v, i) => (
            <li key={v.id} className="relative">
              <span
                className={`absolute top-1.5 -left-[25px] size-2.5 rounded-full border-2 border-surface ${i === 0 ? 'bg-accent' : 'bg-line-strong'}`}
              />
              <p className="text-sm font-medium">{v.label}</p>
              <p className="text-xs text-muted">
                {v.formatVersion}
                {v.apiVersion ? `, info.version ${v.apiVersion}` : ''}
              </p>
              <p className="font-mono text-[11px] text-faint">{shortHash(v.rawHash, 12)}</p>
              <p className="text-xs text-muted">
                {v.uploadedBy.name}, {dateTime(v.createdAt)}
              </p>
            </li>
          ))}
        </ol>
      </aside>
    </div>
  );
}
