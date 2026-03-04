/**
 * Awakening Drift Scanner — CI boundary enforcement for data path migration
 *
 * Prevents regression of the ADR-005 migration: code in packages/agents/
 * must not reference apps/telegram/data/ paths (except documented exemptions).
 *
 * Pattern source: architecture-boundary.test.ts (same utilities).
 *
 * 5 Rules:
 *   1. No apps/telegram/data/ references in packages/agents/src/
 *   2. No apps/telegram/data/ references in packages/bridge/src/ (except cookie exemptions)
 *   3. All manifest data paths exist on disk
 *   4. No stale "relative to apps/telegram" comments
 *   5. Manifest is not stale — every path has a source reference
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';
import { runAwakeningValidation } from '@atlas/shared/awakening';
import { getDataPathExpectations, CROSS_BOUNDARY_EXEMPTIONS } from '@atlas/shared/awakening';

// Resolve project root (packages/agents/test/ → project root)
const PROJECT_ROOT = join(import.meta.dir, '..', '..', '..');
const AGENTS_SRC = join(PROJECT_ROOT, 'packages', 'agents', 'src');
const BRIDGE_SRC = join(PROJECT_ROOT, 'packages', 'bridge', 'src');

// =============================================================================
// UTILITIES (reuse patterns from architecture-boundary.test.ts)
// =============================================================================

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...getAllTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts') && !entry.endsWith('.test.ts')) {
      files.push(full);
    }
  }
  return files;
}

function relPath(filePath: string): string {
  return filePath.replace(PROJECT_ROOT + '\\', '').replace(PROJECT_ROOT + '/', '').replace(/\\/g, '/');
}

function scanFiles(
  files: string[],
  test: (content: string, line: string, lineNum: number, filePath: string) => boolean,
  excludePatterns: RegExp[] = [],
): { file: string; line: number; text: string }[] {
  const violations: { file: string; line: number; text: string }[] = [];

  for (const filePath of files) {
    const rp = relPath(filePath);

    // Skip excluded paths
    if (excludePatterns.some(p => p.test(rp))) continue;

    const content = readFileSync(filePath, 'utf-8');
    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Skip comments
      const trimmed = line.trim();
      if (trimmed.startsWith('//') || trimmed.startsWith('*') || trimmed.startsWith('/*')) continue;

      if (test(content, line, i + 1, filePath)) {
        violations.push({ file: rp, line: i + 1, text: trimmed });
      }
    }
  }
  return violations;
}

function formatViolations(violations: { file: string; line: number; text: string }[]): string {
  return violations.map(v => `  ${v.file}:${v.line} — ${v.text}`).join('\n');
}

// =============================================================================
// Rule 1: No apps/telegram/data/ references in packages/agents/src/
// =============================================================================

describe('Rule 1: No apps/telegram/data/ in packages/agents/src/', () => {
  const agentFiles = getAllTsFiles(AGENTS_SRC);

  it('has zero cross-boundary data path references', () => {
    const violations = scanFiles(agentFiles, (_content, line) => {
      return /apps\/telegram\/data\//.test(line) || /apps\\telegram\\data\\/.test(line);
    });

    if (violations.length > 0) {
      throw new Error(
        `Cross-boundary data path references found in packages/agents/src/:\n${formatViolations(violations)}\n\n` +
        `Fix: Update paths to use packages/agents/data/ or __dirname-relative resolution.`
      );
    }
  });
});

// =============================================================================
// Rule 2: No apps/telegram/data/ in packages/bridge/src/ (except cookies)
// =============================================================================

describe('Rule 2: No apps/telegram/data/ in packages/bridge/src/ (except cookies)', () => {
  const bridgeFiles = getAllTsFiles(BRIDGE_SRC);

  it('only has exempted cross-boundary references', () => {
    const exemptedTargets = CROSS_BOUNDARY_EXEMPTIONS.map(e => e.targetPath);

    const violations = scanFiles(bridgeFiles, (_content, line) => {
      // Check for apps/telegram/data/ references
      if (!/apps\/telegram\/data\//.test(line) && !/apps\\telegram\\data\\/.test(line)) return false;

      // Check if the reference is to an exempted path (cookies)
      const isExempted = exemptedTargets.some(target => line.includes(target));
      return !isExempted;
    });

    if (violations.length > 0) {
      throw new Error(
        `Non-exempted cross-boundary data path references in packages/bridge/src/:\n${formatViolations(violations)}\n\n` +
        `Fix: Add to CROSS_BOUNDARY_EXEMPTIONS in manifest.ts or update the path.`
      );
    }
  });
});

// =============================================================================
// Rule 3: All manifest data paths exist on disk
// =============================================================================

describe('Rule 3: All manifest data paths exist', () => {
  it('awakening validation reports zero failures', () => {
    const report = runAwakeningValidation('ci');

    const failures = report.checks.filter(c => c.status === 'fail');
    if (failures.length > 0) {
      throw new Error(
        `Awakening validation failures:\n` +
        failures.map(f => `  ${f.message}`).join('\n')
      );
    }
  });
});

// =============================================================================
// Rule 4: No stale "relative to apps/telegram" comments
// =============================================================================

describe('Rule 4: No stale "relative to apps/telegram" comments', () => {
  const agentFiles = getAllTsFiles(AGENTS_SRC);

  it('has zero stale path comments', () => {
    const violations: { file: string; line: number; text: string }[] = [];

    for (const filePath of agentFiles) {
      const rp = relPath(filePath);
      const content = readFileSync(filePath, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const trimmed = lines[i].trim();
        // Only check comments for stale references
        if (!trimmed.startsWith('//') && !trimmed.startsWith('*')) continue;
        if (/relative to apps\/telegram/i.test(trimmed)) {
          violations.push({ file: rp, line: i + 1, text: trimmed });
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Stale "relative to apps/telegram" comments found:\n${formatViolations(violations)}\n\n` +
        `Fix: Update comment to reference packages/agents/.`
      );
    }
  });
});

// =============================================================================
// Rule 5: Manifest is not stale — paths are referenced by source
// =============================================================================

describe('Rule 5: Manifest coverage', () => {
  it('has at least 7 data path expectations', () => {
    const expectations = getDataPathExpectations();
    expect(expectations.length).toBeGreaterThanOrEqual(7);
  });

  it('has non-empty cross-boundary exemptions with rationales', () => {
    expect(CROSS_BOUNDARY_EXEMPTIONS.length).toBeGreaterThan(0);
    for (const exemption of CROSS_BOUNDARY_EXEMPTIONS) {
      expect(exemption.rationale.length).toBeGreaterThan(0);
      expect(exemption.file.length).toBeGreaterThan(0);
      expect(exemption.targetPath.length).toBeGreaterThan(0);
    }
  });
});
