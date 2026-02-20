/**
 * Atlas Triage Skill — Unified Haiku Triage
 *
 * Single Haiku call that returns intent + title + classification + complexity tier.
 * Replaces multi-step capture pipeline with one sub-second API roundtrip.
 *
 * Sprint: Triage Intelligence
 * Philosophy: Principle 2 (Decisions Become Defaults) + Principle 1 (Zero Initiation Cost)
 */

import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { TASK_MODEL_MAP } from './models';
import { logger } from '../logger';
import { getFeatureFlags } from '../config/features';
import type { Pillar, RequestType, ClassificationResult } from '../conversation/types';
import { PILLARS, REQUEST_TYPES } from '../conversation/types';

// ==========================================
// Types
// ==========================================

/**
 * Complexity tiers for model routing.
 * Tier 0: Resolved locally from pattern cache (no API call)
 * Tier 1: Haiku handled it (default for triage)
 * Tier 2: Needs Sonnet (long content, ambiguous intent, multi-step commands)
 * Tier 3: Needs Opus/Gemini (research, code gen, deep synthesis)
 */
export type ComplexityTier = 0 | 1 | 2 | 3;

export interface TriageCommand {
  verb: string;        // 'log' | 'create' | 'update' | 'change' | 'dispatch'
  target: string;      // 'bug' | 'task' | 'feature' | 'item'
  priority?: string;   // 'P0' | 'P1' | 'P2' | 'P3'
  description: string; // The actual content, NOT the meta-request
}

/**
 * Sub-intent for compound messages (Bug #6 Fix)
 * Lightweight representation of an additional intent in a multi-intent message
 */
export interface SubIntent {
  intent: 'command' | 'capture' | 'query' | 'clarify';
  description: string;  // Brief description of what this sub-intent is about
  pillar?: Pillar;
  command?: TriageCommand;
}

export interface TriageResult {
  intent: 'command' | 'capture' | 'query' | 'clarify';
  confidence: number; // 0-1

  // Command-specific (only populated when intent === 'command')
  command?: TriageCommand;

  // Capture-specific (only populated when intent === 'capture')
  title?: string;           // ≤60 chars, scannable, descriptive
  titleRationale?: string;  // Why this title (for feedback learning)

  // Always populated
  pillar: Pillar;
  requestType: RequestType;
  keywords: string[];       // For Feed 2.0 Keywords field
  complexityTier: ComplexityTier;
  suggestedModel?: string;  // Human-readable: "haiku sufficient" or "route to sonnet"

  // Metadata
  source: 'pattern_cache' | 'haiku';  // How this result was produced
  latencyMs?: number;

  // Multi-intent (Bug #6 Fix)
  isCompound?: boolean;         // True if message contains multiple intents
  subIntents?: SubIntent[];     // Additional intents beyond the primary
}

// ==========================================
// Zod Schema
// ==========================================

const TriageCommandSchema = z.object({
  verb: z.string(),
  target: z.string(),
  priority: z.string().optional(),
  description: z.string(),
});

// Bug #6: Sub-intent schema for multi-intent parsing
const SubIntentSchema = z.object({
  intent: z.enum(['command', 'capture', 'query', 'clarify']),
  description: z.string(),
  pillar: z.string().optional(),
  command: TriageCommandSchema.optional(),
});

const TriageResultSchema = z.object({
  intent: z.enum(['command', 'capture', 'query', 'clarify']),
  confidence: z.number().min(0).max(1),
  command: TriageCommandSchema.optional().nullable(),
  title: z.string().max(80).optional().nullable(),  // Allow slight overflow, truncate later
  titleRationale: z.string().optional().nullable(),
  pillar: z.string(),  // Validated against Pillar type downstream
  requestType: z.string(),
  keywords: z.array(z.string()).default([]),
  complexityTier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(1),
  suggestedModel: z.string().optional(),
  // Bug #6: Multi-intent support
  isCompound: z.boolean().optional(),
  subIntents: z.array(SubIntentSchema).optional(),
});

// ==========================================
// System Prompt
// ==========================================

