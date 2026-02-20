/**
 * Bridge Goal State Architecture — Structural Integrity Tests
 *
 * Verifies the GOALS.md wiring chain:
 *   Notion (bridge.goals) → composeBridgePrompt() → Slot 0 hydration →
 *   bridge_update_goals MCP tool → staleness detection → session startup
 *
 * Pattern: Source-code text inspection via Bun.file().text()
 * No mocking, no live API calls, no import-time side effects.
 */

import { describe, it, expect } from 'bun:test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const thisDir = dirname(fileURLToPath(import.meta.url));
const bridgeRoot = resolve(thisDir, '..');
const agentsRoot = resolve(thisDir, '../../agents');

// ─── Helper ────────────────────────────────────────────────

async function readSource(relativePath: string): Promise<string> {
  const fullPath = resolve(bridgeRoot, relativePath);
  return Bun.file(fullPath).text();
}

async function readAgents(relativePath: string): Promise<string> {
  const fullPath = resolve(agentsRoot, relativePath);
  return Bun.file(fullPath).text();
}

// ─── 1. composeBridgePrompt() — GOALS.md Hydration ─────────

describe('composeBridgePrompt() with GOALS', () => {
  it('declares bridge.goals prompt ID', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain("const BRIDGE_GOALS_ID = 'bridge.goals'");
  });

  it('resolves bridge.goals in parallel with soul/user/memory', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('pm.getPromptById(BRIDGE_GOALS_ID)');
    // Should be in the Promise.all block
    expect(src).toContain('Promise.all([');
    const promiseAllBlock = src.slice(
      src.indexOf('Promise.all(['),
      src.indexOf(']);', src.indexOf('Promise.all(['))
    );
    expect(promiseAllBlock).toContain('BRIDGE_GOALS_ID');
  });

  it('treats goals as optional with ADR-008 degraded mode', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('GOALS unavailable');
    expect(src).toContain('operating without project awareness');
    // Must NOT throw on missing goals
    expect(src).not.toMatch(/if\s*\(\s*!goals\s*\)\s*\{?\s*throw/);
  });

  it('includes goals in the components tracking', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('goals: !!goals');
    // Interface must include goals field
    expect(src).toContain('goals: boolean');
  });

  it('assembles goals under "Active Goals & Projects" header', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('## Active Goals & Projects');
  });

  it('raises token ceiling to 6000 for SOUL+USER+MEMORY+GOALS', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('SLOT_0_TOKEN_CEILING = 6000');
  });

  it('warns about pruning GOALS when token budget exceeded', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('MEMORY or GOALS entries');
  });
});

// ─── 2. bridge_update_goals — MCP Tool ─────────────────────

describe('bridge_update_goals MCP tool', () => {
  it('has tool schema definition', async () => {
    const src = await readSource('src/tools/bridge-goals.ts');
    expect(src).toContain("name: 'bridge_update_goals'");
    expect(src).toContain('BRIDGE_GOALS_TOOL_SCHEMA');
  });

  it('supports all four operations', async () => {
    const src = await readSource('src/tools/bridge-goals.ts');
    expect(src).toContain("'add_project'");
    expect(src).toContain("'update_project'");
    expect(src).toContain("'archive_project'");
    expect(src).toContain("'update_phase'");
  });

  it('requires operation, pillar, and project parameters', async () => {
    const src = await readSource('src/tools/bridge-goals.ts');
    expect(src).toContain("required: ['operation', 'pillar', 'project']");
  });

  it('supports all four pillars', async () => {
    const src = await readSource('src/tools/bridge-goals.ts');
    expect(src).toContain("'the-grove'");
    expect(src).toContain("'consulting'");
    expect(src).toContain("'personal'");
    expect(src).toContain("'home-garage'");
  });

  it('resolves GOALS page from System Prompts DB', async () => {
    const src = await readSource('src/tools/bridge-goals.ts');
    expect(src).toContain("rich_text: { equals: 'bridge.goals' }");
    expect(src).toContain('resolveGoalsPageId');
  });

  it('writes to Notion via blocks.children.append', async () => {
    const src = await readSource('src/tools/bridge-goals.ts');
    expect(src).toContain('blocks.children.append');
  });

  it('includes timestamps on all operations', async () => {
    const src = await readSource('src/tools/bridge-goals.ts');
    expect(src).toContain("new Date().toISOString().split('T')[0]");
    expect(src).toContain('timestamp');
  });

  it('is registered in schemas.ts', async () => {
    const src = await readSource('src/tools/schemas.ts');
    expect(src).toContain("import { BRIDGE_GOALS_TOOL_SCHEMA }");
    expect(src).toContain('BRIDGE_GOALS_TOOL_SCHEMA as ToolSchema');
  });

  it('is in LOCAL_TOOL_NAMES set (not dispatched to browser)', async () => {
    const src = await readSource('src/tools/schemas.ts');
    expect(src).toContain('BRIDGE_GOALS_TOOL_SCHEMA.name');
  });

  it('is handled locally in MCP server', async () => {
    const src = await readSource('src/tools/mcp-server.ts');
    expect(src).toContain("import { handleBridgeGoalsTool }");
    expect(src).toContain('"bridge_update_goals"');
  });

  it('has fire-and-forget semantics with error handling', async () => {
    const src = await readSource('src/tools/bridge-goals.ts');
    expect(src).toContain('success: true');
    expect(src).toContain('success: false');
    expect(src).toContain("NOTION_API_KEY not set");
  });

  it('documents that Jim must confirm before write', async () => {
    const src = await readSource('src/tools/bridge-goals.ts');
    expect(src).toContain("Jim's conversational confirmation");
  });
});

