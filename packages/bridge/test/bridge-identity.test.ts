/**
 * Bridge Identity Architecture — Structural Integrity Tests
 *
 * Verifies the full identity wiring chain:
 *   Notion (bridge.soul, bridge.memory) → composeBridgePrompt() →
 *   hydrateSystemPreamble() → server.ts startup → prompt-constructor.ts →
 *   MCP tool registration (bridge_update_memory) → Feed 2.0 logging
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

// ─── 1. composeBridgePrompt() — Identity Resolution ─────────

describe('composeBridgePrompt()', () => {
  it('resolves bridge.soul as required (hard-fail)', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain("const BRIDGE_SOUL_ID = 'bridge.soul'");
    expect(src).toContain('if (!soul)');
    expect(src).toContain('throw new Error');
    expect(src).toContain('FATAL: bridge.soul not found');
  });

  it('resolves bridge.memory as optional (soft-degrade with warning)', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain("const BRIDGE_MEMORY_ID = 'bridge.memory'");
    expect(src).toContain('MEMORY unavailable');
    // Must NOT throw on missing memory
    expect(src).not.toMatch(/if\s*\(\s*!memory\s*\)\s*\{?\s*throw/);
  });

  it('resolves system.general as optional (soft-degrade with warning)', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain("const USER_ID = 'system.general'");
    expect(src).toContain('USER context unavailable');
    expect(src).not.toMatch(/if\s*\(\s*!user\s*\)\s*\{?\s*throw/);
  });

  it('uses PromptManager (not direct Notion API)', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain("import { getPromptManager }");
    expect(src).toContain('pm.getPromptById(BRIDGE_SOUL_ID)');
    // Should NOT have direct @notionhq/client import
    expect(src).not.toContain("from '@notionhq/client'");
  });

  it('resolves all four documents in parallel', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('Promise.all([');
    expect(src).toContain('pm.getPromptById(BRIDGE_SOUL_ID)');
    expect(src).toContain('pm.getPromptById(USER_ID)');
    expect(src).toContain('pm.getPromptById(BRIDGE_MEMORY_ID)');
    expect(src).toContain('pm.getPromptById(BRIDGE_GOALS_ID)');
  });

  it('enforces Slot 0 token ceiling of 6000 (SOUL+USER+MEMORY+GOALS)', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('SLOT_0_TOKEN_CEILING = 6000');
    expect(src).toContain('tokenCount > SLOT_0_TOKEN_CEILING');
  });

  it('is exported from the prompt-composition index', async () => {
    const idx = await readAgents('src/services/prompt-composition/index.ts');
    expect(idx).toContain("export { composeBridgePrompt");
    expect(idx).toContain("type BridgePromptResult");
    expect(idx).toContain("from './bridge'");
  });

  it('includes canonical database IDs in assembled prompt', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('90b2b33f-4b44-4b42-870f-8d62fb8cbf18');
    expect(src).toContain('3d679030-b76b-43bd-92d8-1ac51abb4a28');
    expect(src).toContain('2fc780a78eef8196b29bdb4a6adfdc27');
  });
});

// ─── 2. prompt-constructor.ts — Hydration Pattern ──────────

describe('prompt-constructor hydration', () => {
  it('has no hardcoded SYSTEM_PREAMBLE constant', async () => {
    const src = await readSource('src/context/prompt-constructor.ts');
    // The old hardcoded constant should be gone
    expect(src).not.toContain("const SYSTEM_PREAMBLE = `You are Atlas");
    expect(src).not.toContain('const SYSTEM_PREAMBLE =');
  });

  it('exports hydrateSystemPreamble()', async () => {
    const src = await readSource('src/context/prompt-constructor.ts');
    expect(src).toContain('export function hydrateSystemPreamble(preamble: string)');
  });

  it('exports isPreambleHydrated()', async () => {
    const src = await readSource('src/context/prompt-constructor.ts');
    expect(src).toContain('export function isPreambleHydrated()');
  });

  it('throws if constructPrompt called before hydration (ADR-008)', async () => {
    const src = await readSource('src/context/prompt-constructor.ts');
    expect(src).toContain('if (!systemPreamble)');
    expect(src).toContain('throw new Error');
    expect(src).toContain('System preamble not hydrated');
  });

  it('uses hydrated preamble in constructPrompt()', async () => {
    const src = await readSource('src/context/prompt-constructor.ts');
    expect(src).toContain('const sections: string[] = [systemPreamble]');
  });
});

// ─── 3. server.ts — Startup Hydration + CWD ────────────────

describe('server.ts identity wiring', () => {
  it('imports composeBridgePrompt', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain("import { composeBridgePrompt }");
  });

  it('imports hydrateSystemPreamble', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain("import { hydrateSystemPreamble }");
  });

  it('calls composeBridgePrompt() at startup', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain('composeBridgePrompt()');
    expect(src).toContain('hydrateSystemPreamble(result.prompt)');
  });

  it('exits with code 1 on identity hydration failure (ADR-008)', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain('process.exit(1)');
    expect(src).toContain('FATAL: Bridge identity hydration failed');
  });

  it('hydrates identity BEFORE spawning Claude', async () => {
    const src = await readSource('src/server.ts');
    // The hydration must happen before spawnClaude
    const hydrationIdx = src.indexOf('hydrateBridgeIdentity()');
    const spawnIdx = src.indexOf('spawnClaude()', hydrationIdx);
    expect(hydrationIdx).toBeGreaterThan(-1);
    expect(spawnIdx).toBeGreaterThan(hydrationIdx);
  });

  it('supports configurable CWD via BRIDGE_CWD env var', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain("BRIDGE_CWD = process.env.BRIDGE_CWD");
    expect(src).toContain('cwd: BRIDGE_CWD || repoRoot');
  });

  it('logs component status on successful hydration', async () => {
    const src = await readSource('src/server.ts');
    expect(src).toContain('Bridge identity hydrated');
    expect(src).toContain('result.components.soul');
    expect(src).toContain('result.components.user');
    expect(src).toContain('result.components.memory');
    expect(src).toContain('result.components.goals');
  });
});

// ─── 4. bridge_update_memory — MCP Tool Registration ──────

describe('bridge_update_memory MCP tool', () => {
  it('has tool schema definition', async () => {
    const src = await readSource('src/tools/bridge-memory.ts');
    expect(src).toContain("name: 'bridge_update_memory'");
    expect(src).toContain("BRIDGE_MEMORY_TOOL_SCHEMA");
  });

  it('accepts type, content, and context parameters', async () => {
    const src = await readSource('src/tools/bridge-memory.ts');
    expect(src).toContain("enum: ['correction', 'learning', 'pattern']");
    expect(src).toContain("required: ['type', 'content', 'context']");
  });

  it('resolves MEMORY page from System Prompts DB', async () => {
    const src = await readSource('src/tools/bridge-memory.ts');
    expect(src).toContain("rich_text: { equals: 'bridge.memory' }");
    expect(src).toContain('resolveMemoryPageId');
  });

  it('writes as bulleted list item to Notion page', async () => {
    const src = await readSource('src/tools/bridge-memory.ts');
    expect(src).toContain("type: 'bulleted_list_item'");
    expect(src).toContain('blocks.children.append');
  });

  it('is registered in schemas.ts', async () => {
    const src = await readSource('src/tools/schemas.ts');
    expect(src).toContain("import { BRIDGE_MEMORY_TOOL_SCHEMA }");
    expect(src).toContain('BRIDGE_MEMORY_TOOL_SCHEMA as ToolSchema');
  });

  it('is in LOCAL_TOOL_NAMES set (not dispatched to browser)', async () => {
    const src = await readSource('src/tools/schemas.ts');
    expect(src).toContain('LOCAL_TOOL_NAMES');
    expect(src).toContain('BRIDGE_MEMORY_TOOL_SCHEMA.name');
  });

  it('is handled locally in MCP server', async () => {
    const src = await readSource('src/tools/mcp-server.ts');
    expect(src).toContain("import { handleBridgeMemoryTool }");
    expect(src).toContain('LOCAL_TOOL_NAMES.has(name)');
    expect(src).toContain("name === \"bridge_update_memory\"");
  });

  it('has fire-and-forget semantics with error handling', async () => {
    const src = await readSource('src/tools/bridge-memory.ts');
    expect(src).toContain('success: true');
    expect(src).toContain('success: false');
    expect(src).toContain("NOTION_API_KEY not set");
  });
});

// ─── 5. Slot 5 Stub — Diagnostic Telemetry ─────────────────

describe('Slot 5 stub', () => {
  it('returns unavailable status', async () => {
    const src = await readSource('src/slots/slot-5-stub.ts');
    expect(src).toContain("status: 'unavailable'");
  });

  it('includes a degraded note explaining why', async () => {
    const src = await readSource('src/slots/slot-5-stub.ts');
    expect(src).toContain('degradedNote');
    expect(src).toContain('DevTools Panel not yet wired');
  });

  it('exports getSlot5() function', async () => {
    const src = await readSource('src/slots/slot-5-stub.ts');
    expect(src).toContain('export function getSlot5()');
  });
});

// ─── 6. Feed 2.0 Logging ───────────────────────────────────

describe('Feed 2.0 logging', () => {
  it('logs bridge sessions to Feed 2.0', async () => {
    const src = await readSource('src/feed-logger.ts');
    expect(src).toContain('export async function logBridgeSession');
    expect(src).toContain("select: { name: 'Bridge' }");
    expect(src).toContain("select: { name: 'Logged' }");
  });

  it('logs memory writes to Feed 2.0', async () => {
    const src = await readSource('src/feed-logger.ts');
    expect(src).toContain('export async function logMemoryWrite');
    expect(src).toContain("name: 'bridge-memory-write'");
  });

  it('uses canonical Feed 2.0 database ID', async () => {
    const src = await readSource('src/feed-logger.ts');
    expect(src).toContain('90b2b33f-4b44-4b42-870f-8d62fb8cbf18');
  });

  it('includes structured metadata in session logs', async () => {
    const src = await readSource('src/feed-logger.ts');
    expect(src).toContain('sessionDurationMs');
    expect(src).toContain('interactionCount');
    expect(src).toContain('memoryWritesCount');
    expect(src).toContain('correctionsCount');
  });

  it('handles errors gracefully (returns null, does not throw)', async () => {
    const src = await readSource('src/feed-logger.ts');
    expect(src).toContain('return null');
    expect(src).toContain('[feed-logger] Failed to log');
  });
});

// ─── 7. BRIDGE-CLAUDE.md — Process-Level Identity ──────────

describe('BRIDGE-CLAUDE.md', () => {
  it('exists at atlas-bridge/CLAUDE.md', async () => {
    const repoRoot = resolve(bridgeRoot, '../..');
    const content = await Bun.file(resolve(repoRoot, 'atlas-bridge/CLAUDE.md')).text();
    expect(content.length).toBeGreaterThan(100);
  });

  it('identifies as Bridge Claude (not generic Atlas)', async () => {
    const repoRoot = resolve(bridgeRoot, '../..');
    const content = await Bun.file(resolve(repoRoot, 'atlas-bridge/CLAUDE.md')).text();
    expect(content).toContain('Bridge Claude');
    expect(content).toContain('desktop co-pilot');
  });

  it('references bridge.soul and bridge.memory', async () => {
    const repoRoot = resolve(bridgeRoot, '../..');
    const content = await Bun.file(resolve(repoRoot, 'atlas-bridge/CLAUDE.md')).text();
    expect(content).toContain('bridge.soul');
    expect(content).toContain('bridge.memory');
  });

  it('lists all MCP tools including bridge_update_memory', async () => {
    const repoRoot = resolve(bridgeRoot, '../..');
    const content = await Bun.file(resolve(repoRoot, 'atlas-bridge/CLAUDE.md')).text();
    expect(content).toContain('bridge_update_memory');
    expect(content).toContain('atlas_read_current_page');
    expect(content).toContain('atlas_get_linkedin_context');
  });

  it('references all four pillars', async () => {
    const repoRoot = resolve(bridgeRoot, '../..');
    const content = await Bun.file(resolve(repoRoot, 'atlas-bridge/CLAUDE.md')).text();
    expect(content).toContain('Personal');
    expect(content).toContain('The Grove');
    expect(content).toContain('Consulting');
    expect(content).toContain('Home/Garage');
  });
});

// ─── 8. Chain Test: Hydration → Preamble → Prompt ──────────

describe('identity chain integrity', () => {
  it('server.ts → composeBridgePrompt → hydrateSystemPreamble → constructPrompt', async () => {
    // Verify the complete chain exists in source:
    // 1. server.ts imports composeBridgePrompt
    const server = await readSource('src/server.ts');
    expect(server).toContain("composeBridgePrompt");
    expect(server).toContain("hydrateSystemPreamble");

    // 2. composeBridgePrompt resolves from PromptManager
    const bridge = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(bridge).toContain("getPromptManager");

    // 3. hydrateSystemPreamble sets the preamble
    const pc = await readSource('src/context/prompt-constructor.ts');
    expect(pc).toContain("systemPreamble = preamble");

    // 4. constructPrompt uses the hydrated preamble
    expect(pc).toContain("sections: string[] = [systemPreamble]");
  });

  it('no hardcoded identity strings remain in prompt-constructor', async () => {
    const src = await readSource('src/context/prompt-constructor.ts');
    expect(src).not.toContain("You are Atlas, Jim's AI Chief of Staff");
    expect(src).not.toContain("const SYSTEM_PREAMBLE");
  });

  it('MCP server routes local tools before browser dispatch', async () => {
    const src = await readSource('src/tools/mcp-server.ts');
    // LOCAL_TOOL_NAMES check must come before dispatchTool call
    const localIdx = src.indexOf('LOCAL_TOOL_NAMES.has(name)');
    const dispatchIdx = src.indexOf('dispatchTool(name', localIdx);
    expect(localIdx).toBeGreaterThan(-1);
    expect(dispatchIdx).toBeGreaterThan(localIdx);
  });
});
