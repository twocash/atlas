/**
 * Andon Gate — Epistemic Honesty for Cognitive Output
 *
 * Named for the Toyota Production System's andon cord — the mechanism that
 * empowers any worker to stop the production line when quality is wrong.
 *
 * The Andon Gate sits between execution (Step 6) and delivery (Step 8) in
 * the Manifesto's capability pipeline. Step 6.5: Assess.
 *
 * Design principle: Plumbing fails open. Quality fails honest.
 * Content injection (RCI-001) is plumbing — missing context = proceed.
 * Output quality assessment is NOT plumbing — thin results ≠ confident delivery.
 *
 * Classification is deterministic and metadata-driven. No LLM judgment calls.
 *
 * @module andon-gate
 * @sprint ATLAS-AG-001
 */

// ─── Types ───────────────────────────────────────────────────────────────────

/**
 * Confidence classification for cognitive output.
 * Ordered from highest to lowest epistemic certainty.
 */
export type ConfidenceLevel = 'grounded' | 'informed' | 'speculative' | 'insufficient';

/**
 * Routing decision from the Andon Gate.
 * - deliver: send as-is with calibrated framing
 * - caveat: deliver with explicit limitation acknowledgment
 * - clarify: do NOT deliver as findings — ask for clarification instead
 * - deepen: offer to dispatch deeper research
 */
export type RoutingDecision = 'deliver' | 'caveat' | 'clarify' | 'deepen';

/**
 * Input to the Andon Gate assessment function.
 * Metadata already available at the delivery point — no new API calls needed.
 */
export interface AndonInput {
  /** Did the research agent actually dispatch to Gemini? */
  wasDispatched: boolean;

  /** Did Gemini use Google Search grounding? */
  groundingUsed: boolean;

  /** Number of grounding sources returned */
  sourceCount: number;

  /** Number of structured findings */
  findingCount: number;

  /** Bibliography entries (deep research) */
  bibliographyCount: number;

  /** Execution duration in milliseconds */
  durationMs: number;

  /** The research summary text */
  summary: string;

  /** The original query / request from the user */
  originalQuery: string;

  /** Whether the execution succeeded */
  success: boolean;

  /** Whether the hallucination guard passed */
  hallucinationGuardPassed: boolean;

  /** Content mode: prose (drafter template) or json (structured) */
  contentMode?: 'prose' | 'json';

  /** Whether prose content exists (drafter output) */
  hasProseContent?: boolean;

  /** Dispatch source fingerprint */
  source?: string;

  /** Source titles/descriptions for relevance scoring (Sprint B P1-2).
   *  Extracted from ResearchFinding.source + URL domain tokens. */
  sourceTitles?: string[];

  /** Sensitive claim categories detected by claim-detector (Sprint C) */
  claimFlags?: string[];
}

/**
 * Delivery calibration — how to frame the output for the user.
 */
export interface DeliveryCalibration {
  /** The label to use instead of unconditional "Research Complete" */
  label: string;

  /** Caveat text to prepend, if any */
  caveat: string | null;

  /** Whether emoji celebration is appropriate */
  celebrationAllowed: boolean;

  /** Suggested lead emoji */
  emoji: string;
}

/**
 * The Andon Gate's assessment of output quality.
 * This is the full verdict — classification + calibration + routing.
 */
export interface AndonAssessment {
  /** Confidence classification */
  confidence: ConfidenceLevel;

  /** How to frame delivery */
  calibration: DeliveryCalibration;

  /** What to do with the output */
  routing: RoutingDecision;

  /** Novelty score: 0 = pure restatement, 1 = fully novel */
  noveltyScore: number;

  /** Human-readable reason for the classification */
  reason: string;

  /** Source relevance score: 0 = tangential sources, 1 = perfectly relevant */
  sourceRelevanceScore: number;

  /** Metadata for Feed 2.0 telemetry */
  telemetry: {
    /** Feed keyword: andon:grounded, andon:informed, etc. */
    keyword: string;
    /** Source count at assessment time */
    sourceCount: number;
    /** Finding count at assessment time */
    findingCount: number;
    /** Whether novelty check passed */
    noveltyPassed: boolean;
    /** Whether source relevance check passed */
    sourceRelevancePassed: boolean;
    /** Duration of the assessed execution */
    durationMs: number;
  };
}

// ─── Classification Thresholds ───────────────────────────────────────────────
// DRC-001a: Thresholds resolved from Research Pipeline Config.
// assessOutput() accepts optional overrides via AndonThresholds parameter.
// Compiled defaults used when no overrides provided.

import { getResearchPipelineConfigSync, type AndonThresholds } from '../config';

/** Resolve thresholds — overrides take precedence, then config cache, then compiled defaults */
function resolveThresholds(overrides?: Partial<AndonThresholds>): AndonThresholds {
  const { config } = getResearchPipelineConfigSync();
  if (!overrides) return config.andonThresholds;
  return { ...config.andonThresholds, ...overrides };
}

