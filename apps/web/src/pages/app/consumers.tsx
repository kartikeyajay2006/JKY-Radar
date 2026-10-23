import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { Plus, Trash2, Users } from 'lucide-react';
import { toast } from 'sonner';
import { CRITICALITIES, roleAllows, type ConsumerDTO } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Dialog } from '@/components/ui/overlay';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { useCrumbs } from '@/components/layout/workspace';
import { api } from '@/lib/api';
import { useConsumers, useEntities, useInvalidate } from '@/lib/queries';
import { timeAgo } from '@/lib/format';
import { cn } from '@/lib/cn';
import { useProjectCtx } from './project-layout';
import { useConfirm } from '@/components/ui/confirm';

const CRIT_CLS = {
  critical: 'text-breaking',
  high: 'text-potential',
  medium: 'text-review',
  low: 'text-muted',
} as const;

function ConsumerForm({
  initial,
  onSubmit,
  pending,
}: {
  initial?: Partial<ConsumerDTO>;
  onSubmit: (v: {
    name: string;
    owner: string;
    team: string;
    contact: string;
    criticality: string;
    description: string;
  }) => void;
  pending: boolean;
}) {
  const [v, setV] = useState({
    name: initial?.name ?? '',
    owner: initial?.owner ?? '',
    team: initial?.team ?? '',
    contact: initial?.contact ?? '',
    criticality: (initial?.criticality ?? 'medium') as string,
    description: initial?.description ?? '',
  });
  return (
    <form
      className="space-y-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit(v);
      }}
    >
      <Field label="Application name">
        {(id) => (
          <Input
            id={id}
            value={v.name}
            onChange={(e) => setV({ ...v, name: e.target.value })}
            required
            placeholder="Checkout iOS app"
          />
        )}
      </Field>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Owner">
          {(id) => (
            <Input
              id={id}
              value={v.owner}
              onChange={(e) => setV({ ...v, owner: e.target.value })}
              placeholder="Jane Doe"
            />
          )}
        </Field>
        <Field label="Team">
          {(id) => (
            <Input
              id={id}
              value={v.team}
              onChange={(e) => setV({ ...v, team: e.target.value })}
              placeholder="Mobile"
            />
          )}
        </Field>
      </div>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Contact">
          {(id) => (
            <Input
              id={id}
              value={v.contact}
              onChange={(e) => setV({ ...v, contact: e.target.value })}
              placeholder="#mobile-oncall"
            />
          )}
        </Field>
        <Field label="Criticality">
          {(id) => (
            <Select
              id={id}
              value={v.criticality}
              onChange={(e) => setV({ ...v, criticality: e.target.value })}
            >
              {CRITICALITIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      <Field label="Description">
        {(id) => (
          <Textarea
            id={id}
            className="min-h-16"
            value={v.description}
            onChange={(e) => setV({ ...v, description: e.target.value })}
          />
        )}
      </Field>
      <div className="flex justify-end">
        <Button type="submit" variant="primary" loading={pending} disabled={v.name.trim().length < 2}>
          Save consumer
        </Button>
      </div>
    </form>
  );
}

function DependencyEditor({
  c,
  projectId,
  canEdit,
}: {
  c: ConsumerDTO;
  projectId: string;
  canEdit: boolean;
}) {
  const entities = useEntities(projectId);
  const inv = useInvalidate();
  const [key, setKey] = useState('');
  const [evidence, setEvidence] = useState('manual');
  const add = useMutation({
    mutationFn: () =>
      api.post(`/consumers/${c.id}/dependencies`, { operationKey: key, evidenceSource: evidence }),
    onSuccess: async () => {
      setKey('');
      await inv(['consumers', projectId]);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const del = useMutation({
    mutationFn: (did: string) => api.del(`/consumers/${c.id}/dependencies/${did}`),
    onSuccess: () => inv(['consumers', projectId]),
  });
  const listId = `entities-${c.id}`;
  return (
    <div className="space-y-2">
      {c.dependencies.length === 0 ? (
        <p className="text-xs text-muted">
          No dependencies registered. Impact cannot be computed for this consumer yet.
        </p>
      ) : (
        <ul className="flex flex-wrap gap-1.5">
          {c.dependencies.map((d) => (
            <li
              key={d.id}
              className="inline-flex items-center gap-1.5 rounded-[4px] border border-line bg-raised px-2 py-1 font-mono text-xs"
              title={`${d.evidenceSource}, confirmed ${timeAgo(d.lastConfirmedAt)}`}
            >
              {d.operationKey}
              {canEdit && (
                <button
                  type="button"
                  aria-label={`Remove ${d.operationKey}`}
                  className="text-muted hover:text-breaking"
                  onClick={() => del.mutate(d.id)}
                >
                  <Trash2 className="size-3" />
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
      {canEdit && (
        <form
          className="flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (key.trim()) add.mutate();
          }}
        >
          <Input
            list={listId}
            value={key}
            onChange={(e) => setKey(e.target.value)}
            placeholder="GET /orders/{id}, Book.isbn, pkg.Service/Method…"
            className="min-w-56 flex-1 font-mono text-xs"
            aria-label="Operation the consumer depends on"
          />
          <datalist id={listId}>
            {entities.data?.map((e) => (
              <option key={e.key} value={e.key}>
                {e.label}
              </option>
            ))}
          </datalist>
          <Select
            value={evidence}
            onChange={(e) => setEvidence(e.target.value)}
            aria-label="Evidence"
            className="w-44"
          >
            <option value="manual">Manually declared</option>
            <option value="owner-confirmed">Confirmed by owner</option>
            <option value="code-search">Found in code search</option>
            <option value="documentation">From documentation</option>
            <option value="traffic-sample">From traffic sample</option>
          </Select>
          <Button
            type="submit"
            size="md"
            variant="secondary"
            loading={add.isPending}
            icon={<Plus className="size-4" />}
          >
            Add
          </Button>
        </form>
      )}
    </div>
  );
}

export default function ConsumersPage() {
  const { project } = useProjectCtx();
  useCrumbs([
    { label: 'Projects', to: `/app/workspaces/${project.workspaceId}/projects` },
    { label: project.name, to: `/app/projects/${project.id}` },
    { label: 'Consumers' },
  ]);
  const q = useConsumers(project.id);
  const inv = useInvalidate();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<ConsumerDTO | null>(null);
  const canEdit = roleAllows(project.role, 'consumer.manage');
  const confirm = useConfirm();
  const create = useMutation({
    mutationFn: (v: object) => api.post(`/projects/${project.id}/consumers`, v),
    onSuccess: async () => {
      toast.success('Consumer registered');
      setCreating(false);
      await inv(['consumers', project.id]);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const update = useMutation({
    mutationFn: (v: object) => api.patch(`/consumers/${editing!.id}`, v),
    onSuccess: async () => {
      toast.success('Consumer updated');
      setEditing(null);
      await inv(['consumers', project.id]);
    },
    onError: (e) => toast.error((e as Error).message),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.del(`/consumers/${id}`),
    onSuccess: async () => {
      toast.success('Consumer removed');
      await inv(['consumers', project.id]);
    },
  });

  return (
    <>
      <PageHeader
        title="Consumers"
        description="Applications that call this API and the operations they rely on. Impact analysis uses only what is registered here; JKY-Radar does not discover usage."
        actions={
          canEdit && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              Register consumer
            </Button>
          )
        }
      />
      {q.isLoading ? (
        <Skeleton className="h-48" />
      ) : q.error ? (
        <ErrorState error={q.error} />
      ) : q.data!.length === 0 ? (
        <EmptyState
          icon={<Users className="size-5" />}
          title="No consumers registered"
          body="Add the apps, jobs and partner integrations that call this API, with their owners and how critical they are."
          action={
            canEdit && (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Register the first consumer
              </Button>
            )
          }
        />
      ) : (
        <div className="space-y-3">
          {q.data!.map((c) => (
            <article key={c.id} className="panel p-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <h2 className="text-base font-semibold">{c.name}</h2>
                  <p className="text-sm text-muted">
                    <span className={cn('font-medium capitalize', CRIT_CLS[c.criticality])}>
                      {c.criticality}
                    </span>
                    {[c.owner, c.team, c.contact].filter(Boolean).length
                      ? `, ${[c.owner, c.team, c.contact].filter(Boolean).join(', ')}`
                      : ''}
                  </p>
                  {c.description && <p className="mt-1 text-sm text-fg-soft">{c.description}</p>}
                </div>
                {canEdit && (
                  <div className="flex gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(c)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-breaking"
                      onClick={async () =>
                        (await confirm({
                          title: `Remove ${c.name}?`,
                          body: 'Its registered dependencies are removed too. Past analyses are not changed.',
                          confirmLabel: 'Remove consumer',
                          danger: true,
                        })) && remove.mutate(c.id)
                      }
                    >
                      Remove
                    </Button>
                  </div>
                )}
              </div>
              <div className="mt-4 border-t border-line pt-4">
                <DependencyEditor c={c} projectId={project.id} canEdit={canEdit} />
              </div>
            </article>
          ))}
        </div>
      )}
      <Dialog
        open={creating}
        onOpenChange={setCreating}
        title="Register a consumer"
        description="You can add the operations it depends on after saving."
      >
        <ConsumerForm onSubmit={(v) => create.mutate(v)} pending={create.isPending} />
      </Dialog>
      <Dialog
        open={!!editing}
        onOpenChange={(o) => !o && setEditing(null)}
        title={`Edit ${editing?.name ?? ''}`}
      >
        {editing && (
          <ConsumerForm initial={editing} onSubmit={(v) => update.mutate(v)} pending={update.isPending} />
        )}
      </Dialog>
    </>
  );
}
