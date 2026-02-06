/**
 * Atlas Triage Pattern Cache + Feedback Loop
 *
 * High-confidence patterns bypass Haiku entirely. Corrections feed back
 * into triage accuracy. Patterns persist to disk and reload on startup.
 *
 * Sprint: Triage Intelligence
 * Philosophy: Principle 2 (Decisions Become Defaults)
 */

import { readFileSync, writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import { logger } from '../logger';
import { createCachedTriageResult, type TriageResult } from './triage-skill';
import type { Pillar, RequestType } from '../conversation/types';

// ==========================================
// Constants
// ==========================================

const PATTERN_FILE = join(process.cwd(), 'data', 'triage-patterns.json');

/**
 * Minimum confirmations needed to auto-cache a pattern.
 * Below this threshold, Haiku is always called.
 */
const MIN_CONFIRMATIONS = 5;

/**
 * Maximum correction ratio allowed for auto-caching.
 * If correctionCount / confirmCount > this, pattern isn't trusted.
 */
const MAX_CORRECTION_RATIO = 0.1;

/**
 * Debounce delay for saving patterns (ms).
 */
const SAVE_DEBOUNCE_MS = 5000;

// ==========================================
// Types
// ==========================================

export interface TriagePattern {
  /** Pattern key: hash of normalized message characteristics */
  patternKey: string;

  /** The triage result that was confirmed or corrected */
  confirmedResult: Partial<TriageResult>;

  /** Times this pattern was confirmed as-is */
  confirmCount: number;

  /** Times this pattern was corrected */
  correctionCount: number;

  /** ISO timestamp of last occurrence */
  lastSeen: string;

  /** Up to 3 example messages (for few-shot injection) */
  examples: string[];
}

interface PatternStore {
  version: number;
  patterns: Record<string, TriagePattern>;
  lastUpdated: string;
}

// ==========================================
// State
// ==========================================

let _store: PatternStore | null = null;
let _saveTimeout: NodeJS.Timeout | null = null;

// ==========================================
// Pattern Key Generation
// ==========================================

/**
 * Generate a pattern key from a message.
 *
 * For URLs: Normalize to domain + path structure
 * For commands: Extract verb + target pattern
 * For freeform: Extract first significant words
 */
export function generatePatternKey(messageText: string): string {
  const trimmed = messageText.trim().toLowerCase();

  // Check for URL
  const urlMatch = trimmed.match(/https?:\/\/([^\/]+)(\/[^\s]*)?/);
  if (urlMatch) {
    const domain = urlMatch[1];
    const path = urlMatch[2] || '/';

    // Normalize path: replace IDs/hashes with wildcards
    const normalizedPath = path
      .replace(/\/[a-f0-9]{8,}/gi, '/*')  // hex IDs
      .replace(/\/\d+/g, '/*')            // numeric IDs
      .replace(/\/[^\/]+\.[a-z]+$/i, '/*')  // file extensions
      .replace(/\?.*$/, '');              // query strings

    return `url:${domain}${normalizedPath}`;
  }

  // Check for command patterns
  const commandVerbs = ['log', 'create', 'update', 'change', 'dispatch', 'add', 'remove', 'delete'];
  const commandTargets = ['bug', 'task', 'feature', 'item', 'ticket', 'issue', 'p0', 'p1', 'p2', 'p3'];

  for (const verb of commandVerbs) {
    if (trimmed.startsWith(verb) || trimmed.includes(` ${verb} `)) {
      for (const target of commandTargets) {
        if (trimmed.includes(target)) {
          return `cmd:${verb}+${target}`;
        }
      }
      // Verb found but no known target
      return `cmd:${verb}+other`;
    }
  }

  // Check for query patterns
  const queryStarters = ['what', 'how', 'where', 'when', 'why', 'status', 'show', 'list'];
  for (const starter of queryStarters) {
    if (trimmed.startsWith(starter)) {
      return `query:${starter}`;
    }
  }

  // Freeform: extract first 3 significant words
  const words = trimmed
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter(w => w.length > 3)
    .slice(0, 3);

  if (words.length > 0) {
    return `text:${words.join('+')}`;
  }

  return `text:short`;
}

// ==========================================
// Store Management
// ==========================================

function loadStore(): PatternStore {
  if (_store) return _store;

  if (existsSync(PATTERN_FILE)) {
    try {
      const data = readFileSync(PATTERN_FILE, 'utf-8');
      _store = JSON.parse(data) as PatternStore;
      logger.info('[TriagePatterns] Loaded pattern store', {
        patternCount: Object.keys(_store.patterns).length,
      });
    } catch (error) {
      logger.warn('[TriagePatterns] Failed to load pattern store, starting fresh', { error });
      _store = createEmptyStore();
    }
  } else {
    logger.info('[TriagePatterns] No pattern file found, starting fresh');
    _store = createEmptyStore();
  }

  return _store;
}

function createEmptyStore(): PatternStore {
  return {
    version: 1,
    patterns: {},
    lastUpdated: new Date().toISOString(),
  };
}

function saveStore(): void {
  if (!_store) return;

  _store.lastUpdated = new Date().toISOString();

  try {
    writeFileSync(PATTERN_FILE, JSON.stringify(_store, null, 2), 'utf-8');
    logger.debug('[TriagePatterns] Saved pattern store');
  } catch (error) {
    logger.error('[TriagePatterns] Failed to save pattern store', { error });
  }
}

function debouncedSave(): void {
  if (_saveTimeout) {
    clearTimeout(_saveTimeout);
  }
  _saveTimeout = setTimeout(saveStore, SAVE_DEBOUNCE_MS);
}

// ==========================================
// Pattern Cache Operations
// ==========================================

/**
 * Check if a message matches a known high-confidence pattern.
 * Returns cached TriageResult if confidence threshold met.
 *
 * Threshold:
 * - confirmCount >= 5 AND correctionCount === 0
 * - OR: confirmCount >= 10 AND correctionCount / confirmCount < 0.1
 */
export function getCachedTriage(messageText: string): TriageResult | null {
  const store = loadStore();
  const patternKey = generatePatternKey(messageText);

  const pattern = store.patterns[patternKey];
  if (!pattern) {
    return null;
  }

  // Check confidence threshold
  const meetsThreshold =
    (pattern.confirmCount >= MIN_CONFIRMATIONS && pattern.correctionCount === 0) ||
    (pattern.confirmCount >= 10 && pattern.correctionCount / pattern.confirmCount < MAX_CORRECTION_RATIO);

  if (!meetsThreshold) {
    logger.debug('[TriagePatterns] Pattern exists but below threshold', {
      patternKey,
      confirmCount: pattern.confirmCount,
      correctionCount: pattern.correctionCount,
    });
    return null;
  }

  logger.info('[TriagePatterns] Cache hit', {
    patternKey,
    confirmCount: pattern.confirmCount,
  });

  return createCachedTriageResult(pattern.confirmedResult);
}

/**
 * Get relevant few-shot examples for the Haiku prompt.
 * Returns up to 3 confirmed examples similar to the current message.
 */
export function getTriageExamples(messageText: string, limit: number = 3): string[] {
  const store = loadStore();
  const patternKey = generatePatternKey(messageText);

  // Look for patterns with similar keys
  const keyPrefix = patternKey.split(':')[0]; // 'url', 'cmd', 'query', 'text'

  const relevantPatterns = Object.values(store.patterns)
    .filter(p => p.patternKey.startsWith(keyPrefix) && p.confirmCount >= 2)
    .sort((a, b) => b.confirmCount - a.confirmCount)
    .slice(0, limit);

  const examples: string[] = [];
  for (const pattern of relevantPatterns) {
    if (pattern.examples.length > 0) {
      examples.push(pattern.examples[0]);
    }
  }

  return examples;
}

/**
 * Record a triage result confirmation or correction.
 * Called after user interacts with content confirmation keyboard
 * or after a command executes successfully without correction.
 *
 * @param originalTriage - What Haiku (or cache) returned
 * @param correctedFields - What the user changed (null if confirmed as-is)
 */
export function recordTriageFeedback(
  messageText: string,
  originalTriage: TriageResult,
  correctedFields: Partial<TriageResult> | null
): void {
  const store = loadStore();
  const patternKey = generatePatternKey(messageText);

  let pattern = store.patterns[patternKey];

  if (!pattern) {
    // Create new pattern
    pattern = {
      patternKey,
      confirmedResult: {
        intent: originalTriage.intent,
        pillar: originalTriage.pillar,
        requestType: originalTriage.requestType,
        title: originalTriage.title,
        keywords: originalTriage.keywords,
      },
      confirmCount: 0,
      correctionCount: 0,
      lastSeen: new Date().toISOString(),
      examples: [],
    };
    store.patterns[patternKey] = pattern;
  }

  // Update pattern
  pattern.lastSeen = new Date().toISOString();

  if (correctedFields) {
    // User corrected something
    pattern.correctionCount++;

    // Update confirmed result with corrections
    if (correctedFields.pillar) {
      pattern.confirmedResult.pillar = correctedFields.pillar;
    }
    if (correctedFields.requestType) {
      pattern.confirmedResult.requestType = correctedFields.requestType;
    }
    if (correctedFields.title) {
      pattern.confirmedResult.title = correctedFields.title;
    }
    if (correctedFields.intent) {
      pattern.confirmedResult.intent = correctedFields.intent;
    }

    logger.info('[TriagePatterns] Recorded correction', {
      patternKey,
      correctedFields: Object.keys(correctedFields),
    });
  } else {
    // User confirmed as-is
    pattern.confirmCount++;

    logger.debug('[TriagePatterns] Recorded confirmation', {
      patternKey,
      confirmCount: pattern.confirmCount,
    });
  }

  // Update examples (keep most recent 3)
  if (!pattern.examples.includes(messageText)) {
    pattern.examples.unshift(messageText);
    if (pattern.examples.length > 3) {
      pattern.examples.pop();
    }
  }

  debouncedSave();
}

// ==========================================
// Utilities
// ==========================================

/**
 * Get all patterns (for debugging/admin).
 */
export function getAllPatterns(): TriagePattern[] {
  const store = loadStore();
  return Object.values(store.patterns);
}

/**
 * Get pattern count.
 */
export function getPatternCount(): number {
  const store = loadStore();
  return Object.keys(store.patterns).length;
}

/**
 * Clear all patterns (for testing).
 */
export function clearPatterns(): void {
  _store = createEmptyStore();
  saveStore();
  logger.info('[TriagePatterns] Cleared all patterns');
}

/**
 * Force save (for graceful shutdown).
 */
export function flushPatterns(): void {
  if (_saveTimeout) {
    clearTimeout(_saveTimeout);
    _saveTimeout = null;
  }
  saveStore();
}

/**
 * Seed patterns from external source (for bootstrap script).
 */
export function seedPatterns(patterns: TriagePattern[]): void {
  const store = loadStore();

  for (const pattern of patterns) {
    // Don't overwrite existing patterns with higher confirm counts
    const existing = store.patterns[pattern.patternKey];
    if (existing && existing.confirmCount >= pattern.confirmCount) {
      continue;
    }

    store.patterns[pattern.patternKey] = pattern;
  }

  saveStore();
  logger.info('[TriagePatterns] Seeded patterns', {
    totalPatterns: Object.keys(store.patterns).length,
    newPatterns: patterns.length,
  });
}
