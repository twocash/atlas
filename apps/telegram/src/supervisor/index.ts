/**
 * Atlas Supervisor - Main Entry Point
 *
 * Dedicated supervisor for Atlas Telegram bot that:
 * 1. Manages the bot process lifecycle
 * 2. Monitors for errors and anomalies
 * 3. Auto-dispatches issues to Pit Crew
 * 4. Feeds the learning pipeline via Feed 2.0 telemetry
 */

import { EventEmitter } from 'events';
import type {
  SupervisorConfig,
  SupervisorMode,
  SupervisorStatus,
  ProcessState,
  PatternMatch,
  PitCrewDispatch,
  DEFAULT_CONFIG,
} from './types';
import { ProcessManager, createProcessManager } from './process-manager';
import { LogWatcher, createLogWatcher } from './log-watcher';
import { PatternRegistry, getPatternRegistry } from './pattern-registry';
import { TelemetryAggregator, createTelemetryAggregator } from './telemetry-aggregator';
import {
  shouldDispatch,
  formatDispatch,
  executeDispatch,
  shouldSkipDuplicate,
} from './pit-crew-dispatch';
import { getLocalStore } from './local-store';

// Re-define default config to avoid import issues
const DEFAULT_SUPERVISOR_CONFIG: SupervisorConfig = {
  mode: 'production',
  pitCrewEnabled: true,
  errorThreshold: 3,
  telemetryIntervalMs: 15 * 60 * 1000,
  localStoragePath: './data/supervisor',
};

// ==========================================
// Supervisor Events
// ==========================================

export interface SupervisorEvents {
  'started': (pid: number) => void;
  'stopped': () => void;
  'error': (error: Error, shouldDispatch: boolean) => void;
  'pattern_matched': (match: PatternMatch) => void;
  'dispatch_sent': (dispatch: PitCrewDispatch, result: { success: boolean }) => void;
  'telemetry': (status: SupervisorStatus) => void;
  'log': (level: string, message: string) => void;
}

// ==========================================
// Supervisor Class
// ==========================================

export class Supervisor extends EventEmitter {
  private config: SupervisorConfig;
  private processManager: ProcessManager;
  private logWatcher: LogWatcher;
  private patternRegistry: PatternRegistry;
  private telemetryAggregator: TelemetryAggregator;
  private recentDispatches: Array<{ pattern: string; timestamp: Date }> = [];
  private recentPatternMatches: PatternMatch[] = [];
  private mcpExecutor: ((toolName: string, args: Record<string, unknown>) => Promise<{
    success: boolean;
    result: unknown;
    error?: string;
  }>) | null = null;
  private running: boolean = false;

  constructor(config: Partial<SupervisorConfig> = {}) {
    super();

    this.config = {
      ...DEFAULT_SUPERVISOR_CONFIG,
      ...config,
    };

    // Initialize components
    this.patternRegistry = getPatternRegistry();
    this.logWatcher = createLogWatcher(this.patternRegistry);
    this.processManager = createProcessManager(this.config);
    this.telemetryAggregator = createTelemetryAggregator(getLocalStore(this.config.localStoragePath));

    // Initialize telemetry aggregator with dependencies
    this.telemetryAggregator.initialize(this.logWatcher, this.patternRegistry);

    // Wire up event handlers
    this.setupEventHandlers();
  }

