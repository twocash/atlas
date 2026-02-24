/**
 * Architecture Boundary Tests — ADR-005 Enforcement
 *
 * These tests prevent cognitive logic from drifting back into surface apps.
 * They scan actual file contents for import violations.
 *
 * Sprint: ARCH-CPE-001 Phase 1
 */

import { describe, it, expect } from 'bun:test';
import { readFileSync, readdirSync, statSync, existsSync } from 'fs';
import { join } from 'path';

// Resolve project root (test runs from repo root)
const PROJECT_ROOT = join(import.meta.dir, '..', '..');

function getAllTsFiles(dir: string): string[] {
  const files: string[] = [];
  if (!existsSync(dir)) return files;

  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (entry === 'node_modules' || entry === 'dist' || entry === '.git') continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...getAllTsFiles(full));
    } else if (entry.endsWith('.ts') && !entry.endsWith('.d.ts')) {
      files.push(full);
    }
  }
  return files;
}

function getImportLines(filePath: string): { line: number; text: string }[] {
  const content = readFileSync(filePath, 'utf-8');
  return content.split('\n')
    .map((text, i) => ({ line: i + 1, text }))
    .filter(({ text }) =>
      text.match(/^\s*(import|export)\s+/) && text.includes('from')
    );
}

// ============================================================================
// 1. Moved files no longer exist at old locations
// ============================================================================

describe('Phase 1: Moved files deleted from apps/telegram/', () => {
  const movedFiles = [
    'apps/telegram/src/skills/schema.ts',
    'apps/telegram/src/skills/frontmatter.ts',
    'apps/telegram/src/skills/zone-classifier.ts',
    'apps/telegram/src/skills/intent-hash.ts',
    'apps/telegram/src/skills/action-log.ts',
    'apps/telegram/src/cognitive/types.ts',
    'apps/telegram/src/cognitive/models.ts',
    'apps/telegram/src/conversation/types.ts',
  ];

  for (const file of movedFiles) {
    it(`${file} no longer exists`, () => {
      expect(existsSync(join(PROJECT_ROOT, file))).toBe(false);
    });
  }
});

// ============================================================================
// 2. Moved files exist at new locations
// ============================================================================

describe('Phase 1: Moved files exist in packages/agents/', () => {
  const destinations = [
    'packages/agents/src/skills/schema.ts',
    'packages/agents/src/skills/frontmatter.ts',
    'packages/agents/src/skills/zone-classifier.ts',
    'packages/agents/src/skills/intent-hash.ts',
    'packages/agents/src/skills/action-log.ts',
    'packages/agents/src/cognitive/types.ts',
    'packages/agents/src/cognitive/models.ts',
    'packages/agents/src/conversation/types.ts',
  ];

  for (const file of destinations) {
    it(`${file} exists`, () => {
      expect(existsSync(join(PROJECT_ROOT, file))).toBe(true);
    });
  }
});

// ============================================================================
// 3. No relative imports to old locations
// ============================================================================

