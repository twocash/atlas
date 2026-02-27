/**
 * Intent Interpreter — LLM-based Conversational Intent Resolution
 *
 * Replaces brittle regex keyword matching with Claude Haiku interpretation.
 * The interpreter understands natural language nuance — "just helping me
 * keep up with trends" is research, not capture.
 *
 * Architecture: Pluggable IntentInterpreter interface with ratchet-down:
 *   HaikuInterpreter (cloud, ~$0.001/call) → RegexFallbackInterpreter (deterministic)
 *
 * @see Notion: Intent Analysis prompt (slug: intent-analysis)
 * @see ADR-001: All prompts from Notion via PromptManager
 * @see ADR-008: Fail fast, fail loud — regex fallback with logging
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
  IntentInterpreter,
  InterpretedIntent,
  InterpretationResult,
  InterpretationContext,
  InterpretationMethod,
} from './types';
import type { IntentType, DepthLevel, AudienceType, Pillar } from '../services/prompt-composition/types';
import { getPromptManager } from '../services/prompt-manager';
import { reportFailure } from '@atlas/shared/error-escalation';

// ==========================================
// Haiku Interpreter (Primary — Cloud LLM)
// ==========================================

/** Prompt slug in Notion System Prompts DB */
const INTENT_PROMPT_SLUG = 'intent-analysis';

/** Model for intent interpretation — env-configurable, never hardcode model IDs */
const HAIKU_MODEL = process.env.ATLAS_INTENT_MODEL || 'claude-haiku-4-5-20251001';

/** Max tokens for intent response (JSON is small) */
const MAX_TOKENS = Number(process.env.ATLAS_INTENT_MAX_TOKENS) || 256;

/** Timeout for the Haiku call — bail to regex if slower than this */
const HAIKU_TIMEOUT_MS = Number(process.env.ATLAS_INTENT_TIMEOUT_MS) || 5_000;

/**
 * Claude Haiku-powered intent interpreter.
 *
 * Resolves the intent-analysis prompt from Notion via PromptManager,
 * hydrates it with the user's answer + content context, and parses
 * the structured JSON response.
 */
export class HaikuInterpreter implements IntentInterpreter {
  readonly name = 'haiku';
  private client: Anthropic;

  constructor(apiKey?: string) {
    const key = apiKey || process.env.ANTHROPIC_API_KEY;
    if (!key) {
      throw new Error('[HaikuInterpreter] ANTHROPIC_API_KEY not set');
    }
    this.client = new Anthropic({ apiKey: key });
  }

  async interpret(
    answer: string,
    context: InterpretationContext,
  ): Promise<InterpretationResult> {
    const start = Date.now();

    // Resolve prompt template from Notion
    const pm = getPromptManager();
    const promptTemplate = await pm.getPromptById(INTENT_PROMPT_SLUG, {
      answer,
      title: context.title || 'Unknown',
      type: context.sourceType || 'unknown',
    });

    if (!promptTemplate) {
      console.warn(`[HaikuInterpreter] Prompt '${INTENT_PROMPT_SLUG}' not found — falling back`);
      throw new Error(`Prompt '${INTENT_PROMPT_SLUG}' not resolved from Notion or local fallback`);
    }

    // Call Haiku with timeout
    const response = await Promise.race([
      this.client.messages.create({
        model: HAIKU_MODEL,
        max_tokens: MAX_TOKENS,
        messages: [{ role: 'user', content: promptTemplate }],
      }),
      timeoutPromise(HAIKU_TIMEOUT_MS),
    ]);

    const latencyMs = Date.now() - start;

    // Extract text
    const textBlock = response.content.find(
      (b: { type: string }) => b.type === 'text'
    ) as { type: 'text'; text: string } | undefined;

    if (!textBlock?.text) {
      throw new Error('[HaikuInterpreter] No text in response');
    }

    const rawResponse = textBlock.text.trim();

    // Parse JSON response
    const parsed = parseIntentJson(rawResponse);

    return {
      interpreted: parsed,
      method: 'haiku' as InterpretationMethod,
      latencyMs,
      rawResponse,
    };
  }
}

// ==========================================
// Regex Fallback Interpreter (Deterministic)
// ==========================================

/**
 * Deterministic regex-based interpreter.
 * Used as fallback when Haiku is unavailable, times out, or returns garbage.
 *
 * This preserves the existing keyword matching from answer-mapper.ts but
 * packages it behind the IntentInterpreter interface for clean composition.
 */
export class RegexFallbackInterpreter implements IntentInterpreter {
  readonly name = 'regex_fallback';

