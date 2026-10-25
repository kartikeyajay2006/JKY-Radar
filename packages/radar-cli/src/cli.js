#!/usr/bin/env node
/**
 * JKY-Radar CLI — offline contract comparison with the same engine as the server.
 *   npm run radar -- compare <baseline> <candidate> [--format json|md|text] [--protocol <p>]
 *                   [--polarity request|response] [--cross-format] [--fail-on block|warn]
 *   npm run radar -- check <candidate> [--server <url>] [--label <l>] [--baseline <id|label>]
 *                   [--fail-on block|warn]          (needs JKY_RADAR_TOKEN; server from JKY_RADAR_URL)
 * Exit codes: 0 = gate passed (or below --fail-on), 1 = gate failed, 2 = usage/parse error.
 */
import { readFileSync } from 'node:fs';
import { basename } from 'node:path';
import { analyzeContracts, capabilityReport } from '@jky/radar-adapters';
import { buildMarkdownReport, PROTOCOLS, SEVERITY_LABEL } from '@jky/radar-core';
import { runCheck } from './check.js';

/** @import { Protocol } from '@jky/radar-core' */

const [command, ...args] = process.argv.slice(2);
const usage = (message = '') => {
  if (message) console.error(message);
  console.error(
    'Usage: radar compare <baseline> <candidate> [--format text|json|md] [--protocol <p>] [--polarity request|response] [--cross-format] [--fail-on block|warn]',
  );
  console.error(
    '       radar check <candidate> [--server <url>] [--label <label>] [--baseline <id|label>] [--fail-on block|warn]',
  );
  console.error('       radar capabilities');
  process.exit(2);
};

if (!['compare', 'check', 'capabilities'].includes(command)) usage();
const allowed = {
  compare: ['format', 'protocol', 'polarity', 'cross-format', 'fail-on'],
  check: ['server', 'label', 'baseline', 'fail-on'],
  capabilities: [],
}[command];
const flags = new Map();
/** @type {string[]} */
const positional = [];
let optionsEnded = false;
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (!optionsEnded && arg === '--') {
    optionsEnded = true;
  } else if (!optionsEnded && arg.startsWith('--')) {
    const name = arg.slice(2);
    if (!allowed.includes(name)) usage(`Unknown option: ${arg}`);
    if (flags.has(name)) usage(`Duplicate option: ${arg}`);
    if (name === 'cross-format') flags.set(name, 'true');
    else {
      const value = args[++i];
      if (!value || value.startsWith('--')) usage(`Missing value for ${arg}`);
      flags.set(name, value);
    }
  } else {
    positional.push(arg);
  }
}
/** @param {string} name */
const flag = (name) => flags.get(name);
/** @param {string} name */
const has = (name) => flags.has(name);
for (const [name, values] of Object.entries({
  format: ['text', 'json', 'md'],
  polarity: ['request', 'response'],
  'fail-on': ['block', 'warn'],
})) {
  if (has(name) && !values.includes(flag(name)))
    usage(`Invalid --${name}: ${flag(name)}. Expected ${values.join(' or ')}.`);
}

if (command === 'capabilities') {
  if (positional.length) usage('capabilities takes no input files.');
  for (const c of capabilityReport())
    console.log(
      `${c.status.padEnd(13)} ${c.label} (${c.versions}) — rules ${c.rules.tested}/${c.rules.registered}`,
    );
  process.exit(0);
}
if (command === 'check') {
  const [file] = positional;
  const server = flag('server') ?? process.env.JKY_RADAR_URL;
  if (positional.length !== 1 || !server) usage();
  process.exit(
    await runCheck({
      server,
      token: process.env.JKY_RADAR_TOKEN ?? '',
      file,
      ...(flag('label') ? { label: flag('label') } : {}),
      ...(flag('baseline') ? { baseline: flag('baseline') } : {}),
      ...(flag('fail-on') ? { failOn: flag('fail-on') } : {}),
    }),
  );
}
const [basePath, candPath] = positional;
if (positional.length !== 2) usage();

const protocol = /** @type {Protocol | undefined} */ (flag('protocol'));
if (protocol && !PROTOCOLS.includes(protocol)) {
  console.error(`Unknown protocol ${protocol}. Expected one of ${PROTOCOLS.join(', ')}`);
  process.exit(2);
}
const polarity = flag('polarity');
const format = flag('format') ?? 'text';
const failOn = flag('fail-on') ?? 'block';

/** @type {string} */
let baseline;
/** @type {string} */
let candidate;
try {
  baseline = readFileSync(basePath, 'utf8');
  candidate = readFileSync(candPath, 'utf8');
} catch (e) {
  console.error(`Cannot read input: ${/** @type {Error} */ (e).message}`);
  process.exit(2);
}

const out = analyzeContracts({
  baseline: { content: baseline, fileName: basename(basePath), ...(protocol ? { protocol } : {}) },
  candidate: { content: candidate, fileName: basename(candPath), ...(protocol ? { protocol } : {}) },
  options: {
    ...(polarity === 'request' || polarity === 'response' ? { jsonSchemaPolarity: polarity } : {}),
    ...(has('cross-format') ? { allowCrossFormat: true } : {}),
  },
});

if (out.ok === false) {
  console.error(`✖ ${out.code}: ${out.message}`);
  for (const [side, diags] of /** @type {const} */ ([
    ['baseline', out.baseline],
    ['candidate', out.candidate],
  ])) {
    for (const d of diags ?? [])
      console.error(`  ${side}${d.source?.line ? `:${d.source.line}` : ''} ${d.code} ${d.message}`);
  }
  process.exit(2);
}
const r = out.result;
if (format === 'json') {
  console.log(JSON.stringify(r, null, 2));
} else if (format === 'md') {
  const now = new Date().toISOString();
  console.log(
    buildMarkdownReport({
      analysisId: 'cli',
      projectName: r.candidate.title ?? basename(candPath),
      createdAt: now,
      exportedAt: now,
      baseline: { id: 'baseline', label: basename(basePath), rawHash: 'n/a (CLI)' },
      candidate: { id: 'candidate', label: basename(candPath), rawHash: 'n/a (CLI)' },
      result: r,
    }),
  );
} else {
  console.log(
    `JKY-Radar · ${r.protocol} · gate ${r.gate.decision.toUpperCase()} · coverage ${r.coverage.level}`,
  );
  for (const reason of r.gate.reasons) console.log(`  • ${reason}`);
  console.log('');
  for (const f of r.findings) {
    const loc = f.candidateSource?.line ?? f.baselineSource?.line;
    console.log(
      `${SEVERITY_LABEL[f.severity].padEnd(21)} ${f.ruleId.padEnd(36)} ${f.logicalPath}${loc ? `  (line ${loc})` : ''}`,
    );
    console.log(`${' '.repeat(22)}${f.explanation}`);
  }
  if (r.findings.length === 0) console.log('No findings.');
}
const failed =
  r.gate.decision === 'block' ||
  (failOn === 'warn' && (r.gate.decision === 'warn' || r.gate.decision === 'inconclusive'));
process.exit(failed ? 1 : 0);
