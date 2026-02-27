/**
 * SessionManager Unit Tests
 *
 * Tests core SessionManager lifecycle: create, continue, complete,
 * prune, TTL, MAX_ACTIVE, getSessionContext, isSessionContinuation.
 *
 * Sprint: SESSION-TELEMETRY P0
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// Mock filesystem, Notion, and shared config before importing SessionManager
mock.module('node:fs/promises', () => ({
  writeFile: mock(() => Promise.resolve()),
  readFile: mock(() => Promise.resolve('')),
  readdir: mock(() => Promise.resolve([])),
  mkdir: mock(() => Promise.resolve()),
}));
mock.module('node:fs', () => ({
  existsSync: mock(() => true),
}));
mock.module('@notionhq/client', () => ({
  Client: class {
    pages = { create: mock(() => Promise.resolve({ id: 'mock-page-id' })) };
  },
}));
mock.module('@atlas/shared/config', () => ({
  NOTION_DB: { FEED: 'mock-feed-id' },
  ATLAS_NODE: 'test-node',
}));

import { SessionManager } from '../src/sessions/session-manager';

describe('SessionManager', () => {
  let manager: SessionManager;

  beforeEach(() => {
    manager = new SessionManager();
  });

  it('startTurn creates new session on first call', async () => {
    const result = await manager.startTurn('session-1', 'Hello world', 'telegram');

    expect(result.isNew).toBe(true);
    expect(result.sessionContext.sessionId).toBe('session-1');
    expect(result.sessionContext.turnNumber).toBe(1);
    expect(manager.hasSession('session-1')).toBe(true);
    expect(manager.getActiveCount()).toBe(1);
  });

  it('startTurn continues existing session on subsequent calls', async () => {
    await manager.startTurn('session-1', 'Hello', 'telegram');
    const result = await manager.startTurn('session-1', 'Follow up', 'telegram');

    expect(result.isNew).toBe(false);
    expect(result.sessionContext.turnNumber).toBe(2);
  });

  it('completeTurn updates last turn with findings', async () => {
    await manager.startTurn('session-1', 'Research AI agents', 'telegram', {
      intent: 'query',
    });

    await manager.completeTurn('session-1', {
      findings: 'AI agents are autonomous systems',
      responsePreview: 'Here is what I found...',
      thesisHook: 'Agents will replace workflows',
      toolsUsed: ['web-search'],
    });

    const ctx = manager.getSessionContext('session-1');
    expect(ctx).not.toBeNull();
    expect(ctx!.priorFindings).toBe('AI agents are autonomous systems');
    expect(ctx!.thesisHook).toBe('Agents will replace workflows');
  });

  it('completeSession removes from active map', async () => {
    await manager.startTurn('session-1', 'Hello', 'telegram');
    expect(manager.hasSession('session-1')).toBe(true);

    await manager.completeSession('session-1', 'natural');
    expect(manager.hasSession('session-1')).toBe(false);
    expect(manager.getActiveCount()).toBe(0);
  });

  it('pruneExpired auto-completes stale sessions', async () => {
    await manager.startTurn('session-1', 'Hello', 'telegram');

    // Manually set lastActivity to 20 minutes ago
    const state = (manager as any).sessions.get('session-1');
    state.lastActivity = Date.now() - 20 * 60 * 1000; // 20 min ago

    manager.pruneExpired();
    expect(manager.hasSession('session-1')).toBe(false);
  });

  it('MAX_ACTIVE enforced (oldest pruned when exceeded)', async () => {
    // Create 10 sessions (at limit)
    for (let i = 0; i < 10; i++) {
      await manager.startTurn(`session-${i}`, `Message ${i}`, 'telegram');
      // Stagger lastActivity so we know which is oldest
      const state = (manager as any).sessions.get(`session-${i}`);
      state.lastActivity = Date.now() - (10 - i) * 1000; // session-0 is oldest
    }

    expect(manager.getActiveCount()).toBe(10);

    // Creating an 11th should prune the oldest
    await manager.startTurn('session-new', 'New message', 'telegram');

    expect(manager.getActiveCount()).toBe(10); // Still at limit
    expect(manager.hasSession('session-0')).toBe(false); // Oldest pruned
    expect(manager.hasSession('session-new')).toBe(true);
  });

  it('getSessionContext returns Slot 7-compatible data', async () => {
    await manager.startTurn('session-1', 'Research topic', 'telegram', {
      intent: 'query',
      topic: 'AI Agents',
      intentHash: 'abc123',
    });

    await manager.completeTurn('session-1', {
      findings: 'Key finding from turn 1',
      thesisHook: 'The thesis',
    });

    await manager.startTurn('session-1', 'Go deeper', 'telegram', {
      intent: 'research',
      intentHash: 'def456',
    });

    const ctx = manager.getSessionContext('session-1');
    expect(ctx).not.toBeNull();
    expect(ctx!.sessionId).toBe('session-1');
    expect(ctx!.turnNumber).toBe(2);
    expect(ctx!.priorIntentHash).toBe('abc123');
    expect(ctx!.intentSequence).toEqual(['query', 'research']);
    expect(ctx!.priorFindings).toBe('Key finding from turn 1');
    expect(ctx!.thesisHook).toBe('The thesis');
    expect(ctx!.topic).toBe('AI Agents');
  });

  it('isNew is false on turn 2+ (isSessionContinuation seam)', async () => {
    const turn1 = await manager.startTurn('session-1', 'Turn 1', 'telegram');
    expect(turn1.isNew).toBe(true); // isSessionContinuation = false

    const turn2 = await manager.startTurn('session-1', 'Turn 2', 'telegram');
    expect(turn2.isNew).toBe(false); // isSessionContinuation = true
  });

  it('getSessionContext returns null for non-existent session', () => {
    const ctx = manager.getSessionContext('nonexistent');
    expect(ctx).toBeNull();
  });

  it('TTL expiry detected correctly (inactivity)', async () => {
    await manager.startTurn('session-1', 'Hello', 'telegram');

    const state = (manager as any).sessions.get('session-1');

    // 14 minutes ago — should NOT expire
    state.lastActivity = Date.now() - 14 * 60 * 1000;
    manager.pruneExpired();
    expect(manager.hasSession('session-1')).toBe(true);

    // 16 minutes ago — should expire
    state.lastActivity = Date.now() - 16 * 60 * 1000;
    manager.pruneExpired();
    expect(manager.hasSession('session-1')).toBe(false);
  });

  it('TTL expiry detected correctly (max duration)', async () => {
    await manager.startTurn('session-1', 'Hello', 'telegram');

    const state = (manager as any).sessions.get('session-1');

    // Session created 2.5 hours ago but active recently
    state.createdAt = new Date(Date.now() - 2.5 * 60 * 60 * 1000).toISOString();
    state.lastActivity = Date.now(); // Active now

    manager.pruneExpired();
    expect(manager.hasSession('session-1')).toBe(false); // Max duration exceeded
  });

  it('findings accumulate across turns', async () => {
    await manager.startTurn('session-1', 'Turn 1', 'telegram');
    await manager.completeTurn('session-1', { findings: 'Finding A' });

    await manager.startTurn('session-1', 'Turn 2', 'telegram');
    await manager.completeTurn('session-1', { findings: 'Finding B' });

    const ctx = manager.getSessionContext('session-1');
    expect(ctx!.priorFindings).toBe('Finding A\nFinding B');
  });
});
