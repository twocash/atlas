/**
 * Atlas Supervisor - Pattern Registry
 *
 * Manages error pattern detection with progressive learning.
 * Bootstrap patterns are always active; new patterns are proposed and
 * require approval before becoming active detectors.
 */

import { randomUUID } from 'crypto';
import type {
  ErrorPattern,
  PatternMatch,
  PatternSeverity,
  PatternAction,
  BOOTSTRAP_PATTERNS,
} from './types';
import { getLocalStore, type PatternStore } from './local-store';

// Re-define bootstrap patterns here to avoid circular imports
const BOOTSTRAP: Omit<ErrorPattern, 'id' | 'occurrenceCount' | 'firstSeen' | 'lastSeen' | 'contexts'>[] = [
  {
    pattern: 'ECONNREFUSED',
    severity: 'P0',
    action: 'dispatch',
    description: 'Notion API connection refused',
    approved: true,
  },
  {
    pattern: '401 Unauthorized',
    severity: 'P0',
    action: 'dispatch',
    description: 'API authentication failure',
    approved: true,
  },
  {
    pattern: 'PROMPT_STRICT_MODE',
    severity: 'P1',
    action: 'dispatch_after_threshold',
    description: 'Prompt composition error',
    approved: true,
  },
  {
    pattern: 'UnhandledPromiseRejection',
    severity: 'P1',
    action: 'dispatch_after_threshold',
    description: 'Unhandled async error',
    approved: true,
  },
  {
    pattern: 'exit code (?!0)',
    severity: 'P1',
    action: 'restart_and_dispatch',
    description: 'Process crashed with non-zero exit',
    approved: true,
  },
  {
    pattern: 'ETIMEDOUT',
    severity: 'P1',
    action: 'dispatch_after_threshold',
    description: 'Network timeout',
    approved: true,
  },
  {
    pattern: 'ENOTFOUND',
    severity: 'P1',
    action: 'dispatch_after_threshold',
    description: 'DNS resolution failure',
    approved: true,
  },
  {
    pattern: '429 Too Many Requests',
    severity: 'P1',
    action: 'log',
    description: 'Rate limit hit',
    approved: true,
  },
  {
    pattern: 'object_not_found',
    severity: 'P1',
    action: 'dispatch_after_threshold',
    description: 'Notion object not found',
    approved: true,
  },
];

// ==========================================
// Pattern Registry Class
// ==========================================

export class PatternRegistry {
  private store: PatternStore;
  private bootstrapPatterns: ErrorPattern[];
  private initialized: boolean = false;

  constructor(store?: PatternStore) {
    this.store = store || getLocalStore();
    this.bootstrapPatterns = this.initializeBootstrapPatterns();
  }

  /**
   * Initialize bootstrap patterns with full structure
   */
  private initializeBootstrapPatterns(): ErrorPattern[] {
    const now = new Date();

    return BOOTSTRAP.map((bp, index) => ({
      id: `bootstrap-${index}`,
      ...bp,
      occurrenceCount: 0,
      firstSeen: now,
      lastSeen: now,
      contexts: [],
    }));
  }

  /**
   * Ensure registry is initialized
   */
  async initialize(): Promise<void> {
    if (this.initialized) return;

    // Bootstrap patterns are always in memory
    // Custom patterns are loaded from store on demand
    this.initialized = true;
  }

  /**
   * Get all active patterns (bootstrap + approved custom)
   */
  async getActivePatterns(): Promise<ErrorPattern[]> {
    await this.initialize();

    const customPatterns = await this.store.list({ approved: true });

    return [...this.bootstrapPatterns, ...customPatterns];
  }

  /**
   * Match text against all active patterns
   */
  async matchText(text: string, fullContext: string): Promise<PatternMatch[]> {
    const patterns = await this.getActivePatterns();
    const matches: PatternMatch[] = [];

    for (const pattern of patterns) {
      try {
        const regex = new RegExp(pattern.pattern, 'i');
        const match = text.match(regex);

        if (match) {
          matches.push({
            pattern,
            matchedText: match[0],
            context: fullContext.substring(0, 500),
            timestamp: new Date(),
          });

          // Update occurrence count for custom patterns
          if (!pattern.id.startsWith('bootstrap-')) {
            await this.store.incrementCount(pattern.id);
          }
        }
      } catch (regexError) {
        // Invalid regex, try simple substring match
        if (text.toLowerCase().includes(pattern.pattern.toLowerCase())) {
          matches.push({
            pattern,
            matchedText: pattern.pattern,
            context: fullContext.substring(0, 500),
            timestamp: new Date(),
          });

          if (!pattern.id.startsWith('bootstrap-')) {
            await this.store.incrementCount(pattern.id);
          }
        }
      }
    }

    return matches;
  }

