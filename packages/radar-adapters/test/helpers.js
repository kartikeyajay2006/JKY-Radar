import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { analyzeContracts } from '../src/index.js';

/** @import { AnalysisOptions, AnalysisResult } from '@jky/radar-core' */

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
/** @param {string} rel */
export const fixture = (rel) => readFileSync(path.join(FIXTURES, rel), 'utf8');

/**
 * @param {string} a
 * @param {string} b
 * @param {AnalysisOptions} [options]
 * @param {[string?, string?]} [names]
 * @returns {AnalysisResult}
 */
export function run(a, b, options = {}, names = []) {
  const out = analyzeContracts({
    baseline: { content: a, ...(names[0] ? { fileName: names[0] } : {}) },
    candidate: { content: b, ...(names[1] ? { fileName: names[1] } : {}) },
    options,
  });
  if (out.ok === false)
    throw new Error(`${out.code}: ${out.message} ${JSON.stringify({ b: out.baseline, c: out.candidate })}`);
  return out.result;
}

/** @param {AnalysisResult} r */
export const ruleIds = (r) => new Set(r.findings.map((f) => f.ruleId));

/**
 * @typedef {Object} Expectation
 * @property {string} [gate]
 * @property {string} [coverage]
 * @property {string[]} [include]
 * @property {string[]} [exclude]
 */

/**
 * Returns a list of violated expectations (empty when everything holds).
 * @param {Pick<AnalysisResult, 'findings' | 'gate' | 'coverage'>} result
 * @param {Expectation} e
 * @returns {string[]}
 */
export function checkExpectations(result, e) {
  /** @type {string[]} */
  const errors = [];
  const ids = new Set(result.findings.map((f) => f.ruleId));
  if (e.gate && result.gate.decision !== e.gate) errors.push(`gate ${result.gate.decision} !== ${e.gate}`);
  if (e.coverage && result.coverage.level !== e.coverage)
    errors.push(`coverage ${result.coverage.level} !== ${e.coverage}`);
  for (const r of e.include ?? []) if (!ids.has(r)) errors.push(`missing ${r}`);
  for (const r of e.exclude ?? []) if (ids.has(r)) errors.push(`unexpected ${r}`);
  return errors;
}
