/**
 * Triage Skill Tests
 *
 * Tests for the unified Haiku triage skill.
 * Uses mocked Anthropic API calls.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { TriageResult } from '../triage-skill';

// Mock the Anthropic SDK
vi.mock('@anthropic-ai/sdk', () => {
  return {
    default: vi.fn().mockImplementation(() => ({
      messages: {
        create: vi.fn(),
      },
    })),
  };
});

// Mock the logger
vi.mock('../../logger', () => ({
  logger: {
    debug: vi.fn(),
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
  },
}));

describe('triageMessage', () => {
  let mockCreate: ReturnType<typeof vi.fn>;
  let triageMessage: typeof import('../triage-skill').triageMessage;

  beforeEach(async () => {
    vi.clearAllMocks();

    // Get fresh module with mocks
    const Anthropic = (await import('@anthropic-ai/sdk')).default;
    mockCreate = vi.fn();
    (Anthropic as unknown as ReturnType<typeof vi.fn>).mockImplementation(() => ({
      messages: { create: mockCreate },
    }));

    // Re-import to get fresh instance
    vi.resetModules();
    const module = await import('../triage-skill');
    triageMessage = module.triageMessage;
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('should detect meta-request command: "Log a bug about the login page crashing"', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          intent: 'command',
          confidence: 0.95,
          command: {
            verb: 'log',
            target: 'bug',
            description: 'login page crashing',
          },
          pillar: 'The Grove',
          requestType: 'Build',
          keywords: ['bug', 'login', 'crash'],
          complexityTier: 1,
        }),
      }],
    });

    const result = await triageMessage('Log a bug about the login page crashing');

    expect(result.intent).toBe('command');
    expect(result.command?.verb).toBe('log');
    expect(result.command?.target).toBe('bug');
    expect(result.command?.description).toBe('login page crashing');
    expect(result.source).toBe('haiku');
  });

  it('should detect URL share as capture intent', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          intent: 'capture',
          confidence: 0.88,
          title: 'AI Research: Novel Attention Mechanisms',
          titleRationale: 'Extracted from article heading',
          pillar: 'The Grove',
          requestType: 'Research',
          keywords: ['ai', 'research', 'attention'],
          complexityTier: 1,
        }),
      }],
    });

    const result = await triageMessage('https://arxiv.org/abs/2401.12345');

    expect(result.intent).toBe('capture');
    expect(result.title).toBeDefined();
    expect(result.title).not.toContain('arxiv.org');
    expect(result.source).toBe('haiku');
  });

  it('should detect query intent: "What\'s in my feed?"', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          intent: 'query',
          confidence: 0.92,
          pillar: 'The Grove',
          requestType: 'Quick',
          keywords: ['feed', 'status'],
          complexityTier: 1,
        }),
      }],
    });

    const result = await triageMessage("What's in my feed?");

    expect(result.intent).toBe('query');
    expect(result.title).toBeUndefined();
  });

  it('should detect command with priority: "Create a P0 for the API timeout issue"', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          intent: 'command',
          confidence: 0.96,
          command: {
            verb: 'create',
            target: 'task',
            priority: 'P0',
            description: 'API timeout issue',
          },
          pillar: 'The Grove',
          requestType: 'Build',
          keywords: ['p0', 'api', 'timeout'],
          complexityTier: 1,
        }),
      }],
    });

    const result = await triageMessage('Create a P0 for the API timeout issue');

    expect(result.intent).toBe('command');
    expect(result.command?.priority).toBe('P0');
    expect(result.command?.description).toBe('API timeout issue');
  });

  it('should detect ambiguous input as clarify intent', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          intent: 'clarify',
          confidence: 0.4,
          pillar: 'The Grove',
          requestType: 'Quick',
          keywords: [],
          complexityTier: 1,
        }),
      }],
    });

    const result = await triageMessage('hmm');

    expect(result.intent).toBe('clarify');
    expect(result.confidence).toBeLessThan(0.5);
  });

  it('should return fallback on API failure', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API unavailable'));

    const result = await triageMessage('Test message');

    expect(result.intent).toBe('capture');
    expect(result.confidence).toBe(0.3);
    expect(result.source).toBe('pattern_cache');
    expect(result.suggestedModel).toContain('fallback');
  });

  it('should truncate long titles to 60 characters', async () => {
    const longTitle = 'This is a very long title that exceeds sixty characters and should be truncated';
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          intent: 'capture',
          confidence: 0.85,
          title: longTitle,
          pillar: 'The Grove',
          requestType: 'Research',
          keywords: [],
          complexityTier: 1,
        }),
      }],
    });

    const result = await triageMessage('Some article');

    expect(result.title).toBeDefined();
    expect(result.title!.length).toBeLessThanOrEqual(60);
    expect(result.title!.endsWith('...')).toBe(true);
  });

  it('should handle markdown-fenced JSON response', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: '```json\n{"intent":"capture","confidence":0.9,"pillar":"The Grove","requestType":"Quick","keywords":[],"complexityTier":1}\n```',
      }],
    });

    const result = await triageMessage('Test with fences');

    expect(result.intent).toBe('capture');
    expect(result.source).toBe('haiku');
  });

  it('should validate and normalize pillar values', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          intent: 'capture',
          confidence: 0.8,
          pillar: 'grove', // lowercase, should normalize
          requestType: 'Quick',
          keywords: [],
          complexityTier: 1,
        }),
      }],
    });

    const result = await triageMessage('Test normalization');

    expect(result.pillar).toBe('The Grove');
  });

  it('should validate and normalize requestType values', async () => {
    mockCreate.mockResolvedValueOnce({
      content: [{
        type: 'text',
        text: JSON.stringify({
          intent: 'capture',
          confidence: 0.8,
          pillar: 'Personal',
          requestType: 'code', // should map to Build
          keywords: [],
          complexityTier: 1,
        }),
      }],
    });

    const result = await triageMessage('Test normalization');

    expect(result.requestType).toBe('Build');
  });
});

describe('createCachedTriageResult', () => {
  it('should create result with default values', async () => {
    const { createCachedTriageResult } = await import('../triage-skill');

    const result = createCachedTriageResult({
      intent: 'capture',
      pillar: 'Personal',
    });

    expect(result.intent).toBe('capture');
    expect(result.pillar).toBe('Personal');
    expect(result.complexityTier).toBe(0); // Cache hit = Tier 0
    expect(result.source).toBe('pattern_cache');
    expect(result.requestType).toBe('Quick'); // Default
  });
});
