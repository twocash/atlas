/**
 * Awakening Validator Types
 *
 * Boot-time cognitive infrastructure validation.
 * Extends the Autonomaton (Digital Jidoka) pattern from runtime
 * failure monitoring to startup-time path validation.
 *
 * @module @atlas/shared/awakening
 */

/** Mirrors DbCriticality from config.ts */
export type AwakeningCriticality = 'critical' | 'advisory';

/** Categories of awakening checks */
export type CheckCategory = 'data-path' | 'cross-boundary' | 'skill-registry';

/** A data path the cognitive layer depends on */
export interface DataPathExpectation {
  /** Absolute path to validate */
  path: string;
  /** Human-readable label (e.g., "skills directory") */
  label: string;
  /** Source file(s) that reference this path */
  referencedBy: string;
  /** Whether missing path should block startup */
  criticality: AwakeningCriticality;
}

/** Documented cross-boundary path that is intentionally allowed */
export interface CrossBoundaryExemption {
  /** Source file containing the cross-boundary reference */
  file: string;
  /** Approximate line number */
  line: number;
  /** Target path being referenced */
  targetPath: string;
  /** Why this cross-boundary reference is intentional */
  rationale: string;
}

/** Result of a single awakening check */
export interface AwakeningCheckResult {
  category: CheckCategory;
  label: string;
  status: 'pass' | 'fail' | 'warn';
  message: string;
  criticality: AwakeningCriticality;
}

/** Summary statistics for an awakening report */
export interface AwakeningSummary {
  total: number;
  passed: number;
  warned: number;
  failed: number;
  criticalFailed: number;
}

/** Full awakening validation report */
export interface AwakeningReport {
  checkedAt: string;
  surface: string;
  checks: AwakeningCheckResult[];
  canAwaken: boolean;
  summary: AwakeningSummary;
}
