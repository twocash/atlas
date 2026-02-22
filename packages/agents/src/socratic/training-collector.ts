/**
 * Training Data Collector — JSONL Logging for Intent Pairs
 *
 * Logs every answer → intent interpretation pair for future fine-tuning.
 * Captures both the LLM result and regex fallback for comparison analysis.
 *
 * Output format: JSONL (one JSON object per line)
 * Location: data/training/intent-pairs.jsonl
 *
 * ~1000 pairs needed for meaningful fine-tuning. At Jim's current usage
 * rate (~5-10 URL shares/day), this takes ~3-6 months to accumulate.
 */

import * as fs from 'fs';
import * as path from 'path';
import type { InterpretationResult, InterpretationContext } from './types';

// ==========================================
// Types
// ==========================================

/** A single training data entry */
export interface TrainingEntry {
  /** ISO timestamp */
  timestamp: string;
  /** The raw user answer */
  answer: string;
  /** Context at interpretation time */
  context: {
    title?: string;
    sourceType?: string;
    targetSlot?: string;
    questionText?: string;
  };
  /** Primary interpretation result */
  primary: {
    method: string;
    intent: string;
    depth: string;
    audience: string;
    confidence: number;
    reasoning: string;
    latencyMs: number;
  };
  /** Regex fallback result (for comparison) */
  regexBaseline?: {
    intent: string;
    depth: string;
    audience: string;
    confidence: number;
  };
  /** Whether Jim corrected the result (set later via feedback loop) */
  corrected?: boolean;
  /** Jim's corrected intent if different */
  correctedIntent?: string;
}

// ==========================================
// Collector
// ==========================================

/** Default output directory (relative to repo root) */
const DEFAULT_DIR = 'data/training';
const DEFAULT_FILE = 'intent-pairs.jsonl';

/**
 * Log a training entry to the JSONL file.
 *
 * Non-blocking, non-throwing — training data collection should NEVER
 * interfere with the main answer mapping flow.
 */
export function logTrainingEntry(
  answer: string,
  context: InterpretationContext,
  primaryResult: InterpretationResult,
  regexResult?: InterpretationResult,
): void {
  try {
    const entry: TrainingEntry = {
      timestamp: new Date().toISOString(),
      answer,
      context: {
        title: context.title,
        sourceType: context.sourceType,
        targetSlot: context.targetSlot,
        questionText: context.questionText,
      },
      primary: {
        method: primaryResult.method,
        intent: primaryResult.interpreted.intent,
        depth: primaryResult.interpreted.depth,
        audience: primaryResult.interpreted.audience,
        confidence: primaryResult.interpreted.confidence,
        reasoning: primaryResult.interpreted.reasoning,
        latencyMs: primaryResult.latencyMs,
      },
    };

    if (regexResult) {
      entry.regexBaseline = {
        intent: regexResult.interpreted.intent,
        depth: regexResult.interpreted.depth,
        audience: regexResult.interpreted.audience,
        confidence: regexResult.interpreted.confidence,
      };
    }

    const dir = resolveTrainingDir();
    ensureDir(dir);
    const filePath = path.join(dir, DEFAULT_FILE);

    // Append JSONL (one line per entry)
    fs.appendFileSync(filePath, JSON.stringify(entry) + '\n', 'utf-8');
  } catch (err) {
    // Log but never throw — training collection is non-critical
    console.warn('[TrainingCollector] Failed to log entry:', err instanceof Error ? err.message : err);
  }
}

/**
 * Get the count of training entries collected so far.
 */
export function getTrainingCount(): number {
  try {
    const filePath = path.join(resolveTrainingDir(), DEFAULT_FILE);
    if (!fs.existsSync(filePath)) return 0;
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').filter(line => line.trim().length > 0).length;
  } catch {
    return 0;
  }
}

/**
 * Read all training entries (for analysis/export).
 */
export function readTrainingEntries(): TrainingEntry[] {
  try {
    const filePath = path.join(resolveTrainingDir(), DEFAULT_FILE);
    if (!fs.existsSync(filePath)) return [];
    const content = fs.readFileSync(filePath, 'utf-8');
    return content
      .split('\n')
      .filter(line => line.trim().length > 0)
      .map(line => JSON.parse(line) as TrainingEntry);
  } catch (err) {
    console.warn('[TrainingCollector] Failed to read entries:', err instanceof Error ? err.message : err);
    return [];
  }
}

// ==========================================
// Helpers
// ==========================================

function resolveTrainingDir(): string {
  // Walk up from this file to find repo root (has package.json with workspaces)
  // Fallback: use cwd + data/training
  const customDir = process.env.TRAINING_DATA_DIR;
  if (customDir) return customDir;

  // Default: relative to cwd
  return path.resolve(process.cwd(), DEFAULT_DIR);
}

function ensureDir(dir: string): void {
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
}
