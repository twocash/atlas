/**
 * Atlas Supervisor - Type Definitions
 *
 * Types for process management, telemetry, and pattern detection.
 */

// ==========================================
// Configuration Types
// ==========================================

export type SupervisorMode = 'production' | 'dev';

export interface SupervisorConfig {
  mode: SupervisorMode;
  devPath?: string;
  pitCrewEnabled: boolean;
  errorThreshold: number;
  telemetryIntervalMs: number;
  localStoragePath: string;
}

export const DEFAULT_CONFIG: SupervisorConfig = {
  mode: 'production',
  pitCrewEnabled: true,
  errorThreshold: 3,
  telemetryIntervalMs: 15 * 60 * 1000, // 15 minutes
  localStoragePath: './data/supervisor',
};

// ==========================================
// Process State Types
// ==========================================

export interface ProcessState {
  processId: number | null;
  startTime: Date | null;
  restartCount: number;
  errorCount: number;
  consecutiveErrors: number;
  lastError: string | null;
  lastErrorTime: Date | null;
  lastSuccessTime: Date | null;
  dispatchedBugs: string[];
  status: 'stopped' | 'starting' | 'running' | 'error' | 'stopping';
}

export const INITIAL_PROCESS_STATE: ProcessState = {
  processId: null,
  startTime: null,
  restartCount: 0,
  errorCount: 0,
  consecutiveErrors: 0,
  lastError: null,
  lastErrorTime: null,
  lastSuccessTime: null,
  dispatchedBugs: [],
  status: 'stopped',
};

// ==========================================
// Error Pattern Types
// ==========================================

export type PatternSeverity = 'P0' | 'P1' | 'P2';
export type PatternAction = 'dispatch' | 'dispatch_after_threshold' | 'restart_and_dispatch' | 'log';

export interface ErrorPattern {
  id: string;
  pattern: string;           // Regex pattern or substring
  severity: PatternSeverity;
  action: PatternAction;
  description: string;
  occurrenceCount: number;
  firstSeen: Date;
  lastSeen: Date;
  approved: boolean;         // Human-approved for active detection
  contexts: string[];        // Sample error contexts (max 5)
}

export interface PatternMatch {
  pattern: ErrorPattern;
  matchedText: string;
  context: string;
  timestamp: Date;
}

// Bootstrap patterns (these are always active)
export const BOOTSTRAP_PATTERNS: Omit<ErrorPattern, 'id' | 'occurrenceCount' | 'firstSeen' | 'lastSeen' | 'contexts'>[] = [
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
// Telemetry Types
// ==========================================

export interface TelemetrySnapshot {
  timestamp: Date;
  uptime: number;  // milliseconds

  // Process health
  memoryUsage: number;       // bytes
  memoryUsageMb: number;     // convenience
  cpuPercent: number;        // 0-100

  // Request stats (from log parsing)
  requestCount: number;
  errorCount: number;
  errorRate: number;         // 0-100

  // Latency stats
  p50Latency: number;        // milliseconds
  p95Latency: number;

  // API health
  notionLatency: number | null;
  claudeLatency: number | null;
  notionErrorRate: number;
  claudeErrorRate: number;

  // Pattern detection
  unknownErrorPatterns: string[];
  unknownContentTypes: string[];

  // Crash context (if restart occurred since last snapshot)
  lastCrashContext?: CrashContext;
}

export interface CrashContext {
  lastFeedEntries: string[];
  lastError: string;
  activeSkill: string | null;
  timestamp: Date;
}

export interface PromotionDecision {
  promote: boolean;
  reason: string;
  severity: 'info' | 'warning' | 'critical';
}

// ==========================================
// Heartbeat Storage Types
// ==========================================

export interface HeartbeatEntry {
  timestamp: string;  // ISO string
  snapshot: TelemetrySnapshot;
}

export interface HeartbeatStore {
  version: string;
  maxEntries: number;
  entries: HeartbeatEntry[];
}

export const DEFAULT_HEARTBEAT_STORE: HeartbeatStore = {
  version: '1.0.0',
  maxEntries: 96,  // 24 hours at 15-minute intervals
  entries: [],
};

// ==========================================
// Pattern Registry Types
// ==========================================

export interface PatternRegistryStore {
  version: string;
  patterns: ErrorPattern[];
  proposedPatterns: ErrorPattern[];  // Awaiting approval
}

export const DEFAULT_PATTERN_REGISTRY: PatternRegistryStore = {
  version: '1.0.0',
  patterns: [],
  proposedPatterns: [],
};

// ==========================================
// Pit Crew Dispatch Types
// ==========================================

export interface PitCrewDispatch {
  type: 'bug' | 'feature';
  title: string;
  context: string;
  priority: PatternSeverity;
  metadata: {
    source: 'supervisor';
    errorPattern?: string;
    consecutiveErrors?: number;
    uptime?: number;
    lastSuccessTime?: string;
  };
}

export interface PitCrewDispatchResult {
  success: boolean;
  discussionId?: string;
  notionUrl?: string;
  error?: string;
}

// ==========================================
// Supervisor Events
// ==========================================

export type SupervisorEventType =
  | 'process_started'
  | 'process_stopped'
  | 'process_crashed'
  | 'error_detected'
  | 'pattern_matched'
  | 'threshold_exceeded'
  | 'pit_crew_dispatched'
  | 'telemetry_collected'
  | 'feed_promoted'
  | 'pattern_proposed'
  | 'status_query';

export interface SupervisorEvent {
  type: SupervisorEventType;
  timestamp: Date;
  data: Record<string, unknown>;
}

// ==========================================
// Status Response Types
// ==========================================

export interface SupervisorStatus {
  status: ProcessState['status'];
  uptime: number | null;
  processId: number | null;
  errorCount: number;
  consecutiveErrors: number;
  restartCount: number;
  lastError: string | null;
  lastErrorTime: Date | null;
  dispatchedBugs: string[];
  config: {
    mode: SupervisorMode;
    sourcePath: string;
    pitCrewEnabled: boolean;
    errorThreshold: number;
  };
  telemetry: {
    lastSnapshot: TelemetrySnapshot | null;
    localHeartbeatCount: number;
    feedPromotionCount: number;
  };
  patterns: {
    activeCount: number;
    proposedCount: number;
    recentMatches: PatternMatch[];
  };
}
