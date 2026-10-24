/** @import { Protocol } from '@jky/radar-core' */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router';
import { Plus, Search } from 'lucide-react';
import { toast } from 'sonner';
import { PROTOCOL_LABEL } from '@jky/radar-core';
import { roleAllows } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { Dialog } from '@/components/ui/overlay';
import { EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/primitives';
import { GateBadge, ProtocolBadge } from '@/components/radar/badges';
import { useCrumbs, useCurrentWorkspace } from '@/components/layout/workspace';
import { useCapabilities, useCreateProject, useProjects, useWorkspace } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { timeAgo } from '@/lib/format';

/** @type {Protocol[]} */
const PROTOCOLS = [
  'openapi',
  'swagger2',
  'graphql',
  'postman2',
  'json-schema',
  'manual-rest',
  'grpc',
  'asyncapi',
];

/** @param {{ wid: string; open: boolean; onOpenChange: (o: boolean) => void; }} props */
export function CreateProjectDialog({ wid, open, onOpenChange }) {
  const caps = useCapabilities();
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [protocol, setProtocol] = useState(/** @type {Protocol} */ ('openapi'));
  const m = useCreateProject(wid);
  const navigate = useNavigate();
  /** @param {Protocol} p */
  const status = (p) => caps.data?.adapters.find((a) => a.protocol === p)?.status;
  const errs =
    m.error instanceof ApiError && Array.isArray(m.error.details)
      ? Object.fromEntries(
          /** @type {Array<{ path: string; message: string }>} */ (m.error.details).map((d) => [
            d.path,
            d.message,
          ]),
        )
      : {};
  return (
    <Dialog
      open={open}
      onOpenChange={onOpenChange}
      title="Create a project"
      description="A project tracks one API contract across versions."
      footer={
        <>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            loading={m.isPending}
            disabled={name.trim().length < 2}
            onClick={() =>
              m.mutate(
                { name, description, protocol },
                {
                  onSuccess: (p) => {
                    toast.success(`Created ${p.name}`);
                    onOpenChange(false);
                    navigate(`/app/projects/${p.id}/versions`);
                  },
                },
              )
            }
          >
            Create project
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <Field label="Name" error={errs.name}>
          {(id) => (
            <Input
              id={id}
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Payments API"
              autoFocus
            />
          )}
        </Field>
        <Field
          label="Contract format"
          hint="Versions of the same family can be compared, e.g. Swagger 2.0 and OpenAPI 3 with cross-format mode."
        >
          {(id, d) => (
            <Select
              id={id}
              aria-describedby={d}
              value={protocol}
              onChange={(e) => setProtocol(/** @type {Protocol} */ (e.target.value))}
            >
              {PROTOCOLS.map((p) => (
                <option key={p} value={p}>
                  {PROTOCOL_LABEL[p]}
                  {status(p) && status(p) !== 'supported' ? ` (${status(p)})` : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Description" hint="Optional.">
          {(id) => (
            <Textarea
              id={id}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              maxLength={500}
              className="min-h-20"
            />
          )}
        </Field>
        {m.error && !Object.keys(errs).length && (
          <p className="text-sm text-breaking">{/** @type {Error} */ (m.error).message}</p>
        )}
      </div>
    </Dialog>
  );
}

export default function ProjectsPage() {
  const { wid } = useParams();
  const ws = useWorkspace(wid);
  const { setCurrent } = useCurrentWorkspace();
  const [search, setSearch] = useState('');
  const [creating, setCreating] = useState(false);
  const q = useProjects(wid, search);
  useCrumbs([{ label: ws.data?.name ?? 'Workspace', to: '/app' }, { label: 'Projects' }]);
  useEffect(() => {
    if (ws.data && wid) setCurrent(wid);
  }, [ws.data, wid]); // eslint-disable-line react-hooks/exhaustive-deps
  const canCreate = ws.data ? roleAllows(ws.data.role, 'project.create') : false;

  return (
    <>
      <PageHeader
        title="Projects"
        description="Each project is one API contract with its version history, consumers and release policy."
        actions={
          canCreate && (
            <Button variant="primary" icon={<Plus className="size-4" />} onClick={() => setCreating(true)}>
              New project
            </Button>
          )
        }
      />
      <div className="relative mb-5 max-w-sm">
        <Search className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-faint" />
        <Input
          className="pl-8"
          placeholder="Search projects"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search projects"
        />
      </div>
      {ws.error ? (
        <ErrorState error={ws.error} />
      ) : q.isLoading ? (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-40" />
          ))}
        </div>
      ) : q.error ? (
        <ErrorState error={q.error} retry={() => q.refetch()} />
      ) : q.data.length === 0 ? (
        <EmptyState
          title={search ? 'No projects match your search' : 'No projects yet'}
          body={
            search
              ? 'Try another name.'
              : canCreate
                ? 'Create a project for the API you want to protect.'
                : 'Ask a maintainer to create a project.'
          }
          action={
            canCreate && !search ? (
              <Button variant="primary" onClick={() => setCreating(true)}>
                Create a project
              </Button>
            ) : undefined
          }
        />
      ) : (
        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {q.data.map((p) => (
            <Link
              key={p.id}
              to={`/app/projects/${p.id}`}
              className="panel lift group flex flex-col gap-3 p-5 hover:border-line-strong"
            >
              <div className="flex items-start justify-between gap-2">
                <h2 className="min-w-0 truncate text-base font-semibold group-hover:text-accent">{p.name}</h2>
                {p.latestAnalysis && <GateBadge decision={p.latestAnalysis.gate} />}
              </div>
              <ProtocolBadge protocol={p.protocol} className="self-start" />
              <p className="line-clamp-2 min-h-10 text-sm text-muted">{p.description || 'No description'}</p>
              <p className="mt-auto border-t border-line pt-3 text-xs text-muted">
                {p.versionCount} version{p.versionCount === 1 ? '' : 's'}
                {p.latestVersion ? `, latest ${p.latestVersion.label}` : ''}, updated {timeAgo(p.updatedAt)}
              </p>
            </Link>
          ))}
        </div>
      )}
      {wid && <CreateProjectDialog wid={wid} open={creating} onOpenChange={setCreating} />}
    </>
  );
}
