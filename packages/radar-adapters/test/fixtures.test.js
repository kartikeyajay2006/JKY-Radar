/** @import { AnalysisOptions } from '@jky/radar-core' */
/** @import { Expectation } from './helpers.js' */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';

import { analyzeContracts } from '../src/index.js';
import { checkExpectations, FIXTURES, fixture } from './helpers.js';

/**
 * @typedef {Object} ManifestEntry
 * @property {string} id
 * @property {string} baseline
 * @property {string} candidate
 * @property {AnalysisOptions} [options]
 * @property {Expectation} expect
 */
const manifest = /** @type {ManifestEntry[]} */ (
  JSON.parse(readFileSync(path.join(FIXTURES, 'manifest.json'), 'utf8'))
);

describe.each(manifest.map((m) => /** @type {const} */ ([m.id, m])))('fixture %s', (_id, m) => {
  it('matches the expected gate, coverage and findings', () => {
    const out = analyzeContracts({
      baseline: { content: fixture(m.baseline), fileName: m.baseline },
      candidate: { content: fixture(m.candidate), fileName: m.candidate },
      options: m.options ?? {},
    });
    expect(out.ok).toBe(true);
    if (out.ok === false) return;
    expect(checkExpectations(out.result, m.expect)).toEqual([]);
  });
});

describe('expectation harness', () => {
  it('detects missing engine output (tests fail if rule logic is removed)', () => {
    const errors = checkExpectations(
      {
        findings: [],
        gate: /** @type {never} */ ({ decision: 'pass' }),
        coverage: /** @type {never} */ ({ level: 'full' }),
      },
      manifest.find((m) => m.id === 'openapi-ecommerce').expect,
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
  if (out.ok === false) throw new Error('fixture failed');
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
    const removed = r.findings.find((f) => f.ruleId === 'HTTP_OPERATION_REMOVED');
    expect(removed.baselineSource?.jsonPointer).toBe('/paths/~1orders~1{orderId}/get');
    const lines = fixture('openapi/breaking/ecommerce-v1.yaml').split('\n');
    expect(lines[removed.baselineSource.line - 1]).toMatch(/get:/);
  });
  it('sets entity keys for consumer impact joins', () => {
    expect(r.findings.find((f) => f.ruleId === 'HTTP_OPERATION_REMOVED').entityKey).toBe('GET /orders/{}');
  });
});

describe('GraphQL input forms', () => {
  it('SDL and introspection JSON of the same schemas yield the same findings', () => {
    /**
     * @param {string} a
     * @param {string} b
     */
    const run = (a, b) => {
      const out = analyzeContracts({
        baseline: { content: fixture(a), fileName: a },
        candidate: { content: fixture(b), fileName: b },
      });
      if (out.ok === false) throw new Error(out.message);
      return out.result.findings.map((f) => `${f.ruleId} ${f.logicalPath}`).sort();
    };
    expect(run('graphql/bookstore-v1.introspection.json', 'graphql/bookstore-v2.introspection.json')).toEqual(
      run('graphql/bookstore-v1.graphql', 'graphql/bookstore-v2.graphql'),
    );
  });
});

describe('operation aliases', () => {
  /** @param {string} path */
  const doc = (path, extra = '') =>
    JSON.stringify({
      openapi: '3.1.0',
      info: { title: 't', version: '1' },
      paths: {
        [path]: {
          get: { responses: { 200: { description: 'ok' } }, ...(extra ? { summary: extra } : {}) },
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
    if (without.ok === false || withAlias.ok === false) throw new Error('analysis failed');
    expect(without.result.findings.map((f) => f.ruleId)).toContain('HTTP_OPERATION_REMOVED');
    const ids = withAlias.result.findings.map((f) => f.ruleId);
    expect(ids).not.toContain('HTTP_OPERATION_REMOVED');
    expect(ids).toContain('HTTP_DOCS_CHANGED');
  });
});

describe('schema release gate regressions', () => {
  it.each([
    [{ additionalProperties: true }, { additionalProperties: { type: 'string' } }, 'request', 'block'],
    [{ additionalProperties: false }, { additionalProperties: true }, 'response', 'warn'],
    [{ required: [] }, { required: ['token'] }, 'request', 'block'],
  ])('gates %j → %j with %s polarity as %s', (before, after, polarity, expectedGate) => {
    const input = (schema) => ({
      content: JSON.stringify({
        $schema: 'https://json-schema.org/draft/2020-12/schema',
        type: 'object',
        ...schema,
      }),
    });
    const outcome = analyzeContracts({
      baseline: input(before),
      candidate: input(after),
      options: { jsonSchemaPolarity: /** @type {'request' | 'response'} */ (polarity) },
    });
    expect(outcome.ok).toBe(true);
    if (!outcome.ok) return;
    expect(outcome.result.gate.decision).toBe(expectedGate);
    expect(outcome.result.findings.length).toBeGreaterThan(0);
  });
});