const TRIAGE_SYSTEM_PROMPT = `You are Atlas's triage system. Analyze incoming messages and return structured JSON.

## Intent Types

**command** — User is instructing Atlas to do something
Examples:
- "Log a bug about the login page crashing" → verb=log, target=bug, description="login page crashing"
- "Create a P0 for the API timeout" → verb=create, target=task, priority=P0, description="API timeout"
- "Update that bug to P1" → verb=update, target=bug, priority=P1

**capture** — User is sharing content to save/process
Examples:
- URL to an article → capture with descriptive title
- "Idea: we should try X for the onboarding" → capture with title summarizing the idea
- Voice note transcription → capture with topic title

**query** — User is asking Atlas something (no entry created)
Examples:
- "What's in my feed?" → query
- "Status update?" → query
- "How many P0s do I have?" → query

**clarify** — Message is ambiguous, ask user to clarify
Examples:
- "hmm" → clarify
- Single word with no context → clarify

## CRITICAL: Meta-Request Handling

When a user says "log a bug about X" or "create a P0 for Y":
- intent = "command"
- command.description = "X" or "Y" (the SUBJECT, not the instruction)
- DO NOT capture the instruction itself as content

## Valid Pillar Values
${PILLARS.map(p => `- "${p}"`).join('\n')}

## Pillar Classification Rules

**"Home/Garage"** — Physical space, vehicles, house, tools
- Vehicle content: cars, motorcycles, car auctions, Bring a Trailer, BaT, AutoTrader
- Home improvement: permits, contractors, renovations, repairs
- Garage projects: tools, parts, builds
- Examples: "1986 Mercedes 300E listing" → Home/Garage (vehicle)

**"The Grove"** — AI/tech venture, research, architecture
- AI/LLM: Claude, GPT, OpenAI, Anthropic, Hugging Face, LangChain
- Tech: GitHub, programming, code, APIs, developer tools
- Examples: "OpenAI Codex Orchestrator" → The Grove (AI tool)

**"Consulting"** — Client work, professional services
- Clients: DrumWave, Take Flight, client meetings, invoices
- Examples: "DrumWave integration spec" → Consulting

**"Personal"** — Health, relationships, growth, finances
- Health: gym, fitness, medical, nutrition
- Family: kids, spouse, relatives, personal events
- Examples: "gym membership renewal" → Personal

CRITICAL: Vehicles (cars, motorcycles, auctions) are ALWAYS "Home/Garage", NOT "Personal".

## Valid RequestType Values
${REQUEST_TYPES.map(r => `- "${r}"`).join('\n')}

## Title Generation Rules (for capture intent)
- Maximum 60 characters
- Format: "{Topic}: {Key Insight}" when possible
- Be specific and scannable
- NO generic patterns like "article content from domain.com"
- Extract the actual subject matter

## Complexity Tiers
- 0: Pattern cache (not for Haiku to return)
- 1: Haiku sufficient (default)
- 2: Route to Sonnet (long content, ambiguous, multi-step)
- 3: Route to Opus/Gemini (research, code gen, deep synthesis)

## Multi-Intent Detection (Compound Messages)

Some messages contain multiple intents. Look for connectors like "and", "also", "then", "plus".

Examples:
- "Save this article and remind me to read it tomorrow" → capture + command(schedule)
- "Log a bug about X and create a P0 for Y" → command + command
- "What's in my feed? Also, capture this idea about Z" → query + capture

When detected:
- Set "isCompound": true
- Primary intent goes in main fields
- Additional intents go in "subIntents" array
- Each sub-intent needs: intent, description, pillar (optional), command (if applicable)

## Response Format
Return JSON only, no markdown fences. Match this structure exactly:
{
  "intent": "command|capture|query|clarify",
  "confidence": 0.0-1.0,
  "command": { "verb": "...", "target": "...", "priority": "...", "description": "..." },
  "title": "...",
  "titleRationale": "...",
  "pillar": "...",
  "requestType": "...",
  "keywords": ["..."],
  "complexityTier": 1,
  "suggestedModel": "...",
  "isCompound": false,
  "subIntents": []
}`;

