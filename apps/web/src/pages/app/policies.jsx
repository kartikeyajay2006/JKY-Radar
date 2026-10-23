/** @import { FindingSeverity } from '@jky/radar-core' */
/** @import { PolicyDTO, UpdatePolicyInput } from '@jky/shared' */
import { useEffect, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { toast } from 'sonner';
import { SEVERITY_LABEL } from '@jky/radar-core';
import { roleAllows } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { ErrorState, PageHeader, Section, Skeleton } from '@/components/ui/primitives';
import { SeverityIcon } from '@/components/radar/badges';
import { useCrumbs } from '@/components/layout/workspace';
import { usePolicy, useRules, useUpdatePolicy } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { dateTime } from '@/lib/format';
import { useProjectCtx } from './project-layout';

/** @type {FindingSeverity[]} */
const SEVS = ['breaking', 'potentially_breaking', 'needs_review', 'non_breaking', 'informational'];
/**
 * @param {PolicyDTO} p
 * @returns {UpdatePolicyInput}
 */
const toInput = (p) => ({
  name: p.name,
  actions: p.actions,
  onCoverageGap: p.onCoverageGap,
  onPartialCoverage: p.onPartialCoverage,
  ruleOverrides: p.ruleOverrides.map((o) => ({
    ruleId: o.ruleId,
    severity: o.severity,
    justification: o.justification,
  })),
  requireReview: p.requireReview,
  forbidSelfApproval: p.forbidSelfApproval,
  minApprovals: p.minApprovals,
  protectedEnvironments: p.protectedEnvironments,
});

export default function PoliciesPage() {
  const { project } = useProjectCtx();
  useCrumbs([
    { label: 'Projects', to: `/app/workspaces/${project.workspaceId}/projects` },
    { label: project.name, to: `/app/projects/${project.id}` },
    { label: 'Release policy' },
  ]);
  const q = usePolicy(project.id);
  const rules = useRules();
  const save = useUpdatePolicy(project.id);
  const [form, setForm] = useState(/** @type {UpdatePolicyInput | null} */ (null));
  const canEdit = roleAllows(project.role, 'policy.update');
  useEffect(() => {
    if (q.data && !form) setForm(toInput(q.data.current));
  }, [q.data, form]);

  if (q.isLoading || !form) return q.error ? <ErrorState error={q.error} /> : <Skeleton className="h-96" />;
  const cur = q.data.current;
  const dirty = JSON.stringify(form) !== JSON.stringify(toInput(cur));
  const errs =
    save.error instanceof ApiError && Array.isArray(save.error.details)
      ? /** @type {Array<{ path: string; message: string }>} */ (save.error.details)
      : [];

  return (
    <>
      <PageHeader
        title="Release policy"
        description={`Revision ${cur.revision}, ${cur.updatedBy ? `changed by ${cur.updatedBy.name}` : 'default'} on ${dateTime(cur.createdAt)}. Saving creates a new revision; past analyses keep the revision they used.`}
        actions={
          canEdit && (
            <>
              <Button variant="ghost" disabled={!dirty} onClick={() => setForm(toInput(cur))}>
                Discard changes
              </Button>
              <Button
                variant="primary"
                disabled={!dirty}
                loading={save.isPending}
                onClick={() =>
                  save.mutate(form, {
                    onSuccess: (p) => {
                      toast.success(`Saved revision ${p.revision}`);
                      setForm(toInput(p));
                    },
                    onError: (e) => toast.error(/** @type {Error} */ (e).message),
                  })
                }
              >
                Save new revision
              </Button>
            </>
          )
        }
      />
      {!canEdit && (
        <p className="mb-5 rounded-md border border-line bg-raised px-3 py-2 text-sm text-fg-soft">
          Only admins and owners can change the release policy. You are viewing it read-only.
        </p>
      )}
      <fieldset disabled={!canEdit} className="space-y-6">
        <Section
          title="Gate actions"
          description="What the gate does when at least one finding of a severity is present."
        >
          <div className="space-y-2">
            {SEVS.map((s) => (
              <div
                key={s}
                className="grid grid-cols-[1fr_160px] items-center gap-3 sm:grid-cols-[240px_200px]"
              >
                <span className="flex items-center gap-2 text-sm">
                  <SeverityIcon severity={s} />
                  {SEVERITY_LABEL[s]}
                </span>
                <Select
                  aria-label={`Action for ${SEVERITY_LABEL[s]}`}
                  value={form.actions[s]}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      actions: { ...form.actions, [s]: /** @type {'block'} */ (e.target.value) },
                    })
                  }
                >
                  <option value="block">Block release</option>
                  <option value="warn">Warn</option>
                  <option value="ignore">Ignore</option>
                </Select>
              </div>
            ))}
          </div>
          <div className="mt-5 grid grid-cols-1 gap-4 border-t border-line pt-5 sm:grid-cols-2">
            <Field label="When a change lands in a construct that is not decided formally">
              {(id) => (
                <Select
                  id={id}
                  value={form.onCoverageGap}
                  onChange={(e) =>
                    setForm({ ...form, onCoverageGap: /** @type {'warn'} */ (e.target.value) })
                  }
                >
                  <option value="inconclusive">Mark the gate inconclusive</option>
                  <option value="warn">Warn only</option>
                </Select>
              )}
            </Field>
            <Field label="When coverage is partial and nothing else warns">
              {(id) => (
                <Select
                  id={id}
                  value={form.onPartialCoverage}
                  onChange={(e) =>
                    setForm({ ...form, onPartialCoverage: /** @type {'warn'} */ (e.target.value) })
                  }
                >
                  <option value="warn">Warn (recommended)</option>
                  <option value="pass">Pass</option>
                </Select>
              )}
            </Field>
          </div>
        </Section>

        <Section title="Review requirements">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.requireReview}
                onChange={(e) => setForm({ ...form, requireReview: e.target.checked })}
              />
              <span>Require a review decision for every analysis</span>
            </label>
            <label className="flex items-start gap-2 text-sm">
              <input
                type="checkbox"
                className="mt-1"
                checked={form.forbidSelfApproval}
                onChange={(e) => setForm({ ...form, forbidSelfApproval: e.target.checked })}
              />
              <span>Forbid approving or rejecting an analysis you requested</span>
            </label>
            <Field label="Approvals needed">
              {(id) => (
                <Input
                  id={id}
                  type="number"
                  min={0}
                  max={5}
                  value={form.minApprovals}
                  onChange={(e) =>
                    setForm({ ...form, minApprovals: Math.max(0, Math.min(5, Number(e.target.value))) })
                  }
                />
              )}
            </Field>
            <Field label="Protected environments" hint="Comma separated.">
              {(id) => (
                <Input
                  id={id}
                  value={form.protectedEnvironments.join(', ')}
                  onChange={(e) =>
                    setForm({
                      ...form,
                      protectedEnvironments: e.target.value
                        .split(',')
                        .map((x) => x.trim())
                        .filter(Boolean)
                        .slice(0, 10),
                    })
                  }
                />
              )}
            </Field>
          </div>
        </Section>

        <Section
          title="Rule overrides"
          description="Re-classify a rule for this project's gate. Findings keep their original severity; the override and justification are recorded."
          actions={
            canEdit && (
              <Button
                size="sm"
                variant="secondary"
                icon={<Plus className="size-3.5" />}
                onClick={() =>
                  setForm({
                    ...form,
                    ruleOverrides: [
                      ...form.ruleOverrides,
                      { ruleId: '', severity: 'potentially_breaking', justification: '' },
                    ],
                  })
                }
              >
                Add override
              </Button>
            )
          }
        >
          {form.ruleOverrides.length === 0 ? (
            <p className="text-sm text-muted">No overrides. Every rule uses its documented severity.</p>
          ) : (
            <div className="space-y-3">
              {form.ruleOverrides.map((o, i) => (
                <div
                  key={i}
                  className="grid grid-cols-1 gap-2 rounded-md border border-line p-3 md:grid-cols-[1fr_200px_auto]"
                >
                  <Select
                    aria-label="Rule"
                    value={o.ruleId}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        ruleOverrides: form.ruleOverrides.map((x, j) =>
                          j === i ? { ...x, ruleId: e.target.value } : x,
                        ),
                      })
                    }
                  >
                    <option value="">Choose a rule</option>
                    {rules.data?.map((r) => (
                      <option key={r.id} value={r.id}>
                        {r.id} ({SEVERITY_LABEL[r.severity]})
                      </option>
                    ))}
                  </Select>
                  <Select
                    aria-label="Treat as"
                    value={o.severity}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        ruleOverrides: form.ruleOverrides.map((x, j) =>
                          j === i ? { ...x, severity: /** @type {FindingSeverity} */ (e.target.value) } : x,
                        ),
                      })
                    }
                  >
                    {SEVS.map((s) => (
                      <option key={s} value={s}>
                        Treat as {SEVERITY_LABEL[s].toLowerCase()}
                      </option>
                    ))}
                  </Select>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Remove override"
                    onClick={() =>
                      setForm({ ...form, ruleOverrides: form.ruleOverrides.filter((_, j) => j !== i) })
                    }
                  >
                    <Trash2 className="size-4" />
                  </Button>
                  <Textarea
                    aria-label="Justification"
                    className="min-h-14 md:col-span-3"
                    placeholder="Why is this safe for this API? At least 10 characters."
                    value={o.justification}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        ruleOverrides: form.ruleOverrides.map((x, j) =>
                          j === i ? { ...x, justification: e.target.value } : x,
                        ),
                      })
                    }
                  />
                </div>
              ))}
            </div>
          )}
          {errs.length > 0 && (
            <ul className="mt-3 text-sm text-breaking">
              {errs.map((e) => (
                <li key={e.path}>
                  {e.path}: {e.message}
                </li>
              ))}
            </ul>
          )}
        </Section>
      </fieldset>

      <Section title="Revision history" className="mt-6">
        <ol className="divide-y divide-line">
          {q.data.history.map((p) => (
            <li key={p.id} className="flex flex-wrap items-baseline justify-between gap-2 py-2.5 text-sm">
              <span>
                <strong>Revision {p.revision}</strong> <span className="text-muted">{p.name}</span>
              </span>
              <span className="font-mono text-xs text-faint">{p.version}</span>
              <span className="text-xs text-muted">
                {p.updatedBy?.name ?? 'System'}, {dateTime(p.createdAt)}, {p.ruleOverrides.length} override(s)
              </span>
            </li>
          ))}
        </ol>
      </Section>
    </>
  );
}
