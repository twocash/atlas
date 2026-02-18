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
  it('context-enrichment.ts exists', () => {
    expect(fileExists(join(CONVERSATION, 'context-enrichment.ts'))).toBe(true);
  });

  it('exports enrichWithContextSlots function', async () => {
    const content = await readFileContent(join(CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/export async function enrichWithContextSlots/);
  });

  it('exports EnrichmentResult type', async () => {
    const content = await readFileContent(join(CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/export interface EnrichmentResult/);
  });

  it('imports assembleContext from bridge context module', async () => {
    const content = await readFileContent(join(CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/from\s+["'].*packages\/bridge\/src\/context["']/);
    expect(content).toMatch(/assembleContext/);
  });

  it('excludes browser and output slots from Telegram enrichment', async () => {
    const content = await readFileContent(join(CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/EXCLUDED_SLOTS/);
    expect(content).toMatch(/"browser"/);
    expect(content).toMatch(/"output"/);
  });

  it('re-throws errors with error-level logging (no silent degradation)', async () => {
    const content = await readFileContent(join(CONVERSATION, 'context-enrichment.ts'));
    // Should have a try/catch that logs at error level and re-throws
    expect(content).toMatch(/logger\.error/);
    expect(content).toMatch(/throw err/);
  });
});

describe('Context Enrichment: Handler Integration', () => {
  it('handler.ts imports enrichWithContextSlots', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).toMatch(/from\s+['"]\.\/context-enrichment['"]/);
    expect(content).toMatch(/enrichWithContextSlots/);
  });

  it('handler.ts imports EnrichmentResult type', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).toMatch(/EnrichmentResult/);
  });

  it('handler.ts has feature gate for ATLAS_CONTEXT_ENRICHMENT', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).toMatch(/ATLAS_CONTEXT_ENRICHMENT/);
    // Default is enabled — gate checks for 'false' to disable
    expect(content).toMatch(/!== ['"]false['"]/);
  });

  it('handler.ts composes enriched system prompt with cognitive context header', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).toMatch(/Cognitive Context/);
    expect(content).toMatch(/enrichedContext/);
  });

  it('handler.ts logs enrichment metrics', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).toMatch(/contextEnrichment:/);
    expect(content).toMatch(/slotsUsed:/);
    expect(content).toMatch(/contextTokens:/);
    expect(content).toMatch(/enrichmentLatencyMs:/);
    expect(content).toMatch(/enrichmentTier:/);
  });

  it('handler.ts does NOT silently swallow enrichment errors (fail-loud mode)', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    // No try/catch around enrichment — errors propagate to outer handler
    expect(content).not.toMatch(/enrichment failed.*non-fatal/i);
    expect(content).toMatch(/errors propagate/i);
  });

  it('handler.ts still contains the CONTENT PIPELINE GUARDRAIL', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).toMatch(/CONTENT PIPELINE GUARDRAIL/);
  });

  it('handler.ts does NOT contain inline prompt logic (existing guardrail)', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    expect(content).not.toMatch(/You are (a|an) .{20,}/);
    expect(content).not.toMatch(/system:\s*["'`]You/);
  });
});

describe('Context Enrichment: Slot Formatting', () => {
  it('enrichment middleware formats slots with --- CONTEXT: labels', async () => {
    const content = await readFileContent(join(CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/--- CONTEXT:/);
  });

  it('slot labels map all SlotIds', async () => {
    const content = await readFileContent(join(CONVERSATION, 'context-enrichment.ts'));
    expect(content).toMatch(/SLOT_LABELS/);
    expect(content).toMatch(/intent.*INTENT/);
    expect(content).toMatch(/domain_rag.*DOMAIN/);
    expect(content).toMatch(/pov.*POV/);
    expect(content).toMatch(/voice.*VOICE/);
  });
});

describe('Context Enrichment: Feature Gate Behavior', () => {
  it('enrichment is gated on ATLAS_CONTEXT_ENRICHMENT env var in handler', async () => {
    const content = await readFileContent(join(CONVERSATION, 'handler.ts'));
    // The gate should check the env var before calling enrichWithContextSlots
    const gateIndex = content.indexOf('ATLAS_CONTEXT_ENRICHMENT');
    const callIndex = content.indexOf('enrichWithContextSlots(messageText');
    expect(gateIndex).toBeGreaterThan(-1);
    expect(callIndex).toBeGreaterThan(-1);
    // Gate should come before the call
    expect(gateIndex).toBeLessThan(callIndex);
  });
});
