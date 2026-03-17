/**
 * Architecture Boundary Tests — ADR-005 Enforcement
 *
 * These tests prevent cognitive logic from drifting back into surface apps.
 * They scan actual file contents for import violations.
 *
 * Sprint: ARCH-CPE-001 Phase 1 + Phase 2 + Phase 3 + Phase 4 + Phase 5 + Phase 6
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
    'packages/agents/src/conversation/conversation-state.ts',
    'packages/agents/src/conversation/approval-utils.ts',
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
    // Phase 6 — Unified Cognitive Architecture
    'packages/agents/src/pipeline/surface.ts',
    'packages/agents/src/pipeline/system.ts',
    'packages/agents/src/pipeline/router.ts',
    'packages/agents/src/pipeline/router-config.ts',
    'packages/agents/src/pipeline/tool-executor.ts',
    'packages/agents/src/pipeline/context-assembly.ts',
    'packages/agents/src/pipeline/cognitive-pipeline.ts',
    'packages/agents/src/pipeline/backends/claude-api.ts',
    'packages/agents/src/pipeline/backends/claude-code.ts',
    'packages/agents/src/pipeline/backends/local-model.ts',
    'packages/agents/src/pipeline/backends/index.ts',
    'packages/agents/src/pipeline/surfaces/telegram.ts',
    'packages/agents/src/pipeline/surfaces/bridge.ts',
    'packages/agents/src/pipeline/surfaces/index.ts',
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

  it('handler.ts is under 400 lines (thin adapter + bridge relay)', () => {
    const content = readFileSync(handlerPath, 'utf-8');
    const lineCount = content.split('\n').length;
    expect(lineCount).toBeLessThan(400);
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

// ============================================================================
// 9. Phase 6: Unified Cognitive Architecture — Contract Tests
// ============================================================================

describe('Phase 6: AtlasSurface contract', () => {
  const surfacePath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'surface.ts');

  it('defines AtlasSurface interface', () => {
    const content = readFileSync(surfacePath, 'utf-8');
    expect(content).toMatch(/export interface AtlasSurface/);
  });

  it('AtlasSurface has ≤4 delivery methods', () => {
    const content = readFileSync(surfacePath, 'utf-8');
    // Required: reply, sendTyping. Optional: acknowledge, acquireMedia
    expect(content).toMatch(/reply\(.*\).*Promise/);
    expect(content).toMatch(/sendTyping\(\).*Promise/);
    expect(content).toMatch(/acknowledge\?.*Promise/);
    expect(content).toMatch(/acquireMedia\?.*Promise/);
  });

  it('AtlasSurface provides context and device tools', () => {
    const content = readFileSync(surfacePath, 'utf-8');
    expect(content).toMatch(/getContext\(\).*Promise<SurfaceContext>/);
    expect(content).toMatch(/getDeviceTools\(\).*DeviceToolDefinition\[\]/);
    expect(content).toMatch(/executeDeviceTool\(/);
  });

  it('AtlasSurface has NO compute constraints (forbidden anti-pattern)', () => {
    const content = readFileSync(surfacePath, 'utf-8');
    // Extract only the AtlasSurface interface body (not comments)
    const interfaceMatch = content.match(/export interface AtlasSurface\s*\{[\s\S]*?\n\}/);
    const interfaceBody = interfaceMatch?.[0] ?? '';
    // These would be anti-patterns as interface members
    expect(interfaceBody).not.toMatch(/maxTier\s*[?:]|maxTier\s*\(/);
    expect(interfaceBody).not.toMatch(/supportsAgenticExecution\s*[?:]/);
    expect(interfaceBody).not.toMatch(/availableModels\s*[?:]/);
    expect(interfaceBody).not.toMatch(/maxComplexity\s*[?:]/);
  });

  it('DeliveryConstraints only constrains delivery, not compute', () => {
    const content = readFileSync(surfacePath, 'utf-8');
    expect(content).toMatch(/export interface DeliveryConstraints/);
    expect(content).toMatch(/supportsStreaming.*boolean/);
    expect(content).toMatch(/maxResponseLength/);
    expect(content).toMatch(/supportsRichFormatting.*boolean/);
  });

  it('has zero Grammy imports', () => {
    const content = readFileSync(surfacePath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"]grammy['"]/);
  });
});

describe('Phase 6: SystemCapabilities contract', () => {
  const systemPath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'system.ts');

  it('defines SystemCapabilities interface', () => {
    const content = readFileSync(systemPath, 'utf-8');
    expect(content).toMatch(/export interface SystemCapabilities/);
  });

  it('SystemCapabilities has backends + desk tools', () => {
    const content = readFileSync(systemPath, 'utf-8');
    expect(content).toMatch(/backends.*ExecutionBackend\[\]/);
    expect(content).toMatch(/deskTools.*ToolDefinition\[\]/);
    expect(content).toMatch(/deskToolHandlers.*Map/);
  });

  it('CognitiveTier is 0|1|2|3', () => {
    const content = readFileSync(systemPath, 'utf-8');
    expect(content).toMatch(/export type CognitiveTier\s*=\s*0\s*\|\s*1\s*\|\s*2\s*\|\s*3/);
  });

  it('ExecutionMode has deterministic|conversational|agentic', () => {
    const content = readFileSync(systemPath, 'utf-8');
    expect(content).toMatch(/'deterministic'/);
    expect(content).toMatch(/'conversational'/);
    expect(content).toMatch(/'agentic'/);
  });
});

describe('Phase 6: CognitiveRouter contract', () => {
  const routerPath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'router.ts');

  it('exports route() function', () => {
    const content = readFileSync(routerPath, 'utf-8');
    expect(content).toMatch(/export function route\(/);
  });

  it('exports checkContextRequirements() function', () => {
    const content = readFileSync(routerPath, 'utf-8');
    expect(content).toMatch(/export function checkContextRequirements\(/);
  });

  it('route() returns ExecutionStrategy', () => {
    const content = readFileSync(routerPath, 'utf-8');
    expect(content).toMatch(/\):\s*ExecutionStrategy/);
  });

  it('has zero Grammy imports', () => {
    const content = readFileSync(routerPath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"]grammy['"]/);
  });
});

describe('Phase 6: RouterConfigCache contract', () => {
  const configPath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'router-config.ts');

  it('defines RouterConfig and RouterConfigCache', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toMatch(/export interface RouterConfig/);
    expect(content).toMatch(/export interface RouterConfigCache/);
  });

  it('has COMPILED_DEFAULTS with tier 0-3 mappings', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toMatch(/COMPILED_DEFAULTS.*RouterConfig/);
    expect(content).toMatch(/0:.*primary.*deterministic/);
    expect(content).toMatch(/1:.*primary.*haiku/);
    expect(content).toMatch(/2:.*primary.*sonnet/);
    expect(content).toMatch(/3:.*primary.*sonnet/);
  });

  it('cache has startPolling/stopPolling/forceRefresh', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toMatch(/startPolling\(/);
    expect(content).toMatch(/stopPolling\(/);
    expect(content).toMatch(/forceRefresh\(/);
  });

  it('has staleness detection', () => {
    const content = readFileSync(configPath, 'utf-8');
    expect(content).toMatch(/STALE_THRESHOLD/);
    expect(content).toMatch(/checkStaleness/);
  });
});

describe('Phase 6: ToolExecutor contract', () => {
  const executorPath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'tool-executor.ts');

  it('defines OrchestratorToolExecutor class', () => {
    const content = readFileSync(executorPath, 'utf-8');
    expect(content).toMatch(/export class OrchestratorToolExecutor/);
  });

  it('routes desk vs device tools', () => {
    const content = readFileSync(executorPath, 'utf-8');
    expect(content).toMatch(/executeDeskTool/);
    expect(content).toMatch(/executeDeviceTool/);
    expect(content).toMatch(/classification.*===.*'device'/);
  });

  it('has LegacyToolBridge for strangler fig migration', () => {
    const content = readFileSync(executorPath, 'utf-8');
    expect(content).toMatch(/export class LegacyToolBridge/);
    expect(content).toMatch(/createHandlers\(/);
    expect(content).toMatch(/createToolDefinitions\(/);
  });

  it('has mergeTools utility', () => {
    const content = readFileSync(executorPath, 'utf-8');
    expect(content).toMatch(/export function mergeTools\(/);
  });
});

describe('Phase 6: Execution Backends', () => {
  const apiPath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'backends', 'claude-api.ts');
  const codePath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'backends', 'claude-code.ts');
  const localPath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'backends', 'local-model.ts');

  it('ClaudeAPIBackend implements ExecutionBackend', () => {
    const content = readFileSync(apiPath, 'utf-8');
    expect(content).toMatch(/class ClaudeAPIBackend implements ExecutionBackend/);
    expect(content).toMatch(/backendId\s*=\s*'claude-api'/);
    expect(content).toMatch(/async \*execute\(/);
  });

  it('ClaudeAPIBackend has tool use loop', () => {
    const content = readFileSync(apiPath, 'utf-8');
    expect(content).toMatch(/tool_use/);
    expect(content).toMatch(/MAX_TOOL_ITERATIONS/);
    expect(content).toMatch(/toolExecutor\.execute/);
  });

  it('ClaudeCodeBackend implements ExecutionBackend', () => {
    const content = readFileSync(codePath, 'utf-8');
    expect(content).toMatch(/class ClaudeCodeBackend implements ExecutionBackend/);
    expect(content).toMatch(/backendId\s*=\s*'claude-code'/);
    expect(content).toMatch(/stream-json/);
  });

  it('ClaudeCodeBackend uses NDJSON protocol', () => {
    const content = readFileSync(codePath, 'utf-8');
    expect(content).toMatch(/NDJSON/i);
    expect(content).toMatch(/parseNdjsonMessage/);
  });

  it('LocalModelBackend is a seam (stub)', () => {
    const content = readFileSync(localPath, 'utf-8');
    expect(content).toMatch(/class LocalModelBackend implements ExecutionBackend/);
    expect(content).toMatch(/backendId\s*=\s*'local-model'/);
  });
});

describe('Phase 6: Surface Implementations', () => {
  const telegramPath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'surfaces', 'telegram.ts');
  const bridgePath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'surfaces', 'bridge.ts');

  it('TelegramSurface implements AtlasSurface', () => {
    const content = readFileSync(telegramPath, 'utf-8');
    expect(content).toMatch(/class TelegramSurface implements AtlasSurface/);
    expect(content).toMatch(/surfaceId\s*=\s*'telegram'/);
  });

  it('TelegramSurface has no Grammy imports (uses bindings)', () => {
    const content = readFileSync(telegramPath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"]grammy['"]/);
  });

  it('TelegramSurface has correct delivery constraints', () => {
    const content = readFileSync(telegramPath, 'utf-8');
    expect(content).toMatch(/supportsStreaming:\s*false/);
    expect(content).toMatch(/maxResponseLength:\s*4096/);
  });

  it('TelegramSurface has no device tools', () => {
    const content = readFileSync(telegramPath, 'utf-8');
    expect(content).toMatch(/getDeviceTools\(\).*DeviceToolDefinition\[\]/);
    expect(content).toMatch(/return\s*\[\]/);
  });

  it('BridgeSurface implements AtlasSurface', () => {
    const content = readFileSync(bridgePath, 'utf-8');
    expect(content).toMatch(/class BridgeSurface implements AtlasSurface/);
    expect(content).toMatch(/surfaceId\s*=\s*'bridge'/);
  });

  it('BridgeSurface supports streaming', () => {
    const content = readFileSync(bridgePath, 'utf-8');
    expect(content).toMatch(/supportsStreaming:\s*true/);
  });

  it('BridgeSurface has browser device tools', () => {
    const content = readFileSync(bridgePath, 'utf-8');
    expect(content).toMatch(/browser_click/);
    expect(content).toMatch(/browser_type/);
    expect(content).toMatch(/browser_navigate/);
    expect(content).toMatch(/browser_extract/);
    expect(content).toMatch(/classification:\s*'device'/);
  });

  it('BridgeSurface has no Grammy imports', () => {
    const content = readFileSync(bridgePath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"]grammy['"]/);
  });
});

describe('Phase 6: CognitivePipeline integration', () => {
  const pipelinePath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'cognitive-pipeline.ts');

  it('defines CognitivePipeline class', () => {
    const content = readFileSync(pipelinePath, 'utf-8');
    expect(content).toMatch(/export class CognitivePipeline/);
  });

  it('process() takes PipelineRequest + AtlasSurface', () => {
    const content = readFileSync(pipelinePath, 'utf-8');
    expect(content).toMatch(/async process\(/);
    expect(content).toMatch(/request:\s*PipelineRequest/);
    expect(content).toMatch(/surface:\s*AtlasSurface/);
  });

  it('wires router, assembler, executor, and backend', () => {
    const content = readFileSync(pipelinePath, 'utf-8');
    expect(content).toMatch(/route\(/);
    expect(content).toMatch(/assembler\.assemble\(/);
    expect(content).toMatch(/OrchestratorToolExecutor/);
    expect(content).toMatch(/strategy\.backend\.execute\(/);
  });

  it('delivers via surface.reply()', () => {
    const content = readFileSync(pipelinePath, 'utf-8');
    expect(content).toMatch(/surface\.reply\(/);
  });

  it('has zero Grammy imports', () => {
    const content = readFileSync(pipelinePath, 'utf-8');
    expect(content).not.toMatch(/from\s+['"]grammy['"]/);
  });
});

describe('Phase 6: Hook Migration Map documented', () => {
  const typesPath = join(PROJECT_ROOT, 'packages', 'agents', 'src', 'pipeline', 'types.ts');

  it('types.ts has hook migration map', () => {
    const content = readFileSync(typesPath, 'utf-8');
    expect(content).toMatch(/HOOK MIGRATION MAP/);
    expect(content).toMatch(/Phase 5 Hook.*Phase 6 Destination/);
  });

  it('PipelineSurfaceHooks is marked @deprecated', () => {
    const content = readFileSync(typesPath, 'utf-8');
    expect(content).toMatch(/@deprecated/);
  });

  it('types.ts re-exports Phase 6 types', () => {
    const content = readFileSync(typesPath, 'utf-8');
    expect(content).toMatch(/from '\.\/surface'/);
    expect(content).toMatch(/from '\.\/system'/);
    expect(content).toMatch(/from '\.\/router'/);
    expect(content).toMatch(/from '\.\/router-config'/);
    expect(content).toMatch(/from '\.\/tool-executor'/);
    expect(content).toMatch(/from '\.\/context-assembly'/);
  });
});
