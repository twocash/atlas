/**
 * Atlas Agent Registry
 *
 * Tracks running agents, manages lifecycle, and provides
 * querying capabilities for agent status and history.
 */

import type {
  Agent,
  AgentId,
  AgentConfig,
  AgentStatus,
  AgentFilter,
  AgentEvent,
  AgentEventType,
  AgentEventHandler,
  AgentSubscription,
  AgentOperations,
  AgentEventSubscriber,
  AgentResult,
} from "./types";

// ==========================================
// Agent ID Generation
// ==========================================

/**
 * Generate a unique agent ID
 * Format: {type}-{timestamp}-{random}
 */
function generateAgentId(type: string): AgentId {
  const timestamp = Date.now().toString(36);
  const random = Math.random().toString(36).substring(2, 8);
  return `${type}-${timestamp}-${random}`;
}

// ==========================================
// Event Emitter
// ==========================================

type Subscription = {
  agentId: AgentId | "*";
  eventTypes: AgentEventType[] | "*";
  handler: AgentEventHandler;
};

/**
 * Simple event emitter for agent events
 */
class AgentEventEmitter implements AgentEventSubscriber {
  private subscriptions: Map<string, Subscription> = new Map();
  private subscriptionCounter = 0;

  subscribe(agentId: AgentId, handler: AgentEventHandler): AgentSubscription {
    return this.addSubscription(agentId, "*", handler);
  }

  subscribeToEvents(
    agentId: AgentId,
    eventTypes: AgentEventType[],
    handler: AgentEventHandler
  ): AgentSubscription {
    return this.addSubscription(agentId, eventTypes, handler);
  }

  subscribeAll(handler: AgentEventHandler): AgentSubscription {
    return this.addSubscription("*", "*", handler);
  }

  private addSubscription(
    agentId: AgentId | "*",
    eventTypes: AgentEventType[] | "*",
    handler: AgentEventHandler
  ): AgentSubscription {
    const id = `sub-${++this.subscriptionCounter}`;
    this.subscriptions.set(id, { agentId, eventTypes, handler });

    return {
      unsubscribe: () => {
        this.subscriptions.delete(id);
      },
    };
  }

  async emit(event: AgentEvent): Promise<void> {
    const promises: Promise<void>[] = [];

    for (const sub of this.subscriptions.values()) {
      // Check agent ID match
      if (sub.agentId !== "*" && sub.agentId !== event.agentId) {
        continue;
      }

      // Check event type match
      if (sub.eventTypes !== "*" && !sub.eventTypes.includes(event.type)) {
        continue;
      }

      // Call handler
      const result = sub.handler(event);
      if (result instanceof Promise) {
        promises.push(result);
      }
    }

    // Wait for all async handlers
    await Promise.all(promises);
  }
}

// ==========================================
// Agent Registry Implementation
// ==========================================

/**
 * In-memory agent registry
 *
 * Tracks all agent instances and provides CRUD operations.
 * In a production system, this would be backed by a database.
 */
export class AgentRegistry implements AgentOperations, AgentEventSubscriber {
  private agents: Map<AgentId, Agent> = new Map();
  private eventEmitter: AgentEventEmitter = new AgentEventEmitter();

  // Configuration
  private defaults = {
    priority: "P2" as const,
    timeout: 5 * 60 * 1000,
    heartbeatInterval: 30 * 1000,
    maxRetries: 3,
  };

  // ==========================================
  // Agent Operations
  // ==========================================

  /**
   * Spawn a new agent
   */
  async spawn(config: AgentConfig): Promise<Agent> {
    const id = generateAgentId(config.type);

    const agent: Agent = {
      id,
      type: config.type,
      name: config.name,
      status: "pending",
      priority: config.priority ?? this.defaults.priority,
      createdAt: new Date(),
      workItemId: config.workItemId,
    };

    this.agents.set(id, agent);

    await this.eventEmitter.emit({
      type: "spawned",
      agentId: id,
      timestamp: new Date(),
      data: { config },
    });

    return agent;
  }

