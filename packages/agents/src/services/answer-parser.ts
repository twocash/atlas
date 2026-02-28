/**
 * Answer Parser — Socratic Answer → Structured Routing Signals
 *
 * Parses ResolvedContext into ParsedRouting with thesis_hook extraction,
 * intent classification, and depth inference from natural language.
 *
 * Sprint: ATLAS-RESEARCH-INTEL-001
 */

import type { ResolvedContext } from '../socratic/types';
import type { ResearchDepth, ResearchVoice } from '../agents/research';
import type { Pillar } from '../types';
import type { ParsedRouting, ResearchIntent } from '../types/research-v2';

// ─── Thesis Hook Extraction ─────────────────────────────

/**
 * Known thesis-hook keywords that map to POV Library entries.
 * Keys are lowercase keywords/phrases; values are slug-style hooks.
 *
 * When Jim says "epistemic capture through Grove lens", we extract
 * "epistemic_capture" as the thesis hook for POV Library lookup.
 */
const THESIS_HOOK_KEYWORDS: Record<string, string> = {
  'epistemic capture': 'epistemic_capture',
  'epistemic': 'epistemic_capture',
  'infrastructure concentration': 'ai_infrastructure_concentration',
  'ai concentration': 'ai_infrastructure_concentration',
  'data marketplace': 'data_marketplace',
  'data economics': 'data_marketplace',
  'attention economy': 'attention_economy',
  'cognitive load': 'cognitive_load',
  'agent architecture': 'agent_architecture',
  'mcp protocol': 'mcp_protocol',
  'model collapse': 'model_collapse',
  'open source ai': 'open_source_ai',
  'ai governance': 'ai_governance',
  'compute sovereignty': 'compute_sovereignty',
};

/**
 * Directives that carry no thesis information.
 * These should NOT be treated as thesis hooks.
 */