  async interpret(
    answer: string,
    context: InterpretationContext,
  ): Promise<InterpretationResult> {
    const start = Date.now();
    const lower = answer.toLowerCase();

    // Intent detection — action verbs, not incidental words
    let intent: IntentType = 'capture';
    let intentConfidence = 0.5;

    if (matchesAny(lower, ['research', 'look into', 'find out', 'summary', 'summarize', 'analysis', 'analyze', 'intel', 'dig', 'investigate', 'keep up with'])) {
      intent = 'research';
      intentConfidence = 0.7;
    } else if (matchesAny(lower, ['draft', 'write', 'compose', 'thinkpiece', 'blog', 'post', 'article', 'linkedin'])) {
      intent = 'draft';
      intentConfidence = 0.7;
    } else if (matchesAny(lower, ['save', 'bookmark', 'stash', 'file away', 'keep it'])) {
      intent = 'capture';
      intentConfidence = 0.7;
    }
    // NOTE: "just" is deliberately NOT a capture signal here.
    // The old regex matched "just" → capture, causing false positives.

    // Depth detection
    let depth: DepthLevel = 'standard';
    if (matchesAny(lower, ['deep', 'thorough', 'comprehensive', 'full', 'with sources'])) {
      depth = 'deep';
    } else if (matchesAny(lower, ['quick', 'brief', 'summary', 'tldr', 'highlights'])) {
      depth = 'quick';
    }

    // Audience detection
    let audience: AudienceType = 'self';
    if (matchesAny(lower, ['blog', 'linkedin', 'post', 'publish', 'article'])) {
      audience = 'public';
    } else if (matchesAny(lower, ['client', 'deliverable', 'presentation', 'send to'])) {
      audience = 'client';
    }

    // Pillar detection
    let pillar: Pillar | undefined;
    if (matchesAny(lower, ['grove', 'ai', 'tech', 'llm'])) {
      pillar = 'The Grove';
    } else if (matchesAny(lower, ['consulting', 'client', 'drumwave'])) {
      pillar = 'Consulting';
    } else if (matchesAny(lower, ['personal', 'health', 'family', 'fitness'])) {
      pillar = 'Personal';
    } else if (matchesAny(lower, ['home', 'garage', 'car', 'vehicle', 'permit'])) {
      pillar = 'Home/Garage';
    }

    const latencyMs = Date.now() - start;

    return {
      interpreted: {
        intent,
        depth,
        audience,
        confidence: intentConfidence,
        reasoning: `Regex fallback: matched keyword patterns`,
        pillar,
      },
      method: 'regex_fallback' as InterpretationMethod,
      latencyMs,
    };
  }
}

// ==========================================
// Composite Interpreter (Ratchet-Down)
// ==========================================

/**
 * Composite interpreter that tries Haiku first, falls back to regex.
 * This is the default interpreter used by the answer mapper.
 *
 * Ratchet-down pattern:
 *   1. HaikuInterpreter (cloud) — fast, accurate, ~$0.001/call
 *   2. RegexFallbackInterpreter — deterministic, zero-cost
 *   Future: LocalModelInterpreter (8B) as middle tier
 */
export class RatchetInterpreter implements IntentInterpreter {
  readonly name = 'ratchet';
  private primary: IntentInterpreter;
  private fallback: IntentInterpreter;
  private consecutiveFailures = 0;

  constructor(primary?: IntentInterpreter, fallback?: IntentInterpreter) {
    this.primary = primary || new HaikuInterpreter();
    this.fallback = fallback || new RegexFallbackInterpreter();
  }

  async interpret(
    answer: string,
    context: InterpretationContext,
  ): Promise<InterpretationResult> {
    try {
      const result = await this.primary.interpret(answer, context);
      this.consecutiveFailures = 0;
      return result;
    } catch (err) {
      this.consecutiveFailures++;
      const errorMsg = err instanceof Error ? err.message : String(err);

      // CONSTRAINT 4: Fail loud. A single fallback is fine; persistent failure is a system issue.
      console.error(
        `[RatchetInterpreter] PRIMARY FAILED (${this.consecutiveFailures}x consecutive): ` +
        `${this.primary.name} → ${errorMsg}. Falling back to ${this.fallback.name}. ` +
        `Model: ${HAIKU_MODEL}`
      );

      // Autonomaton Loop 1: report to error escalation pipeline.
      // This is the Haiku 404 fix — silent degradation is categorically unacceptable.
      reportFailure('intent-interpreter', err, {
        timestamp: new Date().toISOString(),
        model: HAIKU_MODEL,
        consecutiveFailures: this.consecutiveFailures,
        primaryInterpreter: this.primary.name,
        fallbackInterpreter: this.fallback.name,
        messagePreview: answer.substring(0, 200),
        title: context.title,
        suggestedFix: `Check ATLAS_INTENT_MODEL env var (current: ${HAIKU_MODEL}) and Anthropic API status. If model deprecated, update env var or Notion config.`,
      });

      const fallbackResult = await this.fallback.interpret(answer, context);
      // Mark the result as degraded so downstream consumers know
      return {
        ...fallbackResult,
        method: 'regex_fallback' as InterpretationMethod,
        degradedFrom: this.primary.name,
      };
    }
  }
}