  /**
   * Get current agent status
   */
  async status(id: AgentId): Promise<Agent | null> {
    return this.agents.get(id) ?? null;
  }

  /**
   * Pause a running agent
   */
  async pause(id: AgentId): Promise<Agent> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    if (agent.status !== "running") {
      throw new InvalidStateError(id, agent.status, "pause");
    }

    agent.status = "paused";

    await this.eventEmitter.emit({
      type: "paused",
      agentId: id,
      timestamp: new Date(),
    });

    return agent;
  }

  /**
   * Resume a paused agent
   */
  async resume(id: AgentId): Promise<Agent> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    if (agent.status !== "paused") {
      throw new InvalidStateError(id, agent.status, "resume");
    }

    agent.status = "running";

    await this.eventEmitter.emit({
      type: "resumed",
      agentId: id,
      timestamp: new Date(),
    });

    return agent;
  }

  /**
   * Terminate an agent
   */
  async terminate(id: AgentId, reason?: string): Promise<Agent> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    if (agent.status === "completed" || agent.status === "failed") {
      throw new InvalidStateError(id, agent.status, "terminate");
    }

    agent.status = "cancelled";
    agent.completedAt = new Date();
    if (reason) {
      agent.error = reason;
    }

    await this.eventEmitter.emit({
      type: "cancelled",
      agentId: id,
      timestamp: new Date(),
      data: { reason },
    });

    return agent;
  }

  /**
   * List agents matching filter criteria
   */
  async list(filter?: AgentFilter): Promise<Agent[]> {
    let agents = Array.from(this.agents.values());

    if (!filter) {
      return agents;
    }

    // Apply filters
    if (filter.status) {
      const statuses = Array.isArray(filter.status)
        ? filter.status
        : [filter.status];
      agents = agents.filter((a) => statuses.includes(a.status));
    }

    if (filter.type) {
      const types = Array.isArray(filter.type) ? filter.type : [filter.type];
      agents = agents.filter((a) => types.includes(a.type));
    }

    if (filter.priority) {
      const priorities = Array.isArray(filter.priority)
        ? filter.priority
        : [filter.priority];
      agents = agents.filter((a) => priorities.includes(a.priority));
    }

    if (filter.createdAfter) {
      agents = agents.filter((a) => a.createdAt >= filter.createdAfter!);
    }

    if (filter.createdBefore) {
      agents = agents.filter((a) => a.createdAt <= filter.createdBefore!);
    }

    if (filter.workItemId) {
      agents = agents.filter((a) => a.workItemId === filter.workItemId);
    }

    // Apply limit
    if (filter.limit && agents.length > filter.limit) {
      agents = agents.slice(0, filter.limit);
    }

    return agents;
  }

  // ==========================================
  // Internal State Updates
  // ==========================================

  /**
   * Start an agent (called by executor)
   */
  async start(id: AgentId): Promise<Agent> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    agent.status = "running";
    agent.startedAt = new Date();
    agent.lastHeartbeat = new Date();

    await this.eventEmitter.emit({
      type: "started",
      agentId: id,
      timestamp: new Date(),
    });

    return agent;
  }

  /**
   * Update agent progress
   */
  async updateProgress(
    id: AgentId,
    progress: number,
    activity?: string
  ): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    agent.progress = Math.min(100, Math.max(0, progress));
    if (activity) {
      agent.currentActivity = activity;
    }
    agent.lastHeartbeat = new Date();

    await this.eventEmitter.emit({
      type: "progress",
      agentId: id,
      timestamp: new Date(),
      data: { progress: agent.progress, activity: agent.currentActivity },
    });
  }

  /**
   * Record heartbeat
   */
  async heartbeat(id: AgentId): Promise<void> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    agent.lastHeartbeat = new Date();

    await this.eventEmitter.emit({
      type: "heartbeat",
      agentId: id,
      timestamp: new Date(),
    });
  }

  /**
   * Mark agent as completed
   */
  async complete(id: AgentId, result: AgentResult): Promise<Agent> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    agent.status = "completed";
    agent.completedAt = new Date();
    agent.progress = 100;
    agent.result = result;

    await this.eventEmitter.emit({
      type: "completed",
      agentId: id,
      timestamp: new Date(),
      data: result,
    });

    return agent;
  }

  /**
   * Mark agent as failed
   */
  async fail(id: AgentId, error: string, retryable = false): Promise<Agent> {
    const agent = this.agents.get(id);
    if (!agent) {
      throw new AgentNotFoundError(id);
    }

    agent.status = "failed";
    agent.completedAt = new Date();
    agent.error = error;

    await this.eventEmitter.emit({
      type: "failed",
      agentId: id,
      timestamp: new Date(),
      data: { error, retryable },
    });

    return agent;
  }

  // ==========================================
  // Event Subscription (delegate to emitter)
  // ==========================================

  subscribe(agentId: AgentId, handler: AgentEventHandler): AgentSubscription {
    return this.eventEmitter.subscribe(agentId, handler);
  }

  subscribeToEvents(
    agentId: AgentId,
    eventTypes: AgentEventType[],
    handler: AgentEventHandler
  ): AgentSubscription {
    return this.eventEmitter.subscribeToEvents(agentId, eventTypes, handler);
  }

  subscribeAll(handler: AgentEventHandler): AgentSubscription {
    return this.eventEmitter.subscribeAll(handler);
  }

  // ==========================================
  // Utility Methods
  // ==========================================

  /**
   * Get count of agents by status
   */
  getStatusCounts(): Record<AgentStatus, number> {
    const counts: Record<AgentStatus, number> = {
      pending: 0,
      running: 0,
      paused: 0,
      completed: 0,
      failed: 0,
      cancelled: 0,
    };

    for (const agent of this.agents.values()) {
      counts[agent.status]++;
    }

    return counts;
  }

  /**
   * Get all running agents
   */
  getRunningAgents(): Agent[] {
    return Array.from(this.agents.values()).filter(
      (a) => a.status === "running" || a.status === "paused"
    );
  }

  /**
   * Check if any agents are running
   */
  hasRunningAgents(): boolean {
    for (const agent of this.agents.values()) {
      if (agent.status === "running" || agent.status === "paused") {
        return true;
      }
    }
    return false;
  }

  /**
   * Get agents that haven't sent a heartbeat recently
   */
  getStaleAgents(maxAge: number = 60000): Agent[] {
    const now = Date.now();
    return Array.from(this.agents.values()).filter((a) => {
      if (a.status !== "running") return false;
      if (!a.lastHeartbeat) return true;
      return now - a.lastHeartbeat.getTime() > maxAge;
    });
  }

  /**
   * Clean up old completed/failed agents
   */
  cleanup(maxAge: number = 24 * 60 * 60 * 1000): number {
    const now = Date.now();
    let removed = 0;

    for (const [id, agent] of this.agents.entries()) {
      if (
        agent.status === "completed" ||
        agent.status === "failed" ||
        agent.status === "cancelled"
      ) {
        if (agent.completedAt && now - agent.completedAt.getTime() > maxAge) {
          this.agents.delete(id);
          removed++;
        }
      }
    }

    return removed;
  }

  /**
   * Clear all agents (for testing)
   */
  clear(): void {
    this.agents.clear();
  }
}

// ==========================================
// Error Classes
// ==========================================

/**
 * Agent not found error
 */
export class AgentNotFoundError extends Error {
  constructor(public readonly agentId: AgentId) {
    super(`Agent not found: ${agentId}`);
    this.name = "AgentNotFoundError";
  }
}

/**
 * Invalid state transition error
 */
export class InvalidStateError extends Error {
  constructor(
    public readonly agentId: AgentId,
    public readonly currentStatus: AgentStatus,
    public readonly operation: string
  ) {
    super(
      `Cannot ${operation} agent ${agentId}: current status is ${currentStatus}`
    );
    this.name = "InvalidStateError";
  }
}

// ==========================================
// Singleton Instance
// ==========================================

/**
 * Global agent registry instance
 */
export const registry = new AgentRegistry();
