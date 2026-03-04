/**
 * Awakening Validator — Boot-time cognitive infrastructure checks
 *
 * Validates that every data path the cognitive layer depends on
 * actually exists before the system becomes operational.
 *
 * All checks are synchronous filesystem ops — no network I/O, <10ms overhead.
 *
 * @module @atlas/shared/awakening
 */

import { existsSync, readdirSync } from 'fs';
import { resolve } from 'path';
import { getDataPathExpectations } from './manifest';
import type {
  AwakeningCheckResult,
  AwakeningReport,
  AwakeningSummary,
} from './types';

/** Resolve the skills superpowers root */
const SKILLS_ROOT = resolve(__dirname, '..', '..', '..', 'skills', 'superpowers');

/**
 * Run all awakening validation checks.
 *
 * @param surface - Which surface is booting (e.g., 'telegram', 'bridge')
 * @returns AwakeningReport with pass/fail/warn for each check
 */
export function runAwakeningValidation(surface: string): AwakeningReport {
  const checks: AwakeningCheckResult[] = [];

  // 1. Validate all data path expectations
  const expectations = getDataPathExpectations();
  for (const expectation of expectations) {
    const exists = existsSync(expectation.path);
    checks.push({
      category: 'data-path',
      label: expectation.label,
      status: exists ? 'pass' : (expectation.criticality === 'critical' ? 'fail' : 'warn'),
      message: exists
        ? `${expectation.label}: OK`
        : `${expectation.label}: missing (${expectation.path})`,
      criticality: expectation.criticality,
    });
  }

  // 2. Validate skill registry
  checks.push(checkSkillRegistry());

  // 3. Compute summary
  const summary = computeSummary(checks);

  return {
    checkedAt: new Date().toISOString(),
    surface,
    checks,
    canAwaken: summary.criticalFailed === 0,
    summary,
  };
}

/**
 * Check that the skill registry directory exists and contains at least one SKILL.md.
 */
function checkSkillRegistry(): AwakeningCheckResult {
  if (!existsSync(SKILLS_ROOT)) {
    return {
      category: 'skill-registry',
      label: 'skill registry',
      status: 'warn',
      message: `skill registry: directory missing (${SKILLS_ROOT})`,
      criticality: 'advisory',
    };
  }

  try {
    const entries = readdirSync(SKILLS_ROOT, { withFileTypes: true });
    const skillDirs = entries.filter(e => e.isDirectory());
    let skillCount = 0;

    for (const dir of skillDirs) {
      const skillMd = resolve(SKILLS_ROOT, dir.name, 'SKILL.md');
      if (existsSync(skillMd)) {
        skillCount++;
      }
    }

    if (skillCount === 0) {
      return {
        category: 'skill-registry',
        label: 'skill registry',
        status: 'warn',
        message: 'skill registry: no SKILL.md files found in superpowers/',
        criticality: 'advisory',
      };
    }

    return {
      category: 'skill-registry',
      label: 'skill registry',
      status: 'pass',
      message: `skill registry: ${skillCount} skill(s) registered`,
      criticality: 'advisory',
    };
  } catch {
    return {
      category: 'skill-registry',
      label: 'skill registry',
      status: 'warn',
      message: 'skill registry: failed to read directory',
      criticality: 'advisory',
    };
  }
}

/**
 * Compute summary statistics from check results.
 */
function computeSummary(checks: AwakeningCheckResult[]): AwakeningSummary {
  let passed = 0;
  let warned = 0;
  let failed = 0;
  let criticalFailed = 0;

  for (const check of checks) {
    switch (check.status) {
      case 'pass':
        passed++;
        break;
      case 'warn':
        warned++;
        break;
      case 'fail':
        failed++;
        if (check.criticality === 'critical') {
          criticalFailed++;
        }
        break;
    }
  }

  return {
    total: checks.length,
    passed,
    warned,
    failed,
    criticalFailed,
  };
}
