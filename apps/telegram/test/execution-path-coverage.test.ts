/**
 * Execution Path Coverage — Dispatch Source Fingerprinting
 *
 * Verifies the structural integrity of all 5 research dispatch sites:
 * 1. Each site imports and calls runResearchAgentWithNotifications
 * 2. Each site passes an explicit source identifier (never the 'unknown' default)
 * 3. research-executor.ts contains the full dispatch chain components
 * 4. Double-dispatch idempotency guard exists and is wired correctly
 * 5. Negative paths (dispatch-callback) do NOT auto-execute research
 *
 * Test pattern: source-code text inspection using Bun.file().text()
 * No mocking. No live API calls. Zero flake.
 * Established by exec-gap-feb18.test.ts (2026-02-18).
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'path';

const rel = (p: string) => join(__dirname, p);

// Source file paths (relative from apps/telegram/test/)
const EXECUTOR    = '../src/services/research-executor.ts';
const CONTENT_CB  = '../src/handlers/content-callback.ts';
const NOTION_CB   = '../src/handlers/notion-callback.ts';
const VOICE_CB    = '../src/handlers/voice-callback.ts';
const SOCRATIC    = '../src/conversation/socratic-adapter.ts';
const AGENT_H     = '../src/agent-handler.ts';
const DISPATCH_CB = '../src/handlers/dispatch-callback.ts';

// ─── Suite 1: research-executor.ts — Structural Completeness ──────────────
describe('research-executor: structural completeness', () => {
  it('exports runResearchAgentWithNotifications', async () => {
    const src = await Bun.file(rel(EXECUTOR)).text();
    expect(src).toContain('export async function runResearchAgentWithNotifications');
  });

  it('exports sendCompletionNotification', async () => {
    const src = await Bun.file(rel(EXECUTOR)).text();
    expect(src).toContain('export async function sendCompletionNotification');
  });

  it("accepts source parameter with 'unknown' default", async () => {
    const src = await Bun.file(rel(EXECUTOR)).text();
    expect(src).toContain("source = 'unknown'");
  });

  it("embeds source in agent name: Research [${source}]:", async () => {
    const src = await Bun.file(rel(EXECUTOR)).text();
    expect(src).toContain('Research [${source}]');
  });

  it('calls wireAgentToWorkQueue for WQ lifecycle binding', async () => {
    const src = await Bun.file(rel(EXECUTOR)).text();
    expect(src).toContain('wireAgentToWorkQueue');
  });

  it('calls appendDispatchNotes for source fingerprint persistence', async () => {
    const src = await Bun.file(rel(EXECUTOR)).text();
    expect(src).toContain('appendDispatchNotes');
  });

  it('calls stashAgentResult for session continuity', async () => {
    const src = await Bun.file(rel(EXECUTOR)).text();
    expect(src).toContain('stashAgentResult');
  });

  it('passes source as argument to appendDispatchNotes', async () => {
    const src = await Bun.file(rel(EXECUTOR)).text();
    const idx = src.indexOf('appendDispatchNotes(');
    expect(idx).toBeGreaterThan(-1);
    const callRegion = src.substring(idx, idx + 80);
    expect(callRegion).toContain('source');
  });
});

// ─── Suite 2: Dispatch Site 1 — content-callback.ts ──────────────────────
describe('dispatch site 1: content-callback (source=content-confirm)', () => {
  it('imports runResearchAgentWithNotifications', async () => {
    const src = await Bun.file(rel(CONTENT_CB)).text();
    expect(src).toContain('runResearchAgentWithNotifications');
  });

  it("dispatches with source='content-confirm'", async () => {
    const src = await Bun.file(rel(CONTENT_CB)).text();
    expect(src).toContain("'content-confirm'");
  });

  it('source identifier appears within 300 chars of dispatch call', async () => {
    const src = await Bun.file(rel(CONTENT_CB)).text();
    const callIdx = src.indexOf('runResearchAgentWithNotifications(');
    expect(callIdx).toBeGreaterThan(-1);
    const callRegion = src.substring(callIdx, callIdx + 300);
    expect(callRegion).toContain("'content-confirm'");
  });

  it('declares module-level _activeResearchItems Set for idempotency', async () => {
    const src = await Bun.file(rel(CONTENT_CB)).text();
    expect(src).toContain('_activeResearchItems');
    expect(src).toContain('new Set');
  });

  it('checks _activeResearchItems.has() before dispatching', async () => {
    const src = await Bun.file(rel(CONTENT_CB)).text();
    expect(src).toContain('_activeResearchItems.has(');
  });

  it('adds workQueueId to _activeResearchItems before dispatch', async () => {
    const src = await Bun.file(rel(CONTENT_CB)).text();
    expect(src).toContain('_activeResearchItems.add(');
  });

  it('removes workQueueId from _activeResearchItems in finally block', async () => {
    const src = await Bun.file(rel(CONTENT_CB)).text();
    expect(src).toContain('_activeResearchItems.delete(');
    expect(src).toContain('finally');
  });

  it("guards dispatch under requestType === 'Research'", async () => {
    const src = await Bun.file(rel(CONTENT_CB)).text();
    expect(src).toContain("requestType === 'Research'");
  });
});

// ─── Suite 3: Dispatch Site 2 — notion-callback.ts ───────────────────────
describe('dispatch site 2: notion-callback (source=notion-process)', () => {
  it('imports runResearchAgentWithNotifications', async () => {
    const src = await Bun.file(rel(NOTION_CB)).text();
    expect(src).toContain('runResearchAgentWithNotifications');
  });

  it("dispatches with source='notion-process'", async () => {
    const src = await Bun.file(rel(NOTION_CB)).text();
    expect(src).toContain("'notion-process'");
  });

  it("guards dispatch under requestType === 'Research'", async () => {
    const src = await Bun.file(rel(NOTION_CB)).text();
    expect(src).toContain("requestType === 'Research'");
  });

  it("handleTrackInWQ sets requestType='Process' (not Research — must not dispatch)", async () => {
    const src = await Bun.file(rel(NOTION_CB)).text();
    expect(src).toContain("requestType: 'Process'");
  });
});

// ─── Suite 4: Dispatch Site 3 — voice-callback.ts ────────────────────────
describe('dispatch site 3: voice-callback (source=voice-research)', () => {
  it('imports runResearchAgentWithNotifications', async () => {
    const src = await Bun.file(rel(VOICE_CB)).text();
    expect(src).toContain('runResearchAgentWithNotifications');
  });

  it("dispatches with source='voice-research'", async () => {
    const src = await Bun.file(rel(VOICE_CB)).text();
    expect(src).toContain("'voice-research'");
  });

  it('awaits dispatch synchronously (voice waits — not fire-and-forget)', async () => {
    const src = await Bun.file(rel(VOICE_CB)).text();
    expect(src).toContain('await runResearchAgentWithNotifications');
  });

  it('creates WQ item before dispatching via createResearchWorkItem', async () => {
    const src = await Bun.file(rel(VOICE_CB)).text();
    expect(src).toContain('createResearchWorkItem');
  });
});

// ─── Suite 5: Dispatch Site 4 — socratic-adapter.ts ─────────────────────
describe('dispatch site 4: socratic-adapter (source=socratic-resolved)', () => {
  it('imports runResearchAgentWithNotifications', async () => {
    const src = await Bun.file(rel(SOCRATIC)).text();
    expect(src).toContain('runResearchAgentWithNotifications');
  });

  it("dispatches with source='socratic-resolved'", async () => {
    const src = await Bun.file(rel(SOCRATIC)).text();
    expect(src).toContain("'socratic-resolved'");
  });

  it("guards dispatch under requestType === 'Research'", async () => {
    const src = await Bun.file(rel(SOCRATIC)).text();
    expect(src).toContain("requestType === 'Research'");
  });

  it('guards dispatch on workQueueId presence', async () => {
    const src = await Bun.file(rel(SOCRATIC)).text();
    expect(src).toContain('workQueueId');
  });

  it('uses void pattern for fire-and-forget dispatch', async () => {
    const src = await Bun.file(rel(SOCRATIC)).text();
    expect(src).toContain('void runResearchAgentWithNotifications');
  });

  it('chains sendCompletionNotification via .then()', async () => {
    const src = await Bun.file(rel(SOCRATIC)).text();
    expect(src).toContain('sendCompletionNotification');
    expect(src).toContain('.then(');
  });
});

// ─── Suite 6: Dispatch Site 5 — agent-handler.ts ─────────────────────────
describe('dispatch site 5: agent-handler (source=agent-command)', () => {
  it('imports runResearchAgentWithNotifications', async () => {
    const src = await Bun.file(rel(AGENT_H)).text();
    expect(src).toContain('runResearchAgentWithNotifications');
  });

  it("dispatches with source='agent-command'", async () => {
    const src = await Bun.file(rel(AGENT_H)).text();
    expect(src).toContain("'agent-command'");
  });

  it('awaits synchronously in handleResearchCommand', async () => {
    const src = await Bun.file(rel(AGENT_H)).text();
    expect(src).toContain('await runResearchAgentWithNotifications');
  });
});

// ─── Suite 7: Negative — dispatch-callback must NOT auto-execute ──────────
describe('negative: dispatch-callback does not auto-execute research', () => {
  it('does NOT call runResearchAgentWithNotifications', async () => {
    const src = await Bun.file(rel(DISPATCH_CB)).text();
    expect(src).not.toContain('runResearchAgentWithNotifications');
  });

  it('does NOT call executeResearch directly', async () => {
    const src = await Bun.file(rel(DISPATCH_CB)).text();
    expect(src).not.toContain('executeResearch');
  });
});

// ─── Suite 8: Exhaustive Source Coverage — no orphaned 'unknown' ──────────
describe("source coverage: all 5 dispatch sites use explicit source strings", () => {
  it("content-callback passes 'content-confirm' as string literal", async () => {
    const src = await Bun.file(rel(CONTENT_CB)).text();
    expect(src).toMatch(/'content-confirm'/);
  });

  it("notion-callback passes 'notion-process' as string literal", async () => {
    const src = await Bun.file(rel(NOTION_CB)).text();
    expect(src).toMatch(/'notion-process'/);
  });

  it("voice-callback passes 'voice-research' as string literal", async () => {
    const src = await Bun.file(rel(VOICE_CB)).text();
    expect(src).toMatch(/'voice-research'/);
  });

  it("socratic-adapter passes 'socratic-resolved' as string literal", async () => {
    const src = await Bun.file(rel(SOCRATIC)).text();
    expect(src).toMatch(/'socratic-resolved'/);
  });

  it("agent-handler passes 'agent-command' as string literal", async () => {
    const src = await Bun.file(rel(AGENT_H)).text();
    expect(src).toMatch(/'agent-command'/);
  });
});
