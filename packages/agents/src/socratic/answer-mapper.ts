/**
 * Answer Mapper — Answer → Structured Intent Mapping
 *
 * Maps user answers (from tap-friendly options or freeform text) back to
 * structured intent values. Primary path: LLM interpretation via HaikuInterpreter.
 * Fallback: deterministic regex matching (RegexFallbackInterpreter).
 *
 * V2 (Conversational Intent Resolution):
 *   - LLM-first interpretation replaces brittle keyword matching
 *   - "just helping me keep up" → research (not capture)
 *   - Training data collected for future fine-tuning
 *   - Notion answer_map entries still honored for tap-friendly button answers
 *
 * @see ADR-001: Prompts from Notion via PromptManager
 * @see ADR-008: Fail fast, fail loud — regex fallback with logging
 */

import type { Pillar, IntentType, DepthLevel, AudienceType } from '../services/prompt-composition/types';
import type {
  ContextSlot,
  ContextSignals,
  MappedAnswer,
  SocraticConfig,
  SocraticConfigEntry,
  SocraticQuestion,
  InterpretationContext,
} from './types';
import { assessContext } from './context-assessor';
import { getIntentInterpreter } from './intent-interpreter';
import { RegexFallbackInterpreter } from './intent-interpreter';
import { logTrainingEntry } from './training-collector';
import { reportFailure } from '@atlas/shared/error-escalation';

// ==========================================
// Pillar Mapping (for tap-friendly buttons + Notion answer maps)
// ==========================================

const PILLAR_ALIASES: Record<string, Pillar> = {
  'the-grove': 'The Grove',
  'grove': 'The Grove',
  'ai': 'The Grove',
  'consulting': 'Consulting',
  'client': 'Consulting',
  'personal': 'Personal',
  'home-garage': 'Home/Garage',
  'home': 'Home/Garage',
  'garage': 'Home/Garage',
};

// ==========================================
// Intent Mapping (for tap-friendly button answers)
// ==========================================

const INTENT_ALIASES: Record<string, IntentType> = {
  'meeting': 'engage',
  'coffee': 'engage',
  'connect': 'engage',
  'collaborate': 'engage',
  'advance': 'engage',
  'keep-it-warm': 'engage',
  'stay-in-touch': 'engage',
  'nurture': 'engage',
  'supportive': 'engage',
  'share-expertise': 'draft',
  'thought-leadership': 'draft',
  'ask-a-question': 'research',
  'learn-more': 'research',
  'quick': 'capture',
  'acknowledge': 'capture',
  'thoughtful': 'draft',
  // URL intent answers — "what's the play?" responses
  'research': 'research',
  'research-this': 'research',
  'summarize': 'research',
  'draft-about-it': 'draft',
  'thinkpiece': 'draft',
  'blog': 'draft',
  'write-about': 'draft',
  'just-capture': 'capture',
  'save': 'capture',
  'capture': 'capture',
  'bookmark': 'capture',
};

// ==========================================
// Depth Mapping (for tap-friendly button answers)
// ==========================================

const DEPTH_ALIASES: Record<string, DepthLevel> = {
  'quick': 'quick',
  'brief': 'quick',
  'acknowledge': 'quick',
  'standard': 'standard',
  'medium': 'standard',
  'deep': 'deep',
  'thoughtful': 'deep',
  'detailed': 'deep',
};

// ==========================================
// Question-Form Detection (Sprint B P0-2)
// ==========================================

/** Question-starting words that signal interrogative form */
const QUESTION_STARTERS = /^(what|who|where|when|why|how|which|is|are|was|were|do|does|did|can|could|would|should|will|have|has|tell)\b/i;

/**
 * Detect if a user's answer is itself a question.
 * Sprint B P0-2: Answer Disambiguation.
 *
 * When Jim answers a Socratic prompt with "What's the latest on Anthropic's
 * model safety work?", the answer mapper still extracts slot values (Haiku
 * handles this gracefully). But this flag signals that the answer may contain
 * a DIFFERENT intent than what the Socratic engine assumed.
 *
 * Heuristic: ends with `?` OR starts with a question word.
 * Button answers (short, normalized tokens) are never questions.
 */
export function isQuestionFormAnswer(answer: string): boolean {
  const trimmed = answer.trim();
  if (trimmed.length < 5) return false; // Too short to be a meaningful question
  if (trimmed.includes('?')) return true;
  return QUESTION_STARTERS.test(trimmed);
}

// ==========================================
// Answer Map Parsing (Notion config)
// ==========================================

interface ParsedMapping {
  pattern: string;
  intent?: IntentType;
  depth?: DepthLevel;
  pillar?: Pillar;
  audience?: AudienceType;
}

/**
 * Parse answer map content from Notion into structured mappings.
 * Reads table rows with | Answer | Intent | Depth | ... format.
 */
