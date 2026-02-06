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
import type { Pillar, RequestType } from '../conversation/types';
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

const TriageResultSchema = z.object({
  intent: z.enum(['command', 'capture', 'query', 'clarify']),
  confidence: z.number().min(0).max(1),
  command: TriageCommandSchema.optional(),
  title: z.string().max(80).optional(),  // Allow slight overflow, truncate later
  titleRationale: z.string().optional(),
  pillar: z.string(),  // Validated against Pillar type downstream
  requestType: z.string(),
  keywords: z.array(z.string()).default([]),
  complexityTier: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).default(1),
  suggestedModel: z.string().optional(),
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
  "suggestedModel": "..."
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
// Prompt Builder
// ==========================================

function buildTriagePrompt(
  messageText: string,
  contentPreview?: string,
  patternExamples?: string[]
): string {
  const parts: string[] = [];

  parts.push(`Message to triage:\n"${messageText}"`);

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

function fallbackTriage(messageText: string): TriageResult {
  logger.warn('[Triage] Using fallback triage', { messageLength: messageText.length });

  return {
    intent: 'capture',
    confidence: 0.3,
    pillar: 'The Grove',
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
 * Triage a message using Haiku.
 *
 * Returns intent, title, classification, and complexity tier in a single call.
 */
export async function triageMessage(
  messageText: string,
  options?: TriageOptions
): Promise<TriageResult> {
  const start = Date.now();

  try {
    const anthropic = getAnthropicClient();

    const userPrompt = buildTriagePrompt(
      messageText,
      options?.contentPreview,
      options?.patternExamples
    );

    logger.debug('[Triage] Calling Haiku', {
      messageLength: messageText.length,
      hasContentPreview: !!options?.contentPreview,
      exampleCount: options?.patternExamples?.length ?? 0,
    });

    const response = await anthropic.messages.create({
      model: TASK_MODEL_MAP.classification,
      max_tokens: 400,
      system: TRIAGE_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userPrompt }],
    });

    const latencyMs = Date.now() - start;

    // Extract text response
    const textBlock = response.content.find(b => b.type === 'text');
    if (!textBlock || textBlock.type !== 'text') {
      logger.error('[Triage] No text response from Haiku');
      return fallbackTriage(messageText);
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

    // Map to proper types
    const result: TriageResult = {
      intent: validated.intent,
      confidence: validated.confidence,
      command: validated.command,
      title: truncateTitle(validated.title),
      titleRationale: validated.titleRationale,
      pillar: validatePillar(validated.pillar),
      requestType: validateRequestType(validated.requestType),
      keywords: validated.keywords,
      complexityTier: validated.complexityTier,
      suggestedModel: validated.suggestedModel,
      source: 'haiku',
      latencyMs,
    };

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
      latencyMs,
      hasTitle: !!result.title,
      hasCommand: !!result.command,
    });

    return result;
  } catch (error) {
    logger.error('[Triage] Failed', {
      error: error instanceof Error ? error.message : String(error),
      latencyMs: Date.now() - start,
    });
    return fallbackTriage(messageText);
  }
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
