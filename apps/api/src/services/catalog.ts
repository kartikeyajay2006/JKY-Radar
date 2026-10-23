import { parseContract } from '@jky/radar-adapters';
import type { GraphQLSchema } from 'graphql';
import { operationKey, type HttpContractModel, type ParsedContract, type Protocol } from '@jky/radar-core';

/** Entity keys (operations / coordinates / RPCs / channels) a consumer can depend on. */
export function entityCatalog(
  content: string,
  protocol: Protocol,
  fileName?: string,
): Array<{ key: string; label: string; kind: string }> {
  const out = parseContract({ content, protocol, ...(fileName ? { fileName } : {}) });
  if (!out.ok) return [];
  const c = out.contract as ParsedContract<{ kind: string } & Record<string, unknown>>;
  const m = c.model;
  switch (m.kind) {
    case 'http':
      return (m as unknown as HttpContractModel).operations.map((o) => ({
        key: o.displayKey,
        label: o.summary ?? o.operationId ?? o.displayKey,
        kind: 'operation',
      }));
    case 'postman':
      return (m as unknown as { requests: Array<{ method: string; path: string; id: string }> }).requests.map(
        (r) => ({
          key: operationKey(r.method, r.path).replace(/\{\}/g, '{param}'),
          label: r.id,
          kind: 'request',
        }),
      );
    case 'graphql': {
      const schema = (m as unknown as { schema: GraphQLSchema }).schema;
      const keys: Array<{ key: string; label: string; kind: string }> = [];
      for (const t of Object.values(schema.getTypeMap())) {
        if (t.name.startsWith('__') || !('getFields' in t)) continue;
        keys.push({ key: t.name, label: `type ${t.name}`, kind: 'type' });
        for (const f of Object.keys((t as { getFields(): Record<string, unknown> }).getFields()))
          keys.push({ key: `${t.name}.${f}`, label: `${t.name}.${f}`, kind: 'field' });
      }
      return keys;
    }
    case 'grpc': {
      const pm = m as unknown as {
        package: string;
        services: Record<string, { methods: Record<string, unknown> }>;
      };
      return Object.entries(pm.services).flatMap(([s, svc]) =>
        Object.keys(svc.methods).map((mn) => ({
          key: `${pm.package ? `${pm.package}.` : ''}${s}/${mn}`,
          label: `${s}.${mn}`,
          kind: 'rpc',
        })),
      );
    }
    case 'async':
      return Object.keys((m as unknown as { channels: Record<string, unknown> }).channels).map((ch) => ({
        key: ch,
        label: ch,
        kind: 'channel',
      }));
    case 'json-schema':
      return [{ key: '$', label: 'Document root', kind: 'schema' }];
    default:
      return [];
  }
}