  /**
   * Set up internal event handlers
   */
  private setupEventHandlers(): void {
    // Process manager events
    this.processManager.on('started', (pid: number) => {
      this.emit('started', pid);
      this.log('info', `Bot started with PID ${pid}`);
    });

    this.processManager.on('stopped', (code: number | null) => {
      if (code !== 0) {
        this.telemetryAggregator.recordCrash(
          `Process exited with code ${code}`,
          null  // TODO: Track active skill
        );
      }
      this.emit('stopped');
    });

    this.processManager.on('error', (error: Error) => {
      this.emit('error', error, false);
    });

    this.processManager.on('stdout', (data: string) => {
      this.logWatcher.processLine(data, 'stdout');
    });

    this.processManager.on('stderr', (data: string) => {
      this.logWatcher.processLine(data, 'stderr');
    });

    this.processManager.on('log', (level: string, message: string) => {
      this.log(level, message);
    });

    // Log watcher events
    this.logWatcher.on('pattern_matched', async (match: PatternMatch) => {
      this.recentPatternMatches.push(match);
      if (this.recentPatternMatches.length > 50) {
        this.recentPatternMatches.shift();
      }

      this.emit('pattern_matched', match);
      await this.handlePatternMatch(match);
    });

    this.logWatcher.on('unknown_pattern', (errorText: string, context: string) => {
      this.log('debug', `Unknown error pattern: ${errorText.substring(0, 100)}`);
    });
  }

  /**
   * Handle a matched error pattern
   */
  private async handlePatternMatch(match: PatternMatch): Promise<void> {
    const processState = this.processManager.getState();

    // Record the error in process manager
    this.processManager.recordError(match.matchedText);

    // Check if we should dispatch
    const decision = shouldDispatch(match, processState, this.config.errorThreshold);

    if (!decision.shouldDispatch) {
      this.log('debug', `Dispatch skipped: ${decision.reason}`);
      return;
    }

    // Check for deduplication
    if (shouldSkipDuplicate(match, this.recentDispatches)) {
      this.log('debug', `Dispatch skipped: duplicate within cooldown`);
      return;
    }

    // Check if Pit Crew is enabled
    if (!this.config.pitCrewEnabled) {
      this.log('warn', `Would dispatch but Pit Crew is disabled: ${match.pattern.description}`);
      return;
    }

    // Format and send dispatch
    await this.sendDispatch(match, processState);
  }

  /**
   * Send a dispatch to Pit Crew
   */
  private async sendDispatch(match: PatternMatch, processState: ProcessState): Promise<void> {
    if (!this.mcpExecutor) {
      this.log('warn', 'MCP executor not set - cannot dispatch to Pit Crew');
      return;
    }

    const sourcePath = this.processManager.getSourcePath();
    const dispatch = formatDispatch(match, processState, sourcePath);

    this.log('info', `Dispatching to Pit Crew: ${dispatch.title}`);

    const result = await executeDispatch(dispatch, this.mcpExecutor);

    // Record dispatch for deduplication
    this.recentDispatches.push({
      pattern: match.pattern.pattern,
      timestamp: new Date(),
    });

    // Trim old dispatches
    const cutoff = Date.now() - 30 * 60 * 1000;  // 30 minutes
    this.recentDispatches = this.recentDispatches.filter(
      d => d.timestamp.getTime() > cutoff
    );

    // Record in process state
    if (result.discussionId) {
      this.processManager.recordDispatch(result.discussionId);
    }

    this.emit('dispatch_sent', dispatch, result);

    if (result.success) {
      this.log('info', `Pit Crew dispatch successful: ${result.notionUrl}`);
    } else {
      this.log('error', `Pit Crew dispatch failed: ${result.error}`);
    }
  }

  /**
   * Set the MCP executor function (for Pit Crew integration)
   */
  setMcpExecutor(executor: (toolName: string, args: Record<string, unknown>) => Promise<{
    success: boolean;
    result: unknown;
    error?: string;
  }>): void {
    this.mcpExecutor = executor;
  }

  /**
   * Start the supervisor
   */
  async start(): Promise<{ success: boolean; pid?: number; error?: string }> {
    if (this.running) {
      return { success: false, error: 'Supervisor already running' };
    }

    this.log('info', `Starting supervisor in ${this.config.mode} mode`);

    // Validate source path
    const validation = this.processManager.validateSourcePath();
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    // Initialize pattern registry
    await this.patternRegistry.initialize();

    // Start log watcher
    this.logWatcher.start();

    // Start bot process
    const result = await this.processManager.start();

    if (result.success) {
      // Start telemetry aggregator
      this.telemetryAggregator.start(this.config.telemetryIntervalMs);
      this.running = true;
    }

    return result;
  }

