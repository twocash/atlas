/**
 * Cognitive Router - Module Exports
 *
 * The cognitive routing layer provides intelligent model selection,
 * provider routing, and execution orchestration.
 */

// Types
export type {
  TaskProfile,
  TaskComplexity,
  RiskTier,
  ModelSelection,
  ProviderRoute,
  Endpoint,
  WorkerRequest,
  WorkerResult,
  WorkerTool,
  WorkerToolCall,
  TokenUsage,
  ValidationResult,
  ValidationStage,
  SupervisorRequest,
  SupervisorResponse,
  TokenLedgerEntry,
  WorkerResultEntry,
  CircuitBreakerState,
  CircuitBreakerResponse,
} from "./types";

// Models
export {
  type ModelId,
  type Provider,
  type ModelTier,
  type ModelStrength,
  type ModelConfig,
  MODEL_CATALOG,
  getModelConfig,
  estimateCost,
  hasStrength,
  getModelsByTier,
  getModelsByProvider,
  getCheapestModelWithStrengths,
  DEFAULT_MODEL_BY_TASK,
} from "./models";

// Profiler
export {
  profileTask,
  assessRiskTier,
  canSkipLLM,
  getQuickResponse,
  upgradeComplexity,
} from "./profiler";

// Selector
export {
  selectModel,
  upgradeModelSelection,
  exceedsCostThreshold,
  getModelTierLabel,
  formatSelection,
} from "./selector";

// Router
export {
  routeProvider,
  getFallbackRoute,
  isRouteAvailable,
  getAvailableEndpoints,
  formatRoute,
  getProviderDisplayName,
  isRoutingHealthy,
  getRoutingHealthSummary,
} from "./router";

// Worker
export {
  executeWorker,
  executeWorkersParallel,
  isRetriableError,
  getWorkerTimeout,
} from "./worker";

// Ledger
export {
  getLedger,
  recordTokens,
  getSessionStats,
  getSessionSummary,
  isOverBudget,
  getRemainingBudget,
  resetLedger,
  aggregateUsage,
} from "./ledger";

// Persistence
export {
  persistTokenEntry,
  persistWorkerResult,
  persistWorkerExecution,
  batchPersistTokenEntries,
  queryRecentTokenEntries,
  getTotalSpendFromNotion,
} from "./persistence";

// Supervisor (main entry point)
export {
  supervise,
  superviseParallel,
  resetCircuitBreaker,
  getCircuitBreakerStatus,
} from "./supervisor";

// Triage Skill (Unified Haiku Triage)
export {
  triageMessage,
  createCachedTriageResult,
  type TriageResult,
  type TriageCommand,
  type TriageOptions,
  type ComplexityTier,
} from "./triage-skill";

// Triage Patterns (Cache + Feedback)
export {
  getCachedTriage,
  getTriageExamples,
  recordTriageFeedback,
  generatePatternKey,
  getAllPatterns,
  getPatternCount,
  clearPatterns,
  flushPatterns,
  seedPatterns,
  type TriagePattern,
} from "./triage-patterns";