// ─── 3. Staleness Detection ────────────────────────────────

describe('staleness detection', () => {
  it('has detector module at staleness/detector.ts', async () => {
    const src = await readSource('src/staleness/detector.ts');
    expect(src).toContain('detectStaleness');
  });

  it('defines 14-day nudge threshold', async () => {
    const src = await readSource('src/staleness/detector.ts');
    expect(src).toContain('NUDGE_THRESHOLD_DAYS = 14');
  });

  it('defines 30-day archive threshold', async () => {
    const src = await readSource('src/staleness/detector.ts');
    expect(src).toContain('ARCHIVE_THRESHOLD_DAYS = 30');
  });

  it('parses GOALS.md project structure', async () => {
    const src = await readSource('src/staleness/detector.ts');
    expect(src).toContain('parseGoalsProjects');
    expect(src).toContain('project: string; pillar: string');
  });

  it('queries Feed 2.0 for activity signals', async () => {
    const src = await readSource('src/staleness/detector.ts');
    expect(src).toContain('90b2b33f-4b44-4b42-870f-8d62fb8cbf18');
    expect(src).toContain('getLastPillarActivity');
  });

  it('generates natural language nudge text', async () => {
    const src = await readSource('src/staleness/detector.ts');
    expect(src).toContain('generateNudge');
    expect(src).toContain('Still active?');
    expect(src).toContain('Want to archive it');
  });

  it('returns a StalenessReport with stale projects', async () => {
    const src = await readSource('src/staleness/detector.ts');
    expect(src).toContain('StalenessReport');
    expect(src).toContain('staleProjects');
    expect(src).toContain('hasStaleProjects');
    expect(src).toContain('totalChecked');
  });

  it('has two severity levels: check_in and consider_archive', async () => {
    const src = await readSource('src/staleness/detector.ts');
    expect(src).toContain("'check_in'");
    expect(src).toContain("'consider_archive'");
  });

  it('stops parsing at Archived Projects section', async () => {
    const src = await readSource('src/staleness/detector.ts');
    expect(src).toContain('## Archived');
  });

  it('is exported from staleness/index.ts', async () => {
    const idx = await readSource('src/staleness/index.ts');
    expect(idx).toContain('detectStaleness');
    expect(idx).toContain('parseGoalsProjects');
    expect(idx).toContain('StalenessReport');
  });
});

// ─── 4. Session Startup Integration ────────────────────────

describe('session startup staleness wiring', () => {
  it('server.ts imports detectStaleness', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain("import { detectStaleness }");
  });

  it('runs staleness check after identity hydration', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain('detectStaleness');
    expect(src).toContain('result.components.goals');
  });

  it('logs stale project nudges to console', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain('stale project(s) detected');
    expect(src).toContain('sp.nudgeText');
  });

  it('staleness failure does not block startup', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain('Staleness check failed (non-blocking)');
  });

  it('logs goals component status alongside soul/user/memory', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain('result.components.goals');
    expect(src).toContain('goals:');
  });
});

// ─── 5. parseGoalsProjects — Unit Tests ────────────────────

