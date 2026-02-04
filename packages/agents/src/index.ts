/**
 * Atlas Agent SDK
 *
 * Infrastructure for spawning, coordinating, and monitoring
 * specialist agents that execute tasks autonomously.
 *
 * @example
 * ```typescript
 * import { registry, AgentConfig } from "@atlas/agents";
 *
 * // Spawn a research agent
 * const agent = await registry.spawn({
 *   type: "research",
 *   name: "Competitor pricing analysis",
 *   instructions: "Research competitor pricing for AI coding assistants",
 *   priority: "P1",
 *   workItemId: "abc123"
 * });
 *
 * // Subscribe to events
 * registry.subscribe(agent.id, (event) => {
 *   console.log(`Agent ${event.agentId}: ${event.type}`);
 * });
 *
 * // Check status
 * const status = await registry.status(agent.id);
 * console.log(`Progress: ${status?.progress}%`);
 * ```
 */

// Core types
export type {
  AgentId,
  AgentStatus,
  AgentType,
  AgentPriority,
  Pillar,
  AgentConfig,
  Agent,
  AgentResult,
  AgentMetrics,
  AgentEventType,
  AgentEvent,
  ProgressEvent,
  CompletionEvent,
  FailureEvent,
  AgentOperations,
  AgentFilter,
  AgentEventHandler,
  AgentSubscription,
  AgentEventSubscriber,
  WorkQueueStatus,
  WorkQueueUpdater,
} from "./types";

// Constants
export { AGENT_DEFAULTS } from "./types";

// Registry
export {
  AgentRegistry,
  AgentNotFoundError,
  InvalidStateError,
  registry,
} from "./registry";

// Work Queue Integration
export {
  NotionWorkQueueUpdater,
  workQueueUpdater,
  syncAgentSpawn,
  syncAgentProgress,
  syncAgentComplete,
  syncAgentFailure,
  syncAgentCancelled,
  wireAgentToWorkQueue,
  getNotionPageUrl,
  createResearchWorkItem,
  type ResearchTaskConfig,
} from "./workqueue";

// Specialist Agents
export {
  runResearchAgent,
  executeResearch,
  type ResearchConfig,
  type ResearchFinding,
  type ResearchResult,
  type ResearchDepth,
} from "./agents/research";

// Services
export {
  PromptManager,
  getPromptManager,
  getPrompt,
  getPromptById,
  listUseCases,
  type PromptCapability,
  type PromptStage,
  type PromptPillar,
  type PromptRecord,
  type PromptLookup,
  type PromptVariables,
  type PromptComposition,
  type ComposedPrompt,
} from "./services";
