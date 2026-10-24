import { useState } from 'react';
import { Check, Copy, KeyRound, Plus } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Dialog } from '@/components/ui/overlay';
import { EmptyState, ErrorState, PageHeader, Section, Skeleton } from '@/components/ui/primitives';
import { useConfirm } from '@/components/ui/confirm';
import { useCrumbs } from '@/components/layout/workspace';
import { useCreateToken, useRevokeToken, useTokens } from '@/lib/queries';
import { API } from '@/lib/api';
import { dateTime, timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useProjectCtx } from './project-layout';

const EXPIRY = [30, 90, 180, 365];
const STATUS_TONE = {
  active: 'border-safe/40 text-safe',
  expired: 'border-line-strong text-muted',
  revoked: 'border-breaking/40 text-breaking',
};

/** @param {{ text: string; label: string }} props */
function CopyButton({ text, label }) {
  const [done, setDone] = useState(false);
  return (
    <Button
      size="sm"
      variant="secondary"
      aria-label={label}
      icon={done ? <Check className="size-4" /> : <Copy className="size-4" />}
      onClick={async () => {
        await navigator.clipboard?.writeText(text).catch(() => undefined);
        setDone(true);
        setTimeout(() => setDone(false), 1600);
      }}
    >
      {done ? 'Copied' : 'Copy'}
    </Button>
  );
}

/** @param {{ code: string; label: string }} props */
function Snippet({ code, label }) {
  return (
    <div className="relative overflow-hidden rounded-[var(--radius-control)] border border-line bg-code">
      <div className="absolute top-2 right-2">
        <CopyButton text={code} label={`Copy ${label}`} />
      </div>
      <pre
        className="scroll-thin overflow-x-auto p-4 pr-24 font-mono text-[12px] leading-relaxed"
        tabIndex={0}
      >
        {code}
      </pre>
    </div>
  );
}

