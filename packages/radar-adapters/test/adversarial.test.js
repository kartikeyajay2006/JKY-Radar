import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  analyzeContracts,
  parseContract,
  parseStructured,
  redactSecrets,
  StructuredParseError,
  DEFAULT_LIMITS,
} from '../src/index.js';
import { fixture } from './helpers.js';

/** @param {string} name */
const adv = (name) => fixture(`adversarial/${name}`);
/**
 * @param {string} name
 * @param {Parameters<typeof parseContract>[0]['protocol']} [protocol]
 */
const codes = (name, protocol) => {
  const out = parseContract({ content: adv(name), fileName: name, ...(protocol ? { protocol } : {}) });
  return out.ok === false ? out.diagnostics.map((d) => d.code) : [];
};

afterEach(() => vi.restoreAllMocks());

describe('adversarial inputs fail safely', () => {
  it('1. malformed YAML reports a syntax error with a line number', () => {
    const out = parseContract({ content: adv('malformed.yaml') });
    expect(out.ok).toBe(false);
    if (out.ok === false) {
      expect(out.diagnostics[0].code).toBe('YAML_SYNTAX');
      expect(out.diagnostics[0].source?.line).toBeGreaterThan(0);
    }
  });
  it('2. nested-alias "billion laughs" is bounded', () => {
    const t = Date.now();
    expect(codes('billion-laughs.yaml')).toEqual(
      expect.arrayContaining([expect.stringMatching(/MAX_ALIASES|MAX_NODES/)]),
    );
    expect(Date.now() - t).toBeLessThan(2000);
  });
  it('3. invalid local $ref fails validation', () =>
    expect(codes('invalid-ref.yaml')).toContain('REF_NOT_FOUND'));
  it('4. remote/metadata $ref is never fetched', () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const out = parseContract({ content: adv('remote-ref.yaml') });
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(out.ok).toBe(true);
    if (out.ok) {
      expect(out.contract.diagnostics.map((d) => d.code)).toContain('REF_REMOTE_NOT_FETCHED');
      expect(out.contract.ignoredConstructs).toContain('Remote $ref (never fetched)');
    }
  });
  it('5. ambiguous templated paths are rejected', () =>
    expect(codes('duplicate-paths.yaml')).toContain('DUPLICATE_PATH_TEMPLATE'));
  it('6. duplicate JSON keys are rejected', () =>
    expect(codes('duplicate-keys.json')).toContain('DUPLICATE_KEY'));
  it('7. duplicate YAML keys are rejected', () =>
    expect(codes('duplicate-keys.yaml')).toContain('DUPLICATE_KEY'));
  it('8. unsupported spec version is rejected', () =>
    expect(codes('invalid-version.yaml')).toContain('UNSUPPORTED_VERSION'));
  it('9. __proto__ keys do not pollute prototypes', () => {
    const doc = parseStructured(adv('proto-pollution.json'));
    expect(/** @type {Record<string, unknown>} */ ({}).polluted).toBeUndefined();
    expect(Object.prototype.hasOwnProperty.call(doc.value, '__proto__')).toBe(true);
    expect(Object.getPrototypeOf(doc.value)).toBe(Object.prototype);
  });
  it('10. Postman secrets are redacted while placeholders survive', () => {
    const r = redactSecrets(adv('postman-secrets.postman_collection.json'));
    expect(r.content).not.toMatch(/sk_live_|ghp_a|eyJhbGci/);
    expect(r.content).toContain('{{token}}');
    expect(r.content).toContain('X-API-Key');
    expect(r.redactions.length).toBeGreaterThanOrEqual(3);
    expect(() => JSON.parse(r.content)).not.toThrow();
  });
  it('11. XSS payloads are carried as inert text', () => {
    const out = parseContract({ content: adv('xss-description.yaml') });
    expect(out.ok).toBe(true);
    if (out.ok) expect(out.contract.title).toBe('<img src=x onerror=alert(1)>');
  });
  it('12. oversized input is rejected before parsing', () => {
    const big = `{"a":"${'x'.repeat(DEFAULT_LIMITS.maxBytes)}"}`;
    const out = parseContract({ content: big });
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.diagnostics[0].code).toBe('INPUT_TOO_LARGE');
  });
  it('13. deeply nested JSON hits the depth limit', () => {
    const deep = `${'['.repeat(5000)}${']'.repeat(5000)}`;
    expect(() => parseStructured(deep)).toThrow(StructuredParseError);
    try {
      parseStructured(deep);
    } catch (e) {
      expect(/** @type {StructuredParseError} */ (e).code).toBe('MAX_DEPTH');
    }
  });
  it('14. node-count limit is enforced', () => {
    const arr = `[${Array.from({ length: 2000 }, () => '1').join(',')}]`;
    expect(() => parseStructured(arr, { ...DEFAULT_LIMITS, maxNodes: 1000 })).toThrow(/More than 1000 nodes/);
  });
  it('15. mismatched protocol selection is rejected', () =>
    expect(codes('invalid-ref.yaml', 'graphql')).toContain('PROTOCOL_MISMATCH'));
  it('16. custom YAML tags are rejected', () =>
    expect(codes('custom-tag.yaml')).toEqual([expect.stringMatching(/YAML_CUSTOM_TAG|YAML_SYNTAX/)]));
  it('17. YAML merge keys are rejected', () => expect(codes('merge-key.yaml')).toContain('YAML_MERGE_KEY'));
  it('18. Postman v3 is detected and reported as unsupported', () =>
    expect(codes('postman-v3.json')).toContain('UNSUPPORTED_FORMAT'));
  it('19. GraphQL operations are not mistaken for a schema', () =>
    expect(codes('graphql-operation.graphql')).toContain('NOT_A_SCHEMA'));
  it('20. invalid proto syntax reports a parser error', () =>
    expect(codes('invalid.proto')).toContain('PROTO_SYNTAX'));
  it('21. circular parameter $ref chains fail safely', () =>
    expect(codes('parameter-ref-cycle.yaml')).toContain('REF_CYCLE'));
  it('22. regex patterns are never executed (no ReDoS)', () => {
    const doc = adv('redos-pattern.yaml');
    const changed = doc.replace("'^(a+)+$'", () => "'^(a|aa)+$'");
    const t = Date.now();
    const out = analyzeContracts({ baseline: { content: doc }, candidate: { content: changed } });
    expect(Date.now() - t).toBeLessThan(1500);
    expect(out.ok && out.result.findings.map((f) => f.ruleId)).toContain('REQ_PATTERN_CHANGED');
  });
  it('23. unknown text is reported as an unknown format', () =>
    expect(codes('unknown.txt')).toContain('UNKNOWN_FORMAT'));
  it('24. binary/NUL content is rejected', () =>
    expect(codes('binary-nul.yaml')).toContain('BINARY_CONTENT'));
  it('25. REST is never compared against GraphQL, even with cross-format enabled', () => {
    const out = analyzeContracts({
      baseline: { content: fixture('openapi/breaking/ecommerce-v1.yaml') },
      candidate: { content: fixture('graphql/bookstore-v1.graphql'), fileName: 'b.graphql' },
      options: { allowCrossFormat: true },
    });
    expect(out.ok).toBe(false);
    if (out.ok === false) expect(out.code).toBe('PROTOCOL_MISMATCH');
  });
  it('26. GraphQL token bombs are bounded', () => {
    const sdl = `type Query { ${Array.from({ length: 100_000 }, (_, i) => `f${i}: Int`).join(' ')} }`;
    const out = parseContract({ content: sdl, fileName: 'big.graphql' });
    expect(out.ok).toBe(false);
  });
});
