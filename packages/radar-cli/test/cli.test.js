import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it, vi } from 'vitest';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
/** @param {...string} args */
const cli = (...args) =>
  spawnSync(process.execPath, [path.join(root, 'packages/radar-cli/src/cli.js'), ...args], {
    cwd: root,
    encoding: 'utf8',
  });

describe('radar CLI', () => {
  it.each([
    ['--fail-on', 'wrn'],
    ['--format', 'xml'],
    ['--polarity', 'input'],
    ['--formt', 'json'],
    ['--format'],
    ['--format', '--cross-format'],
    ['--format', 'json', '--format', 'text'],
    ['extra.yaml'],
  ])('rejects invalid compare arguments %j', (...options) => {
    const r = cli(
      'compare',
      'fixtures/openapi/safe/inventory-v1.json',
      'fixtures/openapi/safe/inventory-v2.json',
      ...options,
    );
    expect(r.status).toBe(2);
    expect(r.stderr).toContain('Usage:');
    expect(r.stdout).toBe('');
  });
  it('accepts options before files and an explicit end of options', () => {
    const r = cli(
      'compare',
      '--format',
      'json',
      '--',
      'fixtures/openapi/safe/inventory-v1.json',
      'fixtures/openapi/safe/inventory-v2.json',
    );
    expect(r.status).toBe(0);
    expect(JSON.parse(r.stdout).gate.decision).toBe('pass');
  });
  it.each([
    ['check', 'candidate.yaml', '--server', 'http://radar.test', '--fail-on', 'wrn'],
    ['check', 'candidate.yaml', '--server'],
    ['check', 'candidate.yaml', 'extra.yaml', '--server', 'http://radar.test'],
    ['capabilities', '--format', 'json'],
    ['capabilities', 'extra.yaml'],
  ])('rejects invalid command arguments %j', (...args) => {
    expect(cli(...args).status).toBe(2);
  });
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

describe('radar check (server gate)', () => {
  const file = path.join(root, 'fixtures/openapi/breaking/ecommerce-v2.yaml');
  /**
   * @param {Array<{ status: number; body: unknown }>} replies
   * @param {Array<{ url: string; init: any }>} calls
   */
  const fakeFetch = (replies, calls) =>
    /** @type {typeof fetch} */ (
      /** @type {unknown} */ (
        async (/** @type {string} */ url, /** @type {any} */ init) => {
          calls.push({ url, init });
          const r = /** @type {{ status: number; body: unknown }} */ (replies.shift());
          return new Response(JSON.stringify(r.body), { status: r.status });
        }
      )
    );
  const verdict = (decision, status = 'completed') => ({
    analysisId: 'a1',
    state: status,
    gate: status === 'completed' ? { decision, reasons: [`policy says ${decision}`] } : null,
    counts: { breaking: decision === 'block' ? 3 : 0 },
    coverage: 'full',
    baseline: { id: 'b', label: 'v1' },
    candidate: { id: 'c', label: 'v2', uploaded: true },
    url: 'http://web/app/analyses/a1',
    poll: '/api/v1/ci/analyses/a1',
  });
  const quiet = { log: () => {}, error: () => {} };

  it('sends the candidate with the bearer token and exits 1 when the gate blocks', async () => {
    const { runCheck } = await import('../src/check.js');
    /** @type {Array<{ url: string; init: any }>} */
    const calls = [];
    const code = await runCheck({
      server: 'http://radar.test/',
      token: 'jkyr_abc',
      file,
      baseline: 'v1',
      fetchImpl: fakeFetch([{ status: 200, body: { data: verdict('block') } }], calls),
      ...quiet,
    });
    expect(code).toBe(1);
    expect(calls[0].url).toBe('http://radar.test/api/v1/ci/check');
    expect(calls[0].init.headers.Authorization).toBe('Bearer jkyr_abc');
    const body = JSON.parse(calls[0].init.body);
    expect(body).toMatchObject({ baseline: 'v1', candidate: { label: 'ecommerce-v2.yaml' } });
    expect(body.candidate.content).toContain('openapi');
  });

  it('polls while the server is still analysing, then honours --fail-on warn', async () => {
    const { runCheck } = await import('../src/check.js');
    /** @type {Array<{ url: string; init: any }>} */
    const calls = [];
    const replies = [
      { status: 202, body: { data: verdict('warn', 'running') } },
      { status: 200, body: { data: verdict('warn') } },
    ];
    vi.useFakeTimers({ shouldAdvanceTime: true, advanceTimeDelta: 500 });
    try {
      const code = await runCheck({
        server: 'http://radar.test',
        token: 'jkyr_abc',
        file,
        failOn: 'warn',
        fetchImpl: fakeFetch(replies, calls),
        ...quiet,
      });
      expect(code).toBe(1);
      expect(calls[1].url).toBe('http://radar.test/api/v1/ci/analyses/a1');
      expect(calls[1].init.redirect).toBe('error');
      expect(calls[1].init.signal).toBeInstanceOf(AbortSignal);
    } finally {
      vi.useRealTimers();
    }
  });

  it('exits 0 on pass and 2 on a missing token or a server error', async () => {
    const { runCheck } = await import('../src/check.js');
    const ok = await runCheck({
      server: 'http://radar.test',
      token: 'jkyr_abc',
      file,
      fetchImpl: fakeFetch([{ status: 200, body: { data: verdict('pass') } }], []),
      ...quiet,
    });
    expect(ok).toBe(0);
    expect(await runCheck({ server: 'http://radar.test', token: '', file, ...quiet })).toBe(2);
    const denied = await runCheck({
      server: 'http://radar.test',
      token: 'jkyr_abc',
      file,
      fetchImpl: fakeFetch([{ status: 401, body: { error: { code: 'INVALID_TOKEN', message: 'no' } } }], []),
      ...quiet,
    });
    expect(denied).toBe(2);
  });
  it.each([
    null,
    {},
    { state: 'completed' },
    { ...verdict('pass'), gate: { decision: 'unknown', reasons: [] } },
    { ...verdict('pass'), gate: { decision: 'pass', reasons: 'invalid' } },
    { ...verdict('pass'), baseline: null },
    { ...verdict('pass'), state: 'running' },
  ])('rejects malformed verdicts without throwing or passing: %j', async (data) => {
    const { runCheck } = await import('../src/check.js');
    const error = vi.fn();
    expect(
      await runCheck({
        server: 'http://radar.test',
        token: 'jkyr_abc',
        file,
        fetchImpl: fakeFetch([{ status: 200, body: { data } }], []),
        ...quiet,
        error,
      }),
    ).toBe(2);
    expect(error).toHaveBeenCalledWith(expect.stringContaining('Invalid response'));
  });

  it.each(['https://other.test/steal', '//other.test/steal', '/api/v1/ci/analyses/../tokens', undefined])(
    'rejects unsafe polling paths %j before sending another request',
    async (poll) => {
      const { runCheck } = await import('../src/check.js');
      const calls = [];
      expect(
        await runCheck({
          server: 'http://radar.test',
          token: 'jkyr_abc',
          file,
          fetchImpl: fakeFetch(
            [{ status: 202, body: { data: { ...verdict('warn', 'running'), poll } } }],
            calls,
          ),
          ...quiet,
        }),
      ).toBe(2);
      expect(calls).toHaveLength(1);
    },
  );

  it.each([
    'not a url',
    'file:///tmp/radar',
    'https://user:password@radar.test',
    'https://radar.test?x=1',
    'https://radar.test#fragment',
  ])('rejects invalid server URL %s before making requests', async (server) => {
    const { runCheck } = await import('../src/check.js');
    const fetchImpl = vi.fn();
    expect(await runCheck({ server, token: 'jkyr_abc', file, fetchImpl, ...quiet })).toBe(2);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('bounds a stalled request and rejects redirects carrying credentials', async () => {
    const { runCheck } = await import('../src/check.js');
    const controller = new AbortController();
    const timeout = vi.spyOn(AbortSignal, 'timeout').mockReturnValue(controller.signal);
    try {
      const fetchImpl = vi.fn((_url, init) => {
        expect(init.redirect).toBe('error');
        return new Promise((_, reject) => {
          init.signal.addEventListener('abort', () => reject(init.signal.reason), { once: true });
        });
      });
      const result = runCheck({ server: 'http://radar.test', token: 'jkyr_abc', file, fetchImpl, ...quiet });
      expect(timeout).toHaveBeenCalledWith(90_000);
      controller.abort(new DOMException('Request timed out', 'TimeoutError'));
      expect(await result).toBe(2);
    } finally {
      timeout.mockRestore();
    }
  });
});
