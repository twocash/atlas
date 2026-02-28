/**
 * Research Context Composition — ATLAS-RCI-001
 *
 * Assembles upstream capture pipeline context into structured
 * SourceContext for research prompt injection.
 *
 * ADR-003: Source context is SEPARATE from ResearchConfig.query.
 * Query drives Google Search grounding. Source context drives analysis.
 * They don't cross.
 *
 * Guard rails:
 * - PreReader summary preferred (~500ch) — best signal-to-noise ratio
 * - Truncated extraction fallback (~3000ch) — when PreReader unavailable
 * - Never raw dump — 137k chars of HN comments would blow token budget
 *
 * Sprint: ATLAS-RCI-001 (Research Content Injection)
 */

import type { SourceContext } from '../types/research-v2';

// ─── Constants ──────────────────────────────────────────

/** Max chars for PreReader summary injection */
const PRE_READER_MAX_CHARS = 500;

/** Max chars for extracted content fallback (when PreReader unavailable) */
const EXTRACTED_CONTENT_MAX_CHARS = 3000;

/** Max chars for research angle from Socratic answer */
const RESEARCH_ANGLE_MAX_CHARS = 500;

/** Max chars for target audience */
const TARGET_AUDIENCE_MAX_CHARS = 200;

/** Rough estimate: 4 chars per token (conservative for English) */
const CHARS_PER_TOKEN = 4;

// ─── Input Type ─────────────────────────────────────────

/**
 * Input data for composing research context.
 * All fields optional — graceful absence is a design requirement.
 */
export interface ResearchContextInput {
  /** PreReader summary from content pre-read */
  preReaderSummary?: string;
  /** Content type from PreReader (article, discussion, social_post, etc.) */
  preReaderContentType?: string;
  /** Full extracted content (will be truncated) */
  extractedContent?: string;
  /** Jim's Socratic answer — raw text */
  socraticAnswer?: string;
  /** Source URL */
  sourceUrl?: string;
  /** Triage-generated title */
  triageTitle?: string;
  /** Triage confidence */
  triageConfidence?: number;
  /** Triage keywords */
  triageKeywords?: string[];
}

// ─── Socratic Answer Parsing ────────────────────────────

/**
 * Extract research angle from Jim's Socratic answer.
 *
 * The Socratic engine asks "What's the play?" — Jim's answer contains
 * the research angle, target audience, and desired output format.
 *
 * Examples:
 * - "Public piece looking at how devs view all this high stakes centralization rush - linkedin"
 *   → angle: "how devs view high stakes centralization rush"
 *   → audience: "linkedin" (public)
 * - "Quick summary for my own reference"
 *   → angle: "summary"
 *   → audience: "self"
 * - "Deep research on the financial structure for a Grove post"
 *   → angle: "financial structure"
 *   → audience: "Grove readers"
 */
function extractResearchAngle(answer: string): string | undefined {
  if (!answer || answer.trim().length < 5) return undefined;
  // The full answer IS the angle — it's Jim's stated intent.
  // Truncate but don't parse — the research agent interprets naturally.
  return answer.trim().slice(0, RESEARCH_ANGLE_MAX_CHARS);
}

/**
 * Extract target audience from Jim's Socratic answer.
 *
 * Looks for explicit audience signals in the answer text.
 */
function extractTargetAudience(answer: string): string | undefined {
  if (!answer) return undefined;

  const lower = answer.toLowerCase();

  // Explicit platform mentions → public audience
  if (lower.includes('linkedin')) return 'LinkedIn audience (professional/public)';
  if (lower.includes('grove') && (lower.includes('post') || lower.includes('blog'))) return 'Grove readers (technical AI audience)';
  if (lower.includes('twitter') || lower.includes(' x ')) return 'Twitter/X audience (public)';
  if (lower.includes('client')) return 'Client stakeholders';
  if (lower.includes('internal') || lower.includes('myself') || lower.includes('my own') || lower.includes('self')) return 'Self (internal reference)';

  return undefined;
}

// ─── Main Composer ──────────────────────────────────────

/**
 * Compose structured research context from upstream capture pipeline data.
 *
 * Returns undefined when no meaningful context is available —
 * research proceeds with query-only mode (existing behavior).
 *
 * @param input - Available upstream context (all fields optional)
 * @returns SourceContext or undefined if nothing useful available
 */
export function composeResearchContext(input: ResearchContextInput): SourceContext | undefined {
  const {
    preReaderSummary,
    preReaderContentType,
    extractedContent,
    socraticAnswer,
    sourceUrl,
    triageTitle,
    triageConfidence,
  } = input;

  // Check if we have anything meaningful to inject
  const hasPreReader = !!preReaderSummary && preReaderSummary.trim().length > 0;
  const hasExtracted = !!extractedContent && extractedContent.trim().length > 50;
  const hasAnswer = !!socraticAnswer && socraticAnswer.trim().length >= 5;

  // Nothing to inject — return undefined (graceful absence)
  if (!hasPreReader && !hasExtracted && !hasAnswer) {
    return undefined;
  }

  // Build context with guard rails
  const context: SourceContext = {
    sourceUrl,
    triageTitle,
    triageConfidence,
    preReaderAvailable: hasPreReader,
  };

  // 1. PreReader summary — preferred analytical context
  if (hasPreReader) {
    context.preReaderSummary = preReaderSummary!.trim().slice(0, PRE_READER_MAX_CHARS);
  }

  // 2. Content type from PreReader
  if (preReaderContentType) {
    context.contentType = preReaderContentType;
  }

  // 3. Extracted content — fallback when PreReader unavailable, or supplement
  if (hasExtracted) {
    const trimmed = extractedContent!.trim();
    context.wasTruncated = trimmed.length > EXTRACTED_CONTENT_MAX_CHARS;
    context.extractedContent = trimmed.slice(0, EXTRACTED_CONTENT_MAX_CHARS);
  }

  // 4. Research angle from Socratic answer
  if (hasAnswer) {
    context.researchAngle = extractResearchAngle(socraticAnswer!);
    context.targetAudience = extractTargetAudience(socraticAnswer!);
  }

  // 5. Estimate injected token count
  let totalChars = 0;
  if (context.preReaderSummary) totalChars += context.preReaderSummary.length;
  if (context.extractedContent) totalChars += context.extractedContent.length;
  if (context.researchAngle) totalChars += context.researchAngle.length;
  context.estimatedTokens = Math.ceil(totalChars / CHARS_PER_TOKEN);

  return context;
}
