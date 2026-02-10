/**
 * Adapter tests for classifyWithFallback() and triageForAudit()
 *
 * These adapters wrap triageMessage() and convert TriageResult → ClassificationResult.
 * We mock the Anthropic client to avoid real API calls — triageMessage() runs for real,
 * and the adapters are tested through their actual code paths.
 *
 * Created: 2026-02-09
 * Context: ADR-001 handler-thin-orchestrator
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// --- Mock Anthropic client BEFORE importing anything that uses it ---
const mockCreate = mock(() =>
  Promise.resolve({
    content: [
      {
        type: 'text',
        text: JSON.stringify({
          intent: 'capture',
          pillar: 'Personal',
          requestType: 'Research',
          confidence: 0.92,
          title: 'Fitness tracker comparison',
          titleRationale: 'User is researching fitness tracking options',
          keywords: ['fitness', 'tracking'],
          complexity: 'Tier 1',
          suggestedPillar: 'Personal',
        }),
      },
    ],
  }),
);

mock.module('@anthropic-ai/sdk', () => ({
  default: class Anthropic {
    messages = { create: mockCreate };
  },
}));

// Also mock logger to suppress noise
mock.module('../../src/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Now import the real adapters (triageMessage will use our mocked Anthropic)
const { classifyWithFallback, triageForAudit } = await import(
  '../../src/cognitive/triage-skill'
);

// Required fields every ClassificationResult must have
const REQUIRED_FIELDS = [
  'pillar',
  'requestType',
  'confidence',
  'workType',
  'keywords',
  'reasoning',
] as const;

describe('classifyWithFallback()', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    // Restore success response
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            intent: 'capture',
            pillar: 'Personal',
            requestType: 'Research',
            confidence: 0.92,
            title: 'Fitness tracker comparison',
            titleRationale: 'User is researching fitness tracking options',
            keywords: ['fitness', 'tracking'],
            complexity: 'Tier 1',
            suggestedPillar: 'Personal',
          }),
        },
      ],
    });
  });

  it('returns valid ClassificationResult on success', async () => {
    const result = await classifyWithFallback('Check out this fitness tracker');

    expect(result.pillar).toBe('Personal');
    expect(result.requestType).toBe('Research');
    expect(result.confidence).toBe(0.92);
    expect(result.keywords).toEqual(['fitness', 'tracking']);
    expect(result.workType).toBe('research');
    expect(result.reasoning).toBe('User is researching fitness tracking options');
  });

  it('returns safe defaults on API failure (via fallbackTriage path)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('API timeout'));

    const result = await classifyWithFallback('anything');

    // triageMessage catches internally and returns fallbackTriage() values
    // The adapter passes through the fallback result, NOT its own catch defaults
    expect(result.pillar).toBe('The Grove');
    expect(result.requestType).toBe('Quick');
    expect(result.confidence).toBe(0.3);
    expect(result.workType).toBe('quick');
    expect(result.keywords).toEqual([]);
    expect(result.reasoning).toContain('Triage: capture');
  });

  it('all returns have required ClassificationResult fields', async () => {
    const result = await classifyWithFallback('test message');

    for (const field of REQUIRED_FIELDS) {
      expect(result).toHaveProperty(field);
      expect(result[field]).toBeDefined();
    }
  });
});

describe('triageForAudit()', () => {
  beforeEach(() => {
    mockCreate.mockClear();
    // Restore success response
    mockCreate.mockResolvedValue({
      content: [
        {
          type: 'text',
          text: JSON.stringify({
            intent: 'capture',
            pillar: 'Personal',
            requestType: 'Research',
            confidence: 0.92,
            title: 'Fitness tracker comparison',
            titleRationale: 'User is researching fitness tracking options',
            keywords: ['fitness', 'tracking'],
            complexity: 'Tier 1',
            suggestedPillar: 'Personal',
          }),
        },
      ],
    });
  });

  it('returns both classification and smartTitle on success', async () => {
    const result = await triageForAudit('Check out this fitness tracker');

    expect(result.classification.pillar).toBe('Personal');
    expect(result.classification.requestType).toBe('Research');
    expect(result.classification.confidence).toBe(0.92);
    expect(result.smartTitle).toBe('Fitness tracker comparison');
  });

  it('returns safe defaults on API failure (via fallbackTriage path)', async () => {
    mockCreate.mockRejectedValueOnce(new Error('Notion down'));

    const result = await triageForAudit('anything');

    // triageMessage catches internally and returns fallbackTriage() values
    expect(result.classification.pillar).toBe('The Grove');
    expect(result.classification.requestType).toBe('Quick');
    expect(result.classification.confidence).toBe(0.3);
    expect(result.smartTitle).toBeTruthy();
  });

  it('all returns have required ClassificationResult fields', async () => {
    const result = await triageForAudit('test message');

    for (const field of REQUIRED_FIELDS) {
      expect(result.classification).toHaveProperty(field);
      expect(result.classification[field]).toBeDefined();
    }
  });
});
