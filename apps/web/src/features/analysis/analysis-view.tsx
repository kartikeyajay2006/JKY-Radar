import { useState, type ReactNode } from 'react';
import { useNavigate, useSearchParams } from 'react-router';
import { Check, Copy, History, Link2, Loader2, XCircle } from 'lucide-react';
import { toast } from 'sonner';
import type { AnalysisDTO, FindingDTO } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { ErrorState, Skeleton } from '@/components/ui/primitives';
import { Tabs, TabsContent, TabsList, TabsTrigger, Tip } from '@/components/ui/overlay';
import { CoverageBadge, GateBadge, ProtocolBadge, SeverityBar, gateMeta } from '@/components/radar/badges';
import { useAnalysis, analysisBase, type AnalysisScope } from '@/lib/queries';
import { dateTime, shortHash } from '@/lib/format';
import { cn } from '@/lib/cn';
import { FindingsExplorer } from './findings-explorer';
import { CompareView } from './compare-view';
import { ImpactView } from './impact-view';
import { CoveragePanel } from './coverage-panel';
import { ReportMenu } from './report-menu';
import { ReviewsPanel } from './reviews-panel';

const STAGES = [
  { id: 'queued', label: 'Queued' },
  { id: 'parsing', label: 'Parsing both contracts' },
  { id: 'comparing', label: 'Matching and applying rules' },
  { id: 'persisting', label: 'Saving findings and gate' },
  { id: 'done', label: 'Done' },
];

function Progress({ a }: { a: AnalysisDTO }) {
  const idx = Math.max(
    0,
    STAGES.findIndex((s) => s.id === a.stage),
  );
  return (
    <div className="panel p-6" role="status" aria-live="polite">
      <div className="flex items-center gap-3">
        <Loader2 className="size-5 animate-spin text-accent" aria-hidden />
        <h2 className="text-lg font-semibold">Radar analysis in progress</h2>
      </div>
      <ol className="mt-5 space-y-3">
        {STAGES.slice(0, 4).map((s, i) => (
          <li key={s.id} className="flex items-center gap-3 text-sm">
            <span
              className={cn(
                'flex size-6 items-center justify-center rounded-full border text-xs',
                i < idx
                  ? 'border-safe bg-safe/10 text-safe'
                  : i === idx
                    ? 'border-accent text-accent'
                    : 'border-line text-faint',
              )}
            >
              {i < idx ? <Check className="size-3.5" /> : i + 1}
            </span>
            <span className={i <= idx ? 'text-fg' : 'text-muted'}>{s.label}</span>
          </li>
        ))}
      </ol>
      <p className="mt-5 text-xs text-muted">
        Analyses run in an isolated worker with time and memory limits. This page updates automatically.
      </p>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-0.5 truncate text-sm">{children}</dd>
    </div>
  );
}

function CopyHash({ hash }: { hash: string }) {
  const [done, setDone] = useState(false);
  return (
    <Tip label={hash}>
      <button
        type="button"
        className="inline-flex items-center gap-1 font-mono text-xs text-fg-soft hover:text-accent"
        onClick={async () => {
          await navigator.clipboard?.writeText(hash).catch(() => undefined);
          setDone(true);
          setTimeout(() => setDone(false), 1200);
        }}
        aria-label={`Copy SHA-256 ${hash}`}
      >
        {shortHash(hash, 12)}
        {done ? <Check className="size-3" /> : <Copy className="size-3" />}
      </button>
    </Tip>
  );
}

