/**
 * Context Enrichment Tests
 *
 * Validates the Telegram context enrichment middleware:
 * - enrichWithContextSlots calls assembleContext and formats slots
 * - Feature gate disables enrichment
 * - Graceful degradation on assembly failure
 * - Enrichment output structure
 *
 * Run with: bun test src/conversation/__tests__/context-enrichment.test.ts
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { join } from 'path';
import { file as bunFile } from 'bun';

const ROOT = process.cwd();
const SRC = join(ROOT, 'src');
const CONVERSATION = join(SRC, 'conversation');
// Phase 5: Cognitive logic moved to orchestrator in packages/agents
const AGENTS_CONVERSATION = join(ROOT, '..', '..', 'packages', 'agents', 'src', 'conversation');
const ORCHESTRATOR = join(ROOT, '..', '..', 'packages', 'agents', 'src', 'pipeline', 'orchestrator.ts');

function fileExists(filePath: string): boolean {
  try {
    return bunFile(filePath).size > 0;
  } catch {
    return false;
  }
}

async function readFileContent(filePath: string): Promise<string> {
  try {
    return await bunFile(filePath).text();
  } catch {
    return '';
  }
}

describe('Context Enrichment: Architecture', () => {
  // Phase 3+: context-enrichment.ts lives in packages/agents/src/conversation/
  it('context-enrichment.ts exists in packages/agents/', () => {
    expect(fileExists(join(AGENTS_CONVERSATION, 'context-enrichment.ts'))).toBe(true);
  });

  it('exports enrichWithContextSlots function', async () => {
    const content = await readFileContent(join(AGENTS_CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/export async function enrichWithContextSlots/);
  });

  it('exports EnrichmentResult type', async () => {
    const content = await readFileContent(join(AGENTS_CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/export interface EnrichmentResult/);
  });

  it('imports assembleContext from bridge context module', async () => {
    const content = await readFileContent(join(AGENTS_CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/assembleContext/);
  });

  it('excludes browser and output slots from Telegram enrichment', async () => {
    const content = await readFileContent(join(AGENTS_CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/EXCLUDED_SLOTS/);
    expect(content).toMatch(/"browser"/);
    expect(content).toMatch(/"output"/);
  });

  it('re-throws errors with error-level logging (no silent degradation)', async () => {
    const content = await readFileContent(join(AGENTS_CONVERSATION, 'context-enrichment.ts'));
    // Should have a try/catch that logs at error level and re-throws
    expect(content).toMatch(/logger\.error/);
    expect(content).toMatch(/throw err/);
  });
});

describe('Context Enrichment: Pipeline Integration (Phase 5)', () => {
  // Phase 5: Cognitive logic moved from handler.ts to orchestrator.ts
  it('orchestrator imports enrichWithContextSlots', async () => {
    const content = await readFileContent(ORCHESTRATOR);
    expect(content).toMatch(/enrichWithContextSlots/);
  });

  it('orchestrator imports EnrichmentResult type', async () => {
    const content = await readFileContent(ORCHESTRATOR);
    expect(content).toMatch(/EnrichmentResult/);
  });

  it('handler.ts passes ATLAS_CONTEXT_ENRICHMENT gate via PipelineConfig', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).toMatch(/ATLAS_CONTEXT_ENRICHMENT/);
    // Default is enabled — gate checks for 'false' to disable
    expect(content).toMatch(/!== ['"]false['"]/);
  });

  it('orchestrator composes enriched system prompt with cognitive context header', async () => {
    const content = await readFileContent(ORCHESTRATOR);
    expect(content).toMatch(/Cognitive Context/);
    expect(content).toMatch(/enrichedContext/);
  });

  it('orchestrator logs enrichment metrics', async () => {
    const content = await readFileContent(ORCHESTRATOR);
    expect(content).toMatch(/contextEnrichment:/);
    expect(content).toMatch(/slotsUsed:/);
    expect(content).toMatch(/contextTokens:/);
    expect(content).toMatch(/enrichmentLatencyMs:/);
    expect(content).toMatch(/enrichmentTier:/);
  });

  it('handler.ts is a thin adapter delegating to orchestrator', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).toMatch(/orchestrateMessage/);
    // No Anthropic client in handler
    expect(content).not.toMatch(/new Anthropic\(/);
  });

  it('handler.ts does NOT contain inline prompt logic', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).not.toMatch(/You are (a|an) .{20,}/);
    expect(content).not.toMatch(/system:\s*["'`]You/);
  });
});

describe('Context Enrichment: Slot Formatting', () => {
  it('enrichment middleware formats slots with --- CONTEXT: labels', async () => {
    const content = await readFileContent(join(AGENTS_CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/--- CONTEXT:/);
  });

  it('slot labels map all SlotIds', async () => {
    const content = await readFileContent(join(AGENTS_CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/SLOT_LABELS/);
    expect(content).toMatch(/intent.*INTENT/);
    expect(content).toMatch(/domain_rag.*DOMAIN/);
    expect(content).toMatch(/pov.*POV/);
    expect(content).toMatch(/voice.*VOICE/);
  });
});

describe('Context Enrichment: Feature Gate Behavior', () => {
  it('enrichment is gated on contextEnrichmentEnabled config in orchestrator', async () => {
    const content = await readFileContent(ORCHESTRATOR);
    // The gate should check config before calling enrichWithContextSlots
    const gateIndex = content.indexOf('config.contextEnrichmentEnabled');
    // Find the actual call site (not the import), look for the function call with arguments
    const callIndex = content.indexOf('enrichWithContextSlots(messageText');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(callIndex).toBeGreaterThan(-1);
    // Gate should come before the call
    expect(gateIndex).toBeLessThan(callIndex);
  });

  it('handler.ts resolves ATLAS_CONTEXT_ENRICHMENT env var into PipelineConfig', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).toMatch(/contextEnrichmentEnabled/);
    expect(content).toMatch(/ATLAS_CONTEXT_ENRICHMENT/);
  });
});