// ─── Core Assessment ─────────────────────────────────────────────────────────

/**
 * Assess output quality. Pure function. Deterministic. Metadata-driven.
 *
 * This is the andon cord. It does NOT smooth over quality problems.
 * It tells the truth about what the system knows and doesn't know.
 */
export function assessOutput(input: AndonInput, thresholdOverrides?: Partial<AndonThresholds>): AndonAssessment {
  const t = resolveThresholds(thresholdOverrides);
  const noveltyScore = assessNovelty(input.summary, input.originalQuery);
  const noveltyPassed = noveltyScore >= t.noveltyFloor;

  // Sprint B P1-2: Source relevance scoring
  const sourceRelevanceScore = computeSourceRelevance(input.originalQuery, input.sourceTitles);
  const sourceRelevancePassed = sourceRelevanceScore >= (t.sourceRelevanceFloor ?? 0);

  // Determine confidence level — ordered checks, most restrictive first
  let confidence: ConfidenceLevel;
  let reason: string;

  if (!input.success) {
    confidence = 'insufficient';
    reason = 'Execution failed';
  } else if (!input.summary || input.summary.trim().length < t.minSummaryLength) {
    confidence = 'insufficient';
    reason = `Output too short (${input.summary?.trim().length ?? 0} chars, minimum ${t.minSummaryLength})`;
  } else if (!noveltyPassed) {
    confidence = 'insufficient';
    reason = `Mirror Anti-Pattern: output restates input (novelty ${(noveltyScore * 100).toFixed(0)}%, floor ${t.noveltyFloor * 100}%)`;
  } else if (!input.wasDispatched) {
    confidence = 'speculative';
    reason = 'No research agent dispatched — training-data synthesis';
  } else if (!input.groundingUsed && input.sourceCount === 0) {
    confidence = 'speculative';
    reason = 'Research dispatched but no grounding sources returned';
  } else if (!input.hallucinationGuardPassed) {
    confidence = 'insufficient';
    reason = 'Hallucination guard failed';
  } else if (
    input.sourceCount >= t.groundedMinSources &&
    input.findingCount >= t.minFindingsForSubstance &&
    noveltyPassed &&
    sourceRelevancePassed
  ) {
    confidence = 'grounded';
    reason = `${input.sourceCount} sources, ${input.findingCount} findings, novelty ${(noveltyScore * 100).toFixed(0)}%, relevance ${(sourceRelevanceScore * 100).toFixed(0)}%`;
  } else if (input.sourceCount >= t.groundedMinSources && !sourceRelevancePassed) {
    // Sprint B P1-2: Sources exist but are tangential — downgrade to informed
    confidence = 'informed';
    reason = `${input.sourceCount} sources but low relevance (${(sourceRelevanceScore * 100).toFixed(0)}%, floor ${(t.sourceRelevanceFloor * 100).toFixed(0)}%) — sources may be tangential`;
  } else if (input.sourceCount >= t.informedMinSources) {
    confidence = 'informed';
    reason = `${input.sourceCount} source(s), thin grounding — supplemented with training data`;
  } else {
    confidence = 'speculative';
    reason = `Dispatched but zero qualifying sources (${input.sourceCount} found)`;
  }

  // Sprint C: Sensitive claims downgrade — grounded → informed when claims detected
  if (input.claimFlags && input.claimFlags.length > 0 && confidence === 'grounded') {
    confidence = 'informed';
    reason += ` | Sensitive claims detected (${input.claimFlags.join(', ')}) — downgraded from grounded`;
  }

  const calibration = calibrateDelivery(confidence);
  const routing = determineRouting(confidence, noveltyPassed);

  return {
    confidence,
    calibration,
    routing,
    noveltyScore,
    sourceRelevanceScore,
    reason,
    telemetry: {
      keyword: `andon:${confidence}`,
      sourceCount: input.sourceCount,
      findingCount: input.findingCount,
      noveltyPassed,
      sourceRelevancePassed,
      durationMs: input.durationMs,
    },
  };
}

// ─── Delivery Calibration ────────────────────────────────────────────────────

/**
 * Map confidence classification to delivery framing.
 *
 * Grounded = earned celebration.
 * Informed = honest acknowledgment.
 * Speculative = transparent limitation.
 * Insufficient = stop the line.
 */
