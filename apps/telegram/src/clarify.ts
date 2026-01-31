/**
 * Atlas Telegram Bot - Clarification System
 * 
 * Generates 10-second clarification questions based on classification confidence.
 * 
 * @see IMPLEMENTATION.md Sprint 2.4 for requirements
 * @see workspace/SPARKS.md for the 10-second rule
 */

import { InlineKeyboard } from "grammy";
import type { 
  ClassificationResult, 
  UrlContent, 
  Pillar, 
  Intent,
  ClarificationOption 
} from "./types";
import { getClarificationType } from "./classifier";
import { getUrlDomain } from "./url";
import { logger } from "./logger";

/**
 * Generate a clarification question based on classification result
 */
export function generateClarificationQuestion(
  classification: ClassificationResult,
  urlContent?: UrlContent
): { question: string; options: ClarificationOption[] } {
  const clarifyType = getClarificationType(classification.confidence);
  const domain = urlContent?.url ? getUrlDomain(urlContent.url) : null;
  const title = urlContent?.title || "this content";

  logger.debug("Generating clarification", { 
    type: clarifyType, 
    confidence: classification.confidence 
  });

  switch (clarifyType) {
    case "auto":
      return generateAutoConfirm(classification, title, domain);
    case "caveat":
      return generateCaveatConfirm(classification, title, domain);
    case "quick":
      return generateQuickClarification(classification, title, domain);
    case "must_ask":
      return generateMustAsk(classification, title, domain);
    default:
      return generateMustAsk(classification, title, domain);
  }
}

/**
 * Auto-classify with single confirm (90%+ confidence)
 */
function generateAutoConfirm(
  classification: ClassificationResult,
  title: string,
  domain: string | null
): { question: string; options: ClarificationOption[] } {
  const source = domain ? `${domain}: ` : "";
  const shortTitle = title.length > 50 ? title.substring(0, 47) + "..." : title;

  return {
    question: `${source}${shortTitle} → ${classification.pillar} ${classification.intent.toLowerCase()}?`,
    options: [
      { text: "✓ Confirm", data: "confirm", pillar: classification.pillar, intent: classification.intent },
      { text: "Change", data: "change" },
      { text: "✗ Dismiss", data: "dismiss" },
    ],
  };
}

/**
 * Classify with caveat (70-90% confidence)
 */
function generateCaveatConfirm(
  classification: ClassificationResult,
  title: string,
  domain: string | null
): { question: string; options: ClarificationOption[] } {
  const source = domain ? `${domain}: ` : "";
  const shortTitle = title.length > 40 ? title.substring(0, 37) + "..." : title;

  return {
    question: `${source}${shortTitle}\n\nLooks like ${classification.pillar} ${classification.intent.toLowerCase()}. Correct?`,
    options: [
      { text: "✓ Yes", data: "confirm", pillar: classification.pillar, intent: classification.intent },
      { text: "Different pillar", data: "change_pillar" },
      { text: "Different intent", data: "change_intent" },
      { text: "✗ Dismiss", data: "dismiss" },
    ],
  };
}

/**
 * Quick clarification (50-70% confidence)
 */
function generateQuickClarification(
  classification: ClassificationResult,
  title: string,
  domain: string | null
): { question: string; options: ClarificationOption[] } {
  const source = domain ? `${domain}: ` : "";
  const shortTitle = title.length > 40 ? title.substring(0, 37) + "..." : title;

  // Generate pillar-specific options
  if (classification.pillar === "The Grove") {
    return {
      question: `${source}${shortTitle}\n\nGrove-related. What's the intent?`,
      options: [
        { text: "A) Evaluate for Atlas", data: "grove_atlas", pillar: "The Grove", intent: "Build" },
        { text: "B) Research corpus", data: "grove_research", pillar: "The Grove", intent: "Catalog" },
        { text: "C) Content seed", data: "grove_content", pillar: "The Grove", intent: "Content" },
        { text: "D) Just reference", data: "grove_ref", pillar: "The Grove", intent: "Reference" },
      ],
    };
  }

  // Generic pillar clarification
  return {
    question: `${source}${shortTitle}\n\nWhich pillar?`,
    options: [
      { text: "A) Grove", data: "pillar_grove", pillar: "The Grove", intent: classification.intent },
      { text: "B) Personal", data: "pillar_personal", pillar: "Personal", intent: classification.intent },
      { text: "C) Consulting", data: "pillar_consulting", pillar: "Consulting", intent: classification.intent },
      { text: "D) Home", data: "pillar_home", pillar: "Home", intent: classification.intent },
    ],
  };
}

/**
 * Must ask clarification (<50% confidence)
 */