function parseAnswerMap(entry: SocraticConfigEntry): ParsedMapping[] {
  const mappings: ParsedMapping[] = [];
  const lines = entry.content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();
    // Match table rows: | "answer" / "alias" | intent | depth | ...
    const tableMatch = trimmed.match(/^\|\s*"([^"]+)"(?:\s*\/\s*"[^"]+")*\s*\|\s*(\w+)/);
    if (tableMatch) {
      const pattern = tableMatch[1].toLowerCase().replace(/[^a-z0-9]+/g, '-');
      const intentRaw = tableMatch[2].toLowerCase();

      const mapping: ParsedMapping = { pattern };

      // Map intent (skip wildcards)
      if (intentRaw !== '*' && INTENT_ALIASES[intentRaw]) {
        mapping.intent = INTENT_ALIASES[intentRaw];
      } else if (intentRaw !== '*') {
        mapping.intent = intentRaw as IntentType;
      }

      // Check for pillar override in the Notes column
      const notesMatch = trimmed.match(/Override pillar[^|]*(\w[\w/\s]+)/i);
      if (notesMatch) {
        const pillarKey = notesMatch[1].trim().toLowerCase().replace(/[^a-z]+/g, '-');
        if (PILLAR_ALIASES[pillarKey]) {
          mapping.pillar = PILLAR_ALIASES[pillarKey];
        }
      }

      // Check for depth in third column
      const columns = trimmed.split('|').filter(Boolean).map(c => c.trim());
      if (columns.length >= 3) {
        const depthRaw = columns[2].toLowerCase();
        if (DEPTH_ALIASES[depthRaw]) {
          mapping.depth = DEPTH_ALIASES[depthRaw];
        }
      }

      mappings.push(mapping);
    }
  }

  return mappings;
}

// ==========================================
// Answer Mapping (Primary Export)
// ==========================================

/**
 * Find the best matching answer map entry from the config.
 */
function findAnswerMap(
  config: SocraticConfig,
  skill?: string
): SocraticConfigEntry | null {
  for (const entry of Object.values(config.answerMaps)) {
    if (skill && entry.skill && entry.skill === skill) return entry;
    if (!skill && !entry.skill) return entry;
  }
  // Fall back to any available map
  const maps = Object.values(config.answerMaps);
  return maps.length > 0 ? maps[0] : null;
}

/**
 * Detect if an answer matches a tap-friendly button option exactly.
 * Button answers are short, normalized tokens — not conversational text.
 */
function isButtonAnswer(answer: string): boolean {
  const normalized = answer.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  return !!(INTENT_ALIASES[normalized] || DEPTH_ALIASES[normalized] || PILLAR_ALIASES[normalized]);
}

/**
 * Map a user's answer to structured intent values.
 *
 * V2 flow:
 *   1. Check Notion answer_map for skill-specific button mappings
 *   2. If the answer is a button tap (exact alias match), use deterministic mapping
 *   3. For freeform/conversational answers, delegate to IntentInterpreter (LLM → regex fallback)
 *   4. Log training data for future fine-tuning
 *   5. Compute new confidence with updated signals
 *
 * NOW ASYNC — callers must await.
 */
