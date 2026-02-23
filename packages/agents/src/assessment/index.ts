/**
 * Assessment Module — Request complexity analysis and approach proposals.
 *
 * Sprint: CONV-ARCH-002 (Request Assessment)
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
} from "./types"

export { ASSESSMENT_DEFAULTS } from "./types"

// Complexity Classifier
export { detectSignals, classifyComplexity, countSignals } from "./complexity-classifier"

// Approach Builder
export { buildApproach } from "./approach-builder"

// Request Assessor (main entry point)
export { assessRequest, quickClassify, isAssessmentEnabled, inferPillar } from "./request-assessor"
