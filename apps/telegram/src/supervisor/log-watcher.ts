/**
 * Atlas Supervisor - Log Watcher
 *
 * Monitors bot output for error patterns and anomalies.
 * Integrates with PatternRegistry for progressive learning.
 */

import { EventEmitter } from 'events';
import type { PatternMatch, PatternSeverity, PatternAction } from './types';
import { getPatternRegistry, type PatternRegistry } from './pattern-registry';

// ==========================================
// Log Entry Types
// ==========================================

export interface LogEntry {
  timestamp: Date;
  level: 'debug' | 'info' | 'warn' | 'error';
  source: 'stdout' | 'stderr';
  message: string;
  raw: string;
}

export interface LogStats {
  totalLines: number;
  errorCount: number;
  warnCount: number;
  requestCount: number;
  latencies: number[];  // milliseconds
  notionCalls: number;
  claudeCalls: number;
  notionErrors: number;
  claudeErrors: number;
}

// ==========================================
// Log Watcher Events
// ==========================================

export interface LogWatcherEvents {
  'entry': (entry: LogEntry) => void;
  'pattern_matched': (match: PatternMatch) => void;
  'unknown_pattern': (errorText: string, context: string) => void;
  'stats_updated': (stats: LogStats) => void;
}

// ==========================================
// Log Watcher Class
// ==========================================

export class LogWatcher extends EventEmitter {
  private registry: PatternRegistry;
  private stats: LogStats;
  private recentEntries: LogEntry[] = [];
  private maxRecentEntries: number = 100;
  private statsInterval: ReturnType<typeof setInterval> | null = null;

  constructor(registry?: PatternRegistry) {
    super();
    this.registry = registry || getPatternRegistry();
    this.stats = this.createEmptyStats();
  }

  /**
   * Create empty stats object
   */
  private createEmptyStats(): LogStats {
    return {
      totalLines: 0,
      errorCount: 0,
      warnCount: 0,
      requestCount: 0,
      latencies: [],
      notionCalls: 0,
      claudeCalls: 0,
      notionErrors: 0,
      claudeErrors: 0,
    };
  }

  /**
   * Start watching (call this after connecting to process)
   */
  start(): void {
    // Emit stats every 60 seconds
    this.statsInterval = setInterval(() => {
      this.emit('stats_updated', this.getStats());
    }, 60000);
  }

  /**
   * Stop watching
   */
  stop(): void {
    if (this.statsInterval) {
      clearInterval(this.statsInterval);
      this.statsInterval = null;
    }
  }

  /**
   * Process a line of output from the bot
   */
  async processLine(line: string, source: 'stdout' | 'stderr'): Promise<void> {
    const entry = this.parseLine(line, source);
    this.stats.totalLines++;

    // Store recent entries
    this.recentEntries.push(entry);
    if (this.recentEntries.length > this.maxRecentEntries) {
      this.recentEntries.shift();
    }

    // Update basic stats
    this.updateStats(entry);

    // Emit entry event
    this.emit('entry', entry);

    // Check for error patterns if this looks like an error
    if (entry.level === 'error' || entry.level === 'warn' || source === 'stderr') {
      await this.checkForPatterns(entry);
    }
  }

  /**
   * Parse a log line into a structured entry
   */
  private parseLine(line: string, source: 'stdout' | 'stderr'): LogEntry {
    const timestamp = new Date();

    // Try to extract log level
    let level: LogEntry['level'] = source === 'stderr' ? 'error' : 'info';

    const levelMatch = line.match(/\[(ERROR|WARN|INFO|DEBUG)\]/i);
    if (levelMatch) {
      level = levelMatch[1].toLowerCase() as LogEntry['level'];
    } else if (line.toLowerCase().includes('error')) {
      level = 'error';
    } else if (line.toLowerCase().includes('warn')) {
      level = 'warn';
    }

    return {
      timestamp,
      level,
      source,
      message: line.trim(),
      raw: line,
    };
  }

