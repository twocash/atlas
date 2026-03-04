/**
 * Operational Doctrine Composition — Structural + Behavioral Tests
 *
 * Verifies the Notion-governed operational doctrine pipeline:
 *   Notion (ops.core.*, ops.surface.*) → composeOperationalDoctrine() →
 *   buildSystemPrompt() → Claude system context
 *
 * Test categories:
 *   1. PromptCache — TTL behavior, invalidation, getOrFetch
 *   2. composeOperationalDoctrine — tiered failure, section assembly
 *   3. prompt.ts wiring — structural verification
 *   4. Regression — constitution chain unaffected
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const thisDir = dirname(fileURLToPath(import.meta.url));
const agentsRoot = resolve(thisDir, '..');

async function readAgents(relativePath: string): Promise<string> {
  return Bun.file(resolve(agentsRoot, relativePath)).text();
}

// ─── 1. PromptCache Unit Tests ──────────────────────────────────

describe('PromptCache', () => {
  // Import directly — PromptCache is a pure data structure, no side effects
  let PromptCache: typeof import('../src/services/prompt-composition/cache').PromptCache;

  beforeEach(async () => {
    // Fresh import to reset singleton
    const mod = await import('../src/services/prompt-composition/cache');
    PromptCache = mod.PromptCache;
    // Clear the singleton's cache
    PromptCache.getInstance().clear();
  });

  it('returns null for missing keys', () => {
    const cache = PromptCache.getInstance();
    expect(cache.get('nonexistent')).toBeNull();
  });

  it('stores and retrieves values', () => {
    const cache = PromptCache.getInstance();
    cache.set('test-key', { data: 'hello' });
    expect(cache.get('test-key')).toEqual({ data: 'hello' });
  });

  it('respects TTL expiration', async () => {
    const cache = PromptCache.getInstance();
    // Set with 1ms TTL — expires after a tick
    cache.set('expired-key', 'value', 1);
    await new Promise(r => setTimeout(r, 5));
    expect(cache.get('expired-key')).toBeNull();
  });

  it('getOrFetch uses cache on hit', async () => {
    const cache = PromptCache.getInstance();
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount++;
      return 'fetched-value';
    };

    // First call — fetches
    const v1 = await cache.getOrFetch('key', fetcher);
    expect(v1).toBe('fetched-value');
    expect(fetchCount).toBe(1);

    // Second call — cache hit, no fetch
    const v2 = await cache.getOrFetch('key', fetcher);
    expect(v2).toBe('fetched-value');
    expect(fetchCount).toBe(1); // Still 1
  });

  it('getOrFetch refetches after expiry', async () => {
    const cache = PromptCache.getInstance();
    let fetchCount = 0;
    const fetcher = async () => {
      fetchCount++;
      return `value-${fetchCount}`;
    };

    // Fetch with 1ms TTL
    await cache.getOrFetch('key', fetcher, 1);
    expect(fetchCount).toBe(1);

    // Wait for expiry
    await new Promise(r => setTimeout(r, 5));

    // Expired — should refetch
    const v2 = await cache.getOrFetch('key', fetcher, 1);
    expect(v2).toBe('value-2');
    expect(fetchCount).toBe(2);
  });

  it('invalidateKey removes specific key', () => {
    const cache = PromptCache.getInstance();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.invalidateKey('a');
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBe(2);
  });

  it('clear removes all keys', () => {
    const cache = PromptCache.getInstance();
    cache.set('a', 1);
    cache.set('b', 2);
    cache.clear();
    expect(cache.get('a')).toBeNull();
    expect(cache.get('b')).toBeNull();
  });

  it('is a singleton', () => {
    const a = PromptCache.getInstance();
    const b = PromptCache.getInstance();
    expect(a).toBe(b);
  });
});

// ─── 2. composeOperationalDoctrine — Structural Verification ────

describe('composeOperationalDoctrine structure', () => {
  it('imports PromptManager and promptCache', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain("import { PromptManager } from '../prompt-manager'");
    expect(src).toContain("import { promptCache } from './cache'");
  });

  it('defines CRITICAL_ENTRIES with integrity and dispatch', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain("'ops.core.integrity'");
    expect(src).toContain("'ops.core.dispatch'");
    expect(src).toContain('CRITICAL_ENTRIES');
  });

  it('defines BEHAVIORAL_ENTRIES with tools and format', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain("'ops.core.tools'");
    expect(src).toContain("'ops.core.format'");
    expect(src).toContain('BEHAVIORAL_ENTRIES');
  });

  it('fetches surface-specific entry using template', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain('`ops.surface.${surface}`');
  });

  it('uses getPromptById (not getPrompt) for ID-based lookup', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain('pm.getPromptById(id)');
    // Should NOT use getPrompt with PromptLookup object
    expect(src).not.toContain('pm.getPrompt(id)');
  });

  it('throws on critical entry failure (ADR-008 hard fail)', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain('CRITICAL SAFETY FAILURE');
    expect(src).toContain('throw error');
  });

  it('logs Jidoka warnings for non-critical failures', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain('[Jidoka Warning]');
    expect(src).toContain('degraded mode');
  });

  it('caches composed result via promptCache', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain("promptCache.get<OperationalDoctrineResult>(cacheKey)");
    expect(src).toContain('promptCache.set(cacheKey, result)');
  });

  it('returns OperationalDoctrineResult with content, warnings, resolved, missing', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain('export interface OperationalDoctrineResult');
    expect(src).toContain('content: string');
    expect(src).toContain('warnings: string[]');
    expect(src).toContain('resolved: string[]');
    expect(src).toContain('missing: string[]');
  });
});

// ─── 3. prompt.ts Wiring — Structural Verification ─────────────

describe('prompt.ts operational doctrine wiring', () => {
  it('imports composeOperationalDoctrine from prompt-composition', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    expect(src).toContain('composeOperationalDoctrine');
    expect(src).toContain("from '../services/prompt-composition'");
  });

  it('calls composeOperationalDoctrine with telegram surface', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    expect(src).toContain("composeOperationalDoctrine('telegram')");
  });

  it('logs doctrine warnings', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    expect(src).toContain('[ops-doctrine]');
    expect(src).toContain('doctrine.warnings');
  });

  it('logs resolved and missing entries', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    expect(src).toContain('doctrine.resolved');
    expect(src).toContain('doctrine.missing');
  });

  it('throws on critical doctrine failure (ADR-008)', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    expect(src).toContain('FATAL: Operational doctrine resolution failed');
    expect(src).toContain('throw err');
  });

  it('does NOT contain hardcoded operational doctrine', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    // These strings were in the old 430-line hardcoded block
    expect(src).not.toContain('TICKET CREATION PROTOCOL');
    expect(src).not.toContain('Available Tools (USE THESE)');
    expect(src).not.toContain('ANTI-HALLUCINATION PROTOCOL');
    expect(src).not.toContain('URL INTEGRITY RULE');
    expect(src).not.toContain('CAPABILITIES ATLAS DOES NOT HAVE');
    expect(src).not.toContain('Response Format (STRICT - Telegram HTML)');
  });

  it('still has identity resolution via composeAtlasIdentity', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    expect(src).toContain("composeAtlasIdentity('telegram')");
    expect(src).toContain('identityPrompt');
  });

  it('still has canonical databases section', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    expect(src).toContain('CANONICAL DATABASE LIST');
    expect(src).toContain('NOTION_DB');
  });

  it('still has runtime context (machine, platform)', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    expect(src).toContain('Machine: Atlas [Telegram]');
    expect(src).toContain('Platform: Telegram Mobile');
  });

  it('still has tool context section', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    expect(src).toContain('formatRecentToolContext');
  });

  it('prompt.ts is under 250 lines (was 646)', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    const lineCount = src.split('\n').length;
    expect(lineCount).toBeLessThan(250);
  });
});

// ─── 4. Export Wiring ───────────────────────────────────────────

describe('prompt-composition index exports', () => {
  it('exports composeOperationalDoctrine', async () => {
    const src = await readAgents('src/services/prompt-composition/index.ts');
    expect(src).toContain('composeOperationalDoctrine');
  });

  it('exports OperationalDoctrineResult type', async () => {
    const src = await readAgents('src/services/prompt-composition/index.ts');
    expect(src).toContain('OperationalDoctrineResult');
  });

  it('exports promptCache and PromptCache', async () => {
    const src = await readAgents('src/services/prompt-composition/index.ts');
    expect(src).toContain('promptCache');
    expect(src).toContain('PromptCache');
  });

  it('still exports identity composition (no regression)', async () => {
    const src = await readAgents('src/services/prompt-composition/index.ts');
    expect(src).toContain('composeAtlasIdentity');
    expect(src).toContain('composeBridgePrompt');
    expect(src).toContain('AtlasIdentityResult');
  });
});

// ─── 5. Tiered Failure Model Verification ───────────────────────

describe('tiered failure model', () => {
  it('integrity is fetched as critical (isCritical=true)', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain("fetchEntry('ops.core.integrity', true)");
  });

  it('dispatch is fetched as critical (isCritical=true)', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain("fetchEntry('ops.core.dispatch', true)");
  });

  it('tools is fetched as non-critical (isCritical=false)', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain("fetchEntry('ops.core.tools', false)");
  });

  it('format is fetched as non-critical (isCritical=false)', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain("fetchEntry('ops.core.format', false)");
  });

  it('surface entry is fetched as non-critical', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    // The backtick template fetch is non-critical
    expect(src).toMatch(/fetchEntry\(`ops\.surface\.\$\{surface\}`.*false\)/);
  });

  it('critical failure throws Error (not returns null)', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    // Inside fetchEntry, critical path throws (handle \r\n or \n)
    expect(src).toContain('throw new Error(');
    expect(src).toContain('`CRITICAL SAFETY FAILURE');
  });

  it('non-critical failure pushes to warnings array', async () => {
    const src = await readAgents('src/services/prompt-composition/operations.ts');
    expect(src).toContain('warnings.push(');
    expect(src).toContain('missing.push(id)');
  });
});

// ─── 6. Constitution Chain Regression ───────────────────────────

describe('constitution chain regression (no breakage)', () => {
  it('bridge.ts still defines CONSTITUTION_ID', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain("const CONSTITUTION_ID = 'atlas.constitution'");
  });

  it('bridge.ts still hard-fails if constitution missing', async () => {
    const src = await readAgents('src/services/prompt-composition/bridge.ts');
    expect(src).toContain('if (!constitution)');
    expect(src).toContain('FATAL: atlas.constitution not found');
  });

  it('composeAtlasIdentity is still exported', async () => {
    const src = await readAgents('src/services/prompt-composition/index.ts');
    expect(src).toContain('composeAtlasIdentity');
  });

  it('prompt.ts still calls composeAtlasIdentity before doctrine', async () => {
    const src = await readAgents('src/conversation/prompt.ts');
    const identityCall = src.indexOf("composeAtlasIdentity('telegram')");
    const doctrineCall = src.indexOf("composeOperationalDoctrine('telegram')");
    expect(identityCall).toBeGreaterThan(-1);
    expect(doctrineCall).toBeGreaterThan(identityCall);
  });
});
