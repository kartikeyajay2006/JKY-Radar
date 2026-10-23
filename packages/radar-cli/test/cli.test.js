import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** @param {...string} args */
const cli = (...args) =>
  spawnSync(process.execPath, [path.join(root, 'packages/radar-cli/src/cli.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });

describe('radar CLI', () => {
  it('exits 1 and prints findings when the gate blocks', () => {
    const r = cli(
      'compare',
      'fixtures/openapi/breaking/ecommerce-v1.yaml',
      'fixtures/openapi/breaking/ecommerce-v2.yaml',
    );
    expect(r.status).toBe(1);
    expect(r.stdout).toContain('gate BLOCK');
    expect(r.stdout).toContain('HTTP_OPERATION_REMOVED');
  });
  it('emits machine-readable JSON', () => {
    const r = cli(
      'compare',
      'fixtures/openapi/safe/inventory-v1.json',
      'fixtures/openapi/safe/inventory-v2.json',
      '--format',
      'json',
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).gate.decision).toBe('pass');
  });
  it('exits 2 on invalid input', () => {
    const r = cli(
      'compare',
      'fixtures/adversarial/malformed.yaml',
      'fixtures/openapi/safe/inventory-v1.json',
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('YAML_SYNTAX');
  });
});
