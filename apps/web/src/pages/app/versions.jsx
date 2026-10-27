import { lazy, Suspense, useRef, useState } from 'react';
import { FileUp, ShieldCheck, Upload } from 'lucide-react';
import { toast } from 'sonner';
import { PROTOCOL_LABEL, PROTOCOL_FAMILY } from '@jky/radar-core';
import { roleAllows } from '@jky/shared';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import { Dialog, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/overlay';
import { EmptyState, ErrorState, Section, Skeleton } from '@/components/ui/primitives';
import { ProtocolBadge } from '@/components/radar/badges';
import { useCrumbs } from '@/components/layout/workspace';
import { useUploadVersion, useVersionContent, useVersions } from '@/lib/queries';
import { ApiError } from '@/lib/api';
import { bytes, dateTime, shortHash } from '@/lib/format';
import { cn } from '@/lib/cn';
import { ManualBuilder } from '@/features/versions/manual-builder';
import { useProjectCtx } from './project-layout';

/** @import { DragEvent } from 'react' */
/** @import { Diagnostic, Protocol } from '@jky/radar-core' */
/** @import { VersionDTO } from '@jky/shared' */

const CodePane = lazy(() => import('@/components/radar/code-pane'));
const ACCEPT = '.json,.yaml,.yml,.graphql,.gql,.proto,.txt';

/** @param {{ list: Diagnostic[] }} props */
function Diagnostics({ list }) {
  if (!list.length) return null;
  return (
    <ul className="space-y-1.5 rounded-md border border-breaking/30 bg-breaking/5 p-3 text-sm" role="alert">
      {list.slice(0, 12).map((d, i) => (
        <li key={i} className="flex flex-wrap gap-x-2">
          <span className={d.severity === 'error' ? 'text-breaking' : 'text-review'}>{d.severity}</span>
          {d.source?.line && <span className="text-muted">line {d.source.line}</span>}
          <span className="font-mono text-xs text-faint">{d.code}</span>
          <span className="min-w-0 flex-1">{d.message}</span>
        </li>
      ))}
    </ul>
  );
}

function UploadPanel() {
  const { project } = useProjectCtx();
  const upload = useUploadVersion(project.id);
  const [mode, setMode] = useState(project.protocol === 'manual-rest' ? 'build' : 'file');
  const [label, setLabel] = useState('');
  const [file, setFile] = useState(/** @type {File | null} */ (null));
  const [paste, setPaste] = useState('');
  const [built, setBuilt] = useState(
    /** @type {{ content: string | null; error?: string }} */ ({ content: null }),
  );
  const [protocol, setProtocol] = useState(/** @type {Protocol | ''} */ (''));
  const [drag, setDrag] = useState(false);
  const input = useRef(/** @type {HTMLInputElement} */ (null));
  const err = upload.error instanceof ApiError ? upload.error : null;
  const diags = /** @type {Diagnostic[]} */ (
    /** @type {{ diagnostics?: Diagnostic[] } | undefined} */ (err?.details)?.diagnostics ?? []
  );
  const errLine = diags.find((d) => d.source?.line)?.source?.line;
  const sameFamily = /** @type {Protocol[]} */ (Object.keys(PROTOCOL_LABEL)).filter(
    (p) => p !== 'postman3' && PROTOCOL_FAMILY[p] === PROTOCOL_FAMILY[project.protocol],
  );

  /** @param {DragEvent} e */
  const onDrop = (e) => {
    e.preventDefault();
    setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) pick(f);
  };
  /** @param {File} f */
  const pick = (f) => {
    setFile(f);
    upload.reset();
    if (!label) setLabel(f.name.replace(/\.[^.]+$/, '').slice(0, 60));
  };
  const submit = () => {
    const common = { label: label.trim(), ...(protocol ? { protocol } : {}) };
    const body =
      mode === 'file' && file
        ? { ...common, file }
        : mode === 'paste'
          ? { ...common, content: paste }
          : {
              ...common,
              content: built.content ?? '',
              protocol: /** @type {Protocol} */ ('manual-rest'),
              fileName: 'manual-contract.json',
            };
    upload.mutate(body, {
      onSuccess: (v) => {
        toast.success(
          `Saved ${v.label} (${PROTOCOL_LABEL[v.protocol]} ${v.formatVersion})${v.redactions.length ? `, ${v.redactions.length} secret value(s) redacted` : ''}`,
        );
        setFile(null);
        setPaste('');
        setLabel('');
      },
    });
  };
  const ready =
    label.trim().length > 0 &&
    ((mode === 'file' && !!file) ||
      (mode === 'paste' && paste.trim().length > 0) ||
      (mode === 'build' && !!built.content && !built.error));

  return (
    <Section
      title="Add a version"
      description="Versions are immutable. Secret-looking values are redacted before storage."
    >
      <Tabs value={mode} onValueChange={(v) => (setMode(v), upload.reset())}>
        <TabsList>
          <TabsTrigger value="file">Upload file</TabsTrigger>
          <TabsTrigger value="paste">Paste</TabsTrigger>
          {PROTOCOL_FAMILY[project.protocol] === 'http' && (
            <TabsTrigger value="build">Build manually</TabsTrigger>
          )}
        </TabsList>
        <div className="pt-4">
          <TabsContent value="file">
            <div
              onDragOver={(e) => (e.preventDefault(), setDrag(true))}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              className={cn(
                'flex flex-col items-center justify-center gap-2 rounded-[var(--radius-panel)] border-2 border-dashed px-6 py-10 text-center transition-colors',
                drag ? 'border-accent bg-accent-soft' : 'border-line-strong',
              )}
            >
              <FileUp className="size-7 text-muted" aria-hidden />
              {file ? (
                <p className="text-sm">
                  <span className="font-medium">{file.name}</span>{' '}
                  <span className="text-muted">{bytes(file.size)}</span>
                </p>
              ) : (
                <p className="text-sm text-fg-soft">Drop a contract file here</p>
              )}
              <p className="text-xs text-muted">
                .json, .yaml, .graphql, .proto up to 2 MB. Format is detected from the content.
              </p>
              <Button size="sm" variant="secondary" onClick={() => input.current?.click()}>
                Choose file
              </Button>
              <input
                ref={input}
                type="file"
                accept={ACCEPT}
                className="sr-only"
                aria-label="Choose contract file"
                onChange={(e) => e.target.files?.[0] && pick(e.target.files[0])}
              />
            </div>
          </TabsContent>
          <TabsContent value="paste">
            <p className="mb-3 text-sm text-muted">
              Paste an API contract, such as OpenAPI or JSON Schema. A sample response like{' '}
              <code>{'{"name":"Alex","email":"a@b.com"}'}</code> describes data, but does not declare field
              types or requirements.
              {PROTOCOL_FAMILY[project.protocol] === 'http' &&
                ' Use Build manually to describe your REST endpoint and its fields.'}
            </p>
            <details className="mb-3 text-sm text-muted">
              <summary className="cursor-pointer">Show a contract example</summary>
              <p className="my-2">
                {PROTOCOL_FAMILY[project.protocol] === 'http'
                  ? 'This OpenAPI contract describes a response with name and email fields.'
                  : 'This JSON Schema describes the fields in the sample data. Use it in a JSON Schema project; other project types require their own contract format.'}
              </p>
              <pre className="overflow-x-auto rounded-md border border-line p-3 text-xs select-text">
                {JSON.stringify(
                  PROTOCOL_FAMILY[project.protocol] === 'http'
                    ? {
                        openapi: '3.0.3',
                        info: { title: 'Users API', version: '1.0.0' },
                        paths: {
                          '/users': {
                            get: {
                              responses: {
                                200: {
                                  description: 'User',
                                  content: {
                                    'application/json': {
                                      schema: {
                                        type: 'object',
                                        properties: {
                                          name: { type: 'string' },
                                          email: { type: 'string' },
                                        },
                                      },
                                    },
                                  },
                                },
                              },
                            },
                          },
                        },
                      }
                    : {
                        $schema: 'https://json-schema.org/draft/2020-12/schema',
                        type: 'object',
                        properties: { name: { type: 'string' }, email: { type: 'string' } },
                      },
                  null,
                  2,
                )}
              </pre>
            </details>
            <div className="panel overflow-hidden">
              <Suspense fallback={<Skeleton className="h-72 rounded-none" />}>
                <CodePane
                  value={paste}
                  editable
                  onChange={(v) => (setPaste(v), upload.isError && upload.reset())}
                  height="300px"
                  ariaLabel="Paste contract content"
                  highlights={errLine ? [{ line: errLine, kind: 'del' }] : []}
                  scrollTo={errLine ?? null}
                />
              </Suspense>
            </div>
          </TabsContent>
          <TabsContent value="build">
            <ManualBuilder
              onChange={(content, error) => setBuilt({ content, ...(error ? { error } : {}) })}
            />
          </TabsContent>
        </div>
      </Tabs>
      <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-[1fr_240px_auto] sm:items-end">
        <Field label="Version label" hint="For example v2.3.0 or release-2024-10.">
          {(id, d) => (
            <Input
              id={id}
              aria-describedby={d}
              value={label}
              onChange={(e) => setLabel(e.target.value)}
              maxLength={60}
              placeholder="v2.0.0"
            />
          )}
        </Field>
        {mode !== 'build' ? (
          <Field label="Format" hint="Auto-detect is recommended.">
            {(id, d) => (
              <Select
                id={id}
                aria-describedby={d}
                value={protocol}
                onChange={(e) => setProtocol(/** @type {Protocol | ''} */ (e.target.value))}
              >
                <option value="">Detect automatically</option>
                {sameFamily.map((p) => (
                  <option key={p} value={p}>
                    {PROTOCOL_LABEL[p]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : (
          <div />
        )}
        <Button
          variant="primary"
          icon={<Upload className="size-4" />}
          loading={upload.isPending}
          disabled={!ready}
          onClick={submit}
          className="sm:mb-[22px]"
        >
          Save version
        </Button>
      </div>
      {err && (
        <div className="mt-4 space-y-2">
          {diags.length ? (
            <Diagnostics list={diags} />
          ) : (
            <p role="alert" className="text-sm font-medium text-breaking">
              {err.message}
            </p>
          )}
        </div>
      )}
    </Section>
  );
}

/** @param {{ v: VersionDTO | null; onClose: () => void }} props */
function VersionDialog({ v, onClose }) {
  const content = useVersionContent(v?.id);
  return (
    <Dialog
      open={!!v}
      onOpenChange={(o) => !o && onClose()}
      title={v ? `${v.label}` : ''}
      description={
        v
          ? `${PROTOCOL_LABEL[v.protocol]} ${v.formatVersion}, uploaded ${dateTime(v.createdAt)} by ${v.uploadedBy.name}`
          : undefined
      }
      wide
    >
      {v && (
        <div className="space-y-4">
          <dl className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt className="text-xs text-muted">SHA-256 of stored content</dt>
              <dd className="font-mono text-xs break-all">{v.rawHash}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Normalised hash (key order insensitive)</dt>
              <dd className="font-mono text-xs break-all">{v.normalizedHash}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Detection</dt>
              <dd>
                {v.detection.confidence} confidence{v.detection.overridden ? ', overridden by uploader' : ''}:{' '}
                {v.detection.reasons.join('; ')}
              </dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Contents</dt>
              <dd>
                {Object.entries(v.stats)
                  .map(([k, n]) => `${n} ${k}`)
                  .join(', ')}
              </dd>
            </div>
          </dl>
          {v.redactions.length > 0 && (
            <p className="flex items-start gap-2 rounded-md border border-safe/30 bg-safe/5 p-3 text-sm">
              <ShieldCheck className="mt-0.5 size-4 text-safe" />
              {v.redactions.length} secret-looking value(s) were replaced with [REDACTED] before storage
              (lines{' '}
              {v.redactions
                .slice(0, 8)
                .map((r) => r.line)
                .join(', ')}
              ).
            </p>
          )}
          {v.ignoredConstructs.length > 0 && (
            <p className="text-sm text-muted">Present but not compared: {v.ignoredConstructs.join(', ')}.</p>
          )}
          {v.diagnostics.length > 0 && (
            <ul className="space-y-1 text-sm">
              {v.diagnostics.map((d, i) => (
                <li key={i} className="text-fg-soft">
                  <span className={d.severity === 'warning' ? 'text-review' : 'text-muted'}>
                    {d.severity}
                  </span>{' '}
                  {d.source?.line ? `line ${d.source.line}: ` : ''}
                  {d.message}
                </li>
              ))}
            </ul>
          )}
          <div className="panel overflow-hidden">
            {content.data ? (
              <Suspense fallback={<Skeleton className="h-80 rounded-none" />}>
                <CodePane
                  value={content.data.content}
                  fileName={content.data.fileName}
                  height="420px"
                  ariaLabel={`${v.label} contract content`}
                />
              </Suspense>
            ) : content.error ? (
              <ErrorState error={content.error} />
            ) : (
              <Skeleton className="h-80 rounded-none" />
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

export default function VersionsPage() {
  const { project } = useProjectCtx();
  useCrumbs([
    { label: 'Projects', to: `/app/workspaces/${project.workspaceId}/projects` },
    { label: project.name, to: `/app/projects/${project.id}` },
    { label: 'Versions' },
  ]);
  const q = useVersions(project.id);
  const [open, setOpen] = useState(/** @type {VersionDTO | null} */ (null));
  const canWrite = roleAllows(project.role, 'version.create');
  return (
    <div className="space-y-6">
      {canWrite ? (
        <UploadPanel />
      ) : (
        <p className="text-sm text-muted">Your role is read-only. Maintainers can upload versions.</p>
      )}
      <Section
        title="Version history"
        description="Newest first. Click a version to inspect its content, hashes and diagnostics."
      >
        {q.isLoading ? (
          <Skeleton className="h-40" />
        ) : q.error ? (
          <ErrorState error={q.error} retry={() => q.refetch()} />
        ) : q.data.length === 0 ? (
          <EmptyState
            title="No versions yet"
            body="Upload the version currently in production first; it becomes your baseline."
          />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px] text-sm">
              <thead className="border-b border-line text-left text-xs text-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Label</th>
                  <th className="py-2 pr-4 font-medium">Format</th>
                  <th className="py-2 pr-4 font-medium">Size</th>
                  <th className="py-2 pr-4 font-medium">SHA-256</th>
                  <th className="py-2 pr-4 font-medium">Notes</th>
                  <th className="py-2 font-medium">Uploaded</th>
                </tr>
              </thead>
              <tbody>
                {q.data.map((v) => (
                  <tr key={v.id} className="border-b border-line last:border-0">
                    <td className="py-2.5 pr-4">
                      <button
                        type="button"
                        className="font-medium hover:text-accent hover:underline"
                        onClick={() => setOpen(v)}
                      >
                        {v.label}
                      </button>
                      {v.apiVersion && <span className="ml-2 text-xs text-muted">info {v.apiVersion}</span>}
                    </td>
                    <td className="py-2.5 pr-4">
                      <ProtocolBadge protocol={v.protocol} version={v.formatVersion} />
                    </td>
                    <td className="tabular py-2.5 pr-4 text-fg-soft">{bytes(v.size)}</td>
                    <td className="py-2.5 pr-4 font-mono text-xs text-fg-soft">{shortHash(v.rawHash, 12)}</td>
                    <td className="py-2.5 pr-4 text-xs text-muted">
                      {[
                        v.diagnostics.length ? `${v.diagnostics.length} diagnostic(s)` : '',
                        v.redactions.length ? `${v.redactions.length} redacted` : '',
                        v.ignoredConstructs.length ? `${v.ignoredConstructs.length} not compared` : '',
                      ]
                        .filter(Boolean)
                        .join(', ') || '—'}
                    </td>
                    <td className="py-2.5 text-xs whitespace-nowrap text-muted">
                      {v.uploadedBy.name}, {dateTime(v.createdAt)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Section>
      <VersionDialog v={open} onClose={() => setOpen(null)} />
    </div>
  );
}
