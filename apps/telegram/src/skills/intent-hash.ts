/**
 * Atlas Skill System - Intent Hashing
 *
 * Normalizes user requests into consistent hashes for pattern matching.
 * Similar intents should produce identical or similar hashes regardless
 * of exact wording.
 *
 * Algorithm:
 * 1. Normalize text (lowercase, remove punctuation, collapse whitespace)
 * 2. Extract semantic tokens (verbs, nouns, entities)
 * 3. Sort tokens alphabetically for consistency
 * 4. Hash the normalized token string
 */

import { createHash } from 'crypto';
import { logger } from '../logger';

/**
 * Stop words to remove (articles, prepositions, etc.)
 * These don't carry intent meaning
 */
const STOP_WORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
  'of', 'with', 'by', 'from', 'as', 'is', 'was', 'are', 'were', 'been',
  'be', 'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would',
  'could', 'should', 'may', 'might', 'can', 'this', 'that', 'these',
  'those', 'i', 'me', 'my', 'you', 'your', 'it', 'its', 'we', 'us',
  'our', 'they', 'them', 'their', 'what', 'which', 'who', 'whom',
  'when', 'where', 'why', 'how', 'all', 'each', 'every', 'both',
  'few', 'more', 'most', 'some', 'any', 'no', 'not', 'only', 'own',
  'same', 'so', 'than', 'too', 'very', 'just', 'also', 'now', 'here',
  'there', 'then', 'if', 'because', 'until', 'while', 'about', 'into',
  'through', 'during', 'before', 'after', 'above', 'below', 'between',
  'under', 'again', 'further', 'once', 'please', 'thanks', 'hey', 'hi',
  'hello', 'okay', 'ok', 'sure', 'yeah', 'yes', 'no', 'maybe',
]);

/**
 * Intent verbs that carry strong semantic meaning
 * Maps variations to canonical forms
 */
const INTENT_VERBS: Record<string, string> = {
  // Create operations
  'create': 'create',
  'add': 'create',
  'make': 'create',
  'new': 'create',
  'start': 'create',
  'begin': 'create',
  'init': 'create',
  'setup': 'create',

  // Read operations
  'show': 'query',
  'list': 'query',
  'get': 'query',
  'find': 'query',
  'search': 'query',
  'look': 'query',
  'check': 'query',
  'view': 'query',
  'display': 'query',
  'whats': 'query',
  'what': 'query',

  // Update operations
  'update': 'update',
  'change': 'update',
  'modify': 'update',
  'edit': 'update',
  'set': 'update',
  'move': 'update',
  'rename': 'update',

  // Delete operations
  'delete': 'delete',
  'remove': 'delete',
  'clear': 'delete',
  'dismiss': 'delete',
  'archive': 'delete',

  // Complete operations
  'complete': 'complete',
  'done': 'complete',
  'finish': 'complete',
  'close': 'complete',
  'resolve': 'complete',

  // Research operations
  'research': 'research',
  'investigate': 'research',
  'analyze': 'research',
  'study': 'research',
  'explore': 'research',
  'review': 'research',

  // Draft operations
  'write': 'draft',
  'draft': 'draft',
  'compose': 'draft',
  'author': 'draft',
  'document': 'draft',

  // Schedule operations
  'schedule': 'schedule',
  'book': 'schedule',
  'plan': 'schedule',
  'remind': 'schedule',
  'calendar': 'schedule',
};

/**
 * Entity patterns to extract and normalize
 */
const ENTITY_PATTERNS: Array<{ pattern: RegExp; canonical: string }> = [
  // Notion entities
  { pattern: /\b(feed|activity)\b/gi, canonical: 'feed' },
  { pattern: /\b(work[\s-]?queue|wq|queue|task[s]?)\b/gi, canonical: 'workqueue' },
  { pattern: /\b(notion)\b/gi, canonical: 'notion' },

  // Pillars
  { pattern: /\b(grove|ai|llm|ml)\b/gi, canonical: 'grove' },
  { pattern: /\b(personal|health|fitness|family)\b/gi, canonical: 'personal' },
  { pattern: /\b(consulting|client|drumwave|takeflight)\b/gi, canonical: 'consulting' },
  { pattern: /\b(home|garage|house|permit)\b/gi, canonical: 'home' },

  // Work types
  { pattern: /\b(bug[s]?|issue[s]?|error[s]?)\b/gi, canonical: 'bug' },
  { pattern: /\b(feature[s]?|enhancement[s]?)\b/gi, canonical: 'feature' },
  { pattern: /\b(research|investigate)\b/gi, canonical: 'research' },
  { pattern: /\b(blog|post|article)\b/gi, canonical: 'content' },

  // Time entities
  { pattern: /\b(today|now|urgent)\b/gi, canonical: 'p0' },
  { pattern: /\b(this[\s-]?week|soon)\b/gi, canonical: 'p1' },
  { pattern: /\b(this[\s-]?month|later)\b/gi, canonical: 'p2' },
  { pattern: /\b(someday|backlog|eventually)\b/gi, canonical: 'p3' },
];

/**
 * Result of intent hash generation
 */
export interface IntentHashResult {
  /** The normalized hash (8 chars) */
  hash: string;

  /** Full hash (32 chars) for uniqueness checking */
  fullHash: string;

  /** Normalized tokens used to generate hash */
  tokens: string[];

  /** Extracted canonical intent verb (if any) */
  intentVerb: string | null;

  /** Extracted entities */
  entities: string[];

  /** Original text length */
  originalLength: number;
}

/**
 * Normalize text for hashing
 * - Convert to lowercase
 * - Remove URLs (but track their presence)
 * - Remove punctuation
 * - Collapse whitespace
 */
