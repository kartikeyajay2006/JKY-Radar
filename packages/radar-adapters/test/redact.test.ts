import { describe, expect, it } from 'vitest';
import { redactSecrets } from '../src/index.js';

describe('secret redaction', () => {
  it('redacts secret-named keys in YAML and keeps formatting', () => {
    const src = 'auth:\n  password: hunter2hunter2\n  user: alice\n';
    const r = redactSecrets(src);
    expect(r.content).toBe('auth:\n  password: [REDACTED]\n  user: alice\n');
    expect(r.redactions).toEqual([{ line: 2, reason: 'secret-named key "password"' }]);
  });
  it('does not touch schema definitions named like secrets', () => {
    const src = JSON.stringify({ properties: { password: { type: 'string', minLength: 8 } } });
    expect(redactSecrets(src).content).toBe(src);
  });
  it('redacts credential patterns in non-structured text', () => {
    const r = redactSecrets('# token: ghp_abcdefghijklmnopqrstuvwxyz0123\ntype Query { a: Int }');
    expect(r.content).not.toContain('ghp_');
  });
});