// ==========================================
// API Client
// ==========================================

let _anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    _anthropic = new Anthropic();
  }
  return _anthropic;
}

// ==========================================
// Domain-Based Pillar Hints (Bug #8 Fix)
// ==========================================

/**
 * Known domains that should always route to specific pillars.
 * These provide explicit hints to the triage model regardless of content.
 */
const DOMAIN_PILLAR_MAP: Record<string, { pillar: Pillar; category: string }> = {
  // Vehicle/Automotive → Home/Garage
  'bringatrailer.com': { pillar: 'Home/Garage', category: 'vehicle auction' },
  'bat.vin': { pillar: 'Home/Garage', category: 'vehicle auction' },
  'carsandbids.com': { pillar: 'Home/Garage', category: 'vehicle auction' },
  'autotrader.com': { pillar: 'Home/Garage', category: 'vehicle marketplace' },
  'hemmings.com': { pillar: 'Home/Garage', category: 'classic cars' },
  'classiccars.com': { pillar: 'Home/Garage', category: 'classic cars' },
  'carfax.com': { pillar: 'Home/Garage', category: 'vehicle history' },
  'kbb.com': { pillar: 'Home/Garage', category: 'vehicle valuation' },
  'edmunds.com': { pillar: 'Home/Garage', category: 'vehicle research' },
  'cars.com': { pillar: 'Home/Garage', category: 'vehicle marketplace' },
  // AI/LLM/Tech → The Grove
  'openai.com': { pillar: 'The Grove', category: 'AI provider' },
  'anthropic.com': { pillar: 'The Grove', category: 'AI provider' },
  'huggingface.co': { pillar: 'The Grove', category: 'AI/ML' },
  'github.com': { pillar: 'The Grove', category: 'code/dev' },
  'arxiv.org': { pillar: 'The Grove', category: 'research papers' },
};

/**
 * Detect domain-based pillar hint from a message (usually a URL).
 * Returns undefined if no known domain is detected.
 */
function detectDomainPillarHint(message: string): { pillar: Pillar; category: string; domain: string } | undefined {
  // Extract domain from URL if present
  const urlMatch = message.match(/https?:\/\/(?:www\.)?([^\/\s]+)/i);
  if (!urlMatch) return undefined;

  const domain = urlMatch[1].toLowerCase();

  // Check direct match
  if (DOMAIN_PILLAR_MAP[domain]) {
    return { ...DOMAIN_PILLAR_MAP[domain], domain };
  }

  // Check if domain ends with a known pattern (e.g., subdomain.bringatrailer.com)
  for (const [knownDomain, hint] of Object.entries(DOMAIN_PILLAR_MAP)) {
    if (domain.endsWith(knownDomain)) {
      return { ...hint, domain };
    }
  }

  return undefined;
}

// ==========================================
// Prompt Builder
// ==========================================

function buildTriagePrompt(
  messageText: string,
  contentPreview?: string,
  patternExamples?: string[],
  domainHint?: { pillar: Pillar; category: string; domain: string }
): string {
  const parts: string[] = [];

  parts.push(`Message to triage:\n"${messageText}"`);

  // Bug #8 Fix: Add explicit domain hint when detected
  if (domainHint) {
    parts.push(`\n⚠️ DOMAIN SIGNAL: ${domainHint.domain} is a ${domainHint.category} site → pillar MUST be "${domainHint.pillar}"`);
  }

  if (contentPreview) {
    parts.push(`\nURL content preview (first 500 chars):\n"${contentPreview.slice(0, 500)}"`);
  }

  if (patternExamples && patternExamples.length > 0) {
    parts.push(`\nSimilar confirmed examples:\n${patternExamples.map(e => `- ${e}`).join('\n')}`);
  }

  parts.push('\nReturn JSON only.');

  return parts.join('\n');
}

// ==========================================
// Fallback
// ==========================================

