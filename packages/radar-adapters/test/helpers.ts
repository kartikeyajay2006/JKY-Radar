import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import type { AnalysisOptions, AnalysisResult } from '@jky/radar-core';
import { analyzeContracts } from '../src/index.js';

export const FIXTURES = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../../fixtures');
export const fixture = (rel: string) => readFileSync(path.join(FIXTURES, rel), 'utf8');

export function run(
  a: string,
  b: string,
  options: AnalysisOptions = {},
  names: [string?, string?] = [],
): AnalysisResult {
  const out = analyzeContracts({
    baseline: { content: a, ...(names[0] ? { fileName: names[0] } : {}) },
    candidate: { content: b, ...(names[1] ? { fileName: names[1] } : {}) },
    options,
  });
  if (!out.ok)
    throw new Error(`${out.code}: ${out.message} ${JSON.stringify({ b: out.baseline, c: out.candidate })}`);
  return out.result;
}

export const ruleIds = (r: AnalysisResult) => new Set(r.findings.map((f) => f.ruleId));

export interface Expectation {
  gate?: string;
  coverage?: string;
  include?: string[];
  exclude?: string[];
}

/** Returns a list of violated expectations (empty when everything holds). */
export function checkExpectations(
  result: Pick<AnalysisResult, 'findings' | 'gate' | 'coverage'>,
  e: Expectation,
): string[] {
  const errors: string[] = [];
  const ids = new Set(result.findings.map((f) => f.ruleId));
  if (e.gate && result.gate.decision !== e.gate) errors.push(`gate ${result.gate.decision} !== ${e.gate}`);
  if (e.coverage && result.coverage.level !== e.coverage)
    errors.push(`coverage ${result.coverage.level} !== ${e.coverage}`);
  for (const r of e.include ?? []) if (!ids.has(r)) errors.push(`missing ${r}`);
  for (const r of e.exclude ?? []) if (ids.has(r)) errors.push(`unexpected ${r}`);
  return errors;
}