  /**
   * Check if text matches any known pattern
   */
  async isKnownPattern(text: string): Promise<boolean> {
    const matches = await this.matchText(text, text);
    return matches.length > 0;
  }

  /**
   * Record an unknown error pattern for potential promotion
   */
  async recordUnknownPattern(
    errorText: string,
    context: string,
    suggestedSeverity: PatternSeverity = 'P1'
  ): Promise<{ isNew: boolean; occurrenceCount: number; shouldPropose: boolean }> {
    // Check if this matches any existing proposed pattern
    const proposed = await this.store.listProposed();

    // Extract a pattern from the error text
    const extractedPattern = this.extractPattern(errorText);

    for (const p of proposed) {
      if (p.pattern === extractedPattern || errorText.includes(p.pattern)) {
        const newCount = await this.store.incrementCount(p.id);

        // Add context sample
        if (p.contexts.length < 5) {
          p.contexts.push(context.substring(0, 200));
          await this.store.put(p);
        }

        return {
          isNew: false,
          occurrenceCount: newCount,
          shouldPropose: newCount >= 3,
        };
      }
    }

    // Create new proposed pattern
    const newPattern: ErrorPattern = {
      id: randomUUID(),
      pattern: extractedPattern,
      severity: suggestedSeverity,
      action: 'dispatch_after_threshold',
      description: `Unknown error pattern: ${extractedPattern.substring(0, 50)}`,
      occurrenceCount: 1,
      firstSeen: new Date(),
      lastSeen: new Date(),
      approved: false,
      contexts: [context.substring(0, 200)],
    };

    await this.store.propose(newPattern);

    return {
      isNew: true,
      occurrenceCount: 1,
      shouldPropose: false,
    };
  }

  /**
   * Extract a generalizable pattern from error text
   */
  private extractPattern(errorText: string): string {
    // Try to extract the most specific part of the error
    // Remove timestamps, IDs, paths that vary

    let pattern = errorText
      // Remove timestamps
      .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/g, '')
      // Remove hex IDs
      .replace(/[a-f0-9]{32,}/gi, '<ID>')
      // Remove file paths (but keep the error type)
      .replace(/[A-Z]:\\[^\s]+/gi, '<PATH>')
      .replace(/\/[^\s]+/g, '<PATH>')
      // Remove line numbers
      .replace(/:\d+:\d+/g, '')
      // Trim and clean
      .trim()
      .substring(0, 100);

    // If we have a clear error class, use that
    const errorClassMatch = pattern.match(/([A-Z][a-z]+Error|[A-Z]+_[A-Z]+)/);
    if (errorClassMatch) {
      return errorClassMatch[1];
    }

    // Otherwise use the cleaned pattern
    return pattern || errorText.substring(0, 50);
  }

  /**
   * Get proposed patterns that have hit the threshold
   */
  async getProposalsReadyForApproval(): Promise<ErrorPattern[]> {
    const proposed = await this.store.listProposed();
    return proposed.filter(p => p.occurrenceCount >= 3);
  }

  /**
   * Approve a proposed pattern
   */
  async approvePattern(id: string): Promise<void> {
    await this.store.approve(id);
  }

  /**
   * Reject a proposed pattern
   */
  async rejectPattern(id: string): Promise<void> {
    await this.store.reject(id);
  }

  /**
   * Get pattern statistics
   */
  async getStats(): Promise<{
    activeCount: number;
    proposedCount: number;
    readyForApprovalCount: number;
  }> {
    const active = await this.getActivePatterns();
    const proposed = await this.store.listProposed();
    const ready = await this.getProposalsReadyForApproval();

    return {
      activeCount: active.length,
      proposedCount: proposed.length,
      readyForApprovalCount: ready.length,
    };
  }
}

// ==========================================
// Singleton Instance
// ==========================================

let _registry: PatternRegistry | null = null;

export function getPatternRegistry(): PatternRegistry {
  if (!_registry) {
    _registry = new PatternRegistry();
  }
  return _registry;
}

export function resetPatternRegistry(): void {
  _registry = null;
}
