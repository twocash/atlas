/**
 * Answer Mapper — Answer → Structured Intent Mapping
 *
 * Maps user answers (from tap-friendly options) back to structured
 * intent values. Uses answer_map entries from Notion config for
 * skill-specific mappings, with sensible defaults.
 */

import type { Pillar, IntentType, DepthLevel, AudienceType } from '../services/prompt-composition/types';
import type {
  ContextSlot,
  ContextSignals,
  MappedAnswer,
  SocraticConfig,
  SocraticConfigEntry,
  SocraticQuestion,
} from './types';
import { assessContext } from './context-assessor';

// ==========================================
// Pillar Mapping
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
// Intent Mapping
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
// Depth Mapping
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
// Answer Map Parsing
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
// Answer Mapping
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
 * Map a user's answer to structured intent values.
 *
 * Uses the answer map from Notion config for skill-specific mappings,
 * then falls back to built-in aliases.
 */
export function mapAnswer(
  answer: string,
  question: SocraticQuestion,
  signals: ContextSignals,
  config: SocraticConfig,
  skill?: string
): MappedAnswer {
  const normalizedAnswer = answer.toLowerCase().replace(/[^a-z0-9]+/g, '-');
  const resolved: MappedAnswer['resolved'] = {};

  // Try skill-specific answer map from Notion
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

  // Natural language extraction: parse freeform answers for embedded signals.
  // Jim's answer to "What's the play?" is often: "Research for the Grove, thinkpiece material"
  // This contains: intent (research), pillar (Grove), output format (thinkpiece → draft).
  if (!resolved.intent || !resolved.pillar || !resolved.depth) {
    const lower = answer.toLowerCase();

    // Extract pillar from natural language
    if (!resolved.pillar) {
      if (lower.includes('grove') || lower.includes('ai') || lower.includes('tech')) {
        resolved.pillar = 'The Grove';
      } else if (lower.includes('consulting') || lower.includes('client') || lower.includes('drumwave')) {
        resolved.pillar = 'Consulting';
      } else if (lower.includes('personal') || lower.includes('health') || lower.includes('family')) {
        resolved.pillar = 'Personal';
      } else if (lower.includes('home') || lower.includes('garage') || lower.includes('car') || lower.includes('vehicle')) {
        resolved.pillar = 'Home/Garage';
      }
    }

    // Extract intent from natural language
    if (!resolved.intent) {
      if (lower.includes('research') || lower.includes('look into') || lower.includes('find out') || lower.includes('summarize')) {
        resolved.intent = 'research';
      } else if (lower.includes('draft') || lower.includes('write') || lower.includes('thinkpiece') || lower.includes('blog') || lower.includes('post')) {
        resolved.intent = 'draft';
      } else if (lower.includes('save') || lower.includes('capture') || lower.includes('bookmark') || lower.includes('just')) {
        resolved.intent = 'capture';
      }
    }

    // Extract depth from natural language
    if (!resolved.depth) {
      if (lower.includes('deep') || lower.includes('thorough') || lower.includes('comprehensive')) {
        resolved.depth = 'deep';
      } else if (lower.includes('quick') || lower.includes('brief') || lower.includes('light') || lower.includes('skim')) {
        resolved.depth = 'quick';
      }
      // "medium" / "standard" are default — no need to detect
    }

    // Preserve the FULL answer as user direction for downstream use
    // This is critical: "thinkpiece on prompt engineering for the Grove" carries
    // intent that the research query needs.
    resolved.extraContext = {
      ...resolved.extraContext,
      userDirection: answer,
    };
  }

  // Fall back to built-in aliases for anything not resolved
  if (!resolved.intent && INTENT_ALIASES[normalizedAnswer]) {
    resolved.intent = INTENT_ALIASES[normalizedAnswer];
  }
  if (!resolved.depth && DEPTH_ALIASES[normalizedAnswer]) {
    resolved.depth = DEPTH_ALIASES[normalizedAnswer];
  }
  if (!resolved.pillar && PILLAR_ALIASES[normalizedAnswer]) {
    resolved.pillar = PILLAR_ALIASES[normalizedAnswer];
  }

  // Map slot-specific answers to context updates
  switch (question.targetSlot) {
    case 'contact_data':
      resolved.extraContext = { relationship: answer };
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
      resolved.extraContext = { bridgeNote: answer };
      break;
    case 'skill_requirements':
      if (!resolved.depth) {
        resolved.depth = DEPTH_ALIASES[normalizedAnswer] || undefined;
      }
      break;
  }

  // Estimate new confidence after this answer
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
