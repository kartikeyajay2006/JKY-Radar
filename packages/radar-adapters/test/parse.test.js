import { describe, expect, it } from 'vitest';
import { detectFormat, parseContract, parseStructured } from '../src/index.js';
import { fixture } from './helpers.js';

describe('structured parser', () => {
  it('maps JSON pointers to line/column for JSON', () => {
    const doc = parseStructured('{\n  "a": {\n    "b/c": [1, {"d": true}]\n  }\n}');
    expect(doc.value).toEqual({ a: { 'b/c': [1, { d: true }] } });
    expect(doc.locate('/a/b~1c')).toMatchObject({ line: 3, column: 5 });
    expect(doc.locate('/a/b~1c/1/d')).toMatchObject({ line: 3 });
  });
  it('maps JSON pointers to line/column for YAML', () => {
    const doc = parseStructured('a:\n  b:\n    - x\n    - y: 1\n');
    expect(doc.locate('/a/b/1/y')).toMatchObject({ line: 4 });
  });
  it('parses JSON string escapes', () => {
    expect(parseStructured('{"s":"a\\n\\u00e9\\"/"}').value).toEqual({ s: 'a\né"/' });
  });
  it('rejects trailing commas and garbage', () => {
    expect(() => parseStructured('{"a":1,}')).toThrow();
    expect(() => parseStructured('{"a":1} x')).toThrow();
  });
});

describe('format detection', () => {
  it('rejects sample payloads with actionable contract guidance', () => {
    const result = parseContract({ content: '{"name":"Alex","email":"a@b.com"}' });
    expect(result.ok).toBe(false);
    if (result.ok !== false) return;
    expect(result.diagnostics[0]).toMatchObject({ code: 'UNKNOWN_FORMAT' });
    expect(result.diagnostics[0].message).toContain('sample data, not a contract');
    expect(result.diagnostics[0].message).toContain('Build manually');
  });
  it('accepts a schema describing the sample payload', () => {
    const result = parseContract({
      content: JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        properties: { name: { type: 'string' }, email: { type: 'string' } },
      }),
    });
    expect(result.ok).toBe(true);
    expect(result.detection.protocol).toBe('json-schema');
  });
  it.each([
    ['openapi/breaking/ecommerce-v1.yaml', 'openapi'],
    ['swagger2/petstore-swagger2.yaml', 'swagger2'],
    ['graphql/bookstore-v1.graphql', 'graphql'],
    ['postman2/payments-v1.postman_collection.json', 'postman2'],
    ['json-schema/user-profile-v1.json', 'json-schema'],
    ['protobuf/orders-v1.proto', 'grpc'],
    ['asyncapi/order-events-v1.yaml', 'asyncapi'],
    ['manual/billing-v1.json', 'manual-rest'],
  ])('%s → %s', (file, protocol) => {
    expect(detectFormat(fixture(file)).protocol).toBe(protocol);
  });
  it('detects by structure, not file extension', () => {
    expect(detectFormat(fixture('openapi/breaking/ecommerce-v1.yaml'), 'misleading.graphql').protocol).toBe(
      'openapi',
    );
    expect(detectFormat(fixture('graphql/bookstore-v1.graphql'), 'schema.txt').protocol).toBe('graphql');
    expect(detectFormat('{"openapi":"3.0.0","info":{},"paths":{}}', 'x.graphql').protocol).toBe('openapi');
  });
  it('detects GraphQL introspection JSON', () => {
    expect(detectFormat('{"data":{"__schema":{"types":[]}}}').protocol).toBe('graphql');
  });
});
