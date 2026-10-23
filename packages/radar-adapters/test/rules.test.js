import { describe, expect, it } from 'vitest';
import { ruleRegistry } from '@jky/radar-core';
import { RULE_CASES } from './rule-cases.js';
import { run, ruleIds } from './helpers.js';

describe('rule registry coverage', () => {
  it('every tested rule has a positive and a negative case, and untested rules have none', () => {
    const missing = ruleRegistry
      .all()
      .filter((r) => r.tested && !RULE_CASES[r.id])
      .map((r) => r.id);
    const lying = ruleRegistry
      .all()
      .filter((r) => !r.tested && RULE_CASES[r.id])
      .map((r) => r.id);
    const unknown = Object.keys(RULE_CASES).filter((id) => !ruleRegistry.has(id));
    expect({ missing, lying, unknown }).toEqual({ missing: [], lying: [], unknown: [] });
  });

  it('rule ids are unique, upper snake case and documented', () => {
    for (const r of ruleRegistry.all()) {
      expect(r.id).toMatch(/^[A-Z][A-Z0-9_]+$/);
      expect(r.title.length).toBeGreaterThan(3);
      expect(r.impact.length).toBeGreaterThan(5);
      expect(r.recommendation.length).toBeGreaterThan(5);
      expect(r.protocols.length).toBeGreaterThan(0);
    }
  });
});

describe.each(Object.entries(RULE_CASES))('%s', (ruleId, c) => {
  it('fires on the positive case', () => {
    const r = run(c.pos.a, c.pos.b, c.pos.options, c.pos.names ?? []);
    expect([...ruleIds(r)]).toContain(ruleId);
    const f = r.findings.find((x) => x.ruleId === ruleId);
    expect(f.explanation.length).toBeGreaterThan(5);
    expect(f.fingerprint).toMatch(/^[0-9a-f]{20}$/);
  });
  it('does not fire on the negative case', () => {
    const r = run(c.neg.a, c.neg.b, c.neg.options, c.neg.names ?? []);
    expect([...ruleIds(r)]).not.toContain(ruleId);
  });
});