const DIRECTIVE_PATTERNS = [
  /^(research|look\s*into|dig\s*into|check\s*(it\s+)?out|go\s*deep|explore|investigate|analyze|summarize|read)\s*(it|this|that|the\s*post|the\s*article)?\.?\s*$/i,
  /^(deep\s*dive|go\s*for\s*it|do\s*it|yes\s*please|full\s*send|let'?s?\s*go)\s*\.?\s*$/i,
  /^(what\s*do\s*you\s*think|tell\s*me\s*more|what'?s?\s*there)\s*\??\s*$/i,
];

function isDirective(text: string): boolean {
  return DIRECTIVE_PATTERNS.some(p => p.test(text.trim()));
}

/**
 * Extract a thesis hook from natural language.
 * Returns undefined if no recognizable hook is found (not an error).
 */
function extractThesisHook(text: string): string | undefined {
  if (!text || text.length < 5) return undefined;
  if (isDirective(text)) return undefined;

  const lower = text.toLowerCase();

  // Check known keyword mappings (longest match first)
  const entries = Object.entries(THESIS_HOOK_KEYWORDS)
    .sort((a, b) => b[0].length - a[0].length);

  for (const [keyword, slug] of entries) {
    if (lower.includes(keyword)) {
      return slug;
    }
  }

  // No known hook found — if the text looks like an assertive thesis
  // (contains claim-like structure), use it as a raw hook for fuzzy matching
  if (text.length > 20 && !text.endsWith('?') && !isDirective(text)) {
    // Normalize to a slug-like form for POV fuzzy matching
    const slug = text.trim()
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, '')
      .replace(/\s+/g, '_')
      .slice(0, 60);
    return slug || undefined;
  }

  return undefined;
}

// ─── Depth Inference ────────────────────────────────────

/** Language signals that imply specific depth levels */
const DEPTH_SIGNALS: { pattern: RegExp; depth: ResearchDepth }[] = [
  // Deep signals
  { pattern: /\b(risk|threat|danger|critical|stakes)\b/i, depth: 'deep' },
  { pattern: /\b(deep\s*dive|thorough|comprehensive|exhaustive|rigorous)\b/i, depth: 'deep' },
  { pattern: /\b(counter[- ]?argument|challenge|debunk|refute)\b/i, depth: 'deep' },
  { pattern: /\b(grove[- ]?grade|primary\s*sources|quantitative)\b/i, depth: 'deep' },
  // Light signals
  { pattern: /\b(quick|brief|summary|overview|skim|glance|tldr)\b/i, depth: 'light' },
  { pattern: /\b(just\s*the\s*basics|high[- ]?level|headline)\b/i, depth: 'light' },
];

function inferDepth(text: string, defaultDepth: ResearchDepth): ResearchDepth {
  if (!text) return defaultDepth;

  for (const { pattern, depth } of DEPTH_SIGNALS) {
    if (pattern.test(text)) return depth;
  }

  return defaultDepth;
}

// ─── Intent Classification ──────────────────────────────

const INTENT_KEYWORDS: { pattern: RegExp; intent: ResearchIntent }[] = [
  { pattern: /\b(compare|versus|vs\.?|difference|trade[- ]?off)\b/i, intent: 'compare' },
  { pattern: /\b(validate|verify|confirm|prove|check\s*if)\b/i, intent: 'validate' },
  { pattern: /\b(challenge|counter|debunk|refute|poke\s*holes)\b/i, intent: 'challenge' },
  { pattern: /\b(synthesize|combine|integrate|weave|connect)\b/i, intent: 'synthesize' },
];

function classifyIntent(
  resolvedIntent: string,
  userDirection?: string,
): ResearchIntent {
  // Check user direction for explicit intent keywords first
  if (userDirection) {
    for (const { pattern, intent } of INTENT_KEYWORDS) {
      if (pattern.test(userDirection)) return intent;
    }
  }

  // Map from Socratic IntentType to ResearchIntent
  switch (resolvedIntent) {
    case 'research': return 'explore';
    case 'draft': return 'synthesize';
    case 'analyze': return 'validate';
    default: return 'explore';
  }
}

// ─── Voice Extraction ───────────────────────────────────

const VOICE_SIGNALS: { pattern: RegExp; voice: ResearchVoice }[] = [
  { pattern: /\b(punchy|linkedin|thought\s*leadership)\b/i, voice: 'linkedin-punchy' },
  { pattern: /\b(analytical|academic|grove)\b/i, voice: 'atlas-research' },
  { pattern: /\b(consulting|client|executive)\b/i, voice: 'consulting' },
  { pattern: /\b(raw|notes|quick)\b/i, voice: 'raw-notes' },
];

function extractVoice(text: string): ResearchVoice | undefined {
  if (!text) return undefined;
  for (const { pattern, voice } of VOICE_SIGNALS) {
    if (pattern.test(text)) return voice;
  }
  return undefined;
}

// ─── Focus Hints ────────────────────────────────────────

/** Extract meaningful keywords from text for focus narrowing */
function extractFocusHints(text: string): string[] {
  if (!text || text.length < 5) return [];

  // Remove stop words and extract substantive terms
  const STOP_WORDS = new Set([
    'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
    'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
    'should', 'may', 'might', 'shall', 'can', 'need', 'must',
    'i', 'me', 'my', 'we', 'our', 'you', 'your', 'he', 'she', 'it',
    'they', 'them', 'their', 'this', 'that', 'these', 'those',
    'of', 'in', 'to', 'for', 'with', 'on', 'at', 'from', 'by', 'about',
    'into', 'through', 'during', 'before', 'after', 'above', 'below',
    'and', 'but', 'or', 'nor', 'not', 'so', 'yet', 'both', 'either',
    'research', 'look', 'find', 'check', 'get', 'want', 'think', 'lens',
  ]);

  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 2 && !STOP_WORDS.has(w))
    .slice(0, 8); // cap at 8 hints
}

// ─── Main Parser ────────────────────────────────────────

/**
 * Parse a Socratic ResolvedContext into structured routing signals.
 *
 * Extracts thesis_hook, intent, depth, voice, and focus_hints from
 * the resolved context's extraContext and natural language signals.
 *
 * @param resolved - The resolved context from Socratic engine
 * @returns ParsedRouting with all available signals (missing = undefined)
 */
export function parseAnswerToRouting(resolved: ResolvedContext): ParsedRouting {
  const userDirection = resolved.extraContext?.userDirection || '';
  const contentTopic = resolved.contentTopic || '';

  // Combine user direction + content topic for signal extraction
  const signalText = [userDirection, contentTopic].filter(Boolean).join(' ');

  // Map DepthLevel ('quick'|'standard'|'deep') to ResearchDepth ('light'|'standard'|'deep')
  const baseDepth: ResearchDepth = resolved.depth === 'quick' ? 'light' : (resolved.depth as ResearchDepth);

  return {
    pillar: resolved.pillar,
    depth: inferDepth(signalText, baseDepth),
    thesisHook: extractThesisHook(signalText),
    intent: classifyIntent(resolved.intent, userDirection),
    voice: extractVoice(signalText),
    focusHints: extractFocusHints(signalText),
    focusDirection: userDirection.trim().length > 0
      ? userDirection.trim().slice(0, 500)
      : undefined,
  };
}

// Exported for testing
export { extractThesisHook, inferDepth, classifyIntent, extractFocusHints, isDirective };