export function calibrateDelivery(confidence: ConfidenceLevel): DeliveryCalibration {
  switch (confidence) {
    case 'grounded':
      return {
        label: 'Research Complete',
        caveat: null,
        celebrationAllowed: true,
        emoji: '✅',
      };

    case 'informed':
      return {
        label: 'Research Summary',
        caveat: 'Based on limited external sources — some analysis draws on background knowledge.',
        celebrationAllowed: false,
        emoji: '📋',
      };

    case 'speculative':
      return {
        label: 'Initial Analysis',
        caveat: 'This is my initial thinking, not grounded research. Want me to dispatch a deeper investigation?',
        celebrationAllowed: false,
        emoji: '💭',
      };

    case 'insufficient':
      return {
        label: 'Research Incomplete',
        caveat: "I don't have enough to give you a substantive answer.",
        celebrationAllowed: false,
        emoji: '⚠️',
      };
  }
}

// ─── Routing Decision ────────────────────────────────────────────────────────

function determineRouting(confidence: ConfidenceLevel, noveltyPassed: boolean): RoutingDecision {
  switch (confidence) {
    case 'grounded':
      return 'deliver';

    case 'informed':
      return 'caveat';

    case 'speculative':
      return noveltyPassed ? 'caveat' : 'deepen';

    case 'insufficient':
      return 'clarify';
  }
}

// ─── Source Relevance Assessment (Speculative Padding Detection) ─────────────

/**
 * Assess whether returned sources are actually relevant to the query.
 * Sprint B P1-2: Speculative Padding Guard.
 *
 * Returns a score from 0 (completely tangential) to 1 (highly relevant).
 *
 * Method: Token overlap between the query and source titles/URLs.
 * If a query about "quantum computing breakthroughs 2026" returns sources
 * about "quantum computing history 1980s", the overlap is moderate but
 * the missing "2026"/"breakthroughs" tokens signal tangential results.
 *
 * When no source titles are provided, returns 1.0 (fail open — no data to assess).
 */
export function computeSourceRelevance(query: string, sourceTitles?: string[]): number {
  if (!sourceTitles || sourceTitles.length === 0) return 1.0; // Fail open: no titles = can't assess
  if (!query || query.trim().length === 0) return 1.0;

  const queryTokens = extractSignificantTokens(query);
  if (queryTokens.size === 0) return 1.0;

  // Combine all source titles into one token pool
  const sourceText = sourceTitles.join(' ');
  const sourceTokens = extractSignificantTokens(sourceText);
  if (sourceTokens.size === 0) return 0;

  // Measure: what fraction of query tokens appear in source titles?
  let matchCount = 0;
  for (const token of queryTokens) {
    if (sourceTokens.has(token)) matchCount++;
  }

  return matchCount / queryTokens.size;
}

// ─── Novelty Assessment (Mirror Anti-Pattern Detection) ──────────────────────

/**
 * Detect the Mirror Anti-Pattern: output that restates the input without
 * adding novel information.
 *
 * Returns a score from 0 (pure restatement) to 1 (fully novel content).
 *
 * Method: Token overlap ratio. Extract significant words from both query
 * and summary, measure what fraction of summary tokens are just echoing
 * the query. Low overlap = novel content. High overlap = mirror.
 */
export function assessNovelty(summary: string | undefined | null, query: string): number {
  if (!summary || summary.trim().length === 0) return 0;
  if (!query || query.trim().length === 0) return 1; // No query to mirror

  const queryTokens = extractSignificantTokens(query);
  const summaryTokens = extractSignificantTokens(summary);

  if (summaryTokens.size === 0) return 0;
  if (queryTokens.size === 0) return 1;

  // Count how many summary tokens appear in the query
  let overlapCount = 0;
  for (const token of summaryTokens) {
    if (queryTokens.has(token)) overlapCount++;
  }

  const overlapRatio = overlapCount / summaryTokens.size;

  // Also penalize extremely short summaries relative to query
  const lengthRatio = summary.trim().length / Math.max(query.trim().length, 1);
  const lengthPenalty = lengthRatio < 1.5 ? 0.2 : 0; // Short response relative to input

  // Novelty = inverse of overlap, with length penalty
  return Math.max(0, Math.min(1, 1 - overlapRatio - lengthPenalty));
}

/** Stop words excluded from novelty comparison */
const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'through', 'during',
  'before', 'after', 'above', 'below', 'between', 'under', 'and', 'but',
  'or', 'not', 'no', 'nor', 'so', 'yet', 'both', 'either', 'neither',
  'each', 'every', 'all', 'any', 'few', 'more', 'most', 'other', 'some',
  'such', 'than', 'too', 'very', 'just', 'about', 'this', 'that', 'these',
  'those', 'it', 'its', 'i', 'me', 'my', 'we', 'our', 'you', 'your',
  'he', 'him', 'his', 'she', 'her', 'they', 'them', 'their', 'what',
  'which', 'who', 'whom', 'how', 'when', 'where', 'why', 'if', 'then',
  'here', 'there', 'also', 'only', 'well', 'back', 'even', 'still',
  'research', 'deep', 'dive', 'analysis', 'find', 'look', 'want',
]);

function extractSignificantTokens(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2 && !STOP_WORDS.has(t))
  );
}
