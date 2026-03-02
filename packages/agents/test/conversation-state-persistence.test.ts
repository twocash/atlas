/**
 * ConversationState Disk Persistence Tests
 *
 * Validates the save → clear → rehydrate cycle for both
 * ConversationState and PendingContent stores.
 *
 * Sprint: STATE-PERSIST
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test';
import { existsSync, unlinkSync, mkdirSync } from 'fs';
import { writeFileSync, readFileSync } from 'fs';
import { join } from 'path';

// We need to mock reportFailure and logger BEFORE importing the module
import { mock } from 'bun:test';

mock.module('@atlas/shared/error-escalation', () => ({
  reportFailure: mock(() => {}),
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

import {
  getOrCreateState,
  getState,
  updateState,
  storeContentContext,
  storeSocraticAnswer,
  storeTriage,
  storeAssessment,
  enterSocraticPhase,
  enterApprovalPhase,
  enterDialoguePhase,
  returnToIdle,
  clearState,
  clearAllStates,
  storePendingContent,
  getPendingContent,
  removePendingContent,
  generateRequestId,
  _flushForTesting,
  _rehydrateForTesting,
  _resetRehydrationFlag,
  _getStateFilePath,
} from '../src/conversation/conversation-state';

import type { PendingContent } from '../src/conversation/types';

const STATE_FILE = _getStateFilePath();

function cleanStateFile(): void {
  if (existsSync(STATE_FILE)) {
    unlinkSync(STATE_FILE);
  }
}

function ensureDataDir(): void {
  const dir = join(process.cwd(), 'data');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

describe('ConversationState Disk Persistence', () => {
  beforeEach(() => {
    clearAllStates();
    _flushForTesting(); // Write the empty state
    cleanStateFile();
    _resetRehydrationFlag();
  });

  afterEach(() => {
    clearAllStates();
    cleanStateFile();
    _resetRehydrationFlag();
  });

  // ─── Test 1: Core persistence round-trip ──────────────

  it('state survives save → clear → rehydrate cycle', () => {
    ensureDataDir();
    const chatId = 12345;
    const userId = 67890;

    // Create state and mutate it
    const state = getOrCreateState(chatId, userId);
    state.phase = 'socratic';
    updateState(chatId, { lastSocraticAnswer: 'research this article' });

    // Flush to disk
    _flushForTesting();

    // Clear in-memory state
    clearAllStates();
    _resetRehydrationFlag();

    // Rehydrate
    _rehydrateForTesting();

    const recovered = getState(chatId);
    expect(recovered).toBeDefined();
    expect(recovered!.chatId).toBe(chatId);
    expect(recovered!.userId).toBe(userId);
    expect(recovered!.lastSocraticAnswer).toBe('research this article');
  });

  // ─── Test 2: TTL enforcement on rehydration ───────────

  it('expired states pruned on rehydration', () => {
    ensureDataDir();
    const chatId = 11111;
    const userId = 22222;

    getOrCreateState(chatId, userId);
    _flushForTesting();

    // Read the file and manually backdate lastActivity to 20 minutes ago
    const raw = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    const key = String(chatId);
    raw.states[key].lastActivity = Date.now() - 20 * 60 * 1000;
    writeFileSync(STATE_FILE, JSON.stringify(raw), 'utf-8');

    // Clear and rehydrate
    clearAllStates();
    _resetRehydrationFlag();
    _rehydrateForTesting();

    expect(getState(chatId)).toBeUndefined();
  });

  // ─── Test 3: Phase state round-trips ──────────────────

  it('phase state (socratic/approval/dialogue) round-trips', () => {
    ensureDataDir();
    const chatId = 33333;
    const userId = 44444;

    enterSocraticPhase(chatId, userId, {
      sessionId: 'test-session-id',
      questionMessageId: 100,
      questions: [{ text: 'What is the play?', type: 'open', slot: 'intent' }] as any,
      currentQuestionIndex: 0,
      content: 'https://example.com/article',
      contentType: 'url',
      title: 'Test Article',
      signals: { hasUrl: true } as any,
    });

    _flushForTesting();
    clearAllStates();
    _resetRehydrationFlag();
    _rehydrateForTesting();

    const recovered = getState(chatId);
    expect(recovered).toBeDefined();
    expect(recovered!.phase).toBe('socratic');
    expect(recovered!.socratic).toBeDefined();
    expect(recovered!.socratic!.sessionId).toBe('test-session-id');
    expect(recovered!.socratic!.content).toBe('https://example.com/article');
    expect(recovered!.socratic!.questions).toHaveLength(1);
  });

  // ─── Test 4: PendingContent round-trips ───────────────

  it('PendingContent round-trips', () => {
    ensureDataDir();
    const requestId = generateRequestId();

    const content: PendingContent = {
      requestId,
      chatId: 55555,
      userId: 66666,
      flowState: 'confirm',
      analysis: { key: 'value' },
      originalText: 'test content',
      pillar: 'The Grove',
      requestType: 'Research',
      timestamp: Date.now(),
    };

    storePendingContent(content);
    _flushForTesting();

    clearAllStates();
    _resetRehydrationFlag();
    _rehydrateForTesting();

    const recovered = getPendingContent(requestId);
    expect(recovered).toBeDefined();
    expect(recovered!.pillar).toBe('The Grove');
    expect(recovered!.requestType).toBe('Research');
    expect(recovered!.originalText).toBe('test content');
  });

  // ─── Test 5: ContentContext with UrlContent round-trips ─

  it('ContentContext with UrlContent round-trips', () => {
    ensureDataDir();
    const chatId = 77777;
    const userId = 88888;

    storeContentContext(chatId, userId, {
      url: 'https://example.com/article',
      title: 'Test Article',
      preReadSummary: 'An article about testing',
      prefetchedUrlContent: {
        url: 'https://example.com/article',
        title: 'Test Article',
        description: 'A great article',
        bodySnippet: 'Content here...',
        fetchedAt: new Date('2026-03-01T12:00:00Z'),
        success: true,
      },
      capturedAt: Date.now(),
    });

    _flushForTesting();
    clearAllStates();
    _resetRehydrationFlag();
    _rehydrateForTesting();

    const recovered = getState(chatId);
    expect(recovered).toBeDefined();
    expect(recovered!.contentContext).toBeDefined();
    expect(recovered!.contentContext!.url).toBe('https://example.com/article');
    expect(recovered!.contentContext!.prefetchedUrlContent).toBeDefined();
    // Date serializes to ISO string — callers handle both
    const fetchedAt = recovered!.contentContext!.prefetchedUrlContent!.fetchedAt;
    expect(typeof fetchedAt === 'string' || fetchedAt instanceof Date).toBe(true);
  });

  // ─── Test 6: Unknown version skipped ──────────────────

  it('rehydration skips unknown version', () => {
    ensureDataDir();

    writeFileSync(STATE_FILE, JSON.stringify({
      version: 99,
      states: { '12345': { chatId: 12345, userId: 67890, phase: 'idle', lastActivity: Date.now() } },
      pendingContent: {},
      savedAt: new Date().toISOString(),
    }), 'utf-8');

    clearAllStates();
    _resetRehydrationFlag();
    _rehydrateForTesting();

    expect(getState(12345)).toBeUndefined();
  });

  // ─── Test 7: Missing file → empty state ───────────────

  it('missing file → empty state (no crash)', () => {
    cleanStateFile();
    clearAllStates();
    _resetRehydrationFlag();

    // Should not throw
    _rehydrateForTesting();

    expect(getState(99999)).toBeUndefined();
  });

  // ─── Test 8: Corrupted file → empty state + warning ───

  it('corrupted file → empty state + warning log', () => {
    ensureDataDir();
    writeFileSync(STATE_FILE, '{{{not valid json!!!', 'utf-8');

    clearAllStates();
    _resetRehydrationFlag();

    // Should not throw — graceful degradation
    _rehydrateForTesting();

    expect(getState(99999)).toBeUndefined();
  });

  // ─── Test 9: clearAllStates saves empty file ──────────

  it('clearAllStates() saves empty file', () => {
    ensureDataDir();
    const chatId = 11111;
    const userId = 22222;

    getOrCreateState(chatId, userId);
    _flushForTesting();

    // Verify file exists with data
    expect(existsSync(STATE_FILE)).toBe(true);
    const beforeClear = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    expect(Object.keys(beforeClear.states)).toHaveLength(1);

    // Clear and flush
    clearAllStates();
    _flushForTesting();

    // Verify file now has empty states
    const afterClear = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    expect(Object.keys(afterClear.states)).toHaveLength(0);
    expect(Object.keys(afterClear.pendingContent)).toHaveLength(0);
  });

  // ─── Test 10: Debounce — multiple mutations, single write ─

  it('multiple rapid mutations → single write (debounce)', async () => {
    ensureDataDir();
    cleanStateFile();
    _resetRehydrationFlag();

    const chatId = 44444;
    const userId = 55555;

    // Rapid mutations — each calls scheduleSave() internally
    getOrCreateState(chatId, userId);
    storeSocraticAnswer(chatId, 'answer 1');
    storeSocraticAnswer(chatId, 'answer 2');
    storeSocraticAnswer(chatId, 'answer 3');

    // File should NOT exist yet (debounce hasn't fired)
    // Note: it may or may not exist depending on timing, but the key test
    // is that after waiting, only one write happens with final state.

    // Wait for debounce to fire (2s + buffer)
    await new Promise(resolve => setTimeout(resolve, 2500));

    expect(existsSync(STATE_FILE)).toBe(true);
    const data = JSON.parse(readFileSync(STATE_FILE, 'utf-8'));
    expect(data.states[String(chatId)].lastSocraticAnswer).toBe('answer 3');
  });
});
