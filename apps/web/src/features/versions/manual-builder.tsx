import { useEffect, useMemo, useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';

interface Param {
  name: string;
  in: 'path' | 'query' | 'header' | 'cookie';
  required: boolean;
  type: string;
}
interface Endpoint {
  method: string;
  path: string;
  summary: string;
  params: Param[];
  bodyRequired: boolean;
  bodySchema: string;
  responses: Array<{ status: string; schema: string }>;
}

const blank = (): Endpoint => ({
  method: 'GET',
  path: '/',
  summary: '',
  params: [],
  bodyRequired: false,
  bodySchema: '',
  responses: [{ status: '200', schema: '{ "type": "object", "properties": {} }' }],
});

function parseJson(s: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!s.trim()) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(s) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

/** Builds a "jkyManualRest" document for APIs that have no machine-readable contract. */
export function ManualBuilder({ onChange }: { onChange: (content: string | null, error?: string) => void }) {
  const [title, setTitle] = useState('');
  const [version, setVersion] = useState('1.0.0');
  const [eps, setEps] = useState<Endpoint[]>([blank()]);
  const update = (i: number, patch: Partial<Endpoint>) =>
    setEps((list) => list.map((e, j) => (j === i ? { ...e, ...patch } : e)));

  const built = useMemo(() => {
    const endpoints = [];
    for (const e of eps) {
      const body = parseJson(e.bodySchema);
      if (!body.ok)
        return { error: `${e.method} ${e.path}: request schema is not valid JSON (${body.error})` };
      const responses = [];
      for (const r of e.responses) {
        const sc = parseJson(r.schema);
        if (!sc.ok)
          return {
            error: `${e.method} ${e.path} response ${r.status}: schema is not valid JSON (${sc.error})`,
          };
        responses.push({
          status: r.status,
          contentType: 'application/json',
          ...(sc.value !== undefined ? { schema: sc.value } : {}),
        });
      }
      endpoints.push({
        method: e.method,
        path: e.path,
        ...(e.summary ? { summary: e.summary } : {}),
        parameters: e.params
          .filter((p) => p.name)
          .map((p) => ({
            name: p.name,
            in: p.in,
            required: p.in === 'path' || p.required,
            schema: { type: p.type },
          })),
        ...(body.value !== undefined
          ? { requestBody: { required: e.bodyRequired, contentType: 'application/json', schema: body.value } }
          : {}),
        responses,
      });
    }
    return {
      content: JSON.stringify(
        { jkyManualRest: '1.0', title: title || 'Manual contract', version, endpoints },
        null,
        2,
      ),
    };
  }, [eps, title, version]);

  useEffect(() => onChange(built.content ?? null, built.error), [built]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="API title">
          {(id) => (
            <Input
              id={id}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Billing service"
            />
          )}
        </Field>
        <Field label="API version">
          {(id) => <Input id={id} value={version} onChange={(e) => setVersion(e.target.value)} />}
        </Field>
      </div>
      {eps.map((e, i) => (
        <fieldset key={i} className="space-y-3 rounded-[var(--radius-panel)] border border-line p-4">
          <legend className="px-1 text-sm font-medium">Endpoint {i + 1}</legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[120px_1fr_1fr]">
            <Select
              aria-label="HTTP method"
              value={e.method}
              onChange={(ev) => update(i, { method: ev.target.value })}
            >
              {['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].map((m) => (
                <option key={m}>{m}</option>
              ))}
            </Select>
            <Input
              aria-label="Path"
              value={e.path}
              onChange={(ev) => update(i, { path: ev.target.value })}
              placeholder="/invoices/{invoiceId}"
              className="font-mono"
            />
            <Input
              aria-label="Summary"
              value={e.summary}
              onChange={(ev) => update(i, { summary: ev.target.value })}
              placeholder="Summary (optional)"
            />
          </div>
          <div className="space-y-2">
            <p className="text-xs text-muted">Parameters</p>
            {e.params.map((p, j) => (
              <div key={j} className="grid grid-cols-[1fr_110px_110px_auto_auto] items-center gap-2">
                <Input
                  aria-label="Parameter name"
                  value={p.name}
                  onChange={(ev) =>
                    update(i, {
                      params: e.params.map((x, k) => (k === j ? { ...x, name: ev.target.value } : x)),
                    })
                  }
                  placeholder="name"
                />
                <Select
                  aria-label="Location"
                  value={p.in}
                  onChange={(ev) =>
                    update(i, {
                      params: e.params.map((x, k) =>
                        k === j ? { ...x, in: ev.target.value as Param['in'] } : x,
                      ),
                    })
                  }
                >
                  {['path', 'query', 'header', 'cookie'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
                <Select
                  aria-label="Type"
                  value={p.type}
                  onChange={(ev) =>
                    update(i, {
                      params: e.params.map((x, k) => (k === j ? { ...x, type: ev.target.value } : x)),
                    })
                  }
                >
                  {['string', 'integer', 'number', 'boolean'].map((x) => (
                    <option key={x}>{x}</option>
                  ))}
                </Select>
                <label className="flex items-center gap-1 text-xs">
                  <input
                    type="checkbox"
                    checked={p.required || p.in === 'path'}
                    disabled={p.in === 'path'}
                    onChange={(ev) =>
                      update(i, {
                        params: e.params.map((x, k) => (k === j ? { ...x, required: ev.target.checked } : x)),
                      })
                    }
                  />{' '}
                  required
                </label>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="Remove parameter"
                  onClick={() => update(i, { params: e.params.filter((_, k) => k !== j) })}
                >
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-3.5" />}
              onClick={() =>
                update(i, {
                  params: [...e.params, { name: '', in: 'query', required: false, type: 'string' }],
                })
              }
            >
              Add parameter
            </Button>
          </div>
          {e.method !== 'GET' && e.method !== 'HEAD' && (
            <Field label="Request body JSON Schema" hint="Leave empty for no body.">
              {(id) => (
                <>
                  <Textarea
                    id={id}
                    className="font-mono text-xs"
                    value={e.bodySchema}
                    onChange={(ev) => update(i, { bodySchema: ev.target.value })}
                    placeholder='{ "type": "object", "required": ["amount"], "properties": { "amount": { "type": "number" } } }'
                  />
                  <label className="mt-1.5 flex items-center gap-2 text-xs">
                    <input
                      type="checkbox"
                      checked={e.bodyRequired}
                      onChange={(ev) => update(i, { bodyRequired: ev.target.checked })}
                    />{' '}
                    Body is required
                  </label>
                </>
              )}
            </Field>
          )}
          {e.responses.map((r, j) => (
            <div key={j} className="grid grid-cols-1 gap-2 sm:grid-cols-[90px_1fr]">
              <Input
                aria-label="Status"
                value={r.status}
                onChange={(ev) =>
                  update(i, {
                    responses: e.responses.map((x, k) => (k === j ? { ...x, status: ev.target.value } : x)),
                  })
                }
              />
              <Textarea
                aria-label={`Response ${r.status} schema`}
                className="min-h-16 font-mono text-xs"
                value={r.schema}
                onChange={(ev) =>
                  update(i, {
                    responses: e.responses.map((x, k) => (k === j ? { ...x, schema: ev.target.value } : x)),
                  })
                }
              />
            </div>
          ))}
          <div className="flex justify-between">
            <Button
              size="sm"
              variant="ghost"
              icon={<Plus className="size-3.5" />}
              onClick={() => update(i, { responses: [...e.responses, { status: '404', schema: '' }] })}
            >
              Add response
            </Button>
            {eps.length > 1 && (
              <Button size="sm" variant="danger" onClick={() => setEps((l) => l.filter((_, k) => k !== i))}>
                Remove endpoint
              </Button>
            )}
          </div>
        </fieldset>
      ))}
      <Button
        variant="secondary"
        icon={<Plus className="size-4" />}
        onClick={() => setEps((l) => [...l, blank()])}
      >
        Add endpoint
      </Button>
      {built.error && <p className="text-sm text-breaking">{built.error}</p>}
    </div>
  );
}
