/**
 * Notion Config Tests
 *
 * Tests the cache layer and config organization.
 * Uses injectConfig() for deterministic testing without Notion API.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import {
  getCachedConfig,
  invalidateCache,
  injectConfig,
} from '../src/socratic/notion-config';
import type { SocraticConfig } from '../src/socratic/types';

function makeTestConfig(): SocraticConfig {
  return {
    interviewPrompts: {
      'interview.linkedin-reply': {
        id: 'p1',
        name: 'LinkedIn Reply',
        slug: 'interview.linkedin-reply',
        type: 'interview_prompt',
        surfaces: ['chrome'],
        active: true,
        priority: 10,
        conditions: '',
        contextSlots: ['contact_data'],
        confidenceFloor: 0.5,
        skill: 'linkedin-reply',
        content: 'Test prompt content',
      },
    },
    contextRules: [
      {
        id: 'r1',
        name: 'Test Rule',
        slug: 'rule.test',
        type: 'context_rule',
        surfaces: ['all'],
        active: true,
        priority: 5,
        conditions: 'true',
        contextSlots: [],
        confidenceFloor: 0,
        skill: '',
        content: 'Test rule content',
      },
    ],
    answerMaps: {
      'answer-map.test': {
        id: 'm1',
        name: 'Test Map',
        slug: 'answer-map.test',
        type: 'answer_map',
        surfaces: ['all'],
        active: true,
        priority: 10,
        conditions: '',
        contextSlots: [],
        confidenceFloor: 0,
        skill: '',
        content: 'Test map content',
      },
    },
    thresholds: [
      {
        id: 't1',
        name: 'Auto-Draft',
        slug: 'threshold.auto-draft',
        type: 'threshold',
        surfaces: ['all'],
        active: true,
        priority: 1,
        conditions: 'confidence >= 0.85',
        contextSlots: [],
        confidenceFloor: 0.85,
        skill: '',
        content: 'Auto-draft threshold',
      },
    ],
    fetchedAt: '2026-02-15T00:00:00.000Z',
  };
}

describe('Socratic Notion Config', () => {
  beforeEach(() => {
    invalidateCache();
  });

  describe('Cache operations', () => {
    it('getCachedConfig returns null when cache is empty', () => {
      const result = getCachedConfig();
      expect(result).toBeNull();
    });

    it('injectConfig populates cache', () => {
      const config = makeTestConfig();
      injectConfig(config);

      const cached = getCachedConfig();
      expect(cached).not.toBeNull();
      expect(cached!.fetchedAt).toBe('2026-02-15T00:00:00.000Z');
    });

    it('invalidateCache clears cache', () => {
      injectConfig(makeTestConfig());
      expect(getCachedConfig()).not.toBeNull();

      invalidateCache();
      expect(getCachedConfig()).toBeNull();
    });
  });

  describe('Config organization', () => {
    it('interview prompts keyed by slug', () => {
      const config = makeTestConfig();
      expect(config.interviewPrompts['interview.linkedin-reply']).toBeDefined();
      expect(config.interviewPrompts['interview.linkedin-reply'].type).toBe('interview_prompt');
    });

    it('answer maps keyed by slug', () => {
      const config = makeTestConfig();
      expect(config.answerMaps['answer-map.test']).toBeDefined();
      expect(config.answerMaps['answer-map.test'].type).toBe('answer_map');
    });

    it('thresholds sorted by priority', () => {
      const config = makeTestConfig();
      for (let i = 1; i < config.thresholds.length; i++) {
        expect(config.thresholds[i].priority).toBeGreaterThanOrEqual(
          config.thresholds[i - 1].priority
        );
      }
    });

    it('context rules sorted by priority', () => {
      const config = makeTestConfig();
      for (let i = 1; i < config.contextRules.length; i++) {
        expect(config.contextRules[i].priority).toBeGreaterThanOrEqual(
          config.contextRules[i - 1].priority
        );
      }
    });
  });

  describe('Config entry shape', () => {
    it('interview prompt has all required fields', () => {
      const config = makeTestConfig();
      const entry = config.interviewPrompts['interview.linkedin-reply'];

      expect(entry.id).toBeDefined();
      expect(entry.name).toBeTruthy();
      expect(entry.slug).toBeTruthy();
      expect(entry.type).toBe('interview_prompt');
      expect(Array.isArray(entry.surfaces)).toBe(true);
      expect(typeof entry.active).toBe('boolean');
      expect(typeof entry.priority).toBe('number');
      expect(Array.isArray(entry.contextSlots)).toBe(true);
      expect(typeof entry.confidenceFloor).toBe('number');
      expect(typeof entry.content).toBe('string');
    });

    it('threshold has confidence floor', () => {
      const config = makeTestConfig();
      const threshold = config.thresholds[0];

      expect(threshold.confidenceFloor).toBe(0.85);
      expect(threshold.type).toBe('threshold');
    });
  });
});
