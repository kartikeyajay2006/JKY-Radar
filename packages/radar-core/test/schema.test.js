/** @import { SchemaDialect } from '../src/index.js' */
import { describe, expect, it } from 'vitest';
import { createNormalizeContext, FindingEmitter, normalizeSchema, SchemaComparator } from '../src/index.js';

/**
 * @param {unknown} raw
 * @param {SchemaDialect} dialect
 * @param {unknown} [root]
 */
const norm = (raw, dialect, root = raw) =>
  normalizeSchema(
    raw,
    '',
    createNormalizeContext(root, dialect, () => undefined),
  );
/**
 * @param {unknown} a
 * @param {unknown} b
 * @param {'request' | 'response'} pol
 * @param {SchemaDialect} [da]
 * @param {SchemaDialect} [db]
 */
const diff = (a, b, pol, da = 'oas31', db = 'oas31') => {
  const em = new FindingEmitter({ protocol: 'openapi' });
  new SchemaComparator().emitComparison(em, norm(a, da), norm(b, db), pol, { logicalPath: 'body' });
  return em.findings().map((x) => x.ruleId);
};

describe('dialect normalisation', () => {
  it('OAS 3.0 nullable equals OAS 3.1 type null (no false positive)', () => {
    expect(
      diff({ type: 'string', nullable: true }, { type: ['string', 'null'] }, 'response', 'oas30', 'oas31'),
    ).toEqual([]);
    expect(
      diff({ type: 'string', nullable: true }, { type: ['string', 'null'] }, 'request', 'oas30', 'oas31'),
    ).toEqual([]);
  });
  it('legacy boolean exclusiveMinimum equals numeric exclusiveMinimum', () => {
    expect(
      diff(
        { type: 'number', minimum: 0, exclusiveMinimum: true },
        { type: 'number', exclusiveMinimum: 0 },
        'request',
        'oas30',
        'oas31',
      ),
    ).toEqual([]);
  });
  it('minimum → exclusiveMinimum at the same value is a tightening', () => {
    expect(diff({ type: 'number', minimum: 0 }, { type: 'number', exclusiveMinimum: 0 }, 'request')).toEqual([
      'REQ_CONSTRAINT_TIGHTENED',
    ]);
  });
  it('integer → number is widening for requests and changing for responses', () => {
    expect(diff({ type: 'integer' }, { type: 'number' }, 'request')).toEqual(['REQ_TYPE_WIDENED']);
    expect(diff({ type: 'integer' }, { type: 'number' }, 'response')).toEqual(['RES_TYPE_CHANGED']);
  });
});

describe('polarity', () => {
  const a = { type: 'object', properties: { x: { type: 'string' } } };
  const b = { type: 'object', properties: { x: { type: 'string' }, y: { type: 'string' } }, required: ['y'] };
  it('new required property: breaking for requests, additive for responses', () => {
    expect(diff(a, b, 'request')).toEqual(['REQ_PROPERTY_REQUIRED_ADDED']);
    expect(diff(a, b, 'response')).toEqual(['RES_PROPERTY_ADDED']);
  });
  it('readOnly properties are not required inputs', () => {
    const ro = { type: 'object', properties: { id: { type: 'string', readOnly: true } }, required: ['id'] };
    expect(diff({ type: 'object', properties: {} }, ro, 'request')).toEqual([]);
  });
});

describe('references', () => {
  it('handles circular local references without infinite recursion', () => {
    const root = {
      $defs: {
        Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' }, v: { type: 'string' } } },
      },
    };
    const root2 = {
      $defs: {
        Node: { type: 'object', properties: { child: { $ref: '#/$defs/Node' }, v: { type: 'integer' } } },
      },
    };
    const n1 = normalizeSchema(
      { $ref: '#/$defs/Node' },
      '/x',
      createNormalizeContext(root, 'draft2020', () => undefined),
    );
    const n2 = normalizeSchema(
      { $ref: '#/$defs/Node' },
      '/x',
      createNormalizeContext(root2, 'draft2020', () => undefined),
    );
    expect(n1.properties.child).toBe(n1);
    const em = new FindingEmitter({ protocol: 'json-schema' });
    new SchemaComparator().emitComparison(em, n1, n2, 'response', { logicalPath: '$' });
    expect(em.findings().map((f) => f.logicalPath)).toEqual(['$.v']);
  });
  it('merges simple allOf members', () => {
    const s = norm(
      {
        allOf: [
          { type: 'object', properties: { a: { type: 'string' } }, required: ['a'] },
          { type: 'object', properties: { b: { type: 'string' } } },
        ],
      },
      'oas31',
    );
    expect(s.mergedAllOf).toBe(true);
    expect(Object.keys(s.properties)).toEqual(['a', 'b']);
    expect(s.required).toEqual(['a']);
  });
});

describe('additional properties compatibility', () => {
  it.each([
    [true, { type: 'string' }, 'request', 'REQ_TYPE_NARROWED'],
    [undefined, { type: 'string' }, 'request', 'REQ_TYPE_NARROWED'],
    [{ type: 'string' }, true, 'response', 'RES_TYPE_CHANGED'],
    [false, true, 'response', 'RES_CONSTRAINT_RELAXED'],
    [false, undefined, 'response', 'RES_CONSTRAINT_RELAXED'],
    [false, { type: 'string' }, 'response', 'RES_CONSTRAINT_RELAXED'],
    [true, false, 'response', 'RES_CONSTRAINT_TIGHTENED'],
    [{ type: 'string' }, true, 'request', 'REQ_TYPE_WIDENED'],
    [false, true, 'request', 'REQ_CONSTRAINT_RELAXED'],
  ])('compares %j → %j with %s polarity', (before, after, polarity, rule) => {
    expect(
      diff(
        { type: 'object', additionalProperties: before },
        { type: 'object', additionalProperties: after },
        /** @type {'request' | 'response'} */ (polarity),
      ),
    ).toContain(rule);
  });
  it('treats omitted, true and empty schemas as equivalent', () => {
    for (const polarity of /** @type {const} */ (['request', 'response'])) {
      for (const before of [undefined, true, {}]) {
        for (const after of [undefined, true, {}]) {
          expect(diff({ additionalProperties: before }, { additionalProperties: after }, polarity)).toEqual(
            [],
          );
        }
      }
      expect(diff({ additionalProperties: false }, { additionalProperties: false }, polarity)).toEqual([]);
    }
  });
  it('compares constraints inside additional property schemas', () => {
    expect(
      diff(
        { additionalProperties: { type: 'string', minLength: 1 } },
        { additionalProperties: { type: 'string', minLength: 3 } },
        'request',
      ),
    ).toEqual(['REQ_CONSTRAINT_TIGHTENED']);
  });
});

describe('required properties without definitions', () => {
  it.each([
    ['request', [], ['token'], 'REQ_PROPERTY_BECAME_REQUIRED'],
    ['request', ['token'], [], 'REQ_PROPERTY_BECAME_OPTIONAL'],
    ['response', ['token'], [], 'RES_PROPERTY_BECAME_OPTIONAL'],
    ['response', [], ['token'], 'RES_PROPERTY_BECAME_REQUIRED'],
  ])('compares requiredness with %s polarity', (polarity, before, after, rule) => {
    expect(
      diff(
        { type: 'object', required: before },
        { type: 'object', required: after },
        /** @type {'request' | 'response'} */ (polarity),
      ),
    ).toEqual([rule]);
  });
  it('does not report unchanged required fields', () => {
    expect(diff({ required: ['token'] }, { required: ['token'] }, 'request')).toEqual([]);
  });
});