function fallbackTriage(
  messageText: string,
  domainHint?: { pillar: Pillar; category: string; domain: string }
): TriageResult {
  // Domain hint overrides default pillar even in fallback
  const pillar = domainHint?.pillar ?? 'The Grove';

  logger.warn('[Triage] Using fallback triage', {
    messageLength: messageText.length,
    domainHint: domainHint ? { domain: domainHint.domain, pillar: domainHint.pillar } : undefined,
    pillar,
  });

  return {
    intent: 'capture',
    confidence: 0.3,
    pillar,
    requestType: 'Quick',
    keywords: [],
    complexityTier: 1,
    suggestedModel: 'fallback - haiku unavailable',
    source: 'pattern_cache', // Fallback acts like cache
  };
}

// ==========================================
// Validation Helpers
// ==========================================

function validatePillar(value: string): Pillar {
  if (PILLARS.includes(value as Pillar)) {
    return value as Pillar;
  }
  // Try to map common variations
  const lower = value.toLowerCase();
  if (lower.includes('personal')) return 'Personal';
  if (lower.includes('grove')) return 'The Grove';
  if (lower.includes('consulting') || lower.includes('client')) return 'Consulting';
  if (lower.includes('home') || lower.includes('garage')) return 'Home/Garage';
  // Default
  return 'The Grove';
}

function validateRequestType(value: string): RequestType {
  if (REQUEST_TYPES.includes(value as RequestType)) {
    return value as RequestType;
  }
  // Try to map common variations
  const lower = value.toLowerCase();
  if (lower.includes('research')) return 'Research';
  if (lower.includes('draft')) return 'Draft';
  if (lower.includes('build') || lower.includes('code')) return 'Build';
  if (lower.includes('schedule') || lower.includes('meeting')) return 'Schedule';
  if (lower.includes('answer') || lower.includes('reply')) return 'Answer';
  if (lower.includes('process')) return 'Process';
  if (lower.includes('triage')) return 'Triage';
  if (lower.includes('chat')) return 'Chat';
  // Default
  return 'Quick';
}

function truncateTitle(title: string | undefined): string | undefined {
  if (!title) return undefined;
  if (title.length <= 60) return title;
  // Truncate at word boundary
  const truncated = title.slice(0, 57);
  const lastSpace = truncated.lastIndexOf(' ');
  if (lastSpace > 40) {
    return truncated.slice(0, lastSpace) + '...';
  }
  return truncated + '...';
}

// ==========================================
// Core Triage Function
// ==========================================

export interface TriageOptions {
  contentPreview?: string;
  patternExamples?: string[];
}

/**
 * Quality check for triage result.
 * Returns true if the result is "good enough" and doesn't need a retry.
 */
function isQualityResult(
  result: TriageResult,
  domainHint?: { pillar: Pillar; category: string; domain: string }
): boolean {
  // Check 1: Reasonable confidence (>0.5 is okay, <0.5 might be flaky)
  if (result.confidence < 0.5) {
    return false;
  }

  // Check 2: If domain hint exists, pillar should match
  if (domainHint && result.pillar !== domainHint.pillar) {
    return false;
  }

  // Check 3: Capture intent should have a title
  if (result.intent === 'capture' && !result.title) {
    return false;
  }

  // Check 4: Command intent should have a command
  if (result.intent === 'command' && !result.command) {
    return false;
  }

  return true;
}

/**
 * Execute a single Haiku triage call.
 * Separated out to enable retry logic.
 */
