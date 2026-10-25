/**
 * `radar check`: send a candidate contract to a JKY-Radar server with a project CI token and
 * turn the server's release gate into an exit code. The token comes from JKY_RADAR_TOKEN so it
 * never appears in shell history or process listings.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';

/**
 * @typedef {Object} CheckOptions
 * @property {string} server   Base URL, e.g. https://radar.example.com
 * @property {string} token    Project CI token (jkyr_…)
 * @property {string} file     Path to the candidate contract
 * @property {string} [label]  Version label; defaults to the file name
 * @property {string} [baseline] Version id or label to compare with
 * @property {'block' | 'warn'} [failOn]
 * @property {number} [wait]   Seconds the server may wait for the verdict
 * @property {typeof fetch} [fetchImpl]
 * @property {(line: string) => void} [log]
 * @property {(line: string) => void} [error]
 */

const sleep = (/** @type {number} */ ms) => new Promise((r) => setTimeout(r, ms));

/**
 * @param {CheckOptions} o
 * @returns {Promise<number>} exit code: 0 passed, 1 gate failed, 2 usage, network or server error
 */
export async function runCheck(o) {
  const log = o.log ?? console.log;
  const error = o.error ?? console.error;
  const doFetch = o.fetchImpl ?? fetch;
  if (!o.token || !o.token.startsWith('jkyr_')) {
    error('Set JKY_RADAR_TOKEN to a project CI token (it starts with "jkyr_").');
    return 2;
  }
  /** @type {string} */
  let content;
  try {
    content = readFileSync(o.file, 'utf8');
  } catch (e) {
    error(`Cannot read input: ${/** @type {Error} */ (e).message}`);
    return 2;
  }
  let base;
  try {
    const server = new URL(o.server);
    if (
      !['http:', 'https:'].includes(server.protocol) ||
      server.username ||
      server.password ||
      server.search ||
      server.hash
    )
      throw new Error('Use an HTTP(S) server URL without credentials, a query or a fragment.');
    base = server.href.replace(/\/$/, '');
  } catch {
    error('Invalid server URL. Use an HTTP(S) URL without credentials, a query or a fragment.');
    return 2;
  }
  if (o.failOn !== undefined && !['block', 'warn'].includes(o.failOn)) {
    error('Invalid failOn: expected "block" or "warn".');
    return 2;
  }
  const headers = { Authorization: `Bearer ${o.token}`, 'Content-Type': 'application/json' };
  const label = (o.label ?? basename(o.file)).slice(0, 60);

  /** @param {Response} res */
  const read = async (res) => {
    const body = /** @type {any} */ (await res.json().catch(() => null));
    if (!res.ok) {
      const e = body?.error;
      error(`✖ ${res.status} ${e?.code ?? 'HTTP_ERROR'}: ${e?.message ?? res.statusText}`);
      for (const d of e?.details?.diagnostics ?? [])
        error(`  candidate${d.source?.line ? `:${d.source.line}` : ''} ${d.code} ${d.message}`);
      return null;
    }
    const data = body?.data;
    const pending = res.status === 202;
    if (
      !data ||
      typeof data.url !== 'string' ||
      (pending
        ? !['queued', 'running'].includes(data.state) ||
          typeof data.poll !== 'string' ||
          !/^\/api\/v1\/ci\/analyses\/[A-Za-z0-9_-]+$/.test(data.poll)
        : !['completed', 'failed'].includes(data.state)) ||
      (data.state === 'completed' &&
        (!['pass', 'warn', 'block', 'inconclusive'].includes(data.gate?.decision) ||
          !Array.isArray(data.gate.reasons) ||
          typeof data.baseline?.label !== 'string' ||
          typeof data.candidate?.label !== 'string'))
    ) {
      error('✖ Invalid response from the server; no valid release verdict was received.');
      return null;
    }
    return { status: res.status, data };
  };

  /** @type {{ status: number; data: any } | null} */
  let out;
  try {
    out = await read(
      await doFetch(`${base}/api/v1/ci/check`, {
        method: 'POST',
        redirect: 'error',
        signal: AbortSignal.timeout(90_000),
        headers,
        body: JSON.stringify({
          candidate: { label, content, fileName: basename(o.file) },
          ...(o.baseline ? { baseline: o.baseline } : {}),
          wait: o.wait ?? 60,
        }),
      }),
    );
    // The server answers 202 when the analysis is still running; poll until it settles.
    for (let i = 0; out && out.status === 202 && i < 60; i++) {
      await sleep(2000);
      out = await read(
        await doFetch(`${base}${out.data.poll}`, {
          headers,
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        }),
      );
    }
  } catch (e) {
    error(`✖ Cannot reach ${base}: ${/** @type {Error} */ (e).message}`);
    return 2;
  }
  if (!out) return 2;
  const d = out.data;
  if (out.status === 202) {
    error(`✖ The analysis is still running. Follow it at ${d.url}`);
    return 2;
  }
  if (d.state === 'failed' || !d.gate) {
    error(`✖ The analysis failed: ${d.error?.message ?? 'unknown error'}`);
    return 2;
  }
  const decision = String(d.gate.decision);
  log(
    `JKY-Radar · ${d.baseline.label} → ${d.candidate.label} · gate ${decision.toUpperCase()} · coverage ${d.coverage}`,
  );
  for (const reason of d.gate.reasons ?? []) log(`  • ${reason}`);
  const c = d.counts ?? {};
  log(
    `  ${c.breaking ?? 0} breaking, ${c.potentially_breaking ?? 0} potentially breaking, ${c.needs_review ?? 0} need review`,
  );
  log(`  ${d.url}`);
  const failed =
    decision === 'block' ||
    ((o.failOn ?? 'block') === 'warn' && (decision === 'warn' || decision === 'inconclusive'));
  return failed ? 1 : 0;
}