  /**
   * Stop the supervisor
   */
  async stop(): Promise<{ success: boolean; error?: string }> {
    if (!this.running) {
      return { success: true };
    }

    this.log('info', 'Stopping supervisor...');

    // Stop telemetry
    this.telemetryAggregator.stop();

    // Stop log watcher
    this.logWatcher.stop();

    // Stop bot process
    const result = await this.processManager.stop();

    this.running = false;

    return result;
  }

  /**
   * Restart the bot process
   */
  async restart(): Promise<{ success: boolean; pid?: number; error?: string }> {
    this.log('info', 'Restarting bot...');
    return this.processManager.restart();
  }

  /**
   * Get comprehensive supervisor status
   */
  async getStatus(): Promise<SupervisorStatus> {
    const processState = this.processManager.getState();
    const telemetryStatus = await this.telemetryAggregator.getStatusAsync();
    const patternStats = await this.patternRegistry.getStats();

    return {
      status: processState.status,
      uptime: this.processManager.getUptime(),
      processId: processState.processId,
      errorCount: processState.errorCount,
      consecutiveErrors: processState.consecutiveErrors,
      restartCount: processState.restartCount,
      lastError: processState.lastError,
      lastErrorTime: processState.lastErrorTime,
      dispatchedBugs: processState.dispatchedBugs,
      config: {
        mode: this.config.mode,
        sourcePath: this.processManager.getSourcePath(),
        pitCrewEnabled: this.config.pitCrewEnabled,
        errorThreshold: this.config.errorThreshold,
      },
      telemetry: {
        lastSnapshot: telemetryStatus.lastSnapshot,
        localHeartbeatCount: telemetryStatus.localHeartbeatCount,
        feedPromotionCount: telemetryStatus.feedPromotionCount,
      },
      patterns: {
        activeCount: patternStats.activeCount,
        proposedCount: patternStats.proposedCount,
        recentMatches: this.recentPatternMatches.slice(-10),
      },
    };
  }

  /**
   * Check if supervisor is running
   */
  isRunning(): boolean {
    return this.running;
  }

  /**
   * Check if bot process is running
   */
  isBotRunning(): boolean {
    return this.processManager.isRunning();
  }

  /**
   * Log a message
   */
  private log(level: string, message: string): void {
    console.error(`[Supervisor] [${level.toUpperCase()}] ${message}`);
    this.emit('log', level, message);
  }

  /**
   * Get the pattern registry (for manual pattern management)
   */
  getPatternRegistry(): PatternRegistry {
    return this.patternRegistry;
  }

  /**
   * Get the log watcher stats
   */
  getLogStats() {
    return this.logWatcher.getStats();
  }

  /**
   * Get recent heartbeats for trend analysis
   */
  async getRecentHeartbeats(hours: number = 3) {
    return this.telemetryAggregator.getRecentHeartbeats(hours);
  }
}

// ==========================================
// Exports
// ==========================================

export { ProcessManager, createProcessManager } from './process-manager';
export { LogWatcher, createLogWatcher } from './log-watcher';
export { PatternRegistry, getPatternRegistry } from './pattern-registry';
export { TelemetryAggregator, createTelemetryAggregator } from './telemetry-aggregator';
export { getLocalStore, JsonLocalStore, type PatternStore } from './local-store';
export * from './types';
export * from './pit-crew-dispatch';

// ==========================================
// Factory Function
// ==========================================

export function createSupervisor(config: Partial<SupervisorConfig> = {}): Supervisor {
  return new Supervisor(config);
}

// ==========================================
// Singleton Instance (for tool integration)
// ==========================================

let _supervisor: Supervisor | null = null;

export function getSupervisor(): Supervisor | null {
  return _supervisor;
}

export function setSupervisor(supervisor: Supervisor): void {
  _supervisor = supervisor;
}

export function resetSupervisor(): void {
  _supervisor = null;
}
