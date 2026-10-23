import { describe, expect, it } from 'vitest';
import { canonicalJson } from '@jky/radar-core';
import { analyzeContracts } from '../src/index.js';
import { fixture } from './helpers.js';

describe('determinism', () => {
  it('produces byte-identical results for identical inputs', () => {
    const go = () =>
      analyzeContracts({
        baseline: { content: fixture('openapi/breaking/ecommerce-v1.yaml') },
        candidate: { content: fixture('openapi/breaking/ecommerce-v2.yaml') },
      });
    const a = go();
    const b = go();
    expect(canonicalJson(a)).toBe(canonicalJson(b));
  });

  it('fingerprints are stable across key ordering of the input document', () => {
    const v1 = JSON.parse(fixture('openapi/safe/inventory-v1.json'));
    const v2 = JSON.parse(fixture('openapi/safe/inventory-v2.json'));
    /**
     * @param {unknown} o
     * @returns {unknown}
     */
    const reorder = (o) =>
      Array.isArray(o)
        ? o.map(reorder)
        : o && typeof o === 'object'
          ? Object.fromEntries(
              Object.entries(o)
                .reverse()
                .map(([k, v]) => [k, reorder(v)]),
            )
          : o;
    const a = analyzeContracts({
      baseline: { content: JSON.stringify(v1) },
      candidate: { content: JSON.stringify(v2) },
    });
    const b = analyzeContracts({
      baseline: { content: JSON.stringify(reorder(v1)) },
      candidate: { content: JSON.stringify(reorder(v2)) },
    });
    if (a.ok === false || b.ok === false) throw new Error('analysis failed');
    expect(a.result.findings.map((f) => f.fingerprint).sort()).toEqual(
      b.result.findings.map((f) => f.fingerprint).sort(),
    );
  });

  it('identical documents produce no findings and a pass gate', () => {
    const doc = fixture('openapi/breaking/ecommerce-v1.yaml');
    const r = analyzeContracts({ baseline: { content: doc }, candidate: { content: doc } });
    if (r.ok === false) throw new Error('analysis failed');
    expect(r.result.findings).toEqual([]);
    expect(r.result.gate.decision).toBe('pass');
  });
});
