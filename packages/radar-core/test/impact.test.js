/** @import { Finding } from '../src/index.js' */
import { describe, expect, it } from 'vitest';
import { computeImpact, normalizeDependencyKey } from '../src/index.js';

/**
 * @param {string} ruleId
 * @param {Finding['severity']} severity
 * @param {string} [entityKey]
 * @returns {Finding}
 */
const f = (ruleId, severity, entityKey) => ({
  ruleId,
  severity,
  protocol: 'openapi',
  title: '',
  explanation: '',
  impact: '',
  recommendation: '',
  logicalPath: entityKey ?? 'global',
  evidenceLevel: 'contract_proven',
  fingerprint: `${ruleId}-${entityKey}`,
  tags: [],
  ...(entityKey ? { entityKey } : {}),
});

describe('consumer impact', () => {
  it('normalises dependency keys like operations', () => {
    expect(normalizeDependencyKey('get /orders/{orderId}/')).toBe('GET /orders/{}');
    expect(normalizeDependencyKey('Query.books')).toBe('Query.books');
  });
  it('separates known, potential and unmatched impact', () => {
    const r = computeImpact(
      [
        f('HTTP_OPERATION_REMOVED', 'breaking', 'GET /orders/{}'),
        f('HTTP_SERVER_REMOVED', 'needs_review'),
        f('HTTP_OPERATION_REMOVED', 'breaking', 'GET /legacy'),
        f('HTTP_OPERATION_ADDED', 'non_breaking', 'GET /new'),
      ],
      [
        {
          id: 'c1',
          name: 'Mobile app',
          criticality: 'critical',
          dependencies: [{ operationKey: 'GET /orders/{id}' }],
        },
        { id: 'c2', name: 'Reporting', criticality: 'low', dependencies: [{ operationKey: 'GET /reports' }] },
        { id: 'c3', name: 'Unwired', criticality: 'low', dependencies: [] },
      ],
    );
    const mobile = r.consumers.find((c) => c.consumerId === 'c1');
    expect(mobile.known).toHaveLength(1);
    expect(mobile.worstSeverity).toBe('breaking');
    expect(r.consumers.find((c) => c.consumerId === 'c2').potential).toHaveLength(1);
    expect(r.knownImpactedCount).toBe(1);
    expect(r.unmatchedRiskyFindings.map((x) => x.entityKey)).toContain('GET /legacy');
    expect(r.disclaimer).toMatch(/not harmless/);
  });
});