async function executeHaikuTriage(
  anthropic: Anthropic,
  userPrompt: string,
  isRetry: boolean = false
): Promise<{ success: boolean; result?: z.infer<typeof TriageResultSchema>; error?: string }> {
  try {
    const response = await anthropic.messages.create({
      model: TASK_MODEL_MAP.classification,
      max_tokens: 400,
      system: TRIAGE_SYSTEM_PROMPT + (isRetry ? '\n\nIMPORTANT: Be extra careful with classification. Double-check pillar and intent.' : ''),
      messages: [{ role: 'user', content: userPrompt }],
    });

    // Extract text response
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      return { success: false, error: 'No text response from Haiku' };
    }

    // Parse JSON (handle potential markdown fences)
    let jsonText = textBlock.text.trim();
    if (jsonText.startsWith('```')) {
      const lines = jsonText.split('\n');
      lines.shift(); // Remove first line
      if (lines[lines.length - 1]?.trim() === '```') {
        lines.pop();
      }
      jsonText = lines.join('\n');
    }

    // Parse and validate
    const parsed = JSON.parse(jsonText);
    const validated = TriageResultSchema.parse(parsed);

    return { success: true, result: validated };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Triage a message using Haiku.
 *
 * Returns intent, title, classification, and complexity tier in a single call.
 * Includes retry logic for flaky API responses (Haiku is cheap, so we can afford it).
 */
export async function triageMessage(
  messageText: string,
  options?: TriageOptions
): Promise<TriageResult> {
  const start = Date.now();

  try {
    const anthropic = getAnthropicClient();

    // Bug #8 Fix: Detect domain-based pillar hint for strong routing signals
    const domainHint = detectDomainPillarHint(messageText);

    const userPrompt = buildTriagePrompt(
      messageText,
      options?.contentPreview,
      options?.patternExamples,
      domainHint
    );

    logger.debug('[Triage] Calling Haiku', {
      messageLength: messageText.length,
      hasContentPreview: !!options?.contentPreview,
      exampleCount: options?.patternExamples?.length ?? 0,
      domainHint: domainHint ? { domain: domainHint.domain, pillar: domainHint.pillar } : undefined,
    });

    // First attempt
    const attempt1 = await executeHaikuTriage(anthropic, userPrompt, false);

    if (!attempt1.success || !attempt1.result) {
      logger.error('[Triage] First attempt failed', { error: attempt1.error });
      return fallbackTriage(messageText, domainHint);
    }

    // Build result from first attempt
    let validated = attempt1.result;
    let result = buildTriageResult(validated, Date.now() - start, domainHint);

    // Quality check: retry if result looks flaky
    if (!isQualityResult(result, domainHint)) {
      logger.info('[Triage] First attempt quality check failed, retrying', {
        confidence: result.confidence,
        pillar: result.pillar,
        expectedPillar: domainHint?.pillar,
        hasTitle: !!result.title,
        intent: result.intent,
      });

      // Short delay to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 100));

      // Second attempt with emphasis on accuracy
      const attempt2 = await executeHaikuTriage(anthropic, userPrompt, true);

      if (attempt2.success && attempt2.result) {
        const result2 = buildTriageResult(attempt2.result, Date.now() - start, domainHint);

        // Use second result if it's higher quality
        if (isQualityResult(result2, domainHint) || result2.confidence > result.confidence) {
          logger.info('[Triage] Using retry result', {
            originalConfidence: result.confidence,
            retryConfidence: result2.confidence,
            pillarChanged: result.pillar !== result2.pillar,
          });
          result = result2;
        } else {
          logger.info('[Triage] Retry did not improve, using original');
        }
      }
    }

    // BUG #3 FIX: Low confidence fallback to capture
    // Philosophy: "capture is always safe, asking always adds friction"
    const flags = getFeatureFlags();
    if (flags.lowConfidenceFallbackToCapture) {
      if (result.intent === 'clarify' && result.confidence < 0.5) {
        logger.info('[Triage] Applying low-confidence fallback: clarify → capture', {
          originalConfidence: result.confidence,
          pillar: result.pillar,
        });
        result.intent = 'capture';
        // Keep the best-guess pillar, let the user reclassify if needed
      }
    }

    logger.info('[Triage] Completed', {
      intent: result.intent,
      confidence: result.confidence,
      pillar: result.pillar,
      requestType: result.requestType,
      latencyMs: result.latencyMs,
      hasTitle: !!result.title,
      hasCommand: !!result.command,
      isCompound: result.isCompound ?? false,
      subIntentCount: result.subIntents?.length ?? 0,
    });

    return result;
  } catch (error) {
    logger.error('[Triage] Failed', {
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    });
    return fallbackTriage(messageText, domainHint);
  }
}

/**
 * Build a TriageResult from validated schema data.
 * Separated out to avoid duplication with retry logic.
 */
function buildTriageResult(
  validated: z.infer<typeof TriageResultSchema>,
  latencyMs: number,
  domainHint?: { pillar: Pillar; category: string; domain: string }
): TriageResult {
  // If domain hint exists and Haiku disagreed, override the pillar
  let pillar = validatePillar(validated.pillar);
  if (domainHint && pillar !== domainHint.pillar) {
    logger.debug('[Triage] Domain hint overriding pillar', {
      originalPillar: pillar,
      domainPillar: domainHint.pillar,
      domain: domainHint.domain,
    });
    pillar = domainHint.pillar;
  }

  return {
    intent: validated.intent,
    confidence: validated.confidence,
    command: validated.command,
    title: truncateTitle(validated.title),
    titleRationale: validated.titleRationale,
    pillar,
    requestType: validateRequestType(validated.requestType),
    keywords: validated.keywords,
    complexityTier: validated.complexityTier,
    suggestedModel: validated.suggestedModel,
    source: 'haiku',
    latencyMs,
    // Bug #6: Multi-intent support
    isCompound: validated.isCompound,
    subIntents: validated.subIntents?.map(sub => ({
      intent: sub.intent,
      description: sub.description,
      pillar: sub.pillar ? validatePillar(sub.pillar) : undefined,
      command: sub.command,
    })),
  };
}

/**
 * Create a TriageResult from pattern cache data.
 * Used by triage-patterns.ts when a cache hit occurs.
 */
export function createCachedTriageResult(
  partial: Partial<TriageResult>
): TriageResult {
  return {
    intent: partial.intent ?? 'capture',
    confidence: partial.confidence ?? 0.9,
    command: partial.command,
    title: partial.title,
    titleRationale: partial.titleRationale,
    pillar: partial.pillar ?? 'The Grove',
    requestType: partial.requestType ?? 'Quick',
    keywords: partial.keywords ?? [],
    complexityTier: 0, // Cache hit = Tier 0
    suggestedModel: 'pattern cache hit',
    source: 'pattern_cache',
  };
}

// ==========================================
// Handler Adapters (Tech Debt Refactor)
// ==========================================

/**
 * Classify a message with safe fallback — wraps triageMessage() for handler.ts consumption.
 * Returns ClassificationResult (not TriageResult) for downstream compatibility.
 */
export async function classifyWithFallback(message: string): Promise<ClassificationResult> {
  try {
    const result = await triageMessage(message);
    return {
      pillar: result.pillar,
      requestType: result.requestType,
      confidence: result.confidence,
      workType: result.requestType.toLowerCase(),
      keywords: result.keywords,
      reasoning: result.titleRationale || `Triage: ${result.intent} (${result.source})`,
    };
  } catch (error) {
    logger.warn('[Triage] classifyWithFallback failed, returning safe default', { error });
    return {
      pillar: 'The Grove',
      requestType: 'Chat',
      confidence: 0.5,
      workType: 'general chat',
      keywords: [],
      reasoning: 'Default classification (triage failed)',
    };
  }
}

/**
 * Triage for audit — returns both ClassificationResult and smart title in one call.
 * Replaces the inline TriageResult→ClassificationResult conversion in handler.ts.
 */
export async function triageForAudit(message: string): Promise<{
  classification: ClassificationResult;
  smartTitle: string;
}> {
  try {
    const result = await triageMessage(message);
    return {
      classification: {
        pillar: result.pillar,
        requestType: result.requestType,
        confidence: result.confidence,
        workType: result.requestType.toLowerCase(),
        keywords: result.keywords,
        reasoning: result.titleRationale || `Triage: ${result.intent} (${result.source})`,
      },
      smartTitle: result.title || message.substring(0, 100) || 'Message',
    };
  } catch (error) {
    logger.warn('[Triage] triageForAudit failed, returning safe defaults', { error });
    return {
      classification: {
        pillar: 'The Grove',
        requestType: 'Chat',
        confidence: 0.5,
        workType: 'general chat',
        keywords: [],
        reasoning: 'Default classification (triage failed)',
      },
      smartTitle: message.substring(0, 100) || 'Message',
    };
  }
}