export default function CiAccessPage() {
  const { project } = useProjectCtx();
  useCrumbs([
    { label: 'Projects', to: `/app/workspaces/${project.workspaceId}/projects` },
    { label: project.name, to: `/app/projects/${project.id}` },
    { label: 'CI access' },
  ]);
  const q = useTokens(project.id);
  const create = useCreateToken(project.id);
  const revoke = useRevokeToken(project.id);
  const confirm = useConfirm();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('GitHub Actions');
  const [days, setDays] = useState(90);
  const [secret, setSecret] = useState(/** @type {string | null} */ (null));

  const server = new URL(API, window.location.origin).origin;
  const curl = `curl -sS -X POST "$JKY_RADAR_URL/api/v1/ci/check" \\
  -H "Authorization: Bearer $JKY_RADAR_TOKEN" \\
  -H "Content-Type: application/json" \\
  --data "$(jq -n --rawfile c openapi.yaml --arg l "$GITHUB_SHA" '{candidate: {label: $l, content: $c}}')" \\
  | tee radar.json | jq -e '.data.gate.decision == "pass" or .data.gate.decision == "warn"'`;
  const workflow = `- name: Check the API contract with JKY-Radar
  env:
    JKY_RADAR_URL: ${server}
    JKY_RADAR_TOKEN: \${{ secrets.JKY_RADAR_TOKEN }}
  run: npm run radar -- check openapi.yaml --label "\${{ github.sha }}"`;

  return (
    <>
      <PageHeader
        title="CI access"
        description="Tokens let a pipeline upload a new version of this project's contract and get the release gate back in one call. A token can do nothing else, works only for this project, and acts with its creator's permissions."
        actions={
          <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setOpen(true)}>
            Create token
          </Button>
        }
      />

      <div className="space-y-6">
        <Section
          title="Tokens"
          description="Only a hash of each token is stored. Revoking takes effect immediately."
        >
          {q.isLoading ? (
            <Skeleton className="h-24" />
          ) : q.error ? (
            <ErrorState error={q.error} retry={() => q.refetch()} />
          ) : q.data.length === 0 ? (
            <EmptyState
              icon={<KeyRound className="size-5" />}
              title="No tokens yet"
              body="Create a token, store it as a secret in your CI provider, and every pull request can be checked against the last released contract."
            />
          ) : (
            <div className="-mx-5 -my-5 overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="border-b border-line text-left text-xs text-muted">
                  <tr>
                    <th className="px-5 py-3 font-medium">Name</th>
                    <th className="px-5 py-3 font-medium">Token</th>
                    <th className="px-5 py-3 font-medium">Created by</th>
                    <th className="px-5 py-3 font-medium">Last used</th>
                    <th className="px-5 py-3 font-medium">Expires</th>
                    <th className="px-5 py-3 font-medium">Status</th>
                    <th className="px-5 py-3">
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {q.data.map((t) => (
                    <tr key={t.id} className="border-b border-line last:border-0">
                      <td className="px-5 py-3 font-medium">{t.name}</td>
                      <td className="px-5 py-3 font-mono text-xs text-fg-soft">{t.prefix}…</td>
                      <td className="px-5 py-3 text-fg-soft">{t.createdBy?.name ?? '—'}</td>
                      <td className="px-5 py-3 text-fg-soft">
                        {t.lastUsedAt ? timeAgo(t.lastUsedAt) : 'Never'}
                      </td>
                      <td className="px-5 py-3 text-fg-soft" title={dateTime(t.expiresAt)}>
                        {dateTime(t.expiresAt)}
                      </td>
                      <td className="px-5 py-3">
                        <span
                          className={cn(
                            'inline-flex rounded border px-1.5 py-0.5 text-xs capitalize',
                            STATUS_TONE[t.status],
                          )}
                        >
                          {t.status}
                        </span>
                      </td>
                      <td className="px-5 py-3 text-right">
                        {t.status === 'active' && (
                          <Button
                            size="sm"
                            variant="danger"
                            loading={revoke.isPending && revoke.variables === t.id}
                            onClick={async () => {
                              if (
                                await confirm({
                                  title: `Revoke ${t.name}?`,
                                  body: 'Pipelines using this token will fail their check until they get a new one.',
                                  confirmLabel: 'Revoke token',
                                  danger: true,
                                })
                              )
                                revoke.mutate(t.id, { onSuccess: () => toast.success('Token revoked') });
                            }}
                          >
                            Revoke
                          </Button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Section>

        <Section
          title="Use it in a pipeline"
          description="Store the token as a secret named JKY_RADAR_TOKEN. The step fails unless the gate passes or warns."
        >
          <div className="space-y-5">
            <div>
              <h3 className="mb-2 text-sm font-medium">From any CI, with curl and jq</h3>
              <Snippet code={curl} label="curl command" />
            </div>
            <div>
              <h3 className="mb-2 text-sm font-medium">
                With the JKY-Radar CLI, in a workflow that has this repository checked out
              </h3>
              <Snippet code={workflow} label="workflow step" />
            </div>
            <p className="text-xs text-muted">
              The candidate is compared with the newest earlier version unless you pass{' '}
              <code className="font-mono">baseline</code> (a version label or id). Re-running on identical
              content reuses the stored version and analysis.
            </p>
          </div>
        </Section>
      </div>

      <Dialog
        open={open}
        onOpenChange={(o) => {
          setOpen(o);
          if (!o) {
            setSecret(null);
            create.reset();
          }
        }}
        title={secret ? 'Copy your token now' : 'Create a CI token'}
        description={
          secret
            ? 'This is the only time it is shown. Store it as a secret in your CI provider.'
            : `For ${project.name} only. It acts with your permissions in this workspace.`
        }
        footer={
          secret ? (
            <Button variant="primary" onClick={() => setOpen(false)}>
              Done
            </Button>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                loading={create.isPending}
                disabled={!name.trim()}
                onClick={() =>
                  create.mutate(
                    { name: name.trim(), expiresInDays: days },
                    { onSuccess: (d) => setSecret(d.secret) },
                  )
                }
              >
                Create token
              </Button>
            </>
          )
        }
      >
        {secret ? (
          <div className="flex items-center gap-2">
            <code className="min-w-0 flex-1 truncate rounded-[var(--radius-control)] border border-line bg-code px-3 py-2 font-mono text-xs">
              {secret}
            </code>
            <CopyButton text={secret} label="Copy token" />
          </div>
        ) : (
          <div className="space-y-4">
            <Field label="Name" hint="Where the token is used, so you can recognise it later.">
              {(id, describedBy) => (
                <Input
                  id={id}
                  aria-describedby={describedBy}
                  value={name}
                  maxLength={60}
                  onChange={(e) => setName(e.target.value)}
                />
              )}
            </Field>
            <Field label="Expires after">
              {(id) => (
                <Select id={id} value={days} onChange={(e) => setDays(Number(e.target.value))}>
                  {EXPIRY.map((d) => (
                    <option key={d} value={d}>
                      {d} days
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {create.error && (
              <p role="alert" className="text-sm text-breaking">
                {create.error.message}
              </p>
            )}
          </div>
        )}
      </Dialog>
    </>
  );
}
