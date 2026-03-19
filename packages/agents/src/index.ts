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
  appendDispatchNotes,
  getNotionPageUrl,
  createResearchWorkItem,
  type ResearchTaskConfig,
} from "./workqueue";

// Specialist Agents
export {
  runResearchAgent,
  executeResearch,
  buildResearchQuery,
  isGenericTitle,
  type QueryInput,
  type ResearchConfig,
  type ResearchFinding,
  type ResearchResult,
  type ResearchDepth,
} from "./agents/research";

// Research Intelligence v2
export {
  EVIDENCE_PRESETS,
  isResearchConfigV2,
  type ResearchConfigV2,
  type EvidenceRequirements,
  type POVContext,
  type ParsedRouting,
  type ResearchIntent,
  type SourceType,
  type QualityFloor,
  type SourceContext,
} from "./types/research-v2";
export { parseAnswerToRouting } from "./services/answer-parser";
export { fetchPOVContext, clearPovCache, type PovFetchResult, type PovFetchStatus } from "./services/pov-fetcher";
export { buildResearchPromptV2 } from "./services/research-prompt-v2";
export { composeResearchContext } from "./services/research-context";
export type { ResearchContextInput } from "./services/research-context";

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

// Andon Gate — Epistemic Honesty for Cognitive Output (ATLAS-AG-001)
export {
  assessOutput,
  assessOutputWithDiagnostics,
  buildPlainLanguageDiagnostic,
  assessConversationalOutput,
  calibrateDelivery,
  assessNovelty,
  computeSourceRelevance,
  type ConfidenceLevel,
  type RoutingDecision,
  type AndonInput,
  type DeliveryCalibration,
  type AndonAssessment,
  type DiagnosticContext,
  type DiagnosticAssessment,
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
  isQuestionFormAnswer,
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

// Self-Model (Runtime Capability Awareness)
export {
  assembleCapabilityModel,
  getCachedModel,
  invalidateCache as invalidateSelfModelCache,
  matchCapabilities,
  buildSelfModelSlotContent,
  buildEmptySelfModelSlot,
  SELF_MODEL_DEFAULTS,
  MATCH_THRESHOLDS,
  type CapabilityModel,
  type CapabilityHealth,
  type CapabilityLayer,
  type SkillCapability,
  type MCPToolCapability,
  type KnowledgeCapability,
  type ExecutionCapability,
  type IntegrationCapability,
  type SurfaceCapability,
  type CapabilityMatch,
  type SelfModelSlotContent,
  type CapabilityDataProvider,
  type SkillInfo,
  type MCPServerInfo,
  type KnowledgeSourceInfo,
  type IntegrationHealthInfo,
  type SurfaceInfo,
  type MatchResult,
} from "./self-model";

// Request Assessment (Complexity + Approach Proposals)
export {
  assessRequest,
  quickClassify,
  isAssessmentEnabled,
  detectSignals,
  classifyComplexity,
  countSignals,
  buildApproach,
  ASSESSMENT_DEFAULTS,
  type Complexity,
  type ComplexitySignals,
  type ApproachStep,
  type ApproachProposal,
  type RequestAssessment,
  type AssessmentContext,
} from "./assessment";

// Domain + Audience Unbundling (STAB-002c)
export {
  inferDomain,
  inferDomainSync,
  inferAudience,
  inferAudienceSync,
  derivePillar,
  getDomainSlug,
  detectDomainCorrection,
  logDomainCorrection,
  extractKeywords,
  type DomainType,
  type AudienceType,
  type DomainRulesConfig,
  type AudienceRulesConfig,
  type PromptManagerLike,
  type DomainCorrection,
  type CorrectionLogEntry,
} from "./assessment";

// Dialogue (Rough Terrain Collaborative Exploration)
export {
  classifyTerrain,
  needsDialogue,
  assessmentNeedsDialogue,
  surfaceThreads,
  identifyAmbiguity,
  resetThreadCounter,
  enterDialogue,
  continueDialogue,
  isDialogueResolved,
  DIALOGUE_DEFAULTS,
  type Terrain,
  type ThreadSource,
  type Thread,
  type DialogueState,
  type DialogueResult,
} from "./dialogue";

// Emergence — Skill Emergence Detection & Delivery (CONV-ARCH-004)
export {
  // Monitor
  checkForEmergence,
  dismissProposal,
  approveProposal,
  onEmergenceEvent,
  offEmergenceEvent,

  // Session detection
  querySessionActions,
  groupActionsBySession,
  extractIntentSequences,
  extractAllSequences,
  detectSequencePatterns,

  // Proposal generation
  generateProposal,
  generateSkillName,
  formatProposalText,

  // Approval store
  storeEmergenceProposal,
  hasPendingEmergenceProposal,
  getPendingEmergenceProposal,
  processEmergenceResponse,

  // Feed writer
  wireEmergenceFeedSubscriber,
  persistDismissedPattern,

  // Config
  DEFAULT_EMERGENCE_CONFIG,

  // Types
  type SessionAction,
  type SessionGroup,
  type IntentTransition,
  type IntentSequence,
  type SequencePattern,
  type EmergenceSignal,
  type EmergenceSource,
  type DismissedPattern,
  type EmergenceProposal,
  type EmergenceConfig,
  type EmergenceCheckResult,
  type EmergenceEvent,
  type EmergenceEventType,
} from "./emergence";

// Research Orchestration — Surface-agnostic pipeline (RPO-001)
export {
  orchestrateResearch,
  type OrchestratorInput,
  type OrchestratorResult,
} from "./orchestration";

// Research Pipeline Config — Declarative Infrastructure Parameters (DRC-001a)
export {
  getResearchPipelineConfig,
  getResearchPipelineConfigSync,
  invalidateConfigCache,
  injectConfig as injectResearchConfig,
  COMPILED_DEFAULTS,
  type ResearchPipelineConfig,
  type ResolvedConfig,
  type ConfigSource,
  type DepthProfile,
  type AndonThresholds,
  type SearchProviderConfig,
  type EvidencePresetAssignment,
} from "./config";

// Ratchet Classification — Universal Pattern (ADR-012)
export {
  ratchetClassify,
  logRatchetEvent,
  type RatchetLayer,
  type RatchetConfig,
  type RatchetResult,
  type RatchetEvent,
} from "./ratchet"

// Provenance — Universal Action Trace (Sprint A: Pipeline Unification)
export {
  createProvenanceChain,
  appendPhase,
  setConfig as setProvenanceConfig,
  setContext as setProvenanceContext,
  setResult as setProvenanceResult,
  appendPath,
  finalizeProvenance,
  type ProvenanceChain,
  type ProvenanceRoute,
  type ProvenanceCompute,
  type ProvenanceContext,
  type ProvenanceResult,
  type ProvenanceTime,
  type ComputePhase,
} from "./provenance";
export { renderProvenanceNotion } from "./provenance/render";
export type { ProvenanceConfig } from "./types/provenance";
export { updateFeedProvenance } from "./conversation/audit";
