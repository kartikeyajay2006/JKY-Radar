/** @import { AnalysisSummaryDTO, OverviewDTO } from '@jky/shared' */
import { useEffect, useState } from 'react';
import { Link } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import { Boxes, Check, Mail } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { GateBadge, SeverityBar, SeverityIcon } from '@/components/radar/badges';

const GATE_BG = /** @type {const} */ ({
  block: 'bg-breaking',
  inconclusive: 'bg-inconclusive',
  warn: 'bg-review',
  pass: 'bg-safe',
});
import { useCrumbs, useCurrentWorkspace } from '@/components/layout/workspace';
import { useInvalidate, useInvitations, useOverview } from '@/lib/queries';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';

/** @param {{ items: AnalysisSummaryDTO[]; showProject?: boolean; }} props */
export function AnalysisTable({ items, showProject = true }) {
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[640px] text-sm">
        <thead className="border-b border-line text-left text-xs text-muted">
          <tr>
            {showProject && <th className="py-2 pr-4 font-medium">Project</th>}
            <th className="py-2 pr-4 font-medium">Comparison</th>
            <th className="py-2 pr-4 font-medium">Gate</th>
            <th className="py-2 pr-4 font-medium">Findings</th>
            <th className="py-2 pr-4 font-medium">Review</th>
            <th className="py-2 font-medium">When</th>
          </tr>
        </thead>
        <tbody>
          {items.map((a) => (
            <tr key={a.id} className="border-b border-line last:border-0">
              {showProject && <td className="max-w-48 truncate py-2.5 pr-4 font-medium">{a.projectName}</td>}
              <td className="py-2.5 pr-4">
                <Link to={`/app/analyses/${a.id}`} className="hover:text-accent hover:underline">
                  {a.baseline.label} to {a.candidate.label}
                </Link>
              </td>
              <td className="py-2.5 pr-4">
                {a.state === 'completed' ? (
                  <GateBadge decision={a.gate} />
                ) : (
                  <span className="text-xs text-muted capitalize">{a.state}</span>
                )}
              </td>
              <td className="w-40 py-2.5 pr-4">
                {a.counts ? (
                  <SeverityBar counts={a.counts} legend={false} />
                ) : (
                  <span className="text-xs text-muted">—</span>
                )}
              </td>
              <td className="py-2.5 pr-4 text-xs text-muted capitalize">
                {a.reviewStatus.replace('_', ' ')}
              </td>
              <td className="py-2.5 text-xs whitespace-nowrap text-muted">{timeAgo(a.createdAt)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** @param {{ data: OverviewDTO['timeline'] }} props */
function Timeline({ data }) {
  const max = Math.max(1, ...data.map((d) => d.analyses));
  return (
    <figure>
      <div
        className="flex h-36 items-end gap-1.5"
        role="img"
        aria-label={`Analyses per day over the last 14 days, total ${data.reduce((n, d) => n + d.analyses, 0)}`}
      >
        {data.map((d, i) => (
          <div
            key={d.date}
            className="group relative flex h-full flex-1 flex-col justify-end"
            title={`${d.date}: ${d.analyses} analyses, ${d.blocked} blocked`}
          >
            <div
              className="grow-up w-full rounded-t-[3px] bg-accent/25 transition-colors group-hover:bg-accent/40"
              style={{ height: `${(d.analyses / max) * 100}%`, animationDelay: `${i * 35}ms` }}
            >
              <div
                className="w-full rounded-t-[3px] bg-breaking"
                style={{ height: d.analyses ? `${(d.blocked / d.analyses) * 100}%` : 0 }}
              />
            </div>
          </div>
        ))}
      </div>
      <figcaption className="mt-2 flex justify-between text-[11px] text-muted">
        <span>{data[0]?.date.slice(5)}</span>
        <span className="flex gap-3">
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-accent/40" /> analyses
          </span>
          <span className="flex items-center gap-1">
            <span className="size-2 rounded-sm bg-breaking" /> blocked
          </span>
        </span>
        <span>{data.at(-1)?.date.slice(5)}</span>
      </figcaption>
    </figure>
  );
}

function Invitations() {
  const inv = useInvitations();
  const invalidate = useInvalidate();
  const m = useMutation({
    /** @param {{ id: string; action: 'accept' | 'decline' }} props */
    mutationFn: ({ id, action }) => api.post(`/invitations/${id}/${action}`),
    onSuccess: async (_d, v) => {
      toast.success(v.action === 'accept' ? 'Invitation accepted' : 'Invitation declined');
      await invalidate(['invitations'], ['workspaces']);
    },
    onError: (e) => toast.error(/** @type {Error} */ (e).message),
  });
  if (!inv.data?.length) return null;
  return (
    <div className="mb-6 space-y-2">
      {inv.data.map((i) => (
        <div
          key={i.id}
          className="flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-accent/30 bg-accent-soft px-4 py-3 text-sm"
        >
          <Mail className="size-4 text-accent" />
          <span className="flex-1">
            <strong>{i.invitedBy}</strong> invited you to <strong>{i.workspaceName}</strong> as{' '}
            {i.role.toLowerCase()}.
          </span>
          <Button
            size="sm"
            variant="primary"
            onClick={() => m.mutate({ id: i.id, action: 'accept' })}
            loading={m.isPending}
          >
            Accept
          </Button>
          <Button size="sm" variant="ghost" onClick={() => m.mutate({ id: i.id, action: 'decline' })}>
            Decline
          </Button>
        </div>
      ))}
    </div>
  );
}

export default function OverviewPage() {
  const { current } = useCurrentWorkspace();
  useCrumbs([{ label: current?.name ?? 'Workspace' }, { label: 'Overview' }]);
  const q = useOverview(current?.id);
  const projectsHref = current ? `/app/workspaces/${current.id}/projects` : '/app';

  return (
    <>
      <Invitations />
      <PageHeader
        title="Overview"
        description={current ? `Release health across ${current.name}.` : undefined}
        actions={
          <Link to={projectsHref}>
            <Button variant="primary" icon={<Boxes className="size-4" />}>
              View projects
            </Button>
          </Link>
        }
      />
      {q.isLoading || !current ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-4">
          {Array.from({ length: 8 }, (_, i) => (
            <Skeleton key={i} className="h-28" />
          ))}
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data.counts.projects === 0 ? (
        <EmptyState
          icon={<Boxes className="size-5" />}
          title="Start by creating a project"
          body="A project tracks one API contract over time. Upload its current version as a baseline, then compare each proposed version against it."
          action={
            <Link to={projectsHref}>
              <Button variant="primary">Create a project</Button>
            </Link>
          }
        />
      ) : (
        <Dashboard d={q.data} href={projectsHref} />
      )}
    </>
  );
}

/** Counts up to `value` once, easing out; shows the final number straight away for reduced motion. @param {number} value */
function useCountUp(value) {
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches || value === 0) {
      setShown(value);
      return;
    }
    let raf = 0;
    const start = performance.now();
    const tick = (/** @type {number} */ now) => {
      const t = Math.min(1, (now - start) / 750);
      setShown(Math.round(value * (1 - (1 - t) ** 3)));
      if (t < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [value]);
  return shown;
}

/** @param {{ value: number; label: string; tone?: string }} props */
function Stat({ value, label, tone }) {
  const shown = useCountUp(value);
  return (
    <div className="panel lift p-4">
      <div className={cn('tabular text-[28px] leading-none font-semibold', tone)}>
        <span aria-hidden>{shown}</span>
        <span className="sr-only">{value}</span>
      </div>
      <div className="mt-2 text-sm text-muted">{label}</div>
    </div>
  );
}

/** @param {{ d: OverviewDTO; href: string }} props */
function GettingStarted({ d, href }) {
  const steps = [
    { done: d.counts.projects > 0, title: 'Create a project', body: 'One project tracks one API contract.' },
    {
      done: d.counts.versions >= 2,
      title: 'Upload two versions',
      body: 'Your released contract and the proposed one.',
    },
    {
      done: d.counts.analyses > 0,
      title: 'Run an analysis',
      body: 'Compare them and read the release gate.',
    },
    {
      done: d.counts.consumers > 0,
      title: 'Register a consumer',
      body: 'See which apps each change affects.',
    },
  ];
  const done = steps.filter((s) => s.done).length;
  if (done === steps.length) return null;
  return (
    <section className="panel overflow-hidden">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line px-5 py-3.5">
        <div>
          <h2 className="text-[15px] font-semibold">Get started</h2>
          <p className="text-xs text-muted">
            {done} of {steps.length} done
          </p>
        </div>
        <div className="h-1.5 w-40 overflow-hidden rounded-full bg-raised" aria-hidden>
          <div
            className="h-full rounded-full bg-accent transition-[width] duration-700 ease-out"
            style={{ width: `${(done / steps.length) * 100}%` }}
          />
        </div>
      </div>
      <ol className="grid grid-cols-1 divide-y divide-line sm:grid-cols-2 sm:divide-y-0 lg:grid-cols-4 lg:divide-x">
        {steps.map((s, i) => (
          <li key={s.title}>
            <Link to={href} className="group flex h-full gap-3 p-4 transition-colors hover:bg-raised/60">
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full border text-xs font-medium transition-colors',
                  s.done
                    ? 'border-safe bg-safe text-surface'
                    : 'border-line-strong text-muted group-hover:border-accent group-hover:text-accent',
                )}
              >
                {s.done ? <Check className="size-3.5" strokeWidth={3} /> : i + 1}
              </span>
              <span>
                <span className={cn('block text-sm font-medium', s.done && 'text-muted line-through')}>
                  {s.title}
                </span>
                <span className="mt-0.5 block text-xs text-muted">{s.body}</span>
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </section>
  );
}

/** @param {{ d: OverviewDTO; href: string }} props */
function Dashboard({ d, href }) {
  const reviewPct = d.reviewCompletion.total
    ? Math.round((d.reviewCompletion.reviewed / d.reviewCompletion.total) * 100)
    : null;
  return (
    <div className="space-y-6">
      <GettingStarted d={d} href={href} />
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <Stat value={d.counts.projects} label="projects" />
        <Stat value={d.counts.analyses} label="analyses run" />
        <Stat
          value={d.counts.blocked}
          label="releases blocked"
          tone={d.counts.blocked ? 'text-breaking' : undefined}
        />
        <Stat
          value={d.counts.pendingReviews}
          label="awaiting review"
          tone={d.counts.pendingReviews ? 'text-review' : undefined}
        />
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)]">
        <section className="panel p-5">
          <h2 className="text-[15px] font-semibold">Analyses, last 14 days</h2>
          <div className="mt-4">
            <Timeline data={d.timeline} />
          </div>
        </section>
        <section className="panel p-5">
          <h2 className="text-[15px] font-semibold">Gate outcomes</h2>
          <ul className="mt-4 space-y-3">
            {
              /** @type {const} */ (['block', 'inconclusive', 'warn', 'pass']).map((g) => {
                const total = Object.values(d.gateTotals).reduce((a, b) => a + b, 0) || 1;
                return (
                  <li key={g} className="flex items-center gap-3">
                    <span className="w-28">
                      <GateBadge decision={g} />
                    </span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-raised">
                      <div
                        className={cn('grow-right h-full rounded-full', GATE_BG[g])}
                        style={{ width: `${(d.gateTotals[g] / total) * 100}%` }}
                      />
                    </div>
                    <span className="tabular w-8 text-right text-sm">{d.gateTotals[g]}</span>
                  </li>
                );
              })
            }
          </ul>
          <div className="mt-5 border-t border-line pt-4">
            <h3 className="text-sm font-medium">Findings by severity</h3>
            <SeverityBar counts={d.severityTotals} className="mt-3" />
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <section className="panel p-5">
          <h2 className="text-[15px] font-semibold">Most affected operations</h2>
          {d.topEntities.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No risky findings yet.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {d.topEntities.map((e) => (
                <li key={e.entityKey} className="flex items-center gap-2 text-sm">
                  <SeverityIcon severity={e.worst} className="size-3.5" />
                  <span className="min-w-0 flex-1 truncate font-mono text-xs">
                    {e.entityKey.replace(/\{\}/g, '{…}')}
                  </span>
                  <span className="tabular text-xs text-muted">{e.count}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="panel p-5">
          <h2 className="text-[15px] font-semibold">Consumers most affected</h2>
          {d.topConsumers.length === 0 ? (
            <p className="mt-3 text-sm text-muted">
              Register consumers on a project to see who each release affects.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {d.topConsumers.map((c) => (
                <li key={c.consumerId} className="flex items-center gap-2 text-sm">
                  <span className="min-w-0 flex-1 truncate">{c.name}</span>
                  <span className="text-xs text-muted capitalize">{c.criticality}</span>
                  <span className="tabular w-6 text-right text-xs">{c.impactedAnalyses}</span>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-xs text-muted">Counted over each project&apos;s latest analysis.</p>
        </section>
        <section className="panel p-5">
          <h2 className="text-[15px] font-semibold">Review completion</h2>
          <div className="tabular mt-3 text-[28px] font-semibold">
            {reviewPct === null ? '—' : `${reviewPct}%`}
          </div>
          <p className="text-sm text-muted">
            {d.reviewCompletion.reviewed} of {d.reviewCompletion.total} analyses that require review have a
            decision.
          </p>
        </section>
      </div>

      <section className="panel p-5">
        <h2 className="text-[15px] font-semibold">Recent analyses</h2>
        <div className="mt-3">
          {d.recentAnalyses.length ? (
            <AnalysisTable items={d.recentAnalyses} />
          ) : (
            <p className="text-sm text-muted">No analyses yet.</p>
          )}
        </div>
      </section>
    </div>
  );
}
