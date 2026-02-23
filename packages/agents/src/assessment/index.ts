/**
 * Assessment Module — Request complexity analysis and approach proposals.
 *
 * Sprint: CONV-ARCH-002 (Request Assessment)
 * Sprint: STAB-002c (Domain + Audience Unbundling)
 * EPIC: Conversational Architecture
 */

// Types
export type {
  Complexity,
  ComplexitySignals,
  ApproachStep,
  ApproachProposal,
  RequestAssessment,
  AssessmentContext,
  DomainType,
  AudienceType,
} from "./types"

export { ASSESSMENT_DEFAULTS } from "./types"

// Complexity Classifier
export { detectSignals, classifyComplexity, countSignals } from "./complexity-classifier"

// Approach Builder
export { buildApproach } from "./approach-builder"

// Request Assessor (main entry point)
export { assessRequest, quickClassify, isAssessmentEnabled, inferPillar } from "./request-assessor"

// Domain + Audience Inference (STAB-002c)
export {
  inferDomain,
  inferDomainSync,
  inferAudience,
  inferAudienceSync,
  derivePillar,
  getDomainSlug,
} from "./domain-inferrer"

export type {
  DomainRulesConfig,
  AudienceRulesConfig,
  PromptManagerLike,
} from "./domain-inferrer"

// Correction Telemetry (STAB-002c)
export {
  detectDomainCorrection,
  logDomainCorrection,
  extractKeywords,
} from "./correction-logger"

export type {
  DomainCorrection,
  CorrectionLogEntry,
} from "./correction-logger"