function generateMustAsk(
  _classification: ClassificationResult,
  title: string,
  domain: string | null
): { question: string; options: ClarificationOption[] } {
  const source = domain ? `${domain}: ` : "";
  const shortTitle = title.length > 40 ? title.substring(0, 37) + "..." : title;

  return {
    question: `${source}${shortTitle}\n\nNot sure how to classify. What is this?`,
    options: [
      { text: "Grove research", data: "type_grove_research", pillar: "The Grove", intent: "Research" },
      { text: "Grove tool eval", data: "type_grove_build", pillar: "The Grove", intent: "Build" },
      { text: "Personal", data: "type_personal", pillar: "Personal", intent: "Reference" },
      { text: "Home project", data: "type_home", pillar: "Home", intent: "Task" },
      { text: "Consulting", data: "type_consulting", pillar: "Consulting", intent: "Task" },
      { text: "✗ Dismiss", data: "dismiss" },
    ],
  };
}

/**
 * Generate pillar change options
 */
export function generatePillarChangeOptions(): { question: string; options: ClarificationOption[] } {
  return {
    question: "Which pillar should this go to?",
    options: [
      { text: "The Grove", data: "set_pillar_grove", pillar: "The Grove" },
      { text: "Personal", data: "set_pillar_personal", pillar: "Personal" },
      { text: "Consulting", data: "set_pillar_consulting", pillar: "Consulting" },
      { text: "Home", data: "set_pillar_home", pillar: "Home" },
    ],
  };
}

/**
 * Generate intent change options
 */
export function generateIntentChangeOptions(): { question: string; options: ClarificationOption[] } {
  return {
    question: "What's the intent?",
    options: [
      { text: "Research", data: "set_intent_research", intent: "Research" },
      { text: "Build/Evaluate", data: "set_intent_build", intent: "Build" },
      { text: "Content seed", data: "set_intent_content", intent: "Content" },
      { text: "Just reference", data: "set_intent_reference", intent: "Reference" },
      { text: "Task to do", data: "set_intent_task", intent: "Task" },
    ],
  };
}

/**
 * Build an inline keyboard from clarification options
 */
export function buildClarificationKeyboard(
  options: ClarificationOption[]
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  options.forEach((option, index) => {
    keyboard.text(option.text, option.data);
    // New row every 2 buttons (or after odd-numbered button if it's long)
    if ((index + 1) % 2 === 0 || option.text.length > 15) {
      keyboard.row();
    }
  });

  return keyboard;
}

/**
 * Parse callback data to extract pillar/intent
 */
export function parseCallbackData(data: string): { 
  action: string; 
  pillar?: Pillar; 
  intent?: Intent 
} {
  // Handle standard actions
  if (data === "confirm") return { action: "confirm" };
  if (data === "dismiss") return { action: "dismiss" };
  if (data === "change") return { action: "change" };
  if (data === "change_pillar") return { action: "change_pillar" };
  if (data === "change_intent") return { action: "change_intent" };

  // Handle pillar selections
  if (data.startsWith("pillar_") || data.startsWith("set_pillar_")) {
    const pillarMap: Record<string, Pillar> = {
      "grove": "The Grove",
      "personal": "Personal",
      "consulting": "Consulting",
      "home": "Home",
    };
    const key = data.replace("pillar_", "").replace("set_pillar_", "");
    return { action: "set_pillar", pillar: pillarMap[key] };
  }

  // Handle intent selections
  if (data.startsWith("set_intent_")) {
    const intentMap: Record<string, Intent> = {
      "research": "Research",
      "build": "Build",
      "content": "Content",
      "reference": "Reference",
      "task": "Task",
      "catalog": "Catalog",
      "question": "Question",
    };
    const key = data.replace("set_intent_", "");
    return { action: "set_intent", intent: intentMap[key] };
  }

  // Handle Grove-specific shortcuts
  if (data.startsWith("grove_")) {
    const groveMap: Record<string, { pillar: Pillar; intent: Intent }> = {
      "grove_atlas": { pillar: "The Grove", intent: "Build" },
      "grove_research": { pillar: "The Grove", intent: "Catalog" },
      "grove_content": { pillar: "The Grove", intent: "Content" },
      "grove_ref": { pillar: "The Grove", intent: "Reference" },
    };
    const mapping = groveMap[data];
    if (mapping) {
      return { action: "confirm", ...mapping };
    }
  }

  // Handle type shortcuts
  if (data.startsWith("type_")) {
    const typeMap: Record<string, { pillar: Pillar; intent: Intent }> = {
      "type_grove_research": { pillar: "The Grove", intent: "Research" },
      "type_grove_build": { pillar: "The Grove", intent: "Build" },
      "type_personal": { pillar: "Personal", intent: "Reference" },
      "type_home": { pillar: "Home", intent: "Task" },
      "type_consulting": { pillar: "Consulting", intent: "Task" },
    };
    const mapping = typeMap[data];
    if (mapping) {
      return { action: "confirm", ...mapping };
    }
  }

  logger.warn("Unknown callback data", { data });
  return { action: "unknown" };
}

/**
 * Format confirmation message after capture
 */
export function formatConfirmationMessage(
  pillar: Pillar,
  intent: Intent,
  routedToWork: boolean
): string {
  const action = routedToWork 
    ? "→ routing to Work Queue" 
    : "→ classified for review";
  
  return `✓ Captured to Feed (${pillar} / ${intent}) ${action}`;
}