  /**
   * Update stats based on log entry
   */
  private updateStats(entry: LogEntry): void {
    // Count by level
    if (entry.level === 'error') this.stats.errorCount++;
    if (entry.level === 'warn') this.stats.warnCount++;

    // Track API calls
    if (entry.message.includes('[Notion]')) {
      this.stats.notionCalls++;
      if (entry.level === 'error') this.stats.notionErrors++;
    }

    if (entry.message.includes('[Claude]') || entry.message.includes('[Anthropic]')) {
      this.stats.claudeCalls++;
      if (entry.level === 'error') this.stats.claudeErrors++;
    }

    // Track requests (messages processed)
    if (entry.message.includes('Processing message') ||
        entry.message.includes('Received message') ||
        entry.message.includes('[Handler]')) {
      this.stats.requestCount++;
    }

    // Extract latency if present (e.g., "completed in 1234ms")
    const latencyMatch = entry.message.match(/(\d+)\s*ms/);
    if (latencyMatch) {
      const latency = parseInt(latencyMatch[1], 10);
      if (latency > 0 && latency < 300000) {  // Sanity check: < 5 minutes
        this.stats.latencies.push(latency);
        // Keep only last 1000 latencies
        if (this.stats.latencies.length > 1000) {
          this.stats.latencies.shift();
        }
      }
    }
  }

  /**
   * Check log entry against known patterns
   */
  private async checkForPatterns(entry: LogEntry): Promise<void> {
    const context = this.getRecentContext();

    // Match against known patterns
    const matches = await this.registry.matchText(entry.message, context);

    if (matches.length > 0) {
      for (const match of matches) {
        this.emit('pattern_matched', match);
      }
    } else if (entry.level === 'error') {
      // Unknown error pattern - record for learning
      const isKnown = await this.registry.isKnownPattern(entry.message);
      if (!isKnown) {
        const result = await this.registry.recordUnknownPattern(
          entry.message,
          context,
          'P1'  // Default to P1 for unknown errors
        );

        this.emit('unknown_pattern', entry.message, context);

        // If pattern has hit threshold, it's ready for proposal
        if (result.shouldPropose) {
          console.error(`[LogWatcher] Pattern ready for approval: "${entry.message.substring(0, 50)}"`);
        }
      }
    }
  }

  /**
   * Get recent log context for pattern matching
   */
  private getRecentContext(): string {
    const recent = this.recentEntries.slice(-10);
    return recent.map(e => e.message).join('\n');
  }

  /**
   * Get current stats (with computed values)
   */
  getStats(): LogStats & {
    errorRate: number;
    p50Latency: number;
    p95Latency: number;
    notionErrorRate: number;
    claudeErrorRate: number;
  } {
    const errorRate = this.stats.requestCount > 0
      ? (this.stats.errorCount / this.stats.requestCount) * 100
      : 0;

    const sortedLatencies = [...this.stats.latencies].sort((a, b) => a - b);
    const p50Latency = this.percentile(sortedLatencies, 50);
    const p95Latency = this.percentile(sortedLatencies, 95);

    const notionErrorRate = this.stats.notionCalls > 0
      ? (this.stats.notionErrors / this.stats.notionCalls) * 100
      : 0;

    const claudeErrorRate = this.stats.claudeCalls > 0
      ? (this.stats.claudeErrors / this.stats.claudeCalls) * 100
      : 0;

    return {
      ...this.stats,
      errorRate,
      p50Latency,
      p95Latency,
      notionErrorRate,
      claudeErrorRate,
    };
  }

  /**
   * Calculate percentile from sorted array
   */
  private percentile(sorted: number[], p: number): number {
    if (sorted.length === 0) return 0;
    const index = Math.ceil((p / 100) * sorted.length) - 1;
    return sorted[Math.max(0, index)];
  }

  /**
   * Get recent log entries
   */
  getRecentEntries(count: number = 20): LogEntry[] {
    return this.recentEntries.slice(-count);
  }

  /**
   * Get recent errors only
   */
  getRecentErrors(count: number = 10): LogEntry[] {
    return this.recentEntries
      .filter(e => e.level === 'error')
      .slice(-count);
  }

  /**
   * Reset stats (call at beginning of telemetry interval)
   */
  resetStats(): LogStats {
    const current = { ...this.stats };
    this.stats = this.createEmptyStats();
    return current;
  }

  /**
   * Get recent entries as context string (for crash reporting)
   */
  getContextForCrash(): string[] {
    return this.recentEntries.slice(-5).map(e =>
      `[${e.timestamp.toISOString()}] [${e.level.toUpperCase()}] ${e.message.substring(0, 200)}`
    );
  }
}

// ==========================================
// Factory Function
// ==========================================

export function createLogWatcher(registry?: PatternRegistry): LogWatcher {
  return new LogWatcher(registry);
}
