/**
 * Socratic Interview Engine — Type Definitions
 *
 * Transport-agnostic types for the Socratic intent protocol.
 * The engine assesses context gaps, generates targeted questions,
 * and maps answers back to structured composition inputs.
 *
 * @see Notion: Socratic Intent Protocol spec
 */

import type { Pillar, IntentType, DepthLevel, AudienceType } from '../services/prompt-composition/types';

// ==========================================
// Engine State Machine
// ==========================================

/** Socratic engine states */
export type EngineState = 'IDLE' | 'ASSESSING' | 'RESOLVED' | 'ASKING' | 'MAPPING';

/** Confidence regime determines question behavior */
export type ConfidenceRegime = 'auto_draft' | 'ask_one' | 'ask_framing';

// ==========================================
// Notion Config Types
// ==========================================

/** Entry types in the Socratic Interview Config database */
export type ConfigEntryType = 'interview_prompt' | 'context_rule' | 'answer_map' | 'threshold';

/** Surfaces where entries apply */
export type Surface = 'chrome' | 'telegram' | 'claude_code' | 'all';

/** Context signal slots with associated weights */
export type ContextSlot =
  | 'contact_data'
  | 'content_signals'
  | 'classification'
  | 'bridge_context'
  | 'skill_requirements';

/** A single entry from the Socratic Interview Config database */
export interface SocraticConfigEntry {
  id: string;
  name: string;
  slug: string;
  type: ConfigEntryType;
  surfaces: Surface[];
  active: boolean;
  priority: number;
  conditions: string;
  contextSlots: ContextSlot[];
  confidenceFloor: number;
  skill: string;
  /** Page body content — prompt template or mapping rules */
  content: string;
}

/** Organized config fetched from Notion */
export interface SocraticConfig {
  interviewPrompts: Record<string, SocraticConfigEntry>;  // keyed by slug
  contextRules: SocraticConfigEntry[];                     // sorted by priority
  answerMaps: Record<string, SocraticConfigEntry>;         // keyed by slug
  thresholds: SocraticConfigEntry[];                       // sorted by priority
  fetchedAt: string;
}

// ==========================================
// Context Signals
// ==========================================

/** Weights for each context slot (must sum to 1.0) */
export const CONTEXT_WEIGHTS: Record<ContextSlot, number> = {
  contact_data: 0.30,
  content_signals: 0.25,
  classification: 0.20,
  bridge_context: 0.15,
  skill_requirements: 0.10,
};

/** Raw context signals provided by the caller (transport adapter) */
export interface ContextSignals {
  /** Known contact info: name, relationship, history */
  contactData?: {
    name?: string;
    relationship?: string;
    recentActivity?: string;
    relationshipHistory?: string;
    isKnown: boolean;
  };

  /** Content analysis: topic, sentiment, length */
  contentSignals?: {
    topic?: string;
    sentiment?: string;
    contentLength?: number;
    hasUrl?: boolean;
    title?: string;
    url?: string;
  };

  /** Classification from earlier pipeline stages */
  classification?: {
    intent?: IntentType;
    pillar?: Pillar;
    confidence?: number;
    depth?: DepthLevel;
    audience?: AudienceType;
  };

  /** Bridge context from prior interactions */
  bridgeContext?: {
    recentInteraction?: string;
    lastTouchDate?: string;
    pendingFollowUp?: boolean;
    notes?: string;
  };

  /** Skill-specific requirements */
  skillRequirements?: {
    skill?: string;
    requiredFields?: string[];
    providedFields?: string[];
  };
}

/** Assessed confidence for a single context slot */
export interface SlotAssessment {
  slot: ContextSlot;
  weight: number;
  /** 0.0 = no data, 1.0 = fully present */
  completeness: number;
  /** Weighted contribution to overall confidence */
  contribution: number;
  /** What's missing (if incomplete) */
  gaps: string[];
}

