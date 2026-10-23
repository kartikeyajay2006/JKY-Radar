import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import type { AnalysisOptions } from '@jky/radar-core';
import { analyzeContracts } from '../src/index.js';
import { checkExpectations, FIXTURES, fixture, type Expectation } from './helpers.js';

interface ManifestEntry {
  id: string;
  baseline: string;
  candidate: string;
  options?: AnalysisOptions;
  expect: Expectation;
}
const manifest = JSON.parse(readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8')) as ManifestEntry[];

describe.each(manifest.map((m) => [m.id, m] as const))('fixture %s', (_id, m) => {
  it('matches the expected gate, coverage and findings', () => {
    const out = analyzeContracts({
      baseline: { content: fixture(m.baseline), fileName: m.baseline },
      candidate: { content: fixture(m.candidate), fileName: m.candidate },
      options: m.options ?? {},
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(checkExpectations(out.result, m.expect)).toEqual([]);
  });
});

describe('expectation harness', () => {
  it('detects missing engine output (tests fail if rule logic is removed)', () => {
    const errors = checkExpectations(
      { findings: [], gate: { decision: 'pass' } as never, coverage: { level: 'full' } as never },
      manifest.find((m) => m.id === 'openapi-ecommerce')!.expect,
    );
    expect(errors).toContain('gate pass !== block');
    expect(errors).toContain('missing HTTP_OPERATION_REMOVED');
  });
});

describe('e-commerce demo specifics', () => {
  const out = analyzeContracts({
    baseline: { content: fixture('openapi/breaking/ecommerce-v1.yaml') },
    candidate: { content: fixture('openapi/breaking/ecommerce-v2.yaml') },
  });
  if (!out.ok) throw new Error('fixture failed');
  const r = out.result;
  it('reports the removed email at every usage site of Customer', () => {
    const paths = r.findings.filter((f) => f.ruleId === 'RES_PROPERTY_REMOVED').map((f) => f.logicalPath);
    expect(paths).toEqual(
      expect.arrayContaining([
        'GET /customers/{customerId} › response 200 › body.email',
        'GET /orders › response 200 › body.items[].customer.email',
      ]),
    );
  });
  it('attaches line-accurate source pointers', () => {
    const removed = r.findings.find((f) => f.ruleId === 'HTTP_OPERATION_REMOVED')!;
    expect(removed.baselineSource?.jsonPointer).toBe('/paths/~1orders~1{orderId}/get');
    const lines = fixture('openapi/breaking/ecommerce-v1.yaml').split('\n');
    expect(lines[removed.baselineSource!.line! - 1]).toMatch(/get:/);
  });
  it('sets entity keys for consumer impact joins', () => {
    expect(r.findings.find((f) => f.ruleId === 'HTTP_OPERATION_REMOVED')!.entityKey).toBe('GET /orders/{}');
  });
});

describe('GraphQL input forms', () => {
  it('SDL and introspection JSON of the same schemas yield the same findings', () => {
    const run = (a: string, b: string) => {
      const out = analyzeContracts({
        baseline: { content: fixture(a), fileName: a },
        candidate: { content: fixture(b), fileName: b },
      });
      if (!out.ok) throw new Error(out.message);
      return out.result.findings.map((f) => `${f.ruleId} ${f.logicalPath}`).sort();
    };
    expect(run('graphql/bookstore-v1.introspection.json', 'graphql/bookstore-v2.introspection.json')).toEqual(
      run('graphql/bookstore-v1.graphql', 'graphql/bookstore-v2.graphql'),
    );
  });
});

describe('operation aliases', () => {
  const doc = (path: string, extra = '') =>
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 't', version: '1' },
      paths: {
        [path]: {
          get: { responses: { '200': { description: 'ok' } }, ...(extra ? { summary: extra } : {}) },
        },
      },
    });
  it('a declared rename is compared instead of reported as removed + added', () => {
    const without = analyzeContracts({
      baseline: { content: doc('/v1/users') },
      candidate: { content: doc('/users', 'moved') },
    });
    const withAlias = analyzeContracts({
      baseline: { content: doc('/v1/users') },
      candidate: { content: doc('/users', 'moved') },
      options: { operationAliases: { 'GET /v1/users': 'GET /users' } },
    });
    if (!without.ok || !withAlias.ok) throw new Error('analysis failed');
    expect(without.result.findings.map((f) => f.ruleId)).toContain('HTTP_OPERATION_REMOVED');
    const ids = withAlias.result.findings.map((f) => f.ruleId);
    expect(ids).not.toContain('HTTP_OPERATION_REMOVED');
    expect(ids).toContain('HTTP_DOCS_CHANGED');
  });
});
