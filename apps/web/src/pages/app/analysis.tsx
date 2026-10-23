import { useParams } from 'react-router';
import { roleAllows } from '@jky/shared';
import { useCrumbs, useCurrentWorkspace } from '@/components/layout/workspace';
import { AnalysisView } from '@/features/analysis/analysis-view';
import { useAnalysis, useProject } from '@/lib/queries';

export default function AnalysisPage({ tab }: { tab?: string }) {
  const { aid } = useParams();
  const a = useAnalysis('private', aid);
  const p = useProject(a.data?.projectId);
  const { current } = useCurrentWorkspace();
  useCrumbs([
    { label: 'Projects', to: current ? `/app/workspaces/${current.id}/projects` : '/app' },
    ...(p.data ? [{ label: p.data.name, to: `/app/projects/${p.data.id}` }] : []),
    { label: a.data ? `${a.data.baseline.label} to ${a.data.candidate.label}` : 'Analysis' },
  ]);
  const canReview = p.data ? roleAllows(p.data.role, 'review.create') : false;
  return (
    <AnalysisView
      scope="private"
      analysisId={aid!}
      initialTab={tab}
      canReview={canReview}
      consumersHref={p.data ? `/app/projects/${p.data.id}/consumers` : undefined}
      title={p.data ? `${p.data.name}: ${a.data?.baseline.label} to ${a.data?.candidate.label}` : undefined}
    />
  );
}
