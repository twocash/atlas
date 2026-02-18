/**
 * Atlas Supervisor - Telemetry Aggregator
 *
 * Collects operational intelligence and promotes to Feed 2.0
 * only when something interesting happens (not every heartbeat).
 */

import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import type {
  TelemetrySnapshot,
  PromotionDecision,
  CrashContext,
  ProcessState,
} from './types';
import { getLocalStore, type JsonLocalStore } from './local-store';
import type { LogWatcher, LogStats } from './log-watcher';
import type { PatternRegistry } from './pattern-registry';

// Feed 2.0 Database ID (from @atlas/shared/config)
const FEED_DATABASE_ID = NOTION_DB.FEED;

// ==========================================
// Telemetry Aggregator Class
// ==========================================

export class TelemetryAggregator {
  private store: JsonLocalStore;
  private logWatcher: LogWatcher | null = null;
  private patternRegistry: PatternRegistry | null = null;
  private notion: Client | null = null;
  private intervalHandle: ReturnType<typeof setInterval> | null = null;
  private feedPromotionCount: number = 0;
  private lastSnapshot: TelemetrySnapshot | null = null;
  private crashContext: CrashContext | null = null;

  constructor(store?: JsonLocalStore) {
    this.store = store || getLocalStore();
  }

  /**
   * Initialize with dependencies
   */
  initialize(
    logWatcher: LogWatcher,
    patternRegistry: PatternRegistry
  ): void {
    this.logWatcher = logWatcher;
    this.patternRegistry = patternRegistry;

    // Initialize Notion client
    const apiKey = process.env.NOTION_API_KEY;
    if (apiKey) {
      this.notion = new Client({ auth: apiKey });
    }
  }

