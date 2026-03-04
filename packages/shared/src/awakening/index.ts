/**
 * Awakening Validator — Boot-time cognitive infrastructure validation
 *
 * Extends the Autonomaton (Digital Jidoka) pattern from runtime failure
 * monitoring to startup-time path validation. "Awareness starts on awakening."
 *
 * Usage:
 *   import { runAwakeningValidation, formatAwakeningReport } from '@atlas/shared/awakening';
 *   const report = runAwakeningValidation('telegram');
 *   console.log(formatAwakeningReport(report));
 *   if (!report.canAwaken) process.exit(1);
 *
 * @module @atlas/shared/awakening
 */

export type {
  AwakeningCriticality,
  CheckCategory,
  DataPathExpectation,
  CrossBoundaryExemption,
  AwakeningCheckResult,
  AwakeningSummary,
  AwakeningReport,
} from './types';

export { getDataPathExpectations, CROSS_BOUNDARY_EXEMPTIONS } from './manifest';
export { runAwakeningValidation } from './validator';
export { formatAwakeningReport } from './formatter';