export function AnalysisView({
  scope,
  analysisId,
  initialTab = 'findings',
  title,
  canReview = false,
  consumersHref,
}: {
  scope: AnalysisScope;
  analysisId: string;
  initialTab?: string;
  title?: ReactNode;
  canReview?: boolean;
  consumersHref?: string;
}) {
  const q = useAnalysis(scope, analysisId);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();
  const tab = params.get('tab') ?? initialTab;
  const setTab = (t: string) => setParams((p) => (p.set('tab', t), p), { replace: true });
  const [selected, setSelected] = useState<FindingDTO | null>(null);
  const [jump, setJump] = useState<{ side: 'baseline' | 'candidate'; line: number; n: number } | null>(null);
  const [entity, setEntity] = useState<string | undefined>(params.get('entity') ?? undefined);

  if (q.isLoading) return <Skeleton className="h-96" />;
  if (q.error) return <ErrorState error={q.error} retry={() => q.refetch()} />;
  const a = q.data!;

  if (a.state === 'queued' || a.state === 'running') return <Progress a={a} />;
  if (a.state === 'failed') {
    const details = a.error?.details as
      | {
          baseline?: Array<{ code: string; message: string }>;
          candidate?: Array<{ code: string; message: string }>;
        }
      | undefined;
    return (
      <div className="panel space-y-3 p-6">
        <div className="flex items-center gap-2">
          <XCircle className="size-5 text-breaking" />
          <h2 className="text-lg font-semibold">The analysis could not complete</h2>
        </div>
        <p className="text-sm">
          <span className="font-mono text-xs text-muted">{a.error?.code}</span> {a.error?.message}
        </p>
        {(['baseline', 'candidate'] as const).map((side) =>
          details?.[side]?.length ? (
            <div key={side}>
              <h3 className="text-sm font-medium capitalize">{side}</h3>
              <ul className="mt-1 list-inside list-disc text-sm text-fg-soft">
                {details[side]!.map((d, i) => (
                  <li key={i}>
                    <span className="font-mono text-xs">{d.code}</span> {d.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null,
        )}
        <Button variant="secondary" onClick={() => navigate(-1)}>
          Go back
        </Button>
      </div>
    );
  }

  const g = a.gate ? gateMeta(a.gate) : null;
  const base = analysisBase(scope, a.id);
  const onJump = (side: 'baseline' | 'candidate', line: number) => {
    setJump({ side, line, n: Date.now() });
    setTab('compare');
  };

  return (
    <div className="space-y-6">
      <section className="panel overflow-hidden">
        <div className="flex flex-col gap-5 p-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              <ProtocolBadge protocol={a.protocol} />
              <CoverageBadge level={a.coverageLevel} />
              {a.comparisonMode === 'cross_format_http' && (
                <span className="rounded-[4px] border border-inconclusive/30 px-1.5 py-0.5 text-xs text-inconclusive">
                  Cross-format
                </span>
              )}
              {a.isPublicDemo && (
                <span className="rounded-[4px] border border-line px-1.5 py-0.5 text-xs text-muted">
                  Public demo, read-only
                </span>
              )}
            </div>
            <h1 className="text-2xl leading-tight font-semibold md:text-[28px]">
              {title ?? (
                <>
                  {a.projectName && (
                    <span className="block text-base font-medium text-muted">{a.projectName}</span>
                  )}
                  {a.baseline.label} <span className="text-muted">to</span> {a.candidate.label}
                </>
              )}
            </h1>
            {g && <p className="text-sm text-fg-soft">{a.gateResult?.reasons.join(' ')}</p>}
          </div>
          <div className="flex shrink-0 flex-col items-start gap-3 lg:items-end">
            <GateBadge decision={a.gate} size="lg" />
            <div className="flex flex-wrap gap-2">
              {scope === 'private' && (
                <Button
                  variant="secondary"
                  icon={<Link2 className="size-4" />}
                  onClick={async () => {
                    await navigator.clipboard?.writeText(window.location.href).catch(() => undefined);
                    toast.success('Link copied. Workspace members can open it.');
                  }}
                >
                  Share
                </Button>
              )}
              <ReportMenu base={base} />
            </div>
          </div>
        </div>
        <div className="border-t border-line px-5 py-4">
          <SeverityBar counts={a.counts} />
        </div>
        <dl className="grid grid-cols-2 gap-x-6 gap-y-4 border-t border-line bg-raised/40 px-5 py-4 md:grid-cols-4">
          <Meta label={`Baseline ${a.baselineVersion.label}`}>
            <CopyHash hash={a.baselineVersion.rawHash} />
          </Meta>
          <Meta label={`Candidate ${a.candidateVersion.label}`}>
            <CopyHash hash={a.candidateVersion.rawHash} />
          </Meta>
          <Meta label="Policy">
            {a.policy ? `${a.policy.name}, revision ${a.policy.revision}` : 'Default'}
          </Meta>
          <Meta label="Completed">{dateTime(a.timings.completedAt)}</Meta>
        </dl>
        <details className="group border-t border-line px-5 py-3 text-sm">
          <summary className="flex cursor-pointer list-none items-center gap-2 text-fg-soft select-none hover:text-fg">
            <History className="size-4" aria-hidden />
            Radar Replay: exactly what was compared
          </summary>
          <div className="mt-3 grid grid-cols-1 gap-4 md:grid-cols-2">
            <dl className="grid grid-cols-2 gap-3">
              <Meta label="Engine">{a.versions?.engine}</Meta>
              <Meta label="Rule registry">{a.versions?.rules}</Meta>
              <Meta label="Adapter">{a.versions?.adapter}</Meta>
              <Meta label="Policy version">
                <span className="font-mono text-xs">{a.versions?.policy}</span>
              </Meta>
              <Meta label="Input hash">
                <CopyHash hash={a.inputHash} />
              </Meta>
              <Meta label="Duration">
                {a.timings.durationMs !== undefined ? `${a.timings.durationMs} ms` : '—'}
              </Meta>
            </dl>
            <p className="text-xs leading-relaxed text-muted">
              This result is stored immutably with the content hashes of both inputs and the versions of the
              engine, rules, adapter and policy that produced it. Opening it later shows the preserved result;
              it is not re-run with today&apos;s engine. Running the same inputs with the same versions
              returns this analysis instead of computing a new one.
            </p>
          </div>
        </details>
      </section>

      <Tabs value={tab} onValueChange={setTab}>
        <TabsList aria-label="Analysis sections">
          <TabsTrigger value="findings">Findings</TabsTrigger>
          <TabsTrigger value="compare">Compare</TabsTrigger>
          <TabsTrigger value="impact">Consumer impact</TabsTrigger>
          <TabsTrigger value="coverage">Coverage and diagnostics</TabsTrigger>
          <TabsTrigger value="reviews">Reviews</TabsTrigger>
        </TabsList>
        <div className="pt-5">
          <TabsContent value="findings">
            <FindingsExplorer
              key={entity ?? 'all'}
              scope={scope}
              analysisId={a.id}
              selected={selected}
              onSelect={setSelected}
              onJump={onJump}
              initialEntity={entity}
            />
          </TabsContent>
          <TabsContent value="compare">
            <CompareView
              scope={scope}
              analysisId={a.id}
              selected={selected}
              onSelect={setSelected}
              jump={jump}
            />
          </TabsContent>
          <TabsContent value="impact">
            <ImpactView
              scope={scope}
              analysisId={a.id}
              consumersHref={consumersHref}
              onEntity={(k) => {
                setEntity(k);
                setTab('findings');
              }}
            />
          </TabsContent>
          <TabsContent value="coverage">
            <CoveragePanel a={a} />
          </TabsContent>
          <TabsContent value="reviews">
            <ReviewsPanel scope={scope} analysis={a} canReview={canReview} />
          </TabsContent>
        </div>
      </Tabs>
    </div>
  );
}
