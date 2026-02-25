/**
 * Architecture Boundary Tests — ADR-005 Enforcement
 *
 * These tests prevent cognitive logic from drifting back into surface apps.
 * They scan actual file contents for import violations.
 *
 * Sprint: ARCH-CPE-001 Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5
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

describe('Moved files deleted from apps/telegram/', () => {
  const movedFiles = [
    // Phase 1 — Foundation types + skills
    'apps/telegram/src/skills/schema.ts',
    'apps/telegram/src/skills/frontmatter.ts',
    'apps/telegram/src/skills/zone-classifier.ts',
    'apps/telegram/src/skills/intent-hash.ts',
    'apps/telegram/src/skills/action-log.ts',
    'apps/telegram/src/cognitive/types.ts',
    'apps/telegram/src/cognitive/models.ts',
    'apps/telegram/src/conversation/types.ts',
    // Phase 2 — Cognitive Engine
    'apps/telegram/src/cognitive/profiler.ts',
    'apps/telegram/src/cognitive/selector.ts',
    'apps/telegram/src/cognitive/ledger.ts',
    'apps/telegram/src/cognitive/persistence.ts',
    'apps/telegram/src/cognitive/worker.ts',
    'apps/telegram/src/cognitive/router.ts',
    'apps/telegram/src/cognitive/supervisor.ts',
    'apps/telegram/src/cognitive/triage-skill.ts',
    'apps/telegram/src/cognitive/triage-patterns.ts',
    'apps/telegram/src/cognitive/index.ts',
    'apps/telegram/src/config/cognitive.ts',
    'apps/telegram/src/skills/registry.ts',
    'apps/telegram/src/skills/pattern-detector.ts',
    'apps/telegram/src/skills/executor.ts',
    // Phase 3 — Session stores + conversation pipeline
    'apps/telegram/src/conversation/socratic-session.ts',
    'apps/telegram/src/conversation/approval-session.ts',
    'apps/telegram/src/conversation/conversation-state.ts',
    'apps/telegram/src/conversation/pending-content.ts',
    'apps/telegram/src/conversation/context.ts',
    'apps/telegram/src/conversation/context-manager.ts',
    'apps/telegram/src/conversation/context-enrichment.ts',
    'apps/telegram/src/conversation/content-extractor.ts',
    'apps/telegram/src/conversation/content-pre-reader.ts',
    'apps/telegram/src/conversation/content-patterns.ts',
    'apps/telegram/src/conversation/content-router.ts',
    'apps/telegram/src/conversation/bridge-extractor.ts',
    'apps/telegram/src/conversation/prompt.ts',
    'apps/telegram/src/conversation/router.ts',
    'apps/telegram/src/conversation/self-model-provider.ts',
    'apps/telegram/src/conversation/stats.ts',
    'apps/telegram/src/conversation/attachments.ts',
    'apps/telegram/src/conversation/audit.ts',
    // Phase 3 — Tools directory
    'apps/telegram/src/conversation/tools/agents.ts',
    'apps/telegram/src/conversation/tools/browser.ts',
    'apps/telegram/src/conversation/tools/core.ts',
    'apps/telegram/src/conversation/tools/dispatcher.ts',
    'apps/telegram/src/conversation/tools/index.ts',
    'apps/telegram/src/conversation/tools/operator.ts',
    'apps/telegram/src/conversation/tools/self-mod.ts',
    'apps/telegram/src/conversation/tools/supervisor.ts',
    'apps/telegram/src/conversation/tools/workspace.ts',
    // Phase 3 — Skills
    'apps/telegram/src/skills/approval-queue.ts',
    // Phase 4 — Interface splits + cleanup
    'apps/telegram/src/conversation/dialogue-session.ts',
    'apps/telegram/src/cognitive/__tests__/triage-patterns.test.ts',
    'apps/telegram/src/cognitive/__tests__/triage-skill.test.ts',
    'apps/telegram/src/skills/executor.test.ts',
    'apps/telegram/src/skills/intent-hash.test.ts',
    'apps/telegram/src/skills/registry.test.ts',
    'apps/telegram/src/skills/zone-classifier.test.ts',
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

describe('Moved files exist in packages/agents/', () => {
  const destinations = [
    // Phase 1 — Foundation types + skills
    'packages/agents/src/skills/schema.ts',
    'packages/agents/src/skills/frontmatter.ts',
    'packages/agents/src/skills/zone-classifier.ts',
    'packages/agents/src/skills/intent-hash.ts',
    'packages/agents/src/skills/action-log.ts',
    'packages/agents/src/cognitive/types.ts',
    'packages/agents/src/cognitive/models.ts',
    'packages/agents/src/conversation/types.ts',
    // Phase 2 — Cognitive Engine
    'packages/agents/src/cognitive/profiler.ts',
    'packages/agents/src/cognitive/selector.ts',
    'packages/agents/src/cognitive/ledger.ts',
    'packages/agents/src/cognitive/persistence.ts',
    'packages/agents/src/cognitive/worker.ts',
    'packages/agents/src/cognitive/router.ts',
    'packages/agents/src/cognitive/supervisor.ts',
    'packages/agents/src/cognitive/triage-skill.ts',
    'packages/agents/src/cognitive/triage-patterns.ts',
    'packages/agents/src/cognitive/index.ts',
    'packages/agents/src/config/cognitive.ts',
    'packages/agents/src/skills/registry.ts',
    'packages/agents/src/skills/pattern-detector.ts',
    'packages/agents/src/skills/executor.ts',
    // Phase 3 — Session stores + conversation pipeline
    'packages/agents/src/conversation/socratic-session.ts',
    'packages/agents/src/conversation/approval-session.ts',
    'packages/agents/src/conversation/conversation-state.ts',
    'packages/agents/src/conversation/pending-content.ts',
    'packages/agents/src/conversation/context.ts',
    'packages/agents/src/conversation/context-manager.ts',
    'packages/agents/src/conversation/context-enrichment.ts',
    'packages/agents/src/conversation/content-extractor.ts',
    'packages/agents/src/conversation/content-pre-reader.ts',
    'packages/agents/src/conversation/content-patterns.ts',
    'packages/agents/src/conversation/content-router.ts',
    'packages/agents/src/conversation/bridge-extractor.ts',
    'packages/agents/src/conversation/prompt.ts',
    'packages/agents/src/conversation/router.ts',
    'packages/agents/src/conversation/self-model-provider.ts',
    'packages/agents/src/conversation/stats.ts',
    'packages/agents/src/conversation/attachments.ts',
    'packages/agents/src/conversation/audit.ts',
    // Phase 3 — Tools directory
    'packages/agents/src/conversation/tools/hooks.ts',
    'packages/agents/src/conversation/tools/agents.ts',
    'packages/agents/src/conversation/tools/browser.ts',
    'packages/agents/src/conversation/tools/core.ts',
    'packages/agents/src/conversation/tools/dispatcher.ts',
    'packages/agents/src/conversation/tools/index.ts',
    'packages/agents/src/conversation/tools/operator.ts',
    'packages/agents/src/conversation/tools/self-mod.ts',
    'packages/agents/src/conversation/tools/supervisor.ts',
    'packages/agents/src/conversation/tools/workspace.ts',
    // Phase 3 — Skills
    'packages/agents/src/skills/approval-queue.ts',
    // Phase 4 — Interface splits
    'packages/agents/src/media/processor.ts',
    'packages/agents/src/conversation/notion-lookup.ts',
    'packages/agents/src/conversation/content-detection.ts',
    // Phase 5 — Pipeline orchestrator
    'packages/agents/src/pipeline/orchestrator.ts',
    'packages/agents/src/pipeline/types.ts',
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
    // Phase 1: Relative imports to skills files that moved
    /from\s+['"]\.\.?\/skills\/(schema|frontmatter|zone-classifier|intent-hash|action-log)['"]/,
    // Phase 1: Relative imports to cognitive types/models that moved
    /from\s+['"]\.\.?\/(cognitive\/(types|models))['"]/,
    // Phase 1: Relative imports to conversation/types that moved
    /from\s+['"]\.\.?\/conversation\/types['"]/,
    // Phase 1: Parent-relative imports
    /from\s+['"]\.\.\/conversation\/types['"]/,
    /from\s+['"]\.\.\/cognitive\/(types|models)['"]/,
    /from\s+['"]\.\.\/skills\/(schema|frontmatter|zone-classifier|intent-hash|action-log)['"]/,
    // Phase 1: Deep relative imports from test/scripts
    /from\s+['"]\.\.\/src\/skills\/(schema|frontmatter|zone-classifier|intent-hash|action-log)['"]/,
    /from\s+['"]\.\.\/src\/cognitive\/(types|models)['"]/,
    /from\s+['"]\.\.\/src\/conversation\/types['"]/,
    // Phase 1: Dynamic imports
    /import\(['"]\.\.\/src\/skills\/(schema|frontmatter|zone-classifier|intent-hash|action-log)['"]\)/,

    // Phase 2: Relative imports to cognitive engine files that moved
    /from\s+['"]\.\.?\/cognitive\/(profiler|selector|ledger|persistence|worker|router|supervisor|triage-skill|triage-patterns|index)['"]/,
    // Phase 2: Relative imports to skills engine files that moved
    /from\s+['"]\.\.?\/skills\/(registry|pattern-detector|executor)['"]/,
    // Phase 2: Relative imports to config/cognitive that moved
    /from\s+['"]\.\.?\/config\/cognitive['"]/,
    // Phase 2: Parent-relative imports
    /from\s+['"]\.\.\/cognitive\/(profiler|selector|ledger|persistence|worker|router|supervisor|triage-skill|triage-patterns|index)['"]/,
    /from\s+['"]\.\.\/skills\/(registry|pattern-detector|executor)['"]/,
    /from\s+['"]\.\.\/config\/cognitive['"]/,
    // Phase 2: Deep relative imports from test/scripts
    /from\s+['"]\.\.\/src\/cognitive\/(profiler|selector|ledger|persistence|worker|router|supervisor|triage-skill|triage-patterns|index)['"]/,
    /from\s+['"]\.\.\/src\/skills\/(registry|pattern-detector|executor)['"]/,
    /from\s+['"]\.\.\/src\/config\/cognitive['"]/,
    // Phase 2: Barrel import to cognitive/ directory (the index.ts that moved)
    /from\s+['"]\.\.?\/cognitive['"]/,

    // Phase 3: Relative imports to conversation pipeline files that moved
    /from\s+['"]\.\.?\/conversation\/(socratic-session|approval-session|conversation-state|pending-content|context|context-manager|context-enrichment|content-extractor|content-pre-reader|content-patterns|content-router|bridge-extractor|prompt|router|self-model-provider|stats|attachments|audit)['"]/,
    // Phase 3: Relative imports to conversation/tools/ that moved
    /from\s+['"]\.\.?\/conversation\/tools\/(agents|browser|core|dispatcher|index|operator|self-mod|supervisor|workspace)['"]/,
    // Phase 3: Relative imports to skills/approval-queue that moved
    /from\s+['"]\.\.?\/skills\/approval-queue['"]/,
    // Phase 3: Parent-relative imports from test/scripts
    /from\s+['"]\.\.\/src\/conversation\/(socratic-session|approval-session|conversation-state|pending-content|context|context-manager|context-enrichment|content-extractor|content-pre-reader|content-patterns|content-router|bridge-extractor|prompt|router|self-model-provider|stats|attachments|audit)['"]/,
    /from\s+['"]\.\.\/src\/conversation\/tools\/(agents|browser|core|dispatcher|index|operator|self-mod|supervisor|workspace)['"]/,
    /from\s+['"]\.\.\/src\/skills\/approval-queue['"]/,
    // Phase 3: Dynamic imports to moved files
    /import\(['"]\.\.?\/conversation\/(socratic-session|approval-session|conversation-state|pending-content|context|context-manager|context-enrichment|content-extractor|content-pre-reader|content-patterns|content-router|bridge-extractor|prompt|router|self-model-provider|stats|attachments|audit)['"]\)/,
    /import\(['"]\.\.?\/skills\/approval-queue['"]\)/,
    /import\(['"]\.\.\/src\/conversation\/(socratic-session|approval-session|conversation-state|pending-content|context|context-manager|context-enrichment|content-extractor|content-pre-reader|content-patterns|content-router|bridge-extractor|prompt|router|self-model-provider|stats|attachments|audit)['"]\)/,
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
    // Phase 1 — Foundation types + skills
    'apps/telegram/src/skills/schema.ts',
    'apps/telegram/src/skills/frontmatter.ts',
    'apps/telegram/src/skills/zone-classifier.ts',
    'apps/telegram/src/skills/intent-hash.ts',
    'apps/telegram/src/skills/action-log.ts',
    'apps/telegram/src/cognitive/types.ts',
    'apps/telegram/src/cognitive/models.ts',
    'apps/telegram/src/conversation/types.ts',
    // Phase 2 — Cognitive Engine
    'apps/telegram/src/cognitive/profiler.ts',
    'apps/telegram/src/cognitive/selector.ts',
    'apps/telegram/src/cognitive/ledger.ts',
    'apps/telegram/src/cognitive/persistence.ts',
    'apps/telegram/src/cognitive/worker.ts',
    'apps/telegram/src/cognitive/router.ts',
    'apps/telegram/src/cognitive/supervisor.ts',
    'apps/telegram/src/cognitive/triage-skill.ts',
    'apps/telegram/src/cognitive/triage-patterns.ts',
    'apps/telegram/src/cognitive/index.ts',
    'apps/telegram/src/config/cognitive.ts',
    'apps/telegram/src/skills/registry.ts',
    'apps/telegram/src/skills/pattern-detector.ts',
    'apps/telegram/src/skills/executor.ts',
    // Phase 3 — Session stores + conversation pipeline
    'apps/telegram/src/conversation/socratic-session.ts',
    'apps/telegram/src/conversation/approval-session.ts',
    'apps/telegram/src/conversation/conversation-state.ts',
    'apps/telegram/src/conversation/pending-content.ts',
    'apps/telegram/src/conversation/context.ts',
    'apps/telegram/src/conversation/context-manager.ts',
    'apps/telegram/src/conversation/context-enrichment.ts',
    'apps/telegram/src/conversation/content-extractor.ts',
    'apps/telegram/src/conversation/content-pre-reader.ts',
    'apps/telegram/src/conversation/content-patterns.ts',
    'apps/telegram/src/conversation/content-router.ts',
    'apps/telegram/src/conversation/bridge-extractor.ts',
    'apps/telegram/src/conversation/prompt.ts',
    'apps/telegram/src/conversation/router.ts',
    'apps/telegram/src/conversation/self-model-provider.ts',
    'apps/telegram/src/conversation/stats.ts',
    'apps/telegram/src/conversation/attachments.ts',
    'apps/telegram/src/conversation/audit.ts',
    // Phase 3 — Tools directory
    'apps/telegram/src/conversation/tools/agents.ts',
    'apps/telegram/src/conversation/tools/browser.ts',
    'apps/telegram/src/conversation/tools/core.ts',
    'apps/telegram/src/conversation/tools/dispatcher.ts',
    'apps/telegram/src/conversation/tools/index.ts',
    'apps/telegram/src/conversation/tools/operator.ts',
    'apps/telegram/src/conversation/tools/self-mod.ts',
    'apps/telegram/src/conversation/tools/supervisor.ts',
    'apps/telegram/src/conversation/tools/workspace.ts',
    // Phase 3 — Skills
    'apps/telegram/src/skills/approval-queue.ts',
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

// ============================================================================
// 7. Bridge ADR-005: packages/bridge/ must not import from apps/
// ============================================================================

// ============================================================================
// 7b. Phase 5: handler.ts is a thin adapter delegating to orchestrator
// ============================================================================

describe('Phase 5: handler.ts thin adapter contract', () => {
  const handlerPath = join(PROJECT_ROOT, 'apps', 'telegram', 'src', 'conversation', 'handler.ts');
  const orchestratorPath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'orchestrator.ts');

  it('handler.ts imports from orchestrator', () => {
    const content = readFileSync(handlerPath, 'utf-8');
    expect(content).toMatch(/from\s+['"]@atlas\/agents\/src\/pipeline\/orchestrator['"]/);
  });

  it('handler.ts imports pipeline types', () => {
    const content = readFileSync(handlerPath, 'utf-8');
    expect(content).toMatch(/from\s+['"]@atlas\/agents\/src\/pipeline\/types['"]/);
  });

  it('handler.ts does not instantiate Anthropic client', () => {
    const content = readFileSync(handlerPath, 'utf-8');
    expect(content).not.toMatch(/new Anthropic\(/);
  });

  it('handler.ts does not import Anthropic SDK', () => {
    const content = readFileSync(handlerPath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"]@anthropic-ai\/sdk['"]/);
  });

  it('handler.ts is under 250 lines (thin adapter)', () => {
    const content = readFileSync(handlerPath, 'utf-8');
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeLessThan(250);
  });

  it('orchestrator.ts has zero Grammy imports', () => {
    const content = readFileSync(orchestratorPath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"]grammy['"]/);
  });

  it('orchestrator.ts exports orchestrateMessage', () => {
    const content = readFileSync(orchestratorPath, 'utf-8');
    expect(content).toMatch(/export\s+async\s+function\s+orchestrateMessage/);
  });
});

// ============================================================================
// 8. Bridge ADR-005: packages/bridge/ must not import from apps/
// ============================================================================

describe('Bridge boundary: packages/bridge/ does not import from apps/', () => {
  const bridgeSrc = join(PROJECT_ROOT, 'packages', 'bridge', 'src');
  const bridgeFiles = getAllTsFiles(bridgeSrc);

  it('packages/bridge/src/ has zero imports from apps/', () => {
    const violations: string[] = [];

    for (const file of bridgeFiles) {
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
        `packages/bridge/ imports from apps/ (ADR-005 violation):\n` +
        violations.map(v => `  ${v}`).join('\n')
      );
    }
  });
});