/** Full confidence assessment result */
export interface ConfidenceAssessment {
  /** Weighted sum of all slot contributions (0.0 - 1.0) */
  overallConfidence: number;
  /** Which regime this confidence falls into */
  regime: ConfidenceRegime;
  /** Per-slot breakdown */
  slots: SlotAssessment[];
  /** Ordered list of gaps, highest-weight first */
  topGaps: Array<{ slot: ContextSlot; gap: string; weight: number }>;
}

// ==========================================
// Questions
// ==========================================

/** A single question option for tap-friendly UI */
export interface QuestionOption {
  label: string;
  value: string;
}

/** A generated question ready for transport rendering */
export interface SocraticQuestion {
  /** The question text */
  text: string;
  /** Which context slot this question addresses */
  targetSlot: ContextSlot;
  /** Tap-friendly answer options */
  options: QuestionOption[];
  /** Expected confidence boost if answered */
  expectedBoost: number;
}

// ==========================================
// Answer Mapping
// ==========================================

/** Structured result from mapping an answer */
export interface MappedAnswer {
  /** The original answer text */
  rawAnswer: string;
  /** Which question this answers */
  questionSlot: ContextSlot;
  /** Resolved structured values */
  resolved: {
    intent?: IntentType;
    depth?: DepthLevel;
    audience?: AudienceType;
    pillar?: Pillar;
    /** Additional key-value context from the answer */
    extraContext?: Record<string, string>;
  };
  /** New confidence after incorporating this answer */
  newConfidence: number;
}

// ==========================================
// Engine Session
// ==========================================

/** A complete Socratic interview session */
export interface SocraticSession {
  /** Unique session ID */
  id: string;
  /** Current engine state */
  state: EngineState;
  /** Which surface initiated this session */
  surface: Surface;
  /** Which skill (if any) is being served */
  skill: string;
  /** Raw context signals from the caller */
  signals: ContextSignals;
  /** Latest confidence assessment */
  assessment: ConfidenceAssessment | null;
  /** Questions asked so far */
  questionsAsked: SocraticQuestion[];
  /** Answers received so far */
  answersReceived: MappedAnswer[];
  /** Final resolved context (when state === RESOLVED) */
  resolvedContext: ResolvedContext | null;
  /** Timestamp */
  createdAt: number;
  /** Max questions allowed (from threshold config) */
  maxQuestions: number;
}

/** Final resolved context ready for the composition pipeline */
export interface ResolvedContext {
  intent: IntentType;
  depth: DepthLevel;
  audience: AudienceType;
  pillar: Pillar;
  /** The confidence that led to resolution */
  confidence: number;
  /** How it was resolved */
  resolvedVia: 'auto_draft' | 'single_question' | 'multi_question';
  /** Additional context gathered during interview */
  extraContext: Record<string, string>;
  /** Contact name if known */
  contactName?: string;
  /** Content topic if detected */
  contentTopic?: string;
}

// ==========================================
// Engine Result (returned to caller)
// ==========================================

/** Result from engine.assess() or engine.answer() */
export type EngineResult =
  | { type: 'resolved'; context: ResolvedContext }
  | { type: 'question'; questions: SocraticQuestion[] }
  | { type: 'error'; message: string };

// ==========================================
// Composition Integration
// ==========================================

/**
 * Extended composition input that includes Socratic interview results.
 * Feeds into composeFromStructuredContext() in the composition pipeline.
 */
export interface SocraticCompositionInput {
  intent: IntentType;
  depth: DepthLevel;
  audience: AudienceType;
  pillar: Pillar;
  /** How context was gathered */
  resolvedVia: 'auto_draft' | 'single_question' | 'multi_question';
  /** Overall confidence at resolution */
  confidence: number;
  /** Extra context from interview answers */
  interviewContext: Record<string, string>;
  /** Original content (URL, text, etc.) */
  content: string;
  /** Content title if available */
  title?: string;
  /** Original URL if applicable */
  url?: string;
  /** Contact name if known */
  contactName?: string;
}