// ==========================================
// Helpers
// ==========================================

/** Timeout promise that rejects after ms */
function timeoutPromise(ms: number): Promise<never> {
  return new Promise((_, reject) =>
    setTimeout(() => reject(new Error(`Haiku timeout after ${ms}ms`)), ms)
  );
}

/** Check if text contains any of the keywords (word-boundary aware where feasible) */
function matchesAny(text: string, keywords: string[]): boolean {
  return keywords.some(kw => text.includes(kw));
}

/**
 * Parse the JSON response from the intent analysis prompt.
 * Handles minor formatting issues (markdown fences, extra whitespace).
 */
function parseIntentJson(raw: string): InterpretedIntent {
  // Strip markdown code fences if present
  let cleaned = raw.replace(/^```(?:json)?\s*\n?/i, '').replace(/\n?```\s*$/i, '');
  cleaned = cleaned.trim();

  try {
    const parsed = JSON.parse(cleaned);

    // Validate required fields with sensible defaults
    const intent = validateIntent(parsed.intent);
    const depth = validateDepth(parsed.depth);
    const audience = validateAudience(parsed.audience);

    return {
      intent,
      depth,
      audience,
      confidence: typeof parsed.confidence === 'number'
        ? Math.min(1, Math.max(0, parsed.confidence))
        : 0.5,
      reasoning: typeof parsed.reasoning === 'string'
        ? parsed.reasoning
        : 'No reasoning provided',
      pillar: parsed.pillar ? validatePillar(parsed.pillar) : undefined,
    };
  } catch (err) {
    throw new Error(`[parseIntentJson] Invalid JSON from model: ${cleaned.substring(0, 200)}`);
  }
}

/** Validate intent type, defaulting to capture */
function validateIntent(raw: unknown): IntentType {
  const valid: IntentType[] = ['research', 'draft', 'capture', 'engage'];
  if (typeof raw === 'string' && valid.includes(raw as IntentType)) {
    return raw as IntentType;
  }
  // Map model-specific values to our types
  if (raw === 'analyze' || raw === 'answer') return 'research';
  return 'capture';
}

/** Validate depth level */
function validateDepth(raw: unknown): DepthLevel {
  const valid: DepthLevel[] = ['quick', 'standard', 'deep'];
  if (typeof raw === 'string' && valid.includes(raw as DepthLevel)) {
    return raw as DepthLevel;
  }
  return 'standard';
}

/** Validate audience type */
function validateAudience(raw: unknown): AudienceType {
  const valid: AudienceType[] = ['self', 'client', 'public'];
  if (typeof raw === 'string' && valid.includes(raw as AudienceType)) {
    return raw as AudienceType;
  }
  return 'self';
}

/** Validate pillar */
function validatePillar(raw: unknown): Pillar | undefined {
  if (typeof raw !== 'string') return undefined;
  const lower = raw.toLowerCase();
  if (lower.includes('grove')) return 'The Grove';
  if (lower.includes('consulting')) return 'Consulting';
  if (lower.includes('personal')) return 'Personal';
  if (lower.includes('home') || lower.includes('garage')) return 'Home/Garage';
  return undefined;
}

// ==========================================
// Factory / Singleton
// ==========================================

let defaultInterpreter: IntentInterpreter | null = null;

/**
 * Get the default intent interpreter.
 * Returns RatchetInterpreter (Haiku → regex fallback) if ANTHROPIC_API_KEY is set,
 * otherwise returns RegexFallbackInterpreter directly.
 */
export function getIntentInterpreter(): IntentInterpreter {
  if (!defaultInterpreter) {
    if (process.env.ANTHROPIC_API_KEY) {
      defaultInterpreter = new RatchetInterpreter();
    } else {
      console.warn('[IntentInterpreter] No ANTHROPIC_API_KEY — using regex fallback only');
      defaultInterpreter = new RegexFallbackInterpreter();
    }
  }
  return defaultInterpreter;
}

/**
 * Inject a custom interpreter (for testing).
 */
export function injectInterpreter(interpreter: IntentInterpreter | null): void {
  defaultInterpreter = interpreter;
}
