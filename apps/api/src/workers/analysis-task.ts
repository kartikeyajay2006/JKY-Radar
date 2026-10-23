import { analyzeContracts, DEFAULT_LIMITS, type AnalyzeOutcome } from '@jky/radar-adapters';
import type { AnalysisOptions, Protocol, ReleasePolicy } from '@jky/radar-core';

export interface AnalysisTask {
  baseline: { content: string; fileName?: string; protocol: Protocol };
  candidate: { content: string; fileName?: string; protocol: Protocol };
  options: AnalysisOptions;
  policy: ReleasePolicy;
  maxBytes: number;
}

/** Pure function executed either inside a worker thread or inline. */
export function runAnalysisTask(task: AnalysisTask): AnalyzeOutcome {
  return analyzeContracts({
    baseline: task.baseline,
    candidate: task.candidate,
    options: task.options,
    policy: task.policy,
    limits: { ...DEFAULT_LIMITS, maxBytes: task.maxBytes },
  });
}
