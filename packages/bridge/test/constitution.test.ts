/**
 * Atlas Constitution Wiring — Structural Integrity Tests
 *
 * Verifies the constitution is wired into the Bridge identity pipeline:
 *   Notion (atlas.constitution) → composeBridgePrompt() →
 *   hydrateSystemPreamble() → Claude Code system context
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

// ─── Helpers ────────────────────────────────────────────────

async function readBridge(relativePath: string): Promise<string> {
  return Bun.file(resolve(bridgeRoot, relativePath)).text();
}

async function readAgents(relativePath: string): Promise<string> {
  return Bun.file(resolve(agentsRoot, relativePath)).text();
}

// ─── 1. Constitution Fetch — bridge.ts ──────────────────────

describe('constitution fetch in composeBridgePrompt()', () => {
  it('defines CONSTITUTION_ID as atlas.constitution', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain("const CONSTITUTION_ID = 'atlas.constitution'");
  });

  it('fetches constitution via PromptManager in parallel', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('pm.getPromptById(CONSTITUTION_ID)');
    // Must be inside Promise.all with the other fetches
    expect(src).toContain('Promise.all([');
  });

  it('hard-fails if constitution is missing (ADR-008)', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('if (!constitution)');
    expect(src).toContain('FATAL: atlas.constitution not found');
    expect(src).toContain('throw new Error');
  });

  it('constitution check comes BEFORE soul check', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    const constitutionCheck = src.indexOf('if (!constitution)');
    const soulCheck = src.indexOf('if (!soul)');
    expect(constitutionCheck).toBeGreaterThan(-1);
    expect(soulCheck).toBeGreaterThan(constitutionCheck);
  });

  it('places constitution FIRST in the assembled prompt', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    // Constitution section must appear before soul in the sections array
    const constitutionSection = src.indexOf('## Atlas Constitution');
    const soulSection = src.indexOf('soul}');
    expect(constitutionSection).toBeGreaterThan(-1);
    expect(soulSection).toBeGreaterThan(constitutionSection);
  });

  it('includes constitution in components tracking', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('constitution: true');
    // Must be in the components object alongside soul, user, memory, goals
    expect(src).toMatch(/components:\s*\{[^}]*constitution:\s*true/s);
  });

  it('includes constitution in AtlasIdentityResult type', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toMatch(/interface AtlasIdentityResult[\s\S]*?constitution:\s*boolean/);
  });

  it('token ceiling raised to 8000 for constitution + existing content', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('SLOT_0_TOKEN_CEILING = 8000');
  });
});

// ─── 2. Startup Logging — server.ts ─────────────────────────

describe('constitution in startup logging', () => {
  it('logs constitution status during identity hydration', async () => {
    const src = await readBridge('src/server.ts');
    expect(src).toContain('result.components.constitution');
    expect(src).toContain('constitution:');
  });

  it('stores identity components for /status endpoint', async () => {
    const src = await readBridge('src/server.ts');
    expect(src).toContain('identityComponents = result.components');
  });
});

// ─── 3. /status Endpoint — server.ts ────────────────────────

describe('constitution in /status endpoint', () => {
  it('includes identity field in /status response', async () => {
    const src = await readBridge('src/server.ts');
    // The /status handler must include identity info
    expect(src).toContain('identity:');
    expect(src).toContain('identityComponents');
  });

  it('identity includes constitution field', async () => {
    const src = await readBridge('src/server.ts');
    expect(src).toContain('constitution: identityComponents.constitution');
  });
});

// ─── 4. Chain Integrity ─────────────────────────────────────

describe('constitution chain integrity', () => {
  it('constitution fetched → assembled first → hydrated → available in prompt', async () => {
    // 1. bridge.ts fetches constitution
    const bridge = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(bridge).toContain('pm.getPromptById(CONSTITUTION_ID)');

    // 2. Constitution is first in sections array
    expect(bridge).toContain('## Atlas Constitution');

    // 3. server.ts calls composeAtlasIdentity and hydrates
    const server = await readBridge('src/server.ts');
    expect(server).toContain("composeAtlasIdentity('bridge')");
    expect(server).toContain('hydrateSystemPreamble(result.prompt)');

    // 4. prompt-constructor uses hydrated preamble (unchanged from before)
    const pc = await readBridge('src/context/prompt-constructor.ts');
    expect(pc).toContain('sections: string[] = [systemPreamble]');
  });

  it('resolves all identity documents in parallel (not sequential)', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    // All documents must be in the same Promise.all
    const promiseAllMatch = src.match(/Promise\.all\(\[([\s\S]*?)\]\)/);
    expect(promiseAllMatch).toBeTruthy();
    const promiseAllBody = promiseAllMatch![1];
    expect(promiseAllBody).toContain('CONSTITUTION_ID');
    expect(promiseAllBody).toContain('SOUL_ID');
    expect(promiseAllBody).toContain('USER_ID');
    expect(promiseAllBody).toContain('MEMORY_ID');
    expect(promiseAllBody).toContain('GOALS_ID');
    expect(promiseAllBody).toContain('JIDOKA_ID');
  });

  it('is exported from the prompt-composition index', async () => {
    const idx = await readAgents('src/services/prompt-composition/index.ts');
    expect(idx).toContain("composeAtlasIdentity");
    expect(idx).toContain("composeBridgePrompt");
    expect(idx).toContain("AtlasIdentityResult");
  });
});
