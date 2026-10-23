/** @import { AnalysisDTO, ReviewDecision } from '@jky/shared' */
/** @import { AnalysisScope } from '@/lib/queries' */
import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { CheckCircle2, MessageSquare, RotateCcw, XCircle } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/button';
import { Field, Textarea } from '@/components/ui/field';
import { EmptyState, ErrorState, Skeleton } from '@/components/ui/primitives';
import { api, ApiError } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useInvalidate, useReviews } from '@/lib/queries';
import { useAuth } from '@/lib/auth';
import { cn } from '@/lib/cn';

/** @type {Record<ReviewDecision, { label: string; icon: typeof CheckCircle2; cls: string }>} */
const DECISION = {
  approve: { label: 'Approved', icon: CheckCircle2, cls: 'text-safe' },
  reject: { label: 'Rejected', icon: XCircle, cls: 'text-breaking' },
  request_changes: { label: 'Requested changes', icon: RotateCcw, cls: 'text-review' },
  comment: { label: 'Commented', icon: MessageSquare, cls: 'text-muted' },
};

/** @param {{ scope: AnalysisScope; analysis: AnalysisDTO; canReview: boolean; }} props */
export function ReviewsPanel({ scope, analysis, canReview }) {
  const q = useReviews(scope, analysis.id);
  const { user } = useAuth();
  const inv = useInvalidate();
  const [rationale, setRationale] = useState('');
  const [override, setOverride] = useState(false);
  const blocked = analysis.gate === 'block';
  const own = user?.id === analysis.createdBy.id;
  const m = useMutation({
    /** @param {ReviewDecision} decision */
    mutationFn: (decision) =>
      api.post(`/analyses/${analysis.id}/reviews`, {
        decision,
        rationale,
        overrideBlock: decision === 'approve' && blocked ? override : false,
      }),
    onSuccess: async () => {
      toast.success('Decision recorded');
      setRationale('');
      setOverride(false);
      await inv(['reviews', scope, analysis.id], ['analysis', scope, analysis.id]);
    },
    onError: (e) => toast.error(e instanceof ApiError ? e.message : 'Could not record the decision'),
  });
  const approveDisabled =
    (blocked && (!override || rationale.trim().length < 20)) || rationale.trim().length < 3;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,1fr)_380px]">
      <section className="panel">
        <h3 className="border-b border-line px-5 py-3 text-[15px] font-semibold">Decision history</h3>
        {q.isLoading ? (
          <Skeleton className="m-5 h-24" />
        ) : q.error ? (
          <ErrorState className="m-5" error={q.error} />
        ) : q.data.length === 0 ? (
          <EmptyState
            className="m-5"
            title="No decisions yet"
            body={
              analysis.reviewStatus === 'not_required'
                ? 'This project policy does not require a review.'
                : 'A reviewer records approve, reject or request-changes with a short rationale.'
            }
          />
        ) : (
          <ol className="divide-y divide-line">
            {q.data.map((r) => {
              const d = DECISION[r.decision];
              const Icon = d.icon;
              return (
                <li key={r.id} className="flex gap-3 px-5 py-4">
                  <Icon className={cn('mt-0.5 size-5 shrink-0', d.cls)} aria-hidden />
                  <div className="min-w-0">
                    <p className="text-sm">
                      <span className="font-medium">{r.reviewer.name}</span>{' '}
                      <span className={d.cls}>{d.label.toLowerCase()}</span>
                      {r.overrideBlock && (
                        <span className="ml-2 rounded-[4px] border border-breaking/30 px-1.5 py-0.5 text-xs text-breaking">
                          Overrode a blocked gate
                        </span>
                      )}
                    </p>
                    <p className="mt-1 text-sm whitespace-pre-wrap text-fg-soft">{r.rationale}</p>
                    <p className="mt-1 text-xs text-muted">{dateTime(r.createdAt)}</p>
                  </div>
                </li>
              );
            })}
          </ol>
        )}
      </section>

      {scope === 'private' && (
        <section className="panel p-5">
          <h3 className="text-[15px] font-semibold">Record a decision</h3>
          {!canReview ? (
            <p className="mt-2 text-sm text-muted">
              Your role cannot review. Reviewers, maintainers, admins and owners can.
            </p>
          ) : analysis.state !== 'completed' ? (
            <p className="mt-2 text-sm text-muted">Available once the analysis completes.</p>
          ) : (
            <div className="mt-3 space-y-3">
              <Field
                label="Rationale"
                hint={
                  blocked
                    ? 'Approving a blocked gate needs an explicit override and at least 20 characters.'
                    : 'Explain the decision for the audit trail.'
                }
              >
                {(id, d) => (
                  <Textarea
                    id={id}
                    aria-describedby={d}
                    value={rationale}
                    onChange={(e) => setRationale(e.target.value)}
                    maxLength={2000}
                    placeholder="e.g. Consumers migrated off the removed endpoint in sprint 42."
                  />
                )}
              </Field>
              {blocked && (
                <label className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1 accent-[var(--breaking)]"
                    checked={override}
                    onChange={(e) => setOverride(e.target.checked)}
                  />
                  <span>
                    Override the blocked gate. The findings stay as they are; the override and rationale are
                    written to the audit log.
                  </span>
                </label>
              )}
              {own && (
                <p className="text-xs text-review">
                  You requested this analysis. Policy may forbid approving or rejecting your own analysis.
                </p>
              )}
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="primary"
                  loading={m.isPending && m.variables === 'approve'}
                  disabled={approveDisabled || m.isPending}
                  onClick={() => m.mutate('approve')}
                >
                  Approve
                </Button>
                <Button
                  variant="secondary"
                  disabled={rationale.trim().length < 3 || m.isPending}
                  onClick={() => m.mutate('request_changes')}
                >
                  Request changes
                </Button>
                <Button
                  variant="danger"
                  disabled={rationale.trim().length < 3 || m.isPending}
                  onClick={() => m.mutate('reject')}
                >
                  Reject
                </Button>
                <Button
                  variant="ghost"
                  disabled={rationale.trim().length < 3 || m.isPending}
                  onClick={() => m.mutate('comment')}
                >
                  Comment
                </Button>
              </div>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
