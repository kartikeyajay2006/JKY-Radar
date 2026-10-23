import { parseContract } from '@jky/radar-adapters';

import { operationKey } from '@jky/radar-core';

/** @import { GraphQLSchema } from 'graphql' */
/** @import { HttpContractModel, ParsedContract, Protocol } from '@jky/radar-core' */

/**
 * Entity keys (operations / coordinates / RPCs / channels) a consumer can depend on.
 * @param {string} content
 * @param {Protocol} protocol
 * @param {string} [fileName]
 * @returns {Array<{ key: string; label: string; kind: string }>}
 */
export function entityCatalog(content, protocol, fileName) {
  const out = parseContract({ content, protocol, ...(fileName ? { fileName } : {}) });
  if (out.ok === false) return [];
  const c = /** @type {ParsedContract<{ kind: string } & Record<string, unknown>>} */ (out.contract);
  const m = c.model;
  switch (m.kind) {
    case 'http':
      return /** @type {HttpContractModel} */ (m).operations.map((o) => ({
        key: o.displayKey,
        label: o.summary ?? o.operationId ?? o.displayKey,
        kind: 'operation',
      }));
    case 'postman':
      return /** @type {{ requests: Array<{ method: string; path: string; id: string }> }} */ (
        /** @type {unknown} */ (m)
      ).requests.map((r) => ({
        key: operationKey(r.method, r.path).replace(/\{\}/g, '{param}'),
        label: r.id,
        kind: 'request',
      }));
    case 'graphql': {
      const schema = /** @type {{ schema: GraphQLSchema }} */ (/** @type {unknown} */ (m)).schema;
      /** @type {Array<{ key: string; label: string; kind: string }>} */
      const keys = [];
      for (const t of Object.values(schema.getTypeMap())) {
        if (t.name.startsWith('__') || !('getFields' in t)) continue;
        keys.push({ key: t.name, label: `type ${t.name}`, kind: 'type' });
        for (const f of Object.keys(/** @type {{ getFields(): Record<string, unknown> }} */ (t).getFields()))
          keys.push({ key: `${t.name}.${f}`, label: `${t.name}.${f}`, kind: 'field' });
      }
      return keys;
    }
    case 'grpc': {
      const pm =
        /** @type {{ package: string; services: Record<string, { methods: Record<string, unknown> }>; }} */ (
          /** @type {unknown} */ (m)
        );
      return Object.entries(pm.services).flatMap(([s, svc]) =>
        Object.keys(svc.methods).map((mn) => ({
          key: `${pm.package ? `${pm.package}.` : ''}${s}/${mn}`,
          label: `${s}.${mn}`,
          kind: 'rpc',
        })),
      );
    }
    case 'async':
      return Object.keys(
        /** @type {{ channels: Record<string, unknown> }} */ (/** @type {unknown} */ (m)).channels,
      ).map((ch) => ({
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
