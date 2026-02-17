/**
 * Socratic Interview Engine — Barrel Exports
 *
 * Transport-agnostic engine for context-aware interview flows.
 * Assesses context gaps, generates targeted questions, and maps
 * answers to structured composition inputs.
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

// Answer Mapping
export { mapAnswer } from './answer-mapper';

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

  // Composition
  SocraticCompositionInput,
} from './types';

export { CONTEXT_WEIGHTS } from './types';
