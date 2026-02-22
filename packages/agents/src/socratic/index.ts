/**
 * Socratic Interview Engine — Barrel Exports
 *
 * Transport-agnostic engine for context-aware interview flows.
 * Assesses context gaps, generates targeted questions, and maps
 * answers to structured composition inputs.
 *
 * V2: LLM-based intent interpretation (Haiku → regex fallback)
 */

// Engine (primary interface)
export { SocraticEngine, getSocraticEngine } from './engine';

// Context Assessment
export { assessContext, reassessWithAnswer } from './context-assessor';

// Gap Analysis
export { analyzeGaps } from './gap-analyzer';
export type { GapAnalysis } from './gap-analyzer';

// Question Generation
export { generateQuestions } from './question-generator';

// Answer Mapping (V2: async, LLM-first)
export { mapAnswer } from './answer-mapper';

// Intent Interpretation (V2: pluggable interpreters)
export {
  HaikuInterpreter,
  RegexFallbackInterpreter,
  RatchetInterpreter,
  getIntentInterpreter,
  injectInterpreter,
} from './intent-interpreter';

// Training Data Collection
export {
  logTrainingEntry,
  getTrainingCount,
  readTrainingEntries,
} from './training-collector';
export type { TrainingEntry } from './training-collector';

// Notion Config
export {
  getSocraticConfig,
  refreshSocraticConfig,
  fetchSocraticConfig,
  getCachedConfig,
  invalidateCache,
  injectConfig,
} from './notion-config';

// Types
export type {
  // Engine
  EngineState,
  EngineResult,
  SocraticSession,
  ResolvedContext,
  ConfidenceRegime,

  // Config
  SocraticConfig,
  SocraticConfigEntry,
  ConfigEntryType,
  Surface,
  ContextSlot,

  // Signals & Assessment
  ContextSignals,
  SlotAssessment,
  ConfidenceAssessment,

  // Questions
  SocraticQuestion,
  QuestionOption,

  // Answers
  MappedAnswer,

  // Intent Interpretation (V2)
  IntentInterpreter,
  InterpretedIntent,
  InterpretationResult,
  InterpretationContext,
  InterpretationMethod,

  // Composition
  SocraticCompositionInput,

  // Intent Lifecycle (Feed 2.0)
  IntentLifecycleStatus,
} from './types';

export { CONTEXT_WEIGHTS } from './types';