  /**
   * Start periodic telemetry collection
   */
  start(intervalMs: number = 15 * 60 * 1000): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
    }

    // Run immediately, then on interval
    this.tick();

    this.intervalHandle = setInterval(() => {
      this.tick();
    }, intervalMs);

    console.error(`[Telemetry] Started with ${intervalMs / 1000}s interval`);
  }

  /**
   * Stop telemetry collection
   */
  stop(): void {
    if (this.intervalHandle) {
      clearInterval(this.intervalHandle);
      this.intervalHandle = null;
    }
  }

  /**
   * Record a crash context (called by process manager on restart)
   */
  recordCrash(lastError: string, activeSkill: string | null): void {
    this.crashContext = {
      lastFeedEntries: [],  // Will be populated from log watcher
      lastError,
      activeSkill,
      timestamp: new Date(),
    };

    if (this.logWatcher) {
      this.crashContext.lastFeedEntries = this.logWatcher.getContextForCrash();
    }
  }

  /**
   * Clear crash context (called after successful restart)
   */
  clearCrashContext(): void {
    this.crashContext = null;
  }

  /**
   * Main telemetry tick - collect and potentially promote
   */
  private async tick(): Promise<void> {
    try {
      const snapshot = await this.collectSnapshot();
      const previous = await this.store.getLatestHeartbeat();

      // Always write locally (time series data)
      await this.store.appendHeartbeat(snapshot);

      // Check if we should promote to Feed 2.0
      const decision = this.shouldPromoteToFeed(snapshot, previous);

      if (decision.promote) {
        await this.promoteToFeed(snapshot, decision.reason, decision.severity);
        this.feedPromotionCount++;
      }

      this.lastSnapshot = snapshot;

      // Clear crash context after first successful tick
      if (this.crashContext) {
        this.clearCrashContext();
      }
    } catch (error) {
      console.error('[Telemetry] Tick failed:', error);
    }
  }

  /**
   * Collect current telemetry snapshot
   */
  private async collectSnapshot(): Promise<TelemetrySnapshot> {
    const now = new Date();
    const memUsage = process.memoryUsage();
    const stats = this.logWatcher?.getStats() || this.getEmptyStats();

    // Get pattern info
    const unknownPatterns: string[] = [];
    if (this.patternRegistry) {
      const proposals = await this.patternRegistry.getProposalsReadyForApproval();
      unknownPatterns.push(...proposals.map(p => p.pattern));
    }

    const snapshot: TelemetrySnapshot = {
      timestamp: now,
      uptime: process.uptime() * 1000,  // Convert to ms

      // Process health
      memoryUsage: memUsage.heapUsed,
      memoryUsageMb: Math.round(memUsage.heapUsed / 1024 / 1024),
      cpuPercent: 0,  // TODO: Add CPU tracking if needed

      // Request stats
      requestCount: stats.requestCount,
      errorCount: stats.errorCount,
      errorRate: stats.errorRate,

      // Latency
      p50Latency: stats.p50Latency,
      p95Latency: stats.p95Latency,

      // API health
      notionLatency: null,  // TODO: Track actual API latencies
      claudeLatency: null,
      notionErrorRate: stats.notionErrorRate,
      claudeErrorRate: stats.claudeErrorRate,

      // Pattern detection
      unknownErrorPatterns: unknownPatterns,
      unknownContentTypes: [],

      // Crash context if we just restarted
      lastCrashContext: this.crashContext || undefined,
    };

    return snapshot;
  }

  /**
   * Get empty stats (when log watcher not available)
   */
  private getEmptyStats(): LogStats & {
    errorRate: number;
    p50Latency: number;
    p95Latency: number;
    notionErrorRate: number;
    claudeErrorRate: number;
  } {
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
      errorRate: 0,
      p50Latency: 0,
      p95Latency: 0,
      notionErrorRate: 0,
      claudeErrorRate: 0,
    };
  }

  /**
   * Decide whether to promote snapshot to Feed 2.0
   */
  private shouldPromoteToFeed(
    current: TelemetrySnapshot,
    previous: TelemetrySnapshot | null
  ): PromotionDecision {
    // Always promote crash context
    if (current.lastCrashContext) {
      return {
        promote: true,
        reason: 'Process restart',
        severity: 'critical',
      };
    }

    // Always promote if new unknown patterns detected
    if (current.unknownErrorPatterns.length > 0) {
      return {
        promote: true,
        reason: 'New unknown error pattern',
        severity: 'warning',
      };
    }

    if (!previous) {
      // First snapshot - don't promote (baseline)
      return { promote: false, reason: '', severity: 'info' };
    }

    // Error rate spike (>5% increase)
    if (previous.errorRate > 0 && current.errorRate > previous.errorRate * 1.05) {
      return {
        promote: true,
        reason: 'Error rate spike',
        severity: 'warning',
      };
    }

    // Memory jump (>10% increase)
    if (previous.memoryUsage > 0 && current.memoryUsage > previous.memoryUsage * 1.10) {
      return {
        promote: true,
        reason: 'Memory jump >10%',
        severity: 'warning',
      };
    }

    // P95 latency degradation (>50% increase)
    if (previous.p95Latency > 0 && current.p95Latency > previous.p95Latency * 1.5) {
      return {
        promote: true,
        reason: 'Latency degradation',
        severity: 'warning',
      };
    }

    // Notion error rate spike
    if (previous.notionErrorRate > 0 && current.notionErrorRate > previous.notionErrorRate * 2) {
      return {
        promote: true,
        reason: 'Notion API error spike',
        severity: 'warning',
      };
    }

    return { promote: false, reason: '', severity: 'info' };
  }

  /**
   * Promote a snapshot to Feed 2.0
   */
  private async promoteToFeed(
    snapshot: TelemetrySnapshot,
    reason: string,
    severity: 'info' | 'warning' | 'critical'
  ): Promise<void> {
    if (!this.notion) {
      console.error('[Telemetry] Cannot promote - Notion client not initialized');
      return;
    }

    const title = `[Supervisor] ${reason}`;
    const statusIcon = severity === 'critical' ? '🔴' : severity === 'warning' ? '🟡' : '🟢';
    const timestamp = snapshot.timestamp.toISOString();

    // Build entry content
    const entryContent = this.buildFeedContent(snapshot, reason, severity);

    try {
      await this.notion.pages.create({
        parent: { database_id: FEED_DATABASE_ID },
        properties: {
          'Entry': {
            title: [{ text: { content: title.substring(0, 100) } }],
          },
          'Pillar': {
            select: { name: 'The Grove' },
          },
          'Source': {
            select: { name: 'Supervisor' },
          },
          'Status': {
            select: { name: severity === 'critical' ? 'Needs Attention' : 'Done' },
          },
          'Date': {
            date: { start: timestamp },
          },
        },
        children: [
          {
            object: 'block',
            type: 'heading_3',
            heading_3: {
              rich_text: [{ type: 'text', text: { content: `${statusIcon} Trigger` } }],
            },
          },
          {
            object: 'block',
            type: 'paragraph',
            paragraph: {
              rich_text: [{ type: 'text', text: { content: reason } }],
            },
          },
          {
            object: 'block',
            type: 'heading_3',
            heading_3: {
              rich_text: [{ type: 'text', text: { content: '📊 Current State' } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: `Uptime: ${this.formatUptime(snapshot.uptime)}` } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: `Memory: ${snapshot.memoryUsageMb} MB` } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: `Requests: ${snapshot.requestCount}` } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: `Errors: ${snapshot.errorCount} (${snapshot.errorRate.toFixed(1)}%)` } }],
            },
          },
          {
            object: 'block',
            type: 'bulleted_list_item',
            bulleted_list_item: {
              rich_text: [{ type: 'text', text: { content: `P95 Latency: ${snapshot.p95Latency}ms` } }],
            },
          },
          ...this.buildCrashContextBlocks(snapshot),
        ],
      });

      console.error(`[Telemetry] Promoted to Feed 2.0: ${title}`);
    } catch (error) {
      console.error('[Telemetry] Failed to promote to Feed 2.0:', error);
    }
  }

  /**
   * Build crash context blocks for Notion
   */
  private buildCrashContextBlocks(snapshot: TelemetrySnapshot): Array<any> {
    if (!snapshot.lastCrashContext) return [];

    const blocks: any[] = [
      {
        object: 'block',
        type: 'heading_3',
        heading_3: {
          rich_text: [{ type: 'text', text: { content: '💥 Crash Context' } }],
        },
      },
      {
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: `Error: ${snapshot.lastCrashContext.lastError.substring(0, 500)}` } }],
        },
      },
    ];

    if (snapshot.lastCrashContext.activeSkill) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: `Active Skill: ${snapshot.lastCrashContext.activeSkill}` } }],
        },
      });
    }

    if (snapshot.lastCrashContext.lastFeedEntries.length > 0) {
      blocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ type: 'text', text: { content: 'Recent log entries:' } }],
        },
      });

      blocks.push({
        object: 'block',
        type: 'code',
        code: {
          rich_text: [{ type: 'text', text: { content: snapshot.lastCrashContext.lastFeedEntries.join('\n') } }],
          language: 'plain text',
        },
      });
    }

    return blocks;
  }

  /**
   * Build Feed entry content
   */
  private buildFeedContent(
    snapshot: TelemetrySnapshot,
    reason: string,
    severity: 'info' | 'warning' | 'critical'
  ): string {
    const lines = [
      `## Trigger`,
      reason,
      '',
      `## Current State`,
      `- Uptime: ${this.formatUptime(snapshot.uptime)}`,
      `- Memory: ${snapshot.memoryUsageMb} MB`,
      `- Requests: ${snapshot.requestCount}`,
      `- Errors: ${snapshot.errorCount} (${snapshot.errorRate.toFixed(1)}%)`,
      `- P95 Latency: ${snapshot.p95Latency}ms`,
    ];

    if (snapshot.lastCrashContext) {
      lines.push('', '## Crash Context');
      lines.push(`Error: ${snapshot.lastCrashContext.lastError}`);
      if (snapshot.lastCrashContext.activeSkill) {
        lines.push(`Active Skill: ${snapshot.lastCrashContext.activeSkill}`);
      }
    }

    return lines.join('\n');
  }

  /**
   * Format uptime in human-readable form
   */
  private formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);

    if (hours > 0) {
      return `${hours}h ${minutes % 60}m`;
    }
    if (minutes > 0) {
      return `${minutes}m ${seconds % 60}s`;
    }
    return `${seconds}s`;
  }

  /**
   * Get aggregator status
   */
  getStatus(): {
    lastSnapshot: TelemetrySnapshot | null;
    feedPromotionCount: number;
    localHeartbeatCount: number;
  } {
    return {
      lastSnapshot: this.lastSnapshot,
      feedPromotionCount: this.feedPromotionCount,
      localHeartbeatCount: 0,  // Will be populated async
    };
  }

  /**
   * Get async status (with heartbeat count)
   */
  async getStatusAsync(): Promise<{
    lastSnapshot: TelemetrySnapshot | null;
    feedPromotionCount: number;
    localHeartbeatCount: number;
  }> {
    const heartbeatCount = await this.store.getHeartbeatCount();
    return {
      lastSnapshot: this.lastSnapshot,
      feedPromotionCount: this.feedPromotionCount,
      localHeartbeatCount: heartbeatCount,
    };
  }

  /**
   * Get recent heartbeats for trend analysis
   */
  async getRecentHeartbeats(hours: number = 3): Promise<TelemetrySnapshot[]> {
    return this.store.getRecentHeartbeats(hours);
  }

  /**
   * Force a telemetry collection (for testing/debugging)
   */
  async forceCollect(): Promise<TelemetrySnapshot> {
    await this.tick();
    return this.lastSnapshot!;
  }
}

// ==========================================
// Factory Function
// ==========================================

export function createTelemetryAggregator(store?: JsonLocalStore): TelemetryAggregator {
  return new TelemetryAggregator(store);
}
