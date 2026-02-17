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

// Socratic Interview Engine
export {
  SocraticEngine,
  getSocraticEngine,
  assessContext,
  reassessWithAnswer,
  analyzeGaps,
  generateQuestions,
  mapAnswer,
  getSocraticConfig,
  refreshSocraticConfig,
  invalidateCache,
  injectConfig,
  CONTEXT_WEIGHTS,
  type EngineState,
  type EngineResult,
  type SocraticSession,
  type ResolvedContext,
  type ConfidenceRegime,
  type SocraticConfig,
  type SocraticConfigEntry,
  type ConfigEntryType,
  type Surface,
  type ContextSlot,
  type ContextSignals,
  type SlotAssessment,
  type ConfidenceAssessment,
  type SocraticQuestion,
  type QuestionOption,
  type MappedAnswer,
  type SocraticCompositionInput,
  type GapAnalysis,
} from './socratic';

// Prompt Composition Service (V3 Active Capture)
export {
  // Main composition
  composePrompt,
  composePromptFromState,

  // ID resolution
  buildPromptIds,
  buildPromptIdsFromContext,
  resolveDrafterId,
  resolveVoiceId,
  resolveDefaultDrafterId,

  // Validation
  validateSelection,
  validateContext,

  // Registry
  getAvailableActions,
  getAvailableVoices,
  getPillarSlug,
  getPillarFromSlug,
  pillarSupportsAction,
  pillarHasVoice,

  // Constants
  PILLAR_OPTIONS,
  PILLAR_SLUGS,
  SLUG_TO_PILLAR,
  ACTION_OPTIONS,
  ACTION_LABELS,
  ACTION_EMOJIS,
  PILLAR_ACTIONS,
  PILLAR_VOICES,
  ACTION_VOICE_PREFERENCES,

  // Types
  type CompositionPillar,
  type PillarSlug,
  type ActionType,
  type PromptSelectionState,
  type PromptCompositionIds,
  type CompositionContext,
  type PromptCompositionResult,
  type VoiceOption,
  type ActionOption,
  type PillarOption,
  type ValidationError,
} from "./services";
