/** @import { AnalyzeOutcome } from '@jky/radar-adapters' */
/** @import { AnalysisOptions, Protocol, ReleasePolicy } from '@jky/radar-core' */
import { analyzeContracts, DEFAULT_LIMITS } from '@jky/radar-adapters';

/**
 * @typedef {Object} AnalysisTask
 * @property {{ content: string; fileName?: string; protocol: Protocol }} baseline
 * @property {{ content: string; fileName?: string; protocol: Protocol }} candidate
 * @property {AnalysisOptions} options
 * @property {ReleasePolicy} policy
 * @property {number} maxBytes
 */

/**
 * Pure function executed either inside a worker thread or inline.
 * @param {AnalysisTask} task
 * @returns {AnalyzeOutcome}
 */
export function runAnalysisTask(task) {
  return analyzeContracts({
    baseline: task.baseline,
    candidate: task.candidate,
    options: task.options,
    policy: task.policy,
    limits: { ...DEFAULT_LIMITS, maxBytes: task.maxBytes },
  });
}
