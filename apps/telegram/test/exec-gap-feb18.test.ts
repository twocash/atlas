/**
 * Execution Gap Fix — Regression Tests
 * Sprint: fix/capture-execution-gap (2026-02-18)
 *
 * Covers:
 * (a) content-callback Research dispatch — fires runResearchAgentWithNotifications
 * (b) notion-callback handleTrackInWQ default requestType = 'Process'
 * (c) notion-callback handleProcess Research — dispatches agent (not text menu)
 * (d) dispatch-callback routeToWorkQueue — no auto-execute, items stay Triaged
 * (e) source fingerprinting — runResearchAgentWithNotifications accepts source param
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';

// Helper: resolve a path relative to this test file (Windows-safe)
const rel = (...parts: string[]) => join(import.meta.dir, ...parts);

// ──────────────────────────────────────────────────────────────────────────────
// (b) handleTrackInWQ default requestType
// ──────────────────────────────────────────────────────────────────────────────
describe('handleTrackInWQ — requestType default', () => {
  it('defaults to Process, not Research', async () => {
    // Verify the constant in the module source directly.
    // This prevents silent regressions if someone changes the default back.
    const src = await Bun.file(
      rel('../src/handlers/notion-callback.ts')
    ).text();

    // Should have Process as the default for handleTrackInWQ
    const trackSection = src.match(/handleTrackInWQ[\s\S]{0,500}requestType:\s*'(\w+)'/);
    expect(trackSection).not.toBeNull();
    expect(trackSection![1]).toBe('Process');
  });

  it('does NOT have Research as the default for handleTrackInWQ', async () => {
    const src = await Bun.file(
      rel('../src/handlers/notion-callback.ts')
    ).text();

    // Find the handleTrackInWQ function body
    const funcStart = src.indexOf('async function handleTrackInWQ');
    const funcEnd = src.indexOf('\nasync function ', funcStart + 1);
    const funcBody = src.slice(funcStart, funcEnd > 0 ? funcEnd : funcStart + 1000);

    // The default requestType must NOT be 'Research'
    const match = funcBody.match(/requestType:\s*'(\w+)'/);
    expect(match).not.toBeNull();
    expect(match![1]).not.toBe('Research');
    expect(match![1]).toBe('Process');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// (e) source fingerprinting — function signature
// ──────────────────────────────────────────────────────────────────────────────
describe('runResearchAgentWithNotifications — source fingerprinting', () => {
  it('accepts source as 5th parameter with default "unknown"', async () => {
    const src = await Bun.file(
      rel('../src/services/research-executor.ts')
    ).text();

    // Signature must have source with default 'unknown'
    expect(src).toContain("source = 'unknown'");
  });

  it('sendCompletionNotification accepts source as 6th parameter', async () => {
    const src = await Bun.file(
      rel('../src/services/research-executor.ts')
    ).text();

    expect(src).toContain("source = 'unknown'");
    // sendCompletionNotification should have it too
    const fnStart = src.indexOf('export async function sendCompletionNotification');
    const fnSignature = src.slice(fnStart, fnStart + 500);
    expect(fnSignature).toContain("source = 'unknown'");
  });

  it('source is included in structured logger calls', async () => {
    const src = await Bun.file(
      rel('../src/services/research-executor.ts')
    ).text();

    // Logger calls should include source field
    expect(src).toMatch(/logger\.(info|error|warn)\(.*\{[\s\S]*?source[\s\S]*?\}/);
  });

  it('source is embedded in agent name for WQ spawn comment provenance', async () => {
    const src = await Bun.file(
      rel('../src/services/research-executor.ts')
    ).text();

    // Agent name should include source
    expect(src).toContain('`Research [${source}]:');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// (a) content-callback — Research dispatch wiring
// ──────────────────────────────────────────────────────────────────────────────
describe('content-callback — Research dispatch', () => {
  it('imports runResearchAgentWithNotifications from research-executor', async () => {
    const src = await Bun.file(
      rel('../src/handlers/content-callback.ts')
    ).text();

    expect(src).toContain("from '../services/research-executor'");
    expect(src).toContain('runResearchAgentWithNotifications');
    expect(src).toContain('sendCompletionNotification');
  });

  it('has idempotency guard _activeResearchItems Set', async () => {
    const src = await Bun.file(
      rel('../src/handlers/content-callback.ts')
    ).text();

    expect(src).toContain('_activeResearchItems');
    expect(src).toContain('new Set<string>()');
  });

  it('dispatches with source identifier content-confirm', async () => {
    const src = await Bun.file(
      rel('../src/handlers/content-callback.ts')
    ).text();

    expect(src).toContain("'content-confirm'");
  });

  it('guards on requestType === Research before dispatching', async () => {
    const src = await Bun.file(
      rel('../src/handlers/content-callback.ts')
    ).text();

    expect(src).toContain("pending.requestType === 'Research'");
  });

  it('triggerContextualExtraction still runs alongside (not replaced)', async () => {
    const src = await Bun.file(
      rel('../src/handlers/content-callback.ts')
    ).text();

    // Both must be present in handleConfirm
    expect(src).toContain('triggerContextualExtraction');
    expect(src).toContain('runResearchAgentWithNotifications');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// (c) notion-callback handleProcess Research dispatch
// ──────────────────────────────────────────────────────────────────────────────
describe('notion-callback — handleProcess Research dispatch', () => {
  it('imports research executor', async () => {
    const src = await Bun.file(
      rel('../src/handlers/notion-callback.ts')
    ).text();

    expect(src).toContain("from '../services/research-executor'");
  });

  it('dispatches with source identifier notion-process', async () => {
    const src = await Bun.file(
      rel('../src/handlers/notion-callback.ts')
    ).text();

    expect(src).toContain("'notion-process'");
  });

  it('does NOT contain old text menu for Research tasks in handleProcess', async () => {
    const src = await Bun.file(
      rel('../src/handlers/notion-callback.ts')
    ).text();

    // Old text menu is gone
    expect(src).not.toContain('Research the topic and summarize findings');
    expect(src).not.toContain('Find relevant sources');
    expect(src).not.toContain('What would you like me to focus on?');
  });

  it('sends a conversational start message instead of button menu', async () => {
    const src = await Bun.file(
      rel('../src/handlers/notion-callback.ts')
    ).text();

    expect(src).toContain('Starting research on');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// (d) dispatch-callback routeToWorkQueue — no auto-execute
// ──────────────────────────────────────────────────────────────────────────────
describe('dispatch-callback — routeToWorkQueue no auto-execute', () => {
  it('does NOT import runResearchAgentWithNotifications', async () => {
    const src = await Bun.file(
      rel('../src/handlers/dispatch-callback.ts')
    ).text();

    expect(src).not.toContain('runResearchAgentWithNotifications');
  });

  it('items are created with Captured or Triaged status, never Active', async () => {
    const src = await Bun.file(
      rel('../src/handlers/dispatch-callback.ts')
    ).text();

    // routeToWorkQueue sets initialStatus to Captured or Triaged based on requireReview
    expect(src).toContain("'Captured'");
    expect(src).toContain("'Triaged'");

    // The initial status must NOT be Active (that would mean auto-execute)
    const routeToWQSection = src.match(/function routeToWorkQueue[\s\S]*?^}/m);
    if (routeToWQSection) {
      // Active should not appear as an initial status value in this function
      const initStatusMatch = routeToWQSection[0].match(/initialStatus\s*=.*?'Active'/);
      expect(initStatusMatch).toBeNull();
    }
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Call site source identifiers — verify no site uses 'unknown' default
// ──────────────────────────────────────────────────────────────────────────────
describe('call sites — explicit source identifiers', () => {
  const callSites: Array<{ file: string; expectedSource: string }> = [
    { file: '../src/handlers/voice-callback.ts', expectedSource: 'voice-research' },
    { file: '../src/conversation/socratic-adapter.ts', expectedSource: 'socratic-resolved' },
    { file: '../src/handlers/content-callback.ts', expectedSource: 'content-confirm' },
    { file: '../src/handlers/notion-callback.ts', expectedSource: 'notion-process' },
  ];

  for (const { file, expectedSource } of callSites) {
    it(`${file.split('/').pop()} uses source '${expectedSource}'`, async () => {
      const src = await Bun.file(rel(file)).text();
      expect(src).toContain(`'${expectedSource}'`);
    });
  }

  it('agent-handler.ts uses source agent-command', async () => {
    const src = await Bun.file(
      rel('../src/agent-handler.ts')
    ).text();

    expect(src).toContain("'agent-command'");
  });
});
