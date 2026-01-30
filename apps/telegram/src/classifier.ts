/**
 * Atlas Telegram Bot - SPARKS Classification
 * 
 * Classifies sparks using the SPARKS.md framework.
 * 
 * @see IMPLEMENTATION.md Sprint 2.3 for requirements
 * @see workspace/SPARKS.md for classification rules
 */

import type { 
  ClassificationResult, 
  UrlContent, 
  Pillar, 
  Intent 
} from "./types";
import { logger } from "./logger";

// Confidence thresholds
export const CONFIDENCE_THRESHOLDS = {
  AUTO_CLASSIFY: 90,    // 90%+ = auto-classify with single confirm
  CLASSIFY_CAVEAT: 70,  // 70-90% = classify with caveat
  QUICK_CLARIFY: 50,    // 50-70% = quick clarification (A/B/C)
  MUST_ASK: 0,          // <50% = must ask
};

/**
 * Classify a spark using SPARKS.md framework
 * 
 * TODO: This is a stub. Sprint 2.3 will implement Claude integration.
 */
export async function classifySpark(
  message: string,
  urlContent?: UrlContent
): Promise<ClassificationResult> {
  logger.debug("Classifying spark", { message, hasUrl: !!urlContent });

  // TODO: Sprint 2.3 - Send to Claude with SPARKS.md context
  // For now, return mock classification based on simple heuristics

  const result = applySimpleHeuristics(message, urlContent);
  
  logger.info("Classification result", { 
    pillar: result.pillar, 
    intent: result.intent, 
    confidence: result.confidence 
  });

  return result;
}

/**
 * Simple heuristic-based classification (placeholder for Claude)
 */
function applySimpleHeuristics(
  message: string,
  urlContent?: UrlContent
): ClassificationResult {
  const text = `${message} ${urlContent?.title || ""} ${urlContent?.description || ""}`.toLowerCase();

  // Check for explicit signals
  if (text.includes("#grove") || text.includes("for grove")) {
    return makeResult("The Grove", "Research", 95, "Explicit #grove tag");
  }
  if (text.includes("#atlas") || text.includes("we should try")) {
    return makeResult("The Grove", "Build", 95, "Explicit #atlas tag");
  }
  if (text.includes("#home") || text.includes("#garage")) {
    return makeResult("Home", "Task", 95, "Explicit #home tag");
  }
  if (text.includes("#personal")) {
    return makeResult("Personal", "Reference", 95, "Explicit #personal tag");
  }

  // URL-based heuristics
  const url = urlContent?.url || "";
  
  if (url.includes("arxiv.org") || url.includes("papers.")) {
    return makeResult("The Grove", "Catalog", 90, "Academic paper URL");
  }
  if (url.includes("github.com")) {
    // Check for Grove vs Atlas keywords
    if (text.includes("agent") || text.includes("ai") || text.includes("llm")) {
      return makeResult("The Grove", "Build", 75, "GitHub repo with AI keywords");
    }
    return makeResult("The Grove", "Reference", 60, "GitHub repo, needs clarification");
  }
  if (url.includes("linkedin.com")) {
    return makeResult("The Grove", "Content", 80, "LinkedIn content");
  }
  if (url.includes("homedepot") || url.includes("lowes")) {
    return makeResult("Home", "Task", 95, "Home improvement store");
  }

  // Keyword-based heuristics
  if (containsGroveKeywords(text)) {
    return makeResult("The Grove", "Research", 70, "Grove-related keywords detected");
  }
  if (containsHomeKeywords(text)) {
    return makeResult("Home", "Task", 70, "Home-related keywords detected");
  }
  if (containsPersonalKeywords(text)) {
    return makeResult("Personal", "Reference", 70, "Personal keywords detected");
  }

  // Low confidence fallback
  return makeResult("The Grove", "Reference", 40, "No strong signals, needs clarification");
}

/**
 * Create a classification result
 */
function makeResult(
  pillar: Pillar,
  intent: Intent,
  confidence: number,
  reasoning: string
): ClassificationResult {
  return {
    pillar,
    intent,
    confidence,
    reasoning,
    tags: [],
    suggestedTitle: "",
  };
}

/**
 * Check for Grove-related keywords
 */
function containsGroveKeywords(text: string): boolean {
  const keywords = [
    "distributed", "decentralized", "edge", "p2p", "local-first",
    "collective", "knowledge graph", "multi-agent",
    "ai infrastructure", "federated", "open source ai"
  ];
  return keywords.some(kw => text.includes(kw));
}

/**
 * Check for Home-related keywords
 */
function containsHomeKeywords(text: string): boolean {
  const keywords = [
    "construction", "renovation", "permit", "inspection",
    "contractor", "lumber", "concrete", "tools", "workshop",
    "garage", "repair", "hvac", "electrical", "plumbing"
  ];
  return keywords.some(kw => text.includes(kw));
}

/**
 * Check for Personal keywords
 */
function containsPersonalKeywords(text: string): boolean {
  const keywords = [
    "health", "fitness", "diet", "sleep", "exercise",
    "family", "travel", "vacation", "learning", "books", "reading"
  ];
  return keywords.some(kw => text.includes(kw));
}

/**
 * Determine if clarification is needed based on confidence
 */
export function needsClarification(confidence: number): boolean {
  return confidence < CONFIDENCE_THRESHOLDS.CLASSIFY_CAVEAT;
}

/**
 * Determine the clarification type needed
 */
export function getClarificationType(
  confidence: number
): "auto" | "caveat" | "quick" | "must_ask" {
  if (confidence >= CONFIDENCE_THRESHOLDS.AUTO_CLASSIFY) {
    return "auto";
  }
  if (confidence >= CONFIDENCE_THRESHOLDS.CLASSIFY_CAVEAT) {
    return "caveat";
  }
  if (confidence >= CONFIDENCE_THRESHOLDS.QUICK_CLARIFY) {
    return "quick";
  }
  return "must_ask";
}
