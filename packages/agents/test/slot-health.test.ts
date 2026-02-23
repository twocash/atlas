/**
 * Slot Health Tests
 *
 * Validates that context slots inject correctly and failures surface explicitly.
 * Silent slot failures are the hidden cause of "correct but useless" output.
 *
 * Run: bun test packages/agents/test/slot-health.test.ts
 *
 * @see ADR-008: Fail Fast, Fail Loud
 * @see 6-Slot Context Architecture in Architecture Manifesto
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import type { DomainType, AudienceType } from '../src/assessment/types';

// Import slot assembler - adjust path based on actual location
// import { assembleContextSlots } from '../src/context/slot-assembler';

// Mock slot assembler for now - replace with real import when wired
interface SlotResult {
  status: 'success' | 'empty' | 'timeout' | 'error';
  content?: string;
  degradedNote?: string;
  workspace?: string;
  chunks?: Array<{ text: string; source: string }>;
}

interface ContextSlots {
  identity: SlotResult;      // Slot 0: SOUL/BRIDGE-SOUL + USER + MEMORY
  voice: SlotResult;         // Slot 1: jim-voice-writing-style, Reply Strategy
  domainRag: SlotResult;     // Slot 2: AnythingLLM workspace content
  pov: SlotResult;           // Slot 3: POV Library positions
  browser: SlotResult;       // Slot 4: Page content, DOM, LinkedIn context
  diagnostics: SlotResult;   // Slot 5: DevTools Panel, selector health
}

// Placeholder - replace with actual implementation
async function assembleContextSlots(params: {
  domain: DomainType;
  audience: AudienceType;
  message: string;
  _testForceRagTimeout?: boolean;
  _testForcePovEmpty?: boolean;
}): Promise<ContextSlots> {
  // TODO: Wire to real slot assembler
  // This mock demonstrates the test structure

  const baseSlots: ContextSlots = {
    identity: { status: 'success', content: 'SOUL.md content...' },
    voice: { status: 'success', content: 'jim-voice style...' },
    domainRag: { status: 'success', workspace: 'grove-technical', chunks: [] },
    pov: { status: 'success', content: 'POV positions...' },
    browser: { status: 'empty', degradedNote: 'No browser context in Telegram' },
    diagnostics: { status: 'empty' },
  };

  // Test hooks for forcing failures
  if (params._testForceRagTimeout) {
    baseSlots.domainRag = {
      status: 'timeout',
      degradedNote: 'AnythingLLM RAG unavailable - workspace query timed out after 10s'
    };
  }

  if (params._testForcePovEmpty) {
    baseSlots.pov = {
      status: 'empty',
      degradedNote: 'POV Library returned no matching positions for query'
    };
  }

  // Domain → workspace mapping
  const workspaceMap: Record<DomainType, string> = {
    personal: 'personal',
    consulting: 'consulting',
    grove: 'grove-technical',
    drumwave: 'drumwave',
  };

  if (baseSlots.domainRag.status === 'success') {
    baseSlots.domainRag.workspace = workspaceMap[params.domain];
  }

  return baseSlots;
}

describe('Slot Health', () => {

  describe('Domain → RAG Workspace Mapping', () => {
    const cases: Array<{ domain: DomainType; expectedWorkspace: string }> = [
      { domain: 'personal', expectedWorkspace: 'personal' },
      { domain: 'consulting', expectedWorkspace: 'consulting' },
      { domain: 'grove', expectedWorkspace: 'grove-technical' },
      { domain: 'drumwave', expectedWorkspace: 'drumwave' },
    ];

    for (const { domain, expectedWorkspace } of cases) {
      it(`${domain} → ${expectedWorkspace}`, async () => {
        const slots = await assembleContextSlots({
          domain,
          audience: 'self',
          message: 'test query',
        });

        expect(slots.domainRag.status).toBe('success');
        expect(slots.domainRag.workspace).toBe(expectedWorkspace);
      });
    }
  });

  describe('Audience → Voice Slot', () => {
    it('self audience → casual voice', async () => {
      const slots = await assembleContextSlots({
        domain: 'grove',
        audience: 'self',
        message: 'internal question',
      });

      expect(slots.voice.status).toBe('success');
      // Voice content should reflect casual intensity
    });

    it('client audience → professional voice', async () => {
      const slots = await assembleContextSlots({
        domain: 'consulting',
        audience: 'client',
        message: 'client deliverable',
      });

      expect(slots.voice.status).toBe('success');
      // Voice content should reflect professional intensity
    });

    it('public audience → broadcast voice', async () => {
      const slots = await assembleContextSlots({
        domain: 'grove',
        audience: 'public',
        message: 'LinkedIn post',
      });

      expect(slots.voice.status).toBe('success');
      // Voice content should reflect broadcast intensity
    });
  });

  describe('Failure Surfacing (ADR-008)', () => {
    it('RAG timeout surfaces explicitly', async () => {
      const slots = await assembleContextSlots({
        domain: 'grove',
        audience: 'self',
        message: 'test',
        _testForceRagTimeout: true,
      });

      expect(slots.domainRag.status).toBe('timeout');
      expect(slots.domainRag.degradedNote).toBeTruthy();
      expect(slots.domainRag.degradedNote).toContain('unavailable');
    });

    it('empty POV surfaces explicitly', async () => {
      const slots = await assembleContextSlots({
        domain: 'grove',
        audience: 'client',
        message: 'test',
        _testForcePovEmpty: true,
      });

      expect(slots.pov.status).toBe('empty');
      expect(slots.pov.degradedNote).toBeTruthy();
    });

    it('degraded notes are injected into prompt context', async () => {
      const slots = await assembleContextSlots({
        domain: 'grove',
        audience: 'self',
        message: 'test',
        _testForceRagTimeout: true,
      });

      // Build degraded context note
      const degradedNotes = Object.entries(slots)
        .filter(([_, slot]) => slot.status !== 'success' && slot.degradedNote)
        .map(([name, slot]) => `${name}: ${slot.degradedNote}`);

      expect(degradedNotes.length).toBeGreaterThan(0);
      expect(degradedNotes.join('\n')).toContain('RAG unavailable');
    });
  });

  describe('Identity Slot (Slot 0)', () => {
    it('always populated', async () => {
      const slots = await assembleContextSlots({
        domain: 'personal',
        audience: 'self',
        message: 'hello',
      });

      expect(slots.identity.status).toBe('success');
      expect(slots.identity.content).toBeTruthy();
    });
  });

  describe('Browser Slot (Slot 4) - Surface Awareness', () => {
    it('empty in Telegram context', async () => {
      const slots = await assembleContextSlots({
        domain: 'grove',
        audience: 'self',
        message: 'test',
        // Telegram context - no browser
      });

      // Browser slot should be empty but not an error
      expect(slots.browser.status).toBe('empty');
    });

    // TODO: Add Bridge context test when wired
    // it('populated in Bridge context', async () => {
    //   const slots = await assembleContextSlots({
    //     domain: 'grove',
    //     audience: 'self',
    //     message: 'test',
    //     surface: 'bridge',
    //     browserContext: { url: '...', dom: '...' },
    //   });
    //   expect(slots.browser.status).toBe('success');
    // });
  });

  describe('Slot Status Summary', () => {
    it('reports overall health', async () => {
      const slots = await assembleContextSlots({
        domain: 'grove',
        audience: 'client',
        message: 'concentration risk analysis',
      });

      const slotStatuses = Object.entries(slots).map(([name, slot]) => ({
        name,
        status: slot.status,
        hasDegradedNote: !!slot.degradedNote,
      }));

      // Count healthy vs degraded
      const healthy = slotStatuses.filter(s => s.status === 'success').length;
      const degraded = slotStatuses.filter(s => s.status !== 'success' && s.status !== 'empty').length;

      console.log(`\n📊 Slot Health: ${healthy}/6 healthy, ${degraded} degraded`);

      // Core slots should be healthy for grove/client
      expect(slots.identity.status).toBe('success');
      expect(slots.voice.status).toBe('success');
      expect(slots.domainRag.status).toBe('success');
    });
  });

});

describe('Slot Health Regression Cases', () => {
  // Add specific regression cases here as they're discovered

  it('grove domain actually hits grove-technical workspace', async () => {
    const slots = await assembleContextSlots({
      domain: 'grove',
      audience: 'self',
      message: 'concentration risk',
    });

    expect(slots.domainRag.workspace).toBe('grove-technical');
    // NOT 'personal' or empty
  });

  it('client audience triggers POV injection', async () => {
    const slots = await assembleContextSlots({
      domain: 'grove',
      audience: 'client',
      message: 'client deliverable about infrastructure',
    });

    // POV should be populated for client-facing content
    // This ensures Jim's positions inform client output
    expect(slots.pov.status).toBe('success');
  });

});
