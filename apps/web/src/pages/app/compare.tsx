import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { ArrowRight, CircleAlert, CircleCheck, Radar } from 'lucide-react';
import { toast } from 'sonner';
import { PROTOCOL_LABEL } from '@jky/radar-core';
import { roleAllows } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import { EmptyState, ErrorState, Section, Skeleton } from '@/components/ui/primitives';
import { useCrumbs } from '@/components/layout/workspace';
import { useCreateAnalysis, useVersions } from '@/lib/queries';
import { dateTime, shortHash } from '@/lib/format';
import { useProjectCtx } from './project-layout';

export default function ComparePage() {
  const { project } = useProjectCtx();
  useCrumbs([
    { label: 'Projects', to: `/app/workspaces/${project.workspaceId}/projects` },
    { label: project.name, to: `/app/projects/${project.id}` },
    { label: 'Compare' },
  ]);
  const versions = useVersions(project.id);
  const run = useCreateAnalysis(project.id);
  const navigate = useNavigate();
  const [baselineId, setBaselineId] = useState('');
  const [candidateId, setCandidateId] = useState('');
  const [cross, setCross] = useState(false);
  const [polarity, setPolarity] = useState<'request' | 'response'>('response');
  const [informational, setInformational] = useState(true);
  const [aliasText, setAliasText] = useState('');
  const aliases = useMemo(() => {
    const out: Record<string, string> = {};
    const bad: string[] = [];
    for (const line of aliasText
      .split('\n')
      .map((l) => l.trim())
      .filter(Boolean)) {
      const m = /^([A-Za-z]+\s+\S+)\s*(?:->|→)\s*([A-Za-z]+\s+\S+)$/.exec(line);
      if (m) out[m[1]!] = m[2]!;
      else bad.push(line);
    }
    return { out, bad };
  }, [aliasText]);

  useEffect(() => {
    const v = versions.data;
    if (v && v.length >= 2 && !baselineId && !candidateId) {
      setCandidateId(v[0]!.id);
      setBaselineId(v[1]!.id);
    }
  }, [versions.data, baselineId, candidateId]);

  const b = versions.data?.find((v) => v.id === baselineId);
  const c = versions.data?.find((v) => v.id === candidateId);
  const compat = useMemo(() => {
    if (!b || !c) return null;
    if (b.id === c.id) return { ok: false, text: 'Choose two different versions.' };
    if (b.protocol !== c.protocol)
      return {
        ok: cross,
        text: `${PROTOCOL_LABEL[b.protocol]} and ${PROTOCOL_LABEL[c.protocol]} can only be compared through the canonical HTTP model. Results are marked lossy and coverage is partial.`,
        needsCross: true,
      };
    return { ok: true, text: `Both versions are ${PROTOCOL_LABEL[b.protocol]}. Full rule set applies.` };
  }, [b, c, cross]);

  if (!roleAllows(project.role, 'analysis.create'))
    return (
      <EmptyState
        title="Read-only access"
        body="Maintainers and above can run analyses. You can still open existing analyses from the project overview."
      />
    );
  if (versions.isLoading) return <Skeleton className="h-72" />;
  if (versions.error) return <ErrorState error={versions.error} />;
  if (versions.data!.length < 2)
    return (
      <EmptyState
        title="Two versions are needed"
        body={`This project has ${versions.data!.length} version. Upload the proposed version to compare it with the baseline.`}
        action={
          <Link to={`/app/projects/${project.id}/versions`}>
            <Button variant="primary">Upload a version</Button>
          </Link>
        }
      />
    );

  const start = () =>
    run.mutate(
      {
        baselineId,
        candidateId,
        options: {
          includeInformational: informational,
          ...(compat?.needsCross ? { allowCrossFormat: true } : {}),
          ...(b?.protocol === 'json-schema' ? { jsonSchemaPolarity: polarity } : {}),
          ...(Object.keys(aliases.out).length ? { operationAliases: aliases.out } : {}),
        },
      },
      {
        onSuccess: (a) => {
          if (a.cached) toast.info('Identical inputs were analysed before. Showing the stored result.');
          navigate(`/app/analyses/${a.id}`);
        },
        onError: (e) => toast.error((e as Error).message),
      },
    );

  const opt = (id: string) => {
    const v = versions.data!.find((x) => x.id === id)!;
    return `${v.label}  (${v.formatVersion}, ${dateTime(v.createdAt)})`;
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
      <Section
        title="Choose what to compare"
        description="The baseline is what clients use today. The candidate is what you plan to release."
      >
        <div className="grid grid-cols-1 items-end gap-4 md:grid-cols-[1fr_auto_1fr]">
          <Field label="Baseline (current)">
            {(id) => (
              <Select id={id} value={baselineId} onChange={(e) => setBaselineId(e.target.value)}>
                {versions.data!.map((v) => (
                  <option key={v.id} value={v.id}>
                    {opt(v.id)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <ArrowRight className="mx-auto mb-2.5 hidden size-5 text-muted md:block" aria-hidden />
          <Field label="Candidate (proposed)">
            {(id) => (
              <Select id={id} value={candidateId} onChange={(e) => setCandidateId(e.target.value)}>
                {versions.data!.map((v) => (
                  <option key={v.id} value={v.id}>
                    {opt(v.id)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        {compat && (
          <div
            className={`mt-5 flex items-start gap-2 rounded-md border p-3 text-sm ${compat.ok ? 'border-safe/30 bg-safe/5' : 'border-review/30 bg-review/5'}`}
          >
            {compat.ok ? (
              <CircleCheck className="mt-0.5 size-4 shrink-0 text-safe" />
            ) : (
              <CircleAlert className="mt-0.5 size-4 shrink-0 text-review" />
            )}
            <div className="space-y-2">
              <p>{compat.text}</p>
              {compat.needsCross && (
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={cross} onChange={(e) => setCross(e.target.checked)} />{' '}
                  Compare across formats (explicit opt-in)
                </label>
              )}
            </div>
          </div>
        )}

        <fieldset className="mt-5 space-y-3">
          <legend className="text-sm font-medium">Options</legend>
          {b?.protocol === 'json-schema' && (
            <div className="space-y-1.5 text-sm">
              <p className="text-fg-soft">What does this schema describe?</p>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="polarity"
                  className="mt-1"
                  checked={polarity === 'request'}
                  onChange={() => setPolarity('request')}
                />
                <span>
                  <strong className="font-medium">Data clients send</strong> (request): the new schema must
                  still accept everything that was valid.
                </span>
              </label>
              <label className="flex items-start gap-2">
                <input
                  type="radio"
                  name="polarity"
                  className="mt-1"
                  checked={polarity === 'response'}
                  onChange={() => setPolarity('response')}
                />
                <span>
                  <strong className="font-medium">Data clients receive</strong> (response): the new schema
                  must not produce anything clients did not expect.
                </span>
              </label>
            </div>
          )}
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={informational}
              onChange={(e) => setInformational(e.target.checked)}
            />{' '}
            Include documentation-only changes as informational findings
          </label>
          {b && ['openapi', 'swagger2', 'manual-rest'].includes(b.protocol) && (
            <details className="text-sm">
              <summary className="cursor-pointer text-fg-soft">
                Declare intentional renames (optional)
              </summary>
              <p className="mt-2 text-xs text-muted">
                One per line, for example <code>GET /v1/users -&gt; GET /users</code>. Renamed operations are
                compared with each other instead of being reported as removed and added. The mapping is stored
                with the analysis and written to the audit log.
              </p>
              <textarea
                aria-label="Operation renames"
                className="mt-2 min-h-20 w-full rounded-[var(--radius-control)] border border-line bg-surface px-3 py-2 font-mono text-xs"
                value={aliasText}
                onChange={(e) => setAliasText(e.target.value)}
                placeholder="GET /v1/users -> GET /users"
              />
              {aliases.bad.length > 0 && (
                <p className="text-xs text-breaking">Not understood: {aliases.bad.join('; ')}</p>
              )}
            </details>
          )}
        </fieldset>

        <div className="mt-6 flex items-center gap-3 border-t border-line pt-5">
          <Button
            variant="primary"
            size="lg"
            icon={<Radar className="size-4" />}
            loading={run.isPending}
            disabled={!compat?.ok || aliases.bad.length > 0}
            onClick={start}
          >
            Run Radar analysis
          </Button>
          <p className="text-xs text-muted">
            Runs in an isolated worker. Identical inputs return the stored result.
          </p>
        </div>
      </Section>
      <aside className="space-y-4">
        {[
          ['Baseline', b],
          ['Candidate', c],
        ].map(([label, v]) =>
          v && typeof v !== 'string' ? (
            <div key={label as string} className="panel p-4 text-sm">
              <p className="text-xs text-muted">{label as string}</p>
              <p className="mt-1 font-semibold">{v.label}</p>
              <p className="text-fg-soft">
                {PROTOCOL_LABEL[v.protocol]} {v.formatVersion}
              </p>
              <p className="mt-2 font-mono text-[11px] text-faint">{shortHash(v.rawHash, 16)}</p>
              <p className="mt-1 text-xs text-muted">
                {Object.entries(v.stats)
                  .map(([k, n]) => `${n} ${k}`)
                  .join(', ')}
              </p>
            </div>
          ) : null,
        )}
      </aside>
    </div>
  );
}
