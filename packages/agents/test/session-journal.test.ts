/**
 * Session Journal + Artifact Tests
 *
 * Tests filesystem journal writing, idempotency, artifact JSON,
 * and journal parsing for rehydration.
 *
 * Sprint: SESSION-TELEMETRY P0
 */

import { describe, it, expect, beforeEach, afterEach, mock } from 'bun:test';
import { writeFile, readFile, readdir, mkdir, rm } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { SessionState } from '../src/sessions/types';

// Use a temp directory for test isolation
const TEST_DIR = join(__dirname, '..', '..', '..', 'data', 'sessions-test');

// Mock the sessions dir to use our test dir
mock.module('node:path', () => {
  const actual = require('node:path');
  return {
    ...actual,
    resolve: (...args: string[]) => {
      const result = actual.resolve(...args);
      // Redirect data/sessions to data/sessions-test
      if (result.endsWith('data/sessions') || result.endsWith('data\\sessions')) {
        return TEST_DIR;
      }
      return result;
    },
  };
});

import { writeJournal, parseJournal, ensureSessionDir } from '../src/sessions/journal';
import { writeArtifact } from '../src/sessions/artifact';

function createTestState(overrides?: Partial<SessionState>): SessionState {
  return {
    id: 'test-session-001',
    surface: 'telegram',
    pillar: 'The Grove',
    topic: 'AI Agent Architecture',
    intentSequence: ['query', 'research'],
    turns: [
      {
        turnNumber: 1,
        timestamp: '2026-02-27T10:00:00.000Z',
        messageText: 'What are the key patterns for building AI agents?',
        intentHash: 'abc123',
        intent: 'query',
        findings: 'Multi-agent systems use tool routing and memory',
        thesisHook: 'Agents need persistent memory for real value',
        responsePreview: 'AI agents typically follow...',
        toolsUsed: ['web-search'],
      },
      {
        turnNumber: 2,
        timestamp: '2026-02-27T10:05:00.000Z',
        messageText: 'Go deeper on memory architectures',
        intentHash: 'def456',
        intent: 'research',
        findings: 'RAG + vector DB is the dominant pattern',
        thesisHook: 'Memory is the moat',
      },
    ],
    turnCount: 2,
    priorFindings: 'Multi-agent systems use tool routing and memory\nRAG + vector DB is the dominant pattern',
    thesisHook: 'Memory is the moat',
    createdAt: '2026-02-27T10:00:00.000Z',
    lastActivity: Date.now(),
    ...overrides,
  };
}

describe('Session Journal', () => {
  beforeEach(async () => {
    if (!existsSync(TEST_DIR)) {
      await mkdir(TEST_DIR, { recursive: true });
    }
  });

  afterEach(async () => {
    try {
      if (existsSync(TEST_DIR)) {
        await rm(TEST_DIR, { recursive: true, force: true });
      }
    } catch {
      // Cleanup failure is non-fatal in tests
    }
  });

  it('writeJournal creates correct markdown structure', async () => {
    const state = createTestState();
    await writeJournal(state);

    const filePath = join(TEST_DIR, 'test-session-001.md');
    expect(existsSync(filePath)).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('# Session: AI Agent Architecture');
    expect(content).toContain('**Session ID:** test-session-001');
    expect(content).toContain('**Surface:** telegram');
    expect(content).toContain('**Pillar:** The Grove');
    expect(content).toContain('## Turn 1 -- query');
    expect(content).toContain('## Turn 2 -- research');
    expect(content).toContain('**Message:** What are the key patterns');
    expect(content).toContain('**Findings:** Multi-agent systems');
    expect(content).toContain('**Thesis:** Memory is the moat');
  });

  it('writeJournal is idempotent (overwrites safely)', async () => {
    const state = createTestState();

    // Write twice
    await writeJournal(state);
    await writeJournal(state);

    const filePath = join(TEST_DIR, 'test-session-001.md');
    const content = await readFile(filePath, 'utf-8');

    // Should have exactly 2 turn headers, not 4
    const turnMatches = content.match(/## Turn \d+/g);
    expect(turnMatches?.length).toBe(2);
  });

  it('completed journal includes completion marker', async () => {
    const state = createTestState({
      completedAt: '2026-02-27T10:30:00.000Z',
      completionType: 'natural',
    });

    await writeJournal(state);

    const filePath = join(TEST_DIR, 'test-session-001.md');
    const content = await readFile(filePath, 'utf-8');
    expect(content).toContain('## Session Complete');
    expect(content).toContain('**Type:** natural');
    expect(content).toContain('**Completed:** 2026-02-27T10:30:00.000Z');
  });

  it('parseJournal returns null for completed journals', async () => {
    const state = createTestState({
      completedAt: '2026-02-27T10:30:00.000Z',
      completionType: 'natural',
    });

    await writeJournal(state);

    const filePath = join(TEST_DIR, 'test-session-001.md');
    const result = await parseJournal(filePath);
    expect(result).toBeNull();
  });

  it('parseJournal rehydrates incomplete journals', async () => {
    // Write a journal WITHOUT completion marker
    const state = createTestState();
    await writeJournal(state);

    const filePath = join(TEST_DIR, 'test-session-001.md');
    const result = await parseJournal(filePath);

    expect(result).not.toBeNull();
    expect(result!.id).toBe('test-session-001');
    expect(result!.surface).toBe('telegram');
    expect(result!.pillar).toBe('The Grove');
    expect(result!.topic).toBe('AI Agent Architecture');
    expect(result!.turns.length).toBe(2);
    expect(result!.turnCount).toBe(2);
  });

  it('ensureSessionDir creates directory', async () => {
    // Remove test dir first
    if (existsSync(TEST_DIR)) {
      await rm(TEST_DIR, { recursive: true, force: true });
    }

    const dir = await ensureSessionDir();
    expect(existsSync(dir)).toBe(true);
  });
});

describe('Session Artifact', () => {
  beforeEach(async () => {
    if (!existsSync(TEST_DIR)) {
      await mkdir(TEST_DIR, { recursive: true });
    }
  });

  afterEach(async () => {
    try {
      if (existsSync(TEST_DIR)) {
        await rm(TEST_DIR, { recursive: true, force: true });
      }
    } catch {
      // Cleanup failure is non-fatal in tests
    }
  });

  it('writeArtifact creates valid JSON', async () => {
    const state = createTestState({
      completedAt: '2026-02-27T10:30:00.000Z',
      completionType: 'natural',
    });

    await writeArtifact(state);

    const filePath = join(TEST_DIR, 'test-session-001.artifact.json');
    expect(existsSync(filePath)).toBe(true);

    const content = await readFile(filePath, 'utf-8');
    const artifact = JSON.parse(content);

    expect(artifact.version).toBe('1.0');
    expect(artifact.sessionId).toBe('test-session-001');
    expect(artifact.topic).toBe('AI Agent Architecture');
    expect(artifact.surface).toBe('telegram');
    expect(artifact.turns.length).toBe(2);
    expect(artifact.completionType).toBe('natural');
    expect(artifact.totalDurationMs).toBeGreaterThan(0);
  });
});
