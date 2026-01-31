/**
 * Atlas Telegram Bot - Intent Detection
 *
 * Detects user intent from messages using heuristic patterns
 * with Claude fallback for ambiguous cases.
 *
 * Intent types:
 * - spark: URL present, "save this", capture to feed
 * - query: "what's in my...", "show me...", "list..."
 * - status: "how's...", "status on...", "where are we"
 * - lookup: "find...", "search...", "what did we decide"
 * - action: "mark X as...", "complete...", "archive..."
 * - chat: Conversational, general chat
 */

import type { MessageIntent, IntentDetectionResult, IntentEntities, Pillar } from "./types";
import { containsUrl, extractFirstUrl } from "./url";
import { detectIntentWithClaude } from "./claude";
import { logger } from "./logger";

// ==========================================
// Heuristic Patterns
// ==========================================

/** Patterns that strongly indicate a query intent */
const QUERY_PATTERNS = [
  /^(what'?s?|show|list|how many|give me)\b/i,
  /\b(feed|queue|pending|items?|tasks?)\b/i,
  /^(what|which|how many)\b.*\?$/i,
];

/** Patterns that indicate status/dashboard intent */
const STATUS_PATTERNS = [
  /^(how'?s?|status|where are we|what'?s? (the )?(status|progress))/i,
  /\b(sprint|progress|overview|dashboard|summary)\b/i,
  /^status$/i,
];

/** Patterns that indicate lookup/search intent */
const LOOKUP_PATTERNS = [
  /^(find|search|look for|where'?s?|what did we)\b/i,
  /\b(search|looking for|that.*about)\b/i,
];

/** Patterns that indicate action intent */
const ACTION_PATTERNS = [
  /^(mark|complete|archive|dismiss|close|done|finish)\b/i,
  /\b(as (done|complete|archived|dismissed))\b/i,
  /\b(mark.*as|set.*to)\b/i,
];

/** Signals that indicate spark/capture intent */
const SPARK_SIGNALS = [
  /^(save|capture|add|log|note)\b/i,
  /#(grove|atlas|home|personal|consulting)\b/i,
  /^check (this|out)\b/i,
];

/** Conversational patterns that indicate chat intent */
const CHAT_PATTERNS = [
  /^(hey|hi|hello|yo|sup|thanks|thank you|ok|okay|cool|nice|good|great)\b/i,
  /^(what do you think|how are you|can you help)\b/i,
  /^\?+$/,  // Just question marks
];

// ==========================================
// Entity Extraction
// ==========================================

/** Extract pillar from message */
function extractPillar(text: string): Pillar | undefined {
  const lowerText = text.toLowerCase();

  if (/\b(grove|ai|research|venture)\b/.test(lowerText)) return "The Grove";
  if (/\b(personal|health|relationship|growth|finance)\b/.test(lowerText)) return "Personal";
  if (/\b(consult|client|drumwave|take ?flight)\b/.test(lowerText)) return "Consulting";
  if (/\b(home|garage|house|vehicle)\b/.test(lowerText)) return "Home";

  return undefined;
}

/** Extract action type from message */
function extractActionType(text: string): IntentEntities["actionType"] | undefined {
  const lowerText = text.toLowerCase();

  if (/\b(complete|done|finish)\b/.test(lowerText)) return "complete";
  if (/\b(archive)\b/.test(lowerText)) return "archive";
  if (/\b(dismiss|remove|delete)\b/.test(lowerText)) return "dismiss";
  if (/\b(defer|later|postpone)\b/.test(lowerText)) return "defer";

  return undefined;
}

/** Extract query terms from message */
function extractQueryTerms(text: string): string | undefined {
  // Remove common query words to get the search terms
  const cleaned = text
    .replace(/^(what'?s?|show|list|find|search|how many|give me|look for)\s+/i, "")
    .replace(/\b(in|my|the|inbox|queue|items?|tasks?)\b/gi, "")
    .replace(/\?+$/, "")
    .trim();

  return cleaned.length > 0 ? cleaned : undefined;
}

// ==========================================
// Heuristic Detection
// ==========================================

/**
 * Calculate match score for a set of patterns
 */
function matchPatterns(text: string, patterns: RegExp[]): number {
  let matches = 0;
  for (const pattern of patterns) {
    if (pattern.test(text)) {
      matches++;
    }
  }
  return matches / patterns.length;
}

/**
 * Detect intent using heuristic patterns (fast path)
 */
function detectIntentHeuristic(text: string): IntentDetectionResult {
  const hasUrl = containsUrl(text);

  // Collect scores for each intent
  const scores: Record<MessageIntent, number> = {
    spark: 0,
    query: 0,
    status: 0,
    lookup: 0,
    action: 0,
    chat: 0,
  };

  // URL is a strong signal for spark
  if (hasUrl) {
    scores.spark += 0.7;
  }

  // Check spark signals
  const sparkScore = matchPatterns(text, SPARK_SIGNALS);
  scores.spark += sparkScore * 0.3;

  // Check query patterns
  const queryScore = matchPatterns(text, QUERY_PATTERNS);
  scores.query = queryScore;

  // Check status patterns
  const statusScore = matchPatterns(text, STATUS_PATTERNS);
  scores.status = statusScore;

  // Check lookup patterns
  const lookupScore = matchPatterns(text, LOOKUP_PATTERNS);
  scores.lookup = lookupScore;

  // Check action patterns
  const actionScore = matchPatterns(text, ACTION_PATTERNS);
  scores.action = actionScore;

  // Check chat patterns
  const chatScore = matchPatterns(text, CHAT_PATTERNS);
  scores.chat = chatScore * 0.8; // Slightly lower weight for chat

  // Short messages with no clear intent lean toward chat
  if (text.length < 20 && !hasUrl && Object.values(scores).every(s => s < 0.3)) {
    scores.chat += 0.4;
  }

  // Find the highest scoring intent
  let maxScore = 0;
  let detectedIntent: MessageIntent = "chat";

  for (const [intent, score] of Object.entries(scores)) {
    if (score > maxScore) {
      maxScore = score;
      detectedIntent = intent as MessageIntent;
    }
  }

  // Convert score to confidence (0-100)
  const confidence = Math.min(100, Math.round(maxScore * 100));

  // Build entities based on detected intent
  const entities: IntentEntities = {};

  if (detectedIntent === "spark" && hasUrl) {
    entities.url = extractFirstUrl(text) || undefined;
  }

  if (["query", "lookup"].includes(detectedIntent)) {
    entities.query = extractQueryTerms(text);
    entities.pillar = extractPillar(text);
  }

  if (detectedIntent === "action") {
    entities.actionType = extractActionType(text);
    entities.query = extractQueryTerms(text); // For finding the target item
  }

  // Generate reasoning
  const reasoningParts: string[] = [];
  if (hasUrl) reasoningParts.push("contains URL");
  if (queryScore > 0.3) reasoningParts.push("query keywords detected");
  if (statusScore > 0.3) reasoningParts.push("status keywords detected");
  if (lookupScore > 0.3) reasoningParts.push("search keywords detected");
  if (actionScore > 0.3) reasoningParts.push("action keywords detected");
  if (chatScore > 0.3) reasoningParts.push("conversational tone");

  const reasoning = reasoningParts.length > 0
    ? `Heuristic: ${reasoningParts.join(", ")}`
    : "Heuristic: no strong signals, defaulting to chat";

  return {
    intent: detectedIntent,
    confidence,
    reasoning,
    entities,
  };
}

// ==========================================
// Main Detection Function
// ==========================================

/** Confidence threshold below which we use Claude fallback */
const CLAUDE_FALLBACK_THRESHOLD = 60;

/**
 * Detect intent from a message
 *
 * Uses fast heuristic detection first, falls back to Claude
 * for ambiguous cases.
 */
export async function detectIntent(text: string): Promise<IntentDetectionResult> {
  logger.debug("Detecting intent", { text: text.substring(0, 100) });

  // Try heuristic detection first (fast path)
  const heuristicResult = detectIntentHeuristic(text);

  logger.info("Heuristic intent detection", {
    intent: heuristicResult.intent,
    confidence: heuristicResult.confidence,
  });

  // If confidence is high enough, use heuristic result
  if (heuristicResult.confidence >= CLAUDE_FALLBACK_THRESHOLD) {
    return heuristicResult;
  }

  // Fall back to Claude for ambiguous cases
  try {
    const claudeResult = await detectIntentWithClaude(text, heuristicResult);

    logger.info("Claude intent detection", {
      intent: claudeResult.intent,
      confidence: claudeResult.confidence,
    });

    return claudeResult;
  } catch (error) {
    logger.warn("Claude intent detection failed, using heuristic", { error });
    return heuristicResult;
  }
}

/**
 * Quick check if message looks like a spark (for fast path)
 */
export function looksLikeSpark(text: string): boolean {
  return containsUrl(text) || SPARK_SIGNALS.some(p => p.test(text));
}

/**
 * Quick check if message looks like a query
 */
export function looksLikeQuery(text: string): boolean {
  return QUERY_PATTERNS.some(p => p.test(text));
}

/**
 * Quick check if message looks like a status request
 */
export function looksLikeStatus(text: string): boolean {
  return STATUS_PATTERNS.some(p => p.test(text));
}