describe('parseGoalsProjects()', () => {
  // These are true unit tests since parseGoalsProjects is a pure function
  let parseGoalsProjects: (content: string) => Array<{ project: string; pillar: string }>;

  // Dynamic import to avoid side effects
  it('can be imported', async () => {
    const mod = await import('../src/staleness/detector');
    parseGoalsProjects = mod.parseGoalsProjects;
    expect(typeof parseGoalsProjects).toBe('function');
  });

  it('parses projects from structured GOALS.md', async () => {
    const mod = await import('../src/staleness/detector');
    const result = mod.parseGoalsProjects(
      '## The Grove\n\n### Atlas Development\n- Phase: Active\n\n### Grove Foundation\n- Phase: Planning\n\n## Consulting\n\n### DrumWave\n- Phase: Active'
    );
    expect(result).toHaveLength(3);
    expect(result[0]).toEqual({ project: 'Atlas Development', pillar: 'The Grove' });
    expect(result[1]).toEqual({ project: 'Grove Foundation', pillar: 'The Grove' });
    expect(result[2]).toEqual({ project: 'DrumWave', pillar: 'Consulting' });
  });

  it('stops at Archived Projects section', async () => {
    const mod = await import('../src/staleness/detector');
    const result = mod.parseGoalsProjects(
      '## The Grove\n\n### Active Project\n\n## Archived Projects\n\n### Old Project'
    );
    expect(result).toHaveLength(1);
    expect(result[0].project).toBe('Active Project');
  });

  it('handles all four pillars', async () => {
    const mod = await import('../src/staleness/detector');
    const result = mod.parseGoalsProjects(
      '## The Grove\n### A\n## Consulting\n### B\n## Personal\n### C\n## Home/Garage\n### D'
    );
    expect(result).toHaveLength(4);
    expect(result.map(p => p.pillar)).toEqual(['The Grove', 'Consulting', 'Personal', 'Home/Garage']);
  });

  it('ignores non-pillar H2 headers', async () => {
    const mod = await import('../src/staleness/detector');
    const result = mod.parseGoalsProjects(
      '## Active Goals & Projects\n\n## The Grove\n### Real Project'
    );
    expect(result).toHaveLength(1);
    expect(result[0].project).toBe('Real Project');
  });

  it('returns empty for empty content', async () => {
    const mod = await import('../src/staleness/detector');
    expect(mod.parseGoalsProjects('')).toHaveLength(0);
  });
});

// ─── 6. Chain Test: Goals Hydration End-to-End ─────────────

describe('goals chain integrity', () => {
  it('composeBridgePrompt → hydrate → staleness → startup', async () => {
    // Verify the complete chain exists in source:
    // 1. bridge.ts resolves bridge.goals via PromptManager
    const bridge = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(bridge).toContain('BRIDGE_GOALS_ID');
    expect(bridge).toContain('pm.getPromptById(BRIDGE_GOALS_ID)');

    // 2. server.ts calls composeBridgePrompt and checks goals component
    const server = await readSource('src/server.ts');
    expect(server).toContain('composeBridgePrompt()');
    expect(server).toContain('result.components.goals');

    // 3. Staleness runs after hydration
    expect(server).toContain('detectStaleness');

    // 4. Tool for updates exists
    const tool = await readSource('src/tools/bridge-goals.ts');
    expect(tool).toContain('bridge_update_goals');
  });

  it('bridge_update_goals follows bridge_update_memory pattern', async () => {
    const memory = await readSource('src/tools/bridge-memory.ts');
    const goals = await readSource('src/tools/bridge-goals.ts');

    // Both use the same Notion write pattern
    expect(memory).toContain('blocks.children.append');
    expect(goals).toContain('blocks.children.append');

    // Both resolve page ID from System Prompts DB
    expect(memory).toContain('resolveMemoryPageId');
    expect(goals).toContain('resolveGoalsPageId');

    // Both handle missing NOTION_API_KEY
    expect(memory).toContain('NOTION_API_KEY not set');
    expect(goals).toContain('NOTION_API_KEY not set');
  });

  it('no goals content is hardcoded in TypeScript (ADR-001)', async () => {
    const bridge = await readAgents('src/services/prompt-composition/bridge.ts');
    // No project names should be hardcoded
    expect(bridge).not.toContain('Atlas Development');
    expect(bridge).not.toContain('DrumWave');
    expect(bridge).not.toContain('Garage Renovation');
  });
});