describe('No dangling relative imports to moved files', () => {
  const telegramSrc = join(PROJECT_ROOT, 'apps', 'telegram', 'src');
  const telegramTest = join(PROJECT_ROOT, 'apps', 'telegram', 'test');
  const telegramScripts = join(PROJECT_ROOT, 'apps', 'telegram', 'scripts');

  const allFiles = [
    ...getAllTsFiles(telegramSrc),
    ...getAllTsFiles(telegramTest),
    ...getAllTsFiles(telegramScripts),
  ];

  // Patterns that would indicate a dangling reference to a moved file
  const danglingPatterns = [
    // Relative imports to skills files that moved
    /from\s+['"]\.\.?\/skills\/(schema|frontmatter|zone-classifier|intent-hash|action-log)['"]/,
    // Relative imports to cognitive types/models that moved
    /from\s+['"]\.\.?\/(cognitive\/(types|models))['"]/,
    // Relative imports to conversation/types that moved
    /from\s+['"]\.\.?\/conversation\/types['"]/,
    // Parent-relative imports
    /from\s+['"]\.\.\/conversation\/types['"]/,
    /from\s+['"]\.\.\/cognitive\/(types|models)['"]/,
    /from\s+['"]\.\.\/skills\/(schema|frontmatter|zone-classifier|intent-hash|action-log)['"]/,
    // Deep relative imports from test/scripts
    /from\s+['"]\.\.\/src\/skills\/(schema|frontmatter|zone-classifier|intent-hash|action-log)['"]/,
    /from\s+['"]\.\.\/src\/cognitive\/(types|models)['"]/,
    /from\s+['"]\.\.\/src\/conversation\/types['"]/,
    // Dynamic imports
    /import\(['"]\.\.\/src\/skills\/(schema|frontmatter|zone-classifier|intent-hash|action-log)['"]\)/,
  ];

  it('zero dangling relative imports across apps/telegram/', () => {
    const violations: string[] = [];

    for (const file of allFiles) {
      const imports = getImportLines(file);
      for (const { line, text } of imports) {
        for (const pattern of danglingPatterns) {
          if (pattern.test(text)) {
            const relPath = file.replace(PROJECT_ROOT + '\\', '').replace(/\\/g, '/');
            violations.push(`${relPath}:${line} — ${text.trim()}`);
          }
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Found ${violations.length} dangling import(s) to moved files:\n` +
        violations.map(v => `  ${v}`).join('\n')
      );
    }
  });
});

// ============================================================================
// 4. Grammy isolation — packages/ must never import Grammy
// ============================================================================

describe('Grammy isolation: packages/ has zero Grammy imports', () => {
  const agentsSrc = join(PROJECT_ROOT, 'packages', 'agents', 'src');
  const agentFiles = getAllTsFiles(agentsSrc);

  it('packages/agents/src/ has zero Grammy imports', () => {
    const violations: string[] = [];

    for (const file of agentFiles) {
      const content = readFileSync(file, 'utf-8');
      const lines = content.split('\n');

      for (let i = 0; i < lines.length; i++) {
        const line = lines[i];
        // Check for grammy imports
        if (line.match(/from\s+['"]grammy['"]/)) {
          const relPath = file.replace(PROJECT_ROOT + '\\', '').replace(/\\/g, '/');
          violations.push(`${relPath}:${i + 1} — ${line.trim()}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `Grammy found in packages/agents/:\n` +
        violations.map(v => `  ${v}`).join('\n')
      );
    }
  });
});

// ============================================================================
// 5. packages/agents/ must not import from apps/
// ============================================================================

describe('Package boundary: packages/agents/ does not import from apps/', () => {
  const agentsSrc = join(PROJECT_ROOT, 'packages', 'agents', 'src');
  const agentFiles = getAllTsFiles(agentsSrc);

  it('packages/agents/src/ has zero imports from apps/', () => {
    const violations: string[] = [];

    for (const file of agentFiles) {
      const imports = getImportLines(file);
      for (const { line, text } of imports) {
        if (text.match(/from\s+['"].*apps\/(telegram|chrome)/)) {
          const relPath = file.replace(PROJECT_ROOT + '\\', '').replace(/\\/g, '/');
          violations.push(`${relPath}:${line} — ${text.trim()}`);
        }
      }
    }

    if (violations.length > 0) {
      throw new Error(
        `packages/agents/ imports from apps/ (ADR-005 violation):\n` +
        violations.map(v => `  ${v}`).join('\n')
      );
    }
  });
});

// ============================================================================
// 6. No re-export stub files left behind
// ============================================================================

describe('No re-export stubs for moved files', () => {
  const movedSources = [
    'apps/telegram/src/skills/schema.ts',
    'apps/telegram/src/skills/frontmatter.ts',
    'apps/telegram/src/skills/zone-classifier.ts',
    'apps/telegram/src/skills/intent-hash.ts',
    'apps/telegram/src/skills/action-log.ts',
    'apps/telegram/src/cognitive/types.ts',
    'apps/telegram/src/cognitive/models.ts',
    'apps/telegram/src/conversation/types.ts',
  ];

  it('no re-export files exist at old locations', () => {
    const existing = movedSources.filter(f => existsSync(join(PROJECT_ROOT, f)));
    if (existing.length > 0) {
      throw new Error(
        `Re-export stubs found (should be deleted):\n` +
        existing.map(f => `  ${f}`).join('\n')
      );
    }
  });
});
