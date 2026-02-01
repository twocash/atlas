/**
 * Atlas Agent SDK - Type Definitions
 *
 * Core interfaces for spawning, coordinating, and monitoring
 * specialist agents that execute tasks autonomously.
 */

// ==========================================
// Agent Core Types
// ==========================================

/**
 * Unique identifier for an agent instance
 */
export type AgentId = string;

/**
 * Agent lifecycle status
 */
export type AgentStatus =
  | "pending"    // Created but not yet started
  | "running"    // Actively executing
  | "paused"     // Temporarily halted
  | "completed"  // Finished successfully
  | "failed"     // Terminated with error
  | "cancelled"; // Manually stopped

/**
 * Specialist agent types available in Atlas
 */
export type AgentType =
  | "research"  // Web search, summarization
  | "draft"     // Content generation
  | "process";  // File operations, data transforms

/**
 * Priority levels for agent execution
 */
export type AgentPriority = "P0" | "P1" | "P2" | "P3";

// ==========================================
// Agent Configuration
// ==========================================

/**
 * Configuration for spawning a new agent
 */
export interface AgentConfig {
  /** Type of specialist agent to spawn */
  type: AgentType;

  /** Human-readable name for this task */
  name: string;

  /** Detailed instructions for the agent */
  instructions: string;

  /** Priority level (affects scheduling) */
  priority?: AgentPriority;

  /** Maximum execution time in milliseconds */
  timeout?: number;

  /** Work Queue item ID to update on progress */
  workItemId?: string;

  /** Additional context/data for the agent */
  context?: Record<string, unknown>;

  /** Callback URL for completion notification */
  callbackUrl?: string;
}

/**
 * Default configuration values
 */
export const AGENT_DEFAULTS = {
  priority: "P2" as AgentPriority,
  timeout: 5 * 60 * 1000, // 5 minutes
  heartbeatInterval: 30 * 1000, // 30 seconds
  maxRetries: 3,
} as const;

// ==========================================
// Agent Instance
// ==========================================

/**
 * A running agent instance
 */
export interface Agent {
  /** Unique identifier */
  id: AgentId;

  /** Agent type */
  type: AgentType;

  /** Human-readable name */
  name: string;

  /** Current status */
  status: AgentStatus;

  /** Priority level */
  priority: AgentPriority;

  /** Creation timestamp */
  createdAt: Date;

  /** Start timestamp (when execution began) */
  startedAt?: Date;

  /** Completion timestamp */
  completedAt?: Date;

  /** Last heartbeat timestamp */
  lastHeartbeat?: Date;

  /** Associated Work Queue item ID */
  workItemId?: string;

  /** Progress percentage (0-100) */
  progress?: number;

  /** Current activity description */
  currentActivity?: string;

  /** Error message if failed */
  error?: string;

  /** Result data on completion */
  result?: AgentResult;
}

/**
 * Agent execution result
 */
export interface AgentResult {
  /** Was execution successful? */
  success: boolean;

  /** Output data from the agent */
  output?: unknown;

  /** Summary of what was accomplished */
  summary?: string;

  /** Artifacts produced (file paths, URLs, etc.) */
  artifacts?: string[];

  /** Execution metrics */
  metrics?: AgentMetrics;
}

/**
 * Execution metrics for an agent run
 */
export interface AgentMetrics {
  /** Total execution time in ms */
  durationMs: number;

  /** Number of API calls made */
  apiCalls?: number;

  /** Tokens consumed (if applicable) */
  tokensUsed?: number;

  /** Number of retries */
  retries?: number;
}

// ==========================================
// Agent Events
// ==========================================

/**
 * Event types emitted by agents
 */
export type AgentEventType =
  | "spawned"
  | "started"
  | "progress"
  | "heartbeat"
  | "paused"
  | "resumed"
  | "completed"
  | "failed"
  | "cancelled";

/**
 * Base event structure
 */
export interface AgentEvent {
  /** Event type */
  type: AgentEventType;

  /** Agent ID */
  agentId: AgentId;

  /** Event timestamp */
  timestamp: Date;

  /** Event-specific data */
  data?: unknown;
}

/**
 * Progress update event
 */
export interface ProgressEvent extends AgentEvent {
  type: "progress";
  data: {
    progress: number;
    activity: string;
  };
}

/**
 * Completion event
 */
export interface CompletionEvent extends AgentEvent {
  type: "completed";
  data: AgentResult;
}

