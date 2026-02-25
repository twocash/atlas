/**
 * Cognitive Router - Token Ledger
 *
 * Tracks all token spend and costs for budget management.
 * In-memory tracking with periodic Notion persistence.
 */

import type { TokenUsage, WorkerResult, TokenLedgerEntry } from "./types";
import type { Provider } from "./models";
import { logger } from "../logger";

/**
 * Session token stats
 */
interface SessionStats {
  totalInputTokens: number;
  totalOutputTokens: number;
  totalCost: number;
  requestCount: number;
  byModel: Record<string, { tokens: number; cost: number; count: number }>;
  byProvider: Record<Provider, { tokens: number; cost: number; count: number }>;
}

/**
 * In-memory ledger for current session
 */
class TokenLedger {
  private entries: TokenLedgerEntry[] = [];
  private sessionStart: Date = new Date();
  private stats: SessionStats = this.initStats();

  private initStats(): SessionStats {
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalCost: 0,
      requestCount: 0,
      byModel: {},
      byProvider: {
        anthropic: { tokens: 0, cost: 0, count: 0 },
        openai: { tokens: 0, cost: 0, count: 0 },
        openrouter: { tokens: 0, cost: 0, count: 0 },
        local: { tokens: 0, cost: 0, count: 0 },
      },
    };
  }

  /**
   * Record a worker result in the ledger
   */
  record(result: WorkerResult): TokenLedgerEntry {
    const entry: TokenLedgerEntry = {
      taskId: result.taskId,
      model: result.modelId,
      provider: result.provider,
      endpoint: result.endpoint,
      inputTokens: result.usage.inputTokens,
      outputTokens: result.usage.outputTokens,
      costUsd: result.usage.cost,
      latencyMs: result.latencyMs,
      success: result.success,
      timestamp: new Date(),
    };

    this.entries.push(entry);
    this.updateStats(entry);

    logger.debug("Token ledger entry recorded", {
      taskId: entry.taskId,
      model: entry.model,
      cost: entry.costUsd.toFixed(6),
    });

    return entry;
  }

  /**
   * Update session stats
   */
  private updateStats(entry: TokenLedgerEntry): void {
    this.stats.totalInputTokens += entry.inputTokens;
    this.stats.totalOutputTokens += entry.outputTokens;
    this.stats.totalCost += entry.costUsd;
    this.stats.requestCount += 1;

    // Update by model
    if (!this.stats.byModel[entry.model]) {
      this.stats.byModel[entry.model] = { tokens: 0, cost: 0, count: 0 };
    }
    this.stats.byModel[entry.model].tokens += entry.inputTokens + entry.outputTokens;
    this.stats.byModel[entry.model].cost += entry.costUsd;
    this.stats.byModel[entry.model].count += 1;

    // Update by provider
    this.stats.byProvider[entry.provider].tokens += entry.inputTokens + entry.outputTokens;
    this.stats.byProvider[entry.provider].cost += entry.costUsd;
    this.stats.byProvider[entry.provider].count += 1;
  }

  /**
   * Get current session stats
   */
  getStats(): SessionStats {
    return { ...this.stats };
  }

  /**
   * Get all entries (for persistence)
   */
  getEntries(): TokenLedgerEntry[] {
    return [...this.entries];
  }

  /**
   * Get entries since last flush
   */
  getUnflushedEntries(lastFlushTime: Date): TokenLedgerEntry[] {
    return this.entries.filter((e) => e.timestamp > lastFlushTime);
  }

  /**
   * Get session duration in minutes
   */
  getSessionDuration(): number {
    return (Date.now() - this.sessionStart.getTime()) / 1000 / 60;
  }

  /**
   * Reset the ledger (for new session)
   */
  reset(): void {
    this.entries = [];
    this.sessionStart = new Date();
    this.stats = this.initStats();
    logger.info("Token ledger reset");
  }

  /**
   * Get summary for display
   */
  getSummary(): string {
    const duration = this.getSessionDuration().toFixed(1);
    const costStr = this.stats.totalCost > 0
      ? `$${this.stats.totalCost.toFixed(4)}`
      : "$0.00";

    const lines = [
      `Session: ${duration} min | ${this.stats.requestCount} requests | ${costStr}`,
      `Tokens: ${this.stats.totalInputTokens.toLocaleString()} in / ${this.stats.totalOutputTokens.toLocaleString()} out`,
    ];

    // Add top models
    const topModels = Object.entries(this.stats.byModel)
      .sort(([, a], [, b]) => b.cost - a.cost)
      .slice(0, 3);

    if (topModels.length > 0) {
      lines.push("Top models:");
      for (const [model, stats] of topModels) {
        lines.push(`  ${model}: ${stats.count}x, $${stats.cost.toFixed(4)}`);
      }
    }

    return lines.join("\n");
  }
}

// Singleton instance
let _ledger: TokenLedger | null = null;

/**
 * Get the token ledger instance
 */
export function getLedger(): TokenLedger {
  if (!_ledger) {
    _ledger = new TokenLedger();
  }
  return _ledger;
}

/**
 * Record a worker result
 */
export function recordTokens(result: WorkerResult): TokenLedgerEntry {
  return getLedger().record(result);
}

/**
 * Get session stats
 */
export function getSessionStats(): SessionStats {
  return getLedger().getStats();
}

/**
 * Get session summary
 */
export function getSessionSummary(): string {
  return getLedger().getSummary();
}

/**
 * Check if cost threshold is exceeded
 */
export function isOverBudget(threshold: number): boolean {
  return getLedger().getStats().totalCost > threshold;
}

/**
 * Get estimated remaining budget
 */
export function getRemainingBudget(budget: number): number {
  return Math.max(0, budget - getLedger().getStats().totalCost);
}

/**
 * Reset the ledger
 */
export function resetLedger(): void {
  getLedger().reset();
}

/**
 * Aggregate usage from multiple results
 */
export function aggregateUsage(results: WorkerResult[]): TokenUsage {
  return results.reduce(
    (acc, r) => ({
      inputTokens: acc.inputTokens + r.usage.inputTokens,
      outputTokens: acc.outputTokens + r.usage.outputTokens,
      totalTokens: acc.totalTokens + r.usage.totalTokens,
      cost: acc.cost + r.usage.cost,
    }),
    { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 }
  );
}