function normalizeText(text: string): { normalized: string; hasUrl: boolean } {
  // Detect URLs before removing them
  const hasUrl = /https?:\/\/[^\s]+/i.test(text);

  return {
    normalized: text
      .toLowerCase()
      .replace(/https?:\/\/[^\s]+/gi, '') // Remove URLs
      .replace(/[^\w\s]/g, ' ')            // Remove punctuation
      .replace(/\s+/g, ' ')                // Collapse whitespace
      .trim(),
    hasUrl,
  };
}

/**
 * Extract semantic tokens from normalized text
 */
function extractTokens(normalizedText: string): {
  tokens: string[];
  intentVerb: string | null;
  entities: string[];
} {
  const words = normalizedText.split(' ').filter(w => w.length > 0);
  const tokens: string[] = [];
  const entities: string[] = [];
  let intentVerb: string | null = null;

  // First pass: extract entities using patterns
  let processedText = normalizedText;
  for (const { pattern, canonical } of ENTITY_PATTERNS) {
    if (pattern.test(processedText)) {
      entities.push(canonical);
      processedText = processedText.replace(pattern, '');
    }
    // Reset lastIndex for global patterns
    pattern.lastIndex = 0;
  }

  // Second pass: process remaining words
  for (const word of words) {
    // Skip stop words
    if (STOP_WORDS.has(word)) continue;

    // Skip very short words
    if (word.length < 2) continue;

    // Check for intent verbs
    const canonicalVerb = INTENT_VERBS[word];
    if (canonicalVerb) {
      if (!intentVerb) {
        intentVerb = canonicalVerb;
      }
      tokens.push(canonicalVerb);
      continue;
    }

    // Skip numbers alone (but keep alphanumeric)
    if (/^\d+$/.test(word)) continue;

    // Add remaining meaningful words
    tokens.push(word);
  }

  // Add entities to tokens
  tokens.push(...entities);

  // Deduplicate and sort for consistency
  const uniqueTokens = [...new Set(tokens)].sort();
  const uniqueEntities = [...new Set(entities)].sort();

  return {
    tokens: uniqueTokens,
    intentVerb,
    entities: uniqueEntities,
  };
}

/**
 * Generate MD5 hash of token string
 */
function hashTokens(tokens: string[]): { short: string; full: string } {
  const tokenString = tokens.join(':');
  const hash = createHash('md5').update(tokenString).digest('hex');

  return {
    short: hash.substring(0, 8),
    full: hash,
  };
}

/**
 * Generate an intent hash from user input
 *
 * @param text - User's message text
 * @returns Intent hash result with hash, tokens, and metadata
 *
 * @example
 * ```ts
 * const result = generateIntentHash("Add a bug to the work queue");
 * // result.hash = "a3f8b2c1"
 * // result.tokens = ["bug", "create", "workqueue"]
 * // result.intentVerb = "create"
 * ```
 */
export function generateIntentHash(text: string): IntentHashResult {
  const originalLength = text.length;

  // Handle empty/whitespace input
  if (!text || !text.trim()) {
    return {
      hash: '00000000',
      fullHash: '00000000000000000000000000000000',
      tokens: [],
      intentVerb: null,
      entities: [],
      originalLength: 0,
    };
  }

  // Normalize text
  const { normalized, hasUrl } = normalizeText(text);

  // Extract tokens
  const { tokens, intentVerb, entities } = extractTokens(normalized);

  // Add URL marker if present
  if (hasUrl) {
    tokens.push('url');
  }

  // Handle case where no meaningful tokens extracted
  if (tokens.length === 0) {
    const fallbackHash = createHash('md5').update(normalized || 'empty').digest('hex');
    return {
      hash: fallbackHash.substring(0, 8),
      fullHash: fallbackHash,
      tokens: ['_raw_' + normalized.substring(0, 20)],
      intentVerb: null,
      entities: [],
      originalLength,
    };
  }

  // Generate hash
  const { short, full } = hashTokens(tokens);

  logger.debug('Intent hash generated', {
    hash: short,
    tokens,
    intentVerb,
    entities,
    hasUrl,
  });

  return {
    hash: short,
    fullHash: full,
    tokens,
    intentVerb,
    entities,
    originalLength,
  };
}

/**
 * Compare two intent hashes for similarity
 *
 * @param hash1 - First intent hash result
 * @param hash2 - Second intent hash result
 * @returns Similarity score 0-1 (1 = identical)
 */
export function compareIntentHashes(
  hash1: IntentHashResult,
  hash2: IntentHashResult
): number {
  // Exact match
  if (hash1.hash === hash2.hash) {
    return 1.0;
  }

  // Calculate Jaccard similarity of tokens
  const set1 = new Set(hash1.tokens);
  const set2 = new Set(hash2.tokens);

  const intersection = [...set1].filter(t => set2.has(t)).length;
  const union = new Set([...set1, ...set2]).size;

  if (union === 0) return 0;

  const jaccard = intersection / union;

  // Boost if same intent verb
  if (hash1.intentVerb && hash1.intentVerb === hash2.intentVerb) {
    return Math.min(1.0, jaccard + 0.2);
  }

  return jaccard;
}

/**
 * Check if two messages have the same intent
 * (convenience function for pattern detection)
 *
 * @param text1 - First message
 * @param text2 - Second message
 * @param threshold - Similarity threshold (default 0.7)
 * @returns true if messages have similar intent
 */
export function hasSameIntent(
  text1: string,
  text2: string,
  threshold: number = 0.7
): boolean {
  const hash1 = generateIntentHash(text1);
  const hash2 = generateIntentHash(text2);
  return compareIntentHashes(hash1, hash2) >= threshold;
}