/**
 * Failure event
 */
export interface FailureEvent extends AgentEvent {
  type: "failed";
  data: {
    error: string;
    retryable: boolean;
  };
}

// ==========================================
// Agent Operations Interface
// ==========================================

/**
 * Core operations for managing agents
 */
export interface AgentOperations {
  /**
   * Spawn a new agent
   * @param config Agent configuration
   * @returns The created agent instance
   */
  spawn(config: AgentConfig): Promise<Agent>;

  /**
   * Get agent status
   * @param id Agent ID
   * @returns Current agent state or null if not found
   */
  status(id: AgentId): Promise<Agent | null>;

  /**
   * Pause a running agent
   * @param id Agent ID
   * @returns Updated agent state
   */
  pause(id: AgentId): Promise<Agent>;

  /**
   * Resume a paused agent
   * @param id Agent ID
   * @returns Updated agent state
   */
  resume(id: AgentId): Promise<Agent>;

  /**
   * Terminate an agent
   * @param id Agent ID
   * @param reason Optional reason for termination
   * @returns Updated agent state
   */
  terminate(id: AgentId, reason?: string): Promise<Agent>;

  /**
   * List all agents matching criteria
   * @param filter Optional filter criteria
   * @returns List of matching agents
   */
  list(filter?: AgentFilter): Promise<Agent[]>;
}

/**
 * Filter criteria for listing agents
 */
export interface AgentFilter {
  /** Filter by status */
  status?: AgentStatus | AgentStatus[];

  /** Filter by type */
  type?: AgentType | AgentType[];

  /** Filter by priority */
  priority?: AgentPriority | AgentPriority[];

  /** Created after this date */
  createdAfter?: Date;

  /** Created before this date */
  createdBefore?: Date;

  /** Associated with this Work Queue item */
  workItemId?: string;

  /** Maximum results to return */
  limit?: number;
}

// ==========================================
// Event Handler Types
// ==========================================

/**
 * Handler for agent events
 */
export type AgentEventHandler = (event: AgentEvent) => void | Promise<void>;

/**
 * Subscription to agent events
 */
export interface AgentSubscription {
  /** Unsubscribe from events */
  unsubscribe(): void;
}

/**
 * Event subscription interface
 */
export interface AgentEventSubscriber {
  /**
   * Subscribe to all events for an agent
   * @param agentId Agent to subscribe to
   * @param handler Event handler function
   * @returns Subscription handle
   */
  subscribe(agentId: AgentId, handler: AgentEventHandler): AgentSubscription;

  /**
   * Subscribe to specific event types
   * @param agentId Agent to subscribe to
   * @param eventTypes Event types to listen for
   * @param handler Event handler function
   * @returns Subscription handle
   */
  subscribeToEvents(
    agentId: AgentId,
    eventTypes: AgentEventType[],
    handler: AgentEventHandler
  ): AgentSubscription;

  /**
   * Subscribe to all agent events (global)
   * @param handler Event handler function
   * @returns Subscription handle
   */
  subscribeAll(handler: AgentEventHandler): AgentSubscription;
}

// ==========================================
// Work Queue Integration
// ==========================================

/**
 * Work Queue status values that agents can set
 *
 * Status Flow:
 * - Captured: Exists, needs human review before execution
 * - Triaged: Classified and ready for autonomous execution
 * - Active: Currently being worked on
 * - Paused: Intentionally on hold
 * - Blocked: Can't proceed, needs something
 * - Done: Complete
 * - Shipped: Delivered/published/deployed
 */
export type WorkQueueStatus =
  | "Captured"
  | "Triaged"
  | "Active"
  | "Paused"
  | "Blocked"
  | "Done"
  | "Shipped";

/**
 * Interface for updating Work Queue items
 */
export interface WorkQueueUpdater {
  /**
   * Update status of a Work Queue item
   * @param itemId Work Queue item ID
   * @param status New status
   * @param notes Optional notes to append
   */
  updateStatus(
    itemId: string,
    status: WorkQueueStatus,
    notes?: string
  ): Promise<void>;

  /**
   * Add a comment to a Work Queue item
   * @param itemId Work Queue item ID
   * @param comment Comment text
   */
  addComment(itemId: string, comment: string): Promise<void>;

  /**
   * Set output/result on completion
   * @param itemId Work Queue item ID
   * @param output Output description or URL
   */
  setOutput(itemId: string, output: string): Promise<void>;
}
