/**
 * Intent Hash Tests
 *
 * Run with: bun test src/skills/intent-hash.test.ts
 */

import { describe, it, expect } from 'bun:test';
import {
  generateIntentHash,
  compareIntentHashes,
  hasSameIntent,
} from './intent-hash';

describe('generateIntentHash', () => {
  it('produces consistent hash for same input', () => {
    const text = 'Add a bug to the work queue';
    const hash1 = generateIntentHash(text);
    const hash2 = generateIntentHash(text);

    expect(hash1.hash).toBe(hash2.hash);
    expect(hash1.fullHash).toBe(hash2.fullHash);
  });

  it('normalizes similar intents to same hash', () => {
    const hash1 = generateIntentHash('add bug to queue');
    const hash2 = generateIntentHash('create bug in queue');
    const hash3 = generateIntentHash('Add a new bug to the work queue please');

    // All should have "create" as intent verb (add maps to create)
    expect(hash1.intentVerb).toBe('create');
    expect(hash2.intentVerb).toBe('create');
    expect(hash3.intentVerb).toBe('create');
  });

  it('extracts entities from text', () => {
    const hash = generateIntentHash('Add item to work queue for the grove');

    expect(hash.entities).toContain('workqueue');
    expect(hash.entities).toContain('grove');
  });

  it('identifies URLs', () => {
    const hash = generateIntentHash('Check this https://example.com/article');

    expect(hash.tokens).toContain('url');
  });

  it('handles empty input', () => {
    const hash = generateIntentHash('');

    expect(hash.hash).toBe('00000000');
    expect(hash.tokens).toEqual([]);
  });

  it('maps intent verbs to canonical forms', () => {
    expect(generateIntentHash('show queue').intentVerb).toBe('query');
    expect(generateIntentHash('list items').intentVerb).toBe('query');
    expect(generateIntentHash('delete task').intentVerb).toBe('delete');
    expect(generateIntentHash('archive this').intentVerb).toBe('delete');
    expect(generateIntentHash('complete task').intentVerb).toBe('complete');
    expect(generateIntentHash('research this topic').intentVerb).toBe('research');
  });
});

describe('compareIntentHashes', () => {
  it('returns 1.0 for identical hashes', () => {
    const hash1 = generateIntentHash('add bug');
    const hash2 = generateIntentHash('add bug');

    expect(compareIntentHashes(hash1, hash2)).toBe(1.0);
  });

  it('returns high similarity for related intents', () => {
    const hash1 = generateIntentHash('add bug to queue');
    const hash2 = generateIntentHash('create bug in queue');

    const similarity = compareIntentHashes(hash1, hash2);
    expect(similarity).toBeGreaterThan(0.5);
  });

  it('returns low similarity for unrelated intents', () => {
    const hash1 = generateIntentHash('add bug to queue');
    const hash2 = generateIntentHash('show calendar events');

    const similarity = compareIntentHashes(hash1, hash2);
    expect(similarity).toBeLessThan(0.3);
  });
});

describe('hasSameIntent', () => {
  it('returns true for similar messages', () => {
    expect(hasSameIntent('add bug', 'create bug')).toBe(true);
    expect(hasSameIntent('show queue', 'list queue items')).toBe(true);
  });

  it('returns false for different messages', () => {
    expect(hasSameIntent('add bug', 'delete task')).toBe(false);
    expect(hasSameIntent('research AI', 'schedule meeting')).toBe(false);
  });
});