export async function mapAnswer(
  answer: string,
  question: SocraticQuestion,
  signals: ContextSignals,
  config: SocraticConfig,
  skill?: string
): Promise<MappedAnswer> {
  const normalizedAnswer = answer.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const resolved: MappedAnswer['resolved'] = {};

  // ── Layer 1: Notion answer_map (skill-specific button mappings) ──
  const mapEntry = findAnswerMap(config, skill);
  if (mapEntry) {
    const parsedMappings = parseAnswerMap(mapEntry);
    const match = parsedMappings.find(m => normalizedAnswer.includes(m.pattern));
    if (match) {
      if (match.intent) resolved.intent = match.intent;
      if (match.depth) resolved.depth = match.depth;
      if (match.pillar) resolved.pillar = match.pillar;
    }
  }

  // ── Layer 2: Button answer fast-path (deterministic) ──
  if (isButtonAnswer(answer) && !resolved.intent) {
    if (INTENT_ALIASES[normalizedAnswer]) resolved.intent = INTENT_ALIASES[normalizedAnswer];
    if (DEPTH_ALIASES[normalizedAnswer]) resolved.depth = DEPTH_ALIASES[normalizedAnswer];
    if (PILLAR_ALIASES[normalizedAnswer]) resolved.pillar = PILLAR_ALIASES[normalizedAnswer];
  }

  // ── Layer 3: LLM interpretation for conversational answers ──
  if (!resolved.intent || !resolved.pillar || !resolved.depth) {
    const interpretationContext: InterpretationContext = {
      title: signals.contentSignals?.title,
      sourceType: signals.contentSignals?.contentType,
      targetSlot: question.targetSlot,
      questionText: question.text,
      existingSignals: {
        intent: signals.classification?.intent,
        pillar: signals.classification?.pillar,
        depth: signals.classification?.depth,
      },
    };

    try {
      const interpreter = getIntentInterpreter();
      const result = await interpreter.interpret(answer, interpretationContext);

      // Apply LLM results for any unresolved fields
      if (!resolved.intent) resolved.intent = result.interpreted.intent;
      if (!resolved.depth) resolved.depth = result.interpreted.depth;
      if (!resolved.pillar && result.interpreted.pillar) resolved.pillar = result.interpreted.pillar;
      if (!resolved.audience) resolved.audience = result.interpreted.audience;

      // Always preserve the full answer as user direction
      resolved.extraContext = {
        ...resolved.extraContext,
        userDirection: answer,
        interpretationMethod: result.method,
        interpretationConfidence: String(result.interpreted.confidence),
        interpretationReasoning: result.interpreted.reasoning,
      };

      // Log training data (regex baseline for comparison)
      try {
        const regexInterpreter = new RegexFallbackInterpreter();
        const regexResult = await regexInterpreter.interpret(answer, interpretationContext);
        logTrainingEntry(answer, interpretationContext, result, regexResult);
      } catch {
        // Training collection is non-critical
      }
    } catch (err) {
      // Fail loud per ADR-008 — but don't block the answer mapping
      const errorMsg = err instanceof Error ? err.message : String(err);
      console.error(`[mapAnswer] Intent interpretation failed: ${errorMsg}`);

      // Autonomaton Loop 1: report to error escalation pipeline
      reportFailure('intent-interpretation', err, {
        timestamp: new Date().toISOString(),
        answer: answer.substring(0, 200),
        questionSlot: question.targetSlot,
        questionText: question.text?.substring(0, 200),
        suggestedFix: 'Check IntentInterpreter health — if Haiku is failing, the RatchetInterpreter should be catching it. If this fires, the ratchet itself is broken.',
      });

      // Preserve user direction even on failure
      resolved.extraContext = {
        ...resolved.extraContext,
        userDirection: answer,
        interpretationMethod: 'error',
        interpretationError: errorMsg,
      };
    }
  }

  // ── Layer 4: Slot-specific context enrichment ──
  switch (question.targetSlot) {
    case 'contact_data':
      resolved.extraContext = { ...resolved.extraContext, relationship: answer };
      break;
    case 'content_signals':
      resolved.extraContext = { ...resolved.extraContext, contentType: answer };
      break;
    case 'classification':
      if (!resolved.pillar) {
        resolved.pillar = PILLAR_ALIASES[normalizedAnswer] || undefined;
      }
      break;
    case 'bridge_context':
      resolved.extraContext = { ...resolved.extraContext, bridgeNote: answer };
      break;
    case 'skill_requirements':
      if (!resolved.depth) {
        resolved.depth = DEPTH_ALIASES[normalizedAnswer] || undefined;
      }
      break;
  }

  // ── Sprint B P0-2: Question-form detection ──
  const answerIsQuestion = isQuestionFormAnswer(answer);
  if (answerIsQuestion) {
    resolved.extraContext = {
      ...resolved.extraContext,
      answerIsQuestion: 'true',
    };
    console.log('[mapAnswer] Question-form answer detected', {
      answer: answer.substring(0, 100),
      targetSlot: question.targetSlot,
    });
  }

  // ── Estimate new confidence ──
  const slotUpdate = buildSignalUpdate(question.targetSlot, answer, signals);
  const updatedSignals: ContextSignals = {
    ...signals,
    ...slotUpdate,
  };
  const newAssessment = assessContext(updatedSignals, /* skipUrlCeiling= */ true);

  return {
    rawAnswer: answer,
    questionSlot: question.targetSlot,
    resolved,
    newConfidence: newAssessment.overallConfidence,
    answerIsQuestion,
  };
}

/**
 * Build a partial ContextSignals update from an answer to a specific slot.
 */
function buildSignalUpdate(
  slot: ContextSlot,
  answer: string,
  _existing: ContextSignals
): Partial<ContextSignals> {
  switch (slot) {
    case 'contact_data':
      return {
        contactData: {
          isKnown: true,
          relationship: answer,
        },
      };
    case 'content_signals':
      return {
        contentSignals: {
          ..._existing.contentSignals,
          topic: answer,
        },
      };
    case 'classification':
      return {
        classification: {
          pillar: PILLAR_ALIASES[answer.toLowerCase().replace(/[^a-z0-9]+/g, '-')] || undefined,
          confidence: 0.8,
        },
      };
    case 'bridge_context':
      return {
        bridgeContext: {
          notes: answer,
        },
      };
    case 'skill_requirements':
      return {
        skillRequirements: {
          providedFields: [answer],
        },
      };
    default:
      return {};
  }
}
