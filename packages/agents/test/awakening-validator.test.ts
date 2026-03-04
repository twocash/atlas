/**
 * Awakening Validator — Unit tests
 *
 * Structural + behavioral tests for the boot-time cognitive
 * infrastructure validation system.
 *
 * Pattern source: operational-doctrine.test.ts
 */

import { describe, it, expect } from 'bun:test';
import {
  runAwakeningValidation,
  formatAwakeningReport,
  getDataPathExpectations,
  CROSS_BOUNDARY_EXEMPTIONS,
} from '@atlas/shared/awakening';
import type { AwakeningReport, AwakeningCheckResult } from '@atlas/shared/awakening';

// =============================================================================
// Structural Tests
// =============================================================================

describe('Awakening Validator: Structure', () => {
  it('runAwakeningValidation returns a well-formed AwakeningReport', () => {
    const report = runAwakeningValidation('test');

    expect(report).toBeDefined();
    expect(report.checkedAt).toBeTruthy();
    expect(report.surface).toBe('test');
    expect(Array.isArray(report.checks)).toBe(true);
    expect(report.checks.length).toBeGreaterThan(0);
    expect(typeof report.canAwaken).toBe('boolean');
    expect(report.summary).toBeDefined();
    expect(typeof report.summary.total).toBe('number');
    expect(typeof report.summary.passed).toBe('number');
    expect(typeof report.summary.warned).toBe('number');
    expect(typeof report.summary.failed).toBe('number');
    expect(typeof report.summary.criticalFailed).toBe('number');
  });

  it('checkedAt is a valid ISO timestamp', () => {
    const report = runAwakeningValidation('test');
    const parsed = new Date(report.checkedAt);
    expect(parsed.getTime()).not.toBeNaN();
  });

  it('every check has required fields', () => {
    const report = runAwakeningValidation('test');

    for (const check of report.checks) {
      expect(check.category).toBeTruthy();
      expect(['data-path', 'cross-boundary', 'skill-registry']).toContain(check.category);
      expect(check.label).toBeTruthy();
      expect(['pass', 'fail', 'warn']).toContain(check.status);
      expect(check.message).toBeTruthy();
      expect(['critical', 'advisory']).toContain(check.criticality);
    }
  });

  it('summary counts match individual check results', () => {
    const report = runAwakeningValidation('test');
    const { summary, checks } = report;

    expect(summary.total).toBe(checks.length);
    expect(summary.passed).toBe(checks.filter(c => c.status === 'pass').length);
    expect(summary.warned).toBe(checks.filter(c => c.status === 'warn').length);
    expect(summary.failed).toBe(checks.filter(c => c.status === 'fail').length);
    expect(summary.criticalFailed).toBe(
      checks.filter(c => c.status === 'fail' && c.criticality === 'critical').length
    );
  });
});

// =============================================================================
// Behavioral Tests
// =============================================================================

describe('Awakening Validator: Behavior', () => {
  it('canAwaken is true when all critical paths exist', () => {
    const report = runAwakeningValidation('test');
    // After Phase 1 fixes, all paths should exist
    expect(report.canAwaken).toBe(true);
  });

  it('advisory warnings do not prevent awakening', () => {
    const report = runAwakeningValidation('test');
    // canAwaken depends only on criticalFailed, not warned
    if (report.summary.warned > 0) {
      expect(report.canAwaken).toBe(true);
    }
  });

  it('includes skill registry check', () => {
    const report = runAwakeningValidation('test');
    const skillCheck = report.checks.find(c => c.category === 'skill-registry');
    expect(skillCheck).toBeDefined();
    expect(skillCheck!.label).toBe('skill registry');
  });

  it('skill registry detects SKILL.md files', () => {
    const report = runAwakeningValidation('test');
    const skillCheck = report.checks.find(c => c.category === 'skill-registry');
    expect(skillCheck).toBeDefined();
    // We know skills exist in the repo
    expect(skillCheck!.status).toBe('pass');
    expect(skillCheck!.message).toMatch(/\d+ skill\(s\) registered/);
  });
});

// =============================================================================
// Manifest Tests
// =============================================================================

describe('Awakening Manifest', () => {
  it('returns at least 7 data path expectations', () => {
    const expectations = getDataPathExpectations();
    expect(expectations.length).toBeGreaterThanOrEqual(7);
  });

  it('every expectation has required fields', () => {
    const expectations = getDataPathExpectations();
    for (const exp of expectations) {
      expect(exp.path).toBeTruthy();
      expect(exp.label).toBeTruthy();
      expect(exp.referencedBy).toBeTruthy();
      expect(['critical', 'advisory']).toContain(exp.criticality);
    }
  });

  it('exemptions list is non-empty with rationales', () => {
    expect(CROSS_BOUNDARY_EXEMPTIONS.length).toBeGreaterThan(0);
    for (const ex of CROSS_BOUNDARY_EXEMPTIONS) {
      expect(ex.file).toBeTruthy();
      expect(ex.targetPath).toBeTruthy();
      expect(ex.rationale).toBeTruthy();
      expect(ex.line).toBeGreaterThan(0);
    }
  });
});

// =============================================================================
// Formatter Tests
// =============================================================================

describe('Awakening Formatter', () => {
  it('formatAwakeningReport produces non-empty string', () => {
    const report = runAwakeningValidation('test');
    const output = formatAwakeningReport(report);
    expect(output.length).toBeGreaterThan(0);
  });

  it('includes surface name in output', () => {
    const report = runAwakeningValidation('formatter-test');
    const output = formatAwakeningReport(report);
    expect(output).toContain('formatter-test');
  });

  it('includes summary counts in output', () => {
    const report = runAwakeningValidation('test');
    const output = formatAwakeningReport(report);
    expect(output).toContain(`${report.summary.passed}/${report.summary.total} passed`);
  });

  it('includes awakening status', () => {
    const report = runAwakeningValidation('test');
    const output = formatAwakeningReport(report);
    if (report.canAwaken) {
      expect(output).toContain('System can awaken');
    } else {
      expect(output).toContain('SYSTEM CANNOT AWAKEN');
    }
  });
});
