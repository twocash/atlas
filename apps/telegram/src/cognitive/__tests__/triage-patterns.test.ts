/**
 * Triage Pattern Cache Tests
 *
 * Tests for pattern caching, feedback loop, and example retrieval.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import * as fs from 'fs';
import type { TriageResult } from '../triage-skill';

// Mock fs operations
vi.mock('fs', () => ({
  readFileSync: vi.fn(),
  writeFileSync: vi.fn(),
  existsSync: vi.fn(),
}));

// Mock logger
vi.mock('../../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('generatePatternKey', () => {
  let generatePatternKey: typeof import('../triage-patterns').generatePatternKey;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();
    const module = await import('../triage-patterns');
    generatePatternKey = module.generatePatternKey;
  });

  it('should generate URL pattern key with domain and normalized path', () => {
    const key = generatePatternKey('https://threads.com/t/abc123');
    expect(key).toBe('url:threads.com/t/*');
  });

  it('should normalize numeric IDs in URL paths', () => {
    const key = generatePatternKey('https://github.com/user/repo/issues/42');
    expect(key).toBe('url:github.com/user/repo/issues/*');
  });

  it('should generate command pattern key for log verb', () => {
    const key = generatePatternKey('Log a bug about X');
    expect(key).toBe('cmd:log+bug');
  });

  it('should generate command pattern key for create with priority', () => {
    const key = generatePatternKey('Create a P0 for the issue');
    expect(key).toBe('cmd:create+p0');
  });

  it('should generate query pattern key', () => {
    const key = generatePatternKey("What's the status?");
    expect(key).toBe('query:what');
  });

  it('should generate text pattern key for freeform content', () => {
    const key = generatePatternKey('Idea about improving onboarding flow');
    expect(key).toBe('text:idea+about+improving');
  });

  it('should handle short messages', () => {
    const key = generatePatternKey('hi');
    expect(key).toBe('text:short');
  });

  it('should be case-insensitive', () => {
    const key1 = generatePatternKey('Log a bug');
    const key2 = generatePatternKey('LOG A BUG');
    expect(key1).toBe(key2);
  });
});

describe('getCachedTriage', () => {
  let getCachedTriage: typeof import('../triage-patterns').getCachedTriage;
  let recordTriageFeedback: typeof import('../triage-patterns').recordTriageFeedback;
  let clearPatterns: typeof import('../triage-patterns').clearPatterns;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    // Mock empty pattern file initially
    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const module = await import('../triage-patterns');
    getCachedTriage = module.getCachedTriage;
    recordTriageFeedback = module.recordTriageFeedback;
    clearPatterns = module.clearPatterns;

    // Start with clean state
    clearPatterns();
  });

  it('should return null when no pattern exists', () => {
    const result = getCachedTriage('Some new message');
    expect(result).toBeNull();
  });

  it('should return cached result after 5 confirmations with 0 corrections', () => {
    const mockTriage: TriageResult = {
      intent: 'capture',
      confidence: 0.9,
      pillar: 'The Grove',
      requestType: 'Research',
      keywords: ['test'],
      complexityTier: 1,
      source: 'haiku',
    };

    // Record 5 confirmations
    for (let i = 0; i < 5; i++) {
      recordTriageFeedback('Log a bug about X', mockTriage, null);
    }

    const cached = getCachedTriage('Log a bug about Y');
    expect(cached).not.toBeNull();
    expect(cached?.source).toBe('pattern_cache');
    expect(cached?.complexityTier).toBe(0);
  });

  it('should return null with less than 5 confirmations', () => {
    const mockTriage: TriageResult = {
      intent: 'capture',
      confidence: 0.9,
      pillar: 'The Grove',
      requestType: 'Research',
      keywords: [],
      complexityTier: 1,
      source: 'haiku',
    };

    // Record only 3 confirmations
    for (let i = 0; i < 3; i++) {
      recordTriageFeedback('Log a bug about X', mockTriage, null);
    }

    const cached = getCachedTriage('Log a bug about Y');
    expect(cached).toBeNull();
  });

  it('should return null after correction resets confidence', () => {
    const mockTriage: TriageResult = {
      intent: 'capture',
      confidence: 0.9,
      pillar: 'The Grove',
      requestType: 'Research',
      keywords: [],
      complexityTier: 1,
      source: 'haiku',
    };

    // Record 3 confirmations then 1 correction
    for (let i = 0; i < 3; i++) {
      recordTriageFeedback('Log a bug about X', mockTriage, null);
    }
    recordTriageFeedback('Log a bug about X', mockTriage, { pillar: 'Consulting' });

    const cached = getCachedTriage('Log a bug about Y');
    expect(cached).toBeNull();
  });

  it('should return cached result with 10+ confirmations and low correction ratio', () => {
    const mockTriage: TriageResult = {
      intent: 'capture',
      confidence: 0.9,
      pillar: 'The Grove',
      requestType: 'Research',
      keywords: [],
      complexityTier: 1,
      source: 'haiku',
    };

    // Record 10 confirmations and 1 correction (10% ratio)
    for (let i = 0; i < 10; i++) {
      recordTriageFeedback('Log a bug about X', mockTriage, null);
    }
    recordTriageFeedback('Log a bug about X', mockTriage, { pillar: 'Personal' });

    const cached = getCachedTriage('Log a bug about Y');
    // 10 confirms, 1 correction = 0.09 ratio, below 0.1 threshold
    expect(cached).not.toBeNull();
  });
});

describe('getTriageExamples', () => {
  let getTriageExamples: typeof import('../triage-patterns').getTriageExamples;
  let recordTriageFeedback: typeof import('../triage-patterns').recordTriageFeedback;
  let clearPatterns: typeof import('../triage-patterns').clearPatterns;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const module = await import('../triage-patterns');
    getTriageExamples = module.getTriageExamples;
    recordTriageFeedback = module.recordTriageFeedback;
    clearPatterns = module.clearPatterns;

    clearPatterns();
  });

  it('should return empty array when no patterns exist', () => {
    const examples = getTriageExamples('Test message');
    expect(examples).toEqual([]);
  });

  it('should return max 3 examples', () => {
    const mockTriage: TriageResult = {
      intent: 'capture',
      confidence: 0.9,
      pillar: 'The Grove',
      requestType: 'Research',
      keywords: [],
      complexityTier: 1,
      source: 'haiku',
    };

    // Record multiple patterns with different messages
    const messages = [
      'Log a bug about issue 1',
      'Log a bug about issue 2',
      'Log a bug about issue 3',
      'Log a bug about issue 4',
      'Log a bug about issue 5',
    ];

    for (const msg of messages) {
      recordTriageFeedback(msg, mockTriage, null);
      recordTriageFeedback(msg, mockTriage, null); // 2 confirmations each
    }

    const examples = getTriageExamples('Log a bug about new issue');
    expect(examples.length).toBeLessThanOrEqual(3);
  });

  it('should return examples similar to input message type', () => {
    const mockTriage: TriageResult = {
      intent: 'capture',
      confidence: 0.9,
      pillar: 'The Grove',
      requestType: 'Research',
      keywords: [],
      complexityTier: 1,
      source: 'haiku',
    };

    // Record URL pattern
    recordTriageFeedback('https://example.com/article', mockTriage, null);
    recordTriageFeedback('https://example.com/article', mockTriage, null);

    // Record command pattern
    recordTriageFeedback('Log a bug about X', mockTriage, null);
    recordTriageFeedback('Log a bug about X', mockTriage, null);

    // Should get command examples for command-like input
    const cmdExamples = getTriageExamples('Log a bug about Y');
    expect(cmdExamples.length).toBeGreaterThan(0);

    // Should get URL examples for URL input
    const urlExamples = getTriageExamples('https://other.com/page');
    expect(urlExamples.length).toBeGreaterThan(0);
  });
});

describe('recordTriageFeedback', () => {
  let recordTriageFeedback: typeof import('../triage-patterns').recordTriageFeedback;
  let getAllPatterns: typeof import('../triage-patterns').getAllPatterns;
  let clearPatterns: typeof import('../triage-patterns').clearPatterns;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const module = await import('../triage-patterns');
    recordTriageFeedback = module.recordTriageFeedback;
    getAllPatterns = module.getAllPatterns;
    clearPatterns = module.clearPatterns;

    clearPatterns();
  });

  it('should create new pattern on first feedback', () => {
    const mockTriage: TriageResult = {
      intent: 'capture',
      confidence: 0.9,
      pillar: 'The Grove',
      requestType: 'Research',
      keywords: ['test'],
      complexityTier: 1,
      source: 'haiku',
    };

    recordTriageFeedback('Test message', mockTriage, null);

    const patterns = getAllPatterns();
    expect(patterns.length).toBe(1);
    expect(patterns[0].confirmCount).toBe(1);
    expect(patterns[0].correctionCount).toBe(0);
  });

  it('should increment confirmCount on confirmation', () => {
    const mockTriage: TriageResult = {
      intent: 'capture',
      confidence: 0.9,
      pillar: 'The Grove',
      requestType: 'Research',
      keywords: [],
      complexityTier: 1,
      source: 'haiku',
    };

    recordTriageFeedback('Test message', mockTriage, null);
    recordTriageFeedback('Test message', mockTriage, null);

    const patterns = getAllPatterns();
    expect(patterns[0].confirmCount).toBe(2);
  });

  it('should increment correctionCount and update result on correction', () => {
    const mockTriage: TriageResult = {
      intent: 'capture',
      confidence: 0.9,
      pillar: 'The Grove',
      requestType: 'Research',
      keywords: [],
      complexityTier: 1,
      source: 'haiku',
    };

    recordTriageFeedback('Test message', mockTriage, null);
    recordTriageFeedback('Test message', mockTriage, { pillar: 'Consulting' });

    const patterns = getAllPatterns();
    expect(patterns[0].confirmCount).toBe(1);
    expect(patterns[0].correctionCount).toBe(1);
    expect(patterns[0].confirmedResult.pillar).toBe('Consulting');
  });

  it('should store up to 3 examples', () => {
    const mockTriage: TriageResult = {
      intent: 'capture',
      confidence: 0.9,
      pillar: 'The Grove',
      requestType: 'Research',
      keywords: [],
      complexityTier: 1,
      source: 'haiku',
    };

    // Same pattern key, different messages
    recordTriageFeedback('Log a bug about issue 1', mockTriage, null);
    recordTriageFeedback('Log a bug about problem 2', mockTriage, null);
    recordTriageFeedback('Log a bug about error 3', mockTriage, null);
    recordTriageFeedback('Log a bug about failure 4', mockTriage, null);

    const patterns = getAllPatterns();
    expect(patterns[0].examples.length).toBe(3);
    // Most recent should be first
    expect(patterns[0].examples[0]).toBe('Log a bug about failure 4');
  });
});

describe('seedPatterns', () => {
  let seedPatterns: typeof import('../triage-patterns').seedPatterns;
  let getAllPatterns: typeof import('../triage-patterns').getAllPatterns;
  let clearPatterns: typeof import('../triage-patterns').clearPatterns;

  beforeEach(async () => {
    vi.clearAllMocks();
    vi.resetModules();

    (fs.existsSync as ReturnType<typeof vi.fn>).mockReturnValue(false);

    const module = await import('../triage-patterns');
    seedPatterns = module.seedPatterns;
    getAllPatterns = module.getAllPatterns;
    clearPatterns = module.clearPatterns;

    clearPatterns();
  });

  it('should add new patterns from seed', () => {
    seedPatterns([
      {
        patternKey: 'cmd:log+bug',
        confirmedResult: {
          intent: 'command',
          pillar: 'The Grove',
          requestType: 'Build',
        },
        confirmCount: 5,
        correctionCount: 0,
        lastSeen: new Date().toISOString(),
        examples: ['Log a bug about X'],
      },
    ]);

    const patterns = getAllPatterns();
    expect(patterns.length).toBe(1);
    expect(patterns[0].confirmCount).toBe(5);
  });

  it('should not overwrite existing patterns with higher confirm counts', () => {
    // First seed with high count
    seedPatterns([
      {
        patternKey: 'cmd:log+bug',
        confirmedResult: { intent: 'command', pillar: 'The Grove', requestType: 'Build' },
        confirmCount: 10,
        correctionCount: 0,
        lastSeen: new Date().toISOString(),
        examples: ['Original example'],
      },
    ]);

    // Try to seed with lower count
    seedPatterns([
      {
        patternKey: 'cmd:log+bug',
        confirmedResult: { intent: 'command', pillar: 'Consulting', requestType: 'Build' },
        confirmCount: 5,
        correctionCount: 0,
        lastSeen: new Date().toISOString(),
        examples: ['New example'],
      },
    ]);

    const patterns = getAllPatterns();
    expect(patterns.length).toBe(1);
    expect(patterns[0].confirmCount).toBe(10);
    expect(patterns[0].confirmedResult.pillar).toBe('The Grove');
  });
});
