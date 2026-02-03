/**
 * Atlas Skill System - Main Exports
 *
 * Phase 1: Action logging and intent hashing
 * Phase 2: Skill registry and execution
 * Phase 3: Pattern detection and skill proposals
 */

// Feature flags
export {
  getFeatureFlags,
  getDetectionConfig,
  getSafetyLimits,
  isFeatureEnabled,
  reloadConfig,
  getEnabledFeaturesSummary,
  type FeatureFlags,
  type DetectionConfig,
  type SafetyLimits,
} from '../config/features';

// Intent hashing
export {
  generateIntentHash,
  compareIntentHashes,
  hasSameIntent,
  type IntentHashResult,
} from './intent-hash';

// Action logging
export {
  logAction,
  logClassification,
  logToolExecution,
  logMediaAction,
  getIntentHash,
  type ActionType,
  type ActionLogInput,
  type ActionLogResult,
} from './action-log';

// Schema definitions (Phase 2)
export {
  type TriggerType,
  type SkillTrigger,
  type SkillInput,
  type SkillOutputType,
  type SkillOutput,
  type OnErrorBehavior,
  type ToolStep,
  type SkillStep,
  type AgentStep,
  type ConditionalStep,
  type ProcessStep,
  type SkillProcess,
  type SkillTier,
  type SkillMetrics,
  type SkillDefinition,
  classifySkillTier,
  createDefaultMetrics,
  createSkillDefinition,
  getTierDescription,
  getTierEmoji,
  SkillDefinitionSchema,
  TriggerSchema,
  ProcessSchema,
} from './schema';

// Registry (Phase 2)
export {
  SkillRegistry,
  getSkillRegistry,
  initializeSkillRegistry,
  type TriggerMatchResult,
  type MatchContext,
} from './registry';

// Executor (Phase 2)
export {
  executeSkill,
  executeSkillByName,
  executeSkillWithApproval,
  isBrowserAutomationReady,
  // Stop control
  requestStop,
  startExecution,
  endExecution,
  ExecutionStoppedError,
  type ExecutionContext,
  type StepResult,
  type SkillExecutionResult,
} from './executor';

// Pattern Detection (Phase 3)
export {
  detectPatterns,
  getPendingProposals as getPendingPatternsProposals,
  approveProposal,
  rejectProposal,
  markPatternRejected,
  type LoggedAction,
  type DetectedPattern,
  type SkillProposal,
  type PatternDetectionResult,
} from './pattern-detector';

// Approval Queue (Phase 3)
export {
  queueProposals,
  getPendingProposals,
  getProposal,
  getProposalsByTier,
  approveProposalById,
  rejectProposalById,
  approveAllPending,
  approveAllTier0,
  deferAllPending,
  cleanupOldProposals,
  getQueueStats,
  formatProposalForTelegram,
  formatQueueSummary,
} from './approval-queue';
