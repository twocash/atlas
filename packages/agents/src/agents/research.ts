/**
 * Atlas Research Agent
 *
 * Autonomous agent for web research tasks.
 * ADR-010: Decoupled two-phase pipeline:
 *   Phase 1 — Claude Haiku + web_search retrieves URLs deterministically
 *   Phase 2 — Gemini 2.0 Flash synthesizes from provided context (no googleSearch)
 * Fallback: Gemini-with-googleSearch if Claude retrieval returns 0 citations.
 *
 * Research Depths:
 * - light: Quick overview (1-2k tokens, 2-3 sources)
 * - standard: Thorough analysis (5-8k tokens, 5-8 sources)
 * - deep: Academic rigor (15-25k tokens, 10+ sources, Chicago citations)
 */

import type { AgentRegistry } from "../registry";
import type { Agent, AgentResult, AgentMetrics, Pillar } from "../types";
import { getPromptManager, type PromptPillar } from "../services/prompt-manager";
import { degradedWarning, logDegradedFallback } from "../services/degraded-context";
import { resolveDrafterId, resolveDefaultDrafterId } from "../services/prompt-composition/composer";
import { isResearchConfigV2 } from "../types/research-v2";
import { buildResearchPromptV2 } from "../services/research-prompt-v2";
import type { ProvenanceChain } from "../types/provenance";
import { createProvenanceChain, appendPhase, setConfig, setContext, setResult, appendPath, finalizeProvenance } from "../provenance";

// ==========================================
// Research Agent Types
// ==========================================

/**
 * Research depth levels
 */
export type ResearchDepth = "light" | "standard" | "deep";

/**
 * Writing voice/style for research output
 */
export type ResearchVoice =
  | "atlas-research"
  | "linkedin-punchy"
  | "consulting"
  | "raw-notes"
  | "custom";

/**
 * Configuration for a research task
 */
export interface ResearchConfig {
  /** The research query/question */
  query: string;

  /** Research depth - affects rigor, sources, and token budget */
  depth?: ResearchDepth;

  /** Focus area to narrow research */
  focus?: string;

  /** Maximum sources to include (overrides depth default) */
  maxSources?: number;

  /** Writing voice/style for the output */
  voice?: ResearchVoice;

  /** Custom voice instructions (when voice="custom") */
  voiceInstructions?: string;

  /** Context pillar for prompt routing (e.g., "The Grove") */
  pillar?: Pillar;

  /** Specific use case for prompt selection (e.g., "Sprout Generation") */
  useCase?: string;

  /** Query construction mode — 'canonical' uses ADR-003 flow, 'legacy' preserves old behavior.
   * @default 'legacy' — callers opt in to canonical mode as they're migrated */
  queryMode?: 'canonical' | 'legacy';

  /** Extracted content from the source URL — gives Gemini the actual topic context.
   * Critical for social media posts where the query alone is too generic. */
  sourceContent?: string;

  /** Jim's Socratic answer — injected into the research prompt so the agent
   * knows what Jim actually cares about. ATLAS-CEX-001 Contract B. */
  userContext?: string;

  /** Original URL of the shared content — included in research prompt so
   * Google Search grounding can use it for context. */
  sourceUrl?: string;

  /** Provenance chain — initialized by the adapter, accumulated through execution.
   * Sprint A: Pipeline Unification + Provenance Core. */
  provenanceChain?: ProvenanceChain;
}

/**
 * A single research finding with citation
 */
export interface ResearchFinding {
  /** The claim or fact discovered */
  claim: string;

  /** Source description */
  source: string;

  /** URL of the source */
  url: string;

  /** Author if known (for deep research) */
  author?: string;

  /** Publication date if known */
  date?: string;

  /** Relevance score (0-100) */
  relevance?: number;
}

/**
 * Structured research output
 */
export interface ResearchResult {
  /** Executive summary of findings */
  summary: string;

  /** Individual findings with citations */
  findings: ResearchFinding[];

  /** List of all source URLs */
  sources: string[];

  /** The original query */
  query: string;

  /** Focus area if specified */
  focus?: string;

  /** Research depth used */
  depth: ResearchDepth;

  /** Chicago-style bibliography (deep research only) */
  bibliography?: string[];

  /** Output mode: 'prose' when drafter template was used, 'json' for structured output */
  contentMode?: 'prose' | 'json';

  /** Full prose markdown content (only set when contentMode === 'prose') */
  proseContent?: string;
}

// ==========================================
// ADR-003: Canonical Query Construction
// ==========================================

/**
 * Input for building a canonical research query.
 *
 * Priority chain: triageTitle → fallbackTitle → throws.
 * Query is a clean topic description — no raw URLs, no HTML,
 * no navigation chrome, no Socratic answer text.
 */
export interface QueryInput {
  /** Primary query source — the triage-generated descriptive title */
  triageTitle: string;
  /** Focus-narrowing keywords from triage (appended if present) */
  keywords?: string[];
  /** Source URL for context metadata, NOT query content */
  url?: string;
  /** OG / fetched page title if triage unavailable */
  fallbackTitle?: string;
  /** Extracted content from the source URL (used when triage title is generic) */
  sourceContent?: string;
  /** Jim's Socratic answer — what he wants researched. Highest-quality signal when present. */
  userIntent?: string;
}

/** Signals a generic/useless triage title that won't produce good search results.
 *
 * ATLAS-CEX-001: Social media SPAs return their platform marketing `<title>` tag
 * when content extraction fails (e.g., "Pear (@simplpear) on Threads"). These
 * titles cause the research agent to research the PLATFORM instead of the POST.
 * Patterns must catch all common social media title templates. */
const GENERIC_TITLE_PATTERNS = [
  /social\s*media\s*post/i,
  /threads?\s*post/i,
  /twitter\s*post/i,
  /linkedin\s*post/i,
  /instagram\s*(post|reel)/i,
  /^https?:\/\//i,
  // SPA shell titles: "Username (@handle) on Threads", "@handle on X", "Name on LinkedIn"
  /on\s+(threads|x|twitter|linkedin|instagram)\s*$/i,
  // Bare platform names as full title
  /^(threads|x\.com|twitter|linkedin|instagram)\s*$/i,
  // Handle-only titles: "@simplpear" or "(@simplpear)"
  /^@\w+\s*$/,
  /^\(?\s*@\w+\s*\)?\s*$/,
];

export function isGenericTitle(title: string): boolean {
  return GENERIC_TITLE_PATTERNS.some(p => p.test(title));
}

/**
 * Detects low-information directives that pass the length threshold but carry
 * no semantic topic value. These should NOT override extracted source content.
 *
 * Examples: "research it", "go deep", "look into it", "dig in", "check it out"
 */
const DIRECTIVE_PATTERNS = [
  /^(research|look\s*into|dig\s*into|check\s*(it\s+)?out|go\s*deep|explore|investigate|analyze|summarize|read)\s*(it|this|that|the\s*post|the\s*article)?\.?\s*$/i,
  /^(deep\s*dive|go\s*for\s*it|do\s*it|yes\s*please|full\s*send|let'?s?\s*go)\s*\.?\s*$/i,
  /^(what\s*do\s*you\s*think|tell\s*me\s*more|what'?s?\s*there)\s*\??\s*$/i,
];

export function isDirectiveIntent(text: string): boolean {
  return DIRECTIVE_PATTERNS.some(p => p.test(text.trim()));
}

/**
 * Extract a meaningful topic from source content (first ~200 chars of substance).
 * Strips markdown headings, links, images, bare URLs, and leading whitespace.
 *
 * ATLAS-CEX-001: Returns empty string if nothing substantive remains after stripping,
 * which prevents image-only or URL-only content from producing garbage research queries.
 */
function extractTopicFromContent(content: string): string {
  const stripped = content
    .replace(/^#+\s*/gm, '')                  // strip heading markers
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')     // strip markdown images
    .replace(/https?:\/\/\S+/g, '')           // strip bare URLs
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')  // keep link text, strip URL
    .replace(/<[^>]*>/g, '')                   // strip HTML

  const lines = stripped
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.length > 20)      // skip short/empty lines

  // If nothing substantive remains after stripping, bail
  if (lines.length === 0) return '';

  return lines
    .slice(0, 3)                     // first 3 substantial lines
    .join(' ')
    .slice(0, 200)
    .trim();
}

/**
 * Build a canonical research query from triage output.
 *
 * ADR-003 rules:
 * - Query is a clean topic description (< 200 chars)
 * - No raw URLs, HTML tags, or navigation chrome
 * - Socratic answers inform routing (pillar, depth, voice), NOT query text
 * - Keywords append as focus narrowing, capped to budget
 * - When triage title is generic (e.g., "Social Media Post"), extracted
 *   source content is used to derive the actual topic
 *
 * @throws if both triageTitle and fallbackTitle are empty and no sourceContent
 */
export function buildResearchQuery(input: QueryInput): string {
  let title = (input.triageTitle || '').trim() || (input.fallbackTitle || '').trim();

  // User's explicit intent is the highest-quality signal (Socratic answer) —
  // BUT only when it carries actual topic information, not just a directive.
  // "research it" or "go deep" are directives (no topic); "recursive LLMs at the edge" is a topic.
  const hasTopicIntent = input.userIntent
    && input.userIntent.trim().length > 10
    && !isDirectiveIntent(input.userIntent);

  if (hasTopicIntent) {
    const intent = input.userIntent!.trim().slice(0, 150);
    if (title && !isGenericTitle(title)) {
      // Good title + user intent: combine for rich query
      title = `${title} — ${intent}`;
      console.log('[Research] User intent injected alongside good title', {
        triageTitle: input.triageTitle,
        intentPreview: intent.slice(0, 60),
      });
    } else if (input.sourceContent) {
      // Generic title BUT we have extracted content — safe to use intent
      // because extractTopicFromContent() will override at lines 287-296 if better
      title = intent;
      console.log('[Research] User intent REPLACES generic title (sourceContent available as fallback)', {
        triageTitle: input.triageTitle,
        intentPreview: intent.slice(0, 60),
      });
    } else {
      // Generic title AND no sourceContent — answer is direction, not topic
      // Keep generic title; answer goes to userContext only (line 406 in socratic-adapter)
      console.log('[Research] User intent is direction (no sourceContent) — keeping triage title', {
        triageTitle: title,
        intentPreview: intent.slice(0, 60),
      });
    }
  } else if (input.userIntent && isDirectiveIntent(input.userIntent)) {
    console.log('[Research] User intent is a directive, not a topic — deferring to sourceContent', {
      userIntent: input.userIntent.trim(),
    });
  }

  // When triage produces a generic title (or directive intent didn't override),
  // prefer extracted content for the query
  if (input.sourceContent && (!title || isGenericTitle(title))) {
    const contentTopic = extractTopicFromContent(input.sourceContent);
    if (contentTopic.length > 30) {
      console.log('[Research] Triage title is generic — using extracted content for query', {
        triageTitle: title,
        contentTopicPreview: contentTopic.slice(0, 80),
      });
      title = contentTopic;
    }
  }

  if (!title) {
    throw new Error('buildResearchQuery: no title available (triageTitle, fallbackTitle, sourceContent, and userIntent all empty)');
  }

  // Strip HTML tags (triage sometimes includes them)
  let query = title.replace(/<[^>]*>/g, '').trim();

  // Append keyword focus if present
  if (input.keywords && input.keywords.length > 0) {
    const keywordSuffix = ` — ${input.keywords.join(', ')}`;
    query += keywordSuffix;
  }

  // Soft cap at 2000 chars — structured context handles the rest.
  // The 200-char hard cap was a legacy web search constraint (ADR-003).
  // Modern LLMs with grounding don't need short queries — they need context.
  if (query.length > 2000) {
    query = query.slice(0, 1997) + '...';
  }

  return query;
}

// ==========================================
// Research Depth Configuration
// ==========================================

interface DepthConfig {
  maxTokens: number;
  targetSources: number;
  minSources: number;
  description: string;
  citationStyle: "inline" | "chicago";
}

/**
 * DRC-001a: DEPTH_CONFIG is now the compiled defaults export.
 * Internal code uses getResearchPipelineConfigSync() for runtime resolution.
 * The orchestrator resolves config async on entry and caches it.
 */
import { getResearchPipelineConfigSync } from '../config';

/**
 * Resolve depth config from the Research Pipeline Config cache.
 * The orchestrator calls getResearchPipelineConfig() async on entry,
 * which populates the cache. This sync accessor reads from that cache.
 * Falls back to compiled defaults if cache is empty (pre-orchestrator paths).
 */
function resolveDepthConfig(depth: ResearchDepth): DepthConfig {
  const { config } = getResearchPipelineConfigSync();
  return config.depths[depth];
}

/** Legacy export — compiled defaults for external consumers */
const DEPTH_CONFIG: Record<ResearchDepth, DepthConfig> = {
  light: { maxTokens: 2048, targetSources: 3, minSources: 2, description: "Quick overview with key facts", citationStyle: "inline" },
  standard: { maxTokens: 8192, targetSources: 6, minSources: 4, description: "Thorough analysis with multiple perspectives", citationStyle: "inline" },
  deep: { maxTokens: 65536, targetSources: 12, minSources: 8, description: "Academic-grade research with rigorous citations", citationStyle: "chicago" },
};

// ==========================================
// URL Resolution for Gemini Grounding Redirects
// ==========================================

/**
 * Gemini's Google Search grounding returns redirect URLs like:
 * https://vertexaisearch.cloud.google.com/grounding-api-redirect/XXXXX
 *
 * These need to be resolved to get the actual source URLs.
 */
const GROUNDING_REDIRECT_PATTERN = /^https?:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\//;

/**
 * Try to resolve a URL using the given HTTP method. Returns the final URL or null on failure.
 */
async function tryResolveWith(url: string, method: 'HEAD' | 'GET'): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    const headers: Record<string, string> = method === 'GET' ? { Range: 'bytes=0-0' } : {};
    const response = await fetch(url, { method, redirect: 'follow', signal: controller.signal, headers });
    clearTimeout(timeout);
    const finalUrl = response.url;
    if (!finalUrl || GROUNDING_REDIRECT_PATTERN.test(finalUrl)) return null;
    return finalUrl;
  } catch {
    return null;
  }
}

/**
 * Resolve a single Gemini grounding redirect URL to its actual destination.
 * Returns null if unresolvable — callers must drop null results, never keep raw vertex URLs.
 */
async function resolveRedirectUrl(url: string): Promise<string | null> {
  if (!GROUNDING_REDIRECT_PATTERN.test(url)) {
    return url; // Not a redirect URL, return as-is
  }

  // Try HEAD first (lightweight — avoids downloading content)
  const headResult = await tryResolveWith(url, 'HEAD');
  if (headResult) return headResult;

  // Some servers block HEAD — fall back to GET with minimal range header
  const getResult = await tryResolveWith(url, 'GET');
  if (getResult) return getResult;

  // Both failed — drop rather than keep a raw vertex redirect URL in output
  console.log(`[Research] Could not resolve redirect URL, dropping: ${url.substring(0, 80)}`);
  return null;
}

/**
 * Resolve all redirect URLs in sources and findings arrays
 */
async function resolveAllRedirectUrls(
  sources: string[],
  findings: Array<{ claim: string; source: string; url: string; relevance: number }>
): Promise<{
  resolvedSources: string[];
  resolvedFindings: Array<{ claim: string; source: string; url: string; relevance: number }>;
}> {
  console.log("[Research] Resolving redirect URLs...");

  // Collect all unique URLs to resolve
  const urlsToResolve = new Set<string>();
  for (const s of sources) {
    if (GROUNDING_REDIRECT_PATTERN.test(s)) {
      urlsToResolve.add(s);
    }
  }
  for (const f of findings) {
    if (f.url && GROUNDING_REDIRECT_PATTERN.test(f.url)) {
      urlsToResolve.add(f.url);
    }
  }

  if (urlsToResolve.size === 0) {
    console.log("[Research] No redirect URLs to resolve");
    return { resolvedSources: sources, resolvedFindings: findings };
  }

  console.log(`[Research] Resolving ${urlsToResolve.size} redirect URLs...`);

  // Resolve all URLs in parallel (with concurrency limit)
  const urlArray = Array.from(urlsToResolve);
  const resolvedMap = new Map<string, string | null>();

  // Process in batches of 5 to avoid overwhelming the server
  const batchSize = 5;
  for (let i = 0; i < urlArray.length; i += batchSize) {
    const batch = urlArray.slice(i, i + batchSize);
    const results = await Promise.all(batch.map(resolveRedirectUrl));
    batch.forEach((url, idx) => {
      resolvedMap.set(url, results[idx]);
    });
  }

  // Log resolution results
  let resolved = 0;
  let dropped = 0;
  for (const [original, actual] of resolvedMap) {
    if (actual === null) {
      dropped++;
      console.log(`[Research] Dropped unresolvable redirect: ${original.substring(0, 60)}...`);
    } else if (original !== actual) {
      resolved++;
      console.log(`[Research] Resolved: ${actual.substring(0, 60)}...`);
    }
  }
  console.log(`[Research] Resolved ${resolved}/${urlsToResolve.size} redirect URLs, dropped ${dropped}`);

  // Apply resolutions to sources — drop unresolvable vertex redirect URLs entirely
  const resolvedSources = sources
    .map(s => {
      const mapped = resolvedMap.get(s);
      return mapped === undefined ? s : mapped; // undefined = not vertex URL; string = resolved; null = drop
    })
    .filter((s): s is string => s !== null);

  // Apply resolutions to findings — clear URL if unresolvable (keep claim text)
  const resolvedFindings = findings.map(f => {
    if (!f.url) return f;
    const mapped = resolvedMap.get(f.url);
    if (mapped === undefined) return f;         // Not a vertex URL, keep as-is
    if (mapped === null) return { ...f, url: '' }; // Unresolvable — clear URL but keep claim
    return { ...f, url: mapped };               // Resolved successfully
  });

  return { resolvedSources, resolvedFindings };
}

// ==========================================
// Search Provider (RPO-001: replaces dual-SDK GeminiClient)
// ==========================================

import { GeminiSearchProvider, ClaudeSearchProvider, type SearchProvider, type SearchResult as SearchProviderResult } from "../search";

// Backward-compat bridge: GeminiResponse shape used by parseResearchResponse
interface GeminiResponse {
  text: string;
  citations: Array<{ url: string; title: string }>;
  groundingMetadata?: unknown;
  groundingUsed?: boolean;
}

let _searchProvider: SearchProvider | null = null;

/**
 * DRC-001a: Search provider initialized with config-resolved parameters.
 * Re-created when config changes (cache invalidation → null provider).
 */
function getSearchProvider(): SearchProvider {
  if (!_searchProvider) {
    const { config } = getResearchPipelineConfigSync();
    _searchProvider = new GeminiSearchProvider(undefined, {
      model: config.searchProviders.gemini.model,
      groundingRetryMax: config.searchProviders.gemini.groundingRetryMax,
    });
  }
  return _searchProvider;
}

/** Reset cached search provider (call when config changes) */
export function resetSearchProvider(): void {
  _searchProvider = null;
}

/** Lazy Claude fallback provider for when Gemini returns 0 citations */
let _fallbackProvider: SearchProvider | null = null;
function getFallbackProvider(): SearchProvider {
  if (!_fallbackProvider) {
    _fallbackProvider = new ClaudeSearchProvider();
  }
  return _fallbackProvider;
}

/** Convert SearchProviderResult to legacy GeminiResponse shape for parseResearchResponse */
function toGeminiResponse(result: SearchProviderResult): GeminiResponse {
  return {
    text: result.text,
    citations: result.citations,
    groundingMetadata: result.groundingMetadata,
    groundingUsed: result.groundingUsed,
  };
}

// ==========================================
// Voice Styling
// ==========================================

/**
 * FALLBACK voice instructions for each predefined voice.
 * These are used when PromptManager cannot fetch from Notion.
 * Primary source is the Atlas System Prompts database in Notion.
 *
 * @see packages/agents/src/services/prompt-manager.ts
 * @see packages/agents/data/migrations/prompts-v1.json
 */
/**
 * FALLBACK_VOICE_DEFAULTS — Intentionally in Spanish (ADR-008: Fail Loud)
 *
 * These are LAST-RESORT hardcoded defaults that fire ONLY when:
 *   1. Notion is unreachable (circuit breaker tripped)
 *   2. PromptManager returns null for the voice slug
 *   3. Local seed data has no matching entry
 *
 * They are written in Spanish so that degraded output is IMMEDIATELY
 * obvious to the end user — never silently serving stale English content
 * that looks correct but isn't Notion-managed.
 *
 * If you see Spanish in research output, it means the PM chain is broken.
 */
const FALLBACK_VOICE_DEFAULTS: Record<Exclude<ResearchVoice, "custom">, string> = {
  "atlas-research": `
## Voz de Escritura: Grove Analítico [MODO DEGRADADO — VOZ HARDCODEADA]

Escribir con profundidad técnica manteniendo la accesibilidad. Características clave:
- Afirmaciones basadas en evidencia con citas
- Análisis prospectivo ("Esto sugiere...", "La trayectoria apunta a...")
- Escepticismo equilibrado (reconocer exageración vs. sustancia)
- Perspectiva de constructor (implicaciones prácticas)
- Tono seguro pero no arrogante
- Liderar con ideas, no con resúmenes
- Usar ejemplos concretos
- Terminar con implicaciones o próximas preguntas
- Evitar: palabras de moda, exageración, conclusiones vagas
`,

  "linkedin-punchy": `
## Voz de Escritura: LinkedIn Impactante [MODO DEGRADADO — VOZ HARDCODEADA]

Escribir para engagement profesional y compartibilidad. Características clave:
- Gancho en la primera línea (interrupción de patrón)
- Párrafos cortos (1-2 oraciones máximo)
- Estructura escaneable con conclusiones claras
- Tono seguro y autoritativo
- Ligeramente provocativo (desafiar suposiciones)
- Auténtico, no corporativo
- Usar listas numeradas para puntos clave
- Terminar con una pregunta o llamada a la reflexión
- Sin muros de texto
`,

  "consulting": `
## Voz de Escritura: Consultoría/Ejecutivo [MODO DEGRADADO — VOZ HARDCODEADA]

Escribir para tomadores de decisiones senior. Características clave:
- Resumen ejecutivo al inicio
- Estructura orientada a recomendaciones
- "¿Y qué?" claro para cada punto
- Cuantificar impacto donde sea posible
- Tono profesional y mesurado
- Conclusiones orientadas a la acción
- Marco de riesgo/beneficio
- Estructura MECE (mutuamente excluyente, colectivamente exhaustiva)
`,

  "raw-notes": `
## Voz de Escritura: Notas Crudas [MODO DEGRADADO — VOZ HARDCODEADA]

Proporcionar investigación en formato de notas de trabajo. Características clave:
- Viñetas sobre prosa
- Incluir citas textuales y datos
- Notar contradicciones e incertidumbres
- Mantener la síntesis al mínimo
- Organizado por fuente o tema
- Incluir URLs en línea con cada punto
- Bueno para procesamiento/edición posterior
`,
};

/**
 * Get voice instructions for the research output.
 * Tries PromptManager first, falls back to hardcoded defaults.
 */
async function getVoiceInstructionsAsync(config: ResearchConfig): Promise<string> {
  const voice = config.voice || "atlas-research";

  // Handle custom voice (pre-loaded content from Telegram voice selection)
  if (voice === "custom" && config.voiceInstructions) {
    return `\n## Writing Voice: Custom\n\n${config.voiceInstructions}\n`;
  }

  // Try to fetch from PromptManager (Notion) by direct ID: "voice.atlas-research", "voice.consulting", etc.
  const promptId = `voice.${voice}`;
  try {
    const promptManager = getPromptManager();
    const voicePrompt = await promptManager.getPromptById(promptId);

    if (voicePrompt) {
      console.log(`[Research] Loaded voice "${voice}" from PromptManager (ID: ${promptId})`);
      return voicePrompt;
    }
  } catch (error) {
    logDegradedFallback(promptId, 'getVoiceInstructionsAsync', { voice, error: String(error) });
  }

  // Fallback to hardcoded defaults — LOUD about it (ADR-008)
  logDegradedFallback(promptId, 'getVoiceInstructionsAsync', { voice });
  const fallbackVoice = voice === "custom" ? "atlas-research" : voice;
  const fallbackText = FALLBACK_VOICE_DEFAULTS[fallbackVoice] || FALLBACK_VOICE_DEFAULTS["atlas-research"];
  return fallbackText + '\n' + degradedWarning(promptId);
}

/**
 * Sync wrapper for backwards compatibility - uses fallback only
 * @deprecated Use getVoiceInstructionsAsync for PromptManager integration
 */
function getVoiceInstructions(config: ResearchConfig): string {
  if (!config.voice || config.voice === "atlas-research") {
    return FALLBACK_VOICE_DEFAULTS["atlas-research"];
  }

  if (config.voice === "custom" && config.voiceInstructions) {
    return `\n## Writing Voice: Custom\n\n${config.voiceInstructions}\n`;
  }

  // Type assertion needed because voice can be "custom" which isn't in FALLBACK_VOICE_DEFAULTS
  const fallbackVoice = config.voice === "custom" ? "atlas-research" : config.voice;
  return FALLBACK_VOICE_DEFAULTS[fallbackVoice] || FALLBACK_VOICE_DEFAULTS["atlas-research"];
}

// ==========================================
// System Prompts by Depth
// ==========================================

/** Slugify for building prompt IDs: "The Grove" → "the-grove", "Market Analysis" → "market-analysis" */
function slugify(s: string): string {
  return s.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');
}

/** Depth → PromptManager ID mapping */
const DEPTH_PROMPT_ID: Record<ResearchDepth, string> = {
  light: 'research-agent.light',
  standard: 'research-agent.standard',
  deep: 'research-agent.deep',
};

/**
 * Fetch research instructions from PromptManager (Notion).
 *
 * Resolution order:
 * 1. Pillar+UseCase specific (e.g., research-agent.the-grove.sprout-generation)
 * 2. Depth-generic (e.g., research-agent.standard)
 * 3. null (caller uses hardcoded fallback)
 */
async function getResearchInstructionsFromNotion(config: ResearchConfig): Promise<string | null> {
  const depth = config.depth || 'standard';

  try {
    const pm = getPromptManager();

    // 1. Try pillar+useCase specific prompt
    if (config.pillar && config.useCase) {
      const specificId = `research-agent.${slugify(config.pillar)}.${slugify(config.useCase)}`;
      const specific = await pm.getPromptById(specificId);
      if (specific) {
        console.log(`[Research] Loaded research instructions from PromptManager (ID: ${specificId})`);
        return specific;
      }
    }

    // 2. Try depth-generic prompt
    const depthId = DEPTH_PROMPT_ID[depth];
    const depthPrompt = await pm.getPromptById(depthId);
    if (depthPrompt) {
      console.log(`[Research] Loaded research instructions from PromptManager (ID: ${depthId})`);
      return depthPrompt;
    }

    // 3. Not found — caller will use hardcoded fallback
    return null;
  } catch (err) {
    console.error('[Research] RESEARCH INSTRUCTIONS FAILURE: PromptManager threw', {
      depth,
      pillar: config.pillar,
      useCase: config.useCase,
      error: err,
      fix: [
        '1. Check NOTION_PROMPTS_DB_ID env var is set',
        '2. Run seed migration (see packages/agents/src/services/prompt-manager.ts)',
        '3. Check network connectivity to Notion API',
      ],
    });
    return null;
  }
}

async function buildResearchPrompt(config: ResearchConfig): Promise<{ systemInstruction: string; contents: string; isDrafterMode: boolean }> {
  const depth = config.depth || "standard";
  const depthCfg = resolveDepthConfig(depth);

  // Try async voice fetch with PromptManager, fall back to sync
  let voiceInstructions: string;
  try {
    voiceInstructions = await getVoiceInstructionsAsync(config);
  } catch {
    voiceInstructions = getVoiceInstructions(config);
  }

  // DEBUG: Log voice injection
  console.log("[Research] buildResearchPrompt voice config:", {
    voice: config.voice,
    pillar: config.pillar,
    useCase: config.useCase,
    hasVoiceInstructions: !!config.voiceInstructions,
    voiceInstructionsLength: config.voiceInstructions?.length || 0,
    injectedVoiceLength: voiceInstructions.length,
    voicePreview: voiceInstructions.substring(0, 200),
  });

  // Fetch research instructions from PromptManager (Notion-tunable)
  // Notion prompt text combines depth instructions + quality guidelines in one block
  const notionInstructions = await getResearchInstructionsFromNotion(config);
  let researchInstructions: string;
  let qualityBlock: string;

  if (notionInstructions) {
    // Notion text includes both depth instructions AND quality guidelines
    researchInstructions = notionInstructions;
    qualityBlock = ''; // Already included in notionInstructions
  } else {
    // Hardcoded fallback — LOUD about it (ADR-008)
    const attemptedId = config.pillar && config.useCase
      ? `research-agent.${slugify(config.pillar)}.${slugify(config.useCase)} → ${DEPTH_PROMPT_ID[depth]}`
      : DEPTH_PROMPT_ID[depth];
    logDegradedFallback(attemptedId, 'buildResearchPrompt', { depth, pillar: config.pillar, useCase: config.useCase });
    researchInstructions = getDepthInstructions(depth) + '\n' + degradedWarning(DEPTH_PROMPT_ID[depth]);
    qualityBlock = await getQualityGuidelinesAsync(depth);
  }

  // PM-gated summary guidance (async fetch → hardcoded fallback)
  const summaryGuidance = await getSummaryGuidanceAsync(depth);

  // Check for drafter template (prose output mode)
  const drafterTemplate = await getDrafterTemplateAsync(config);
  const isDrafterMode = drafterTemplate !== null;

  // VOICE FIRST: Put voice/style instructions at the TOP so the model adopts the persona
  // before processing the task. This is critical for voice injection to work.
  let outputSection: string;

  if (isDrafterMode) {
    // PROSE MODE: Drafter template replaces JSON schema + Source Integrity sections
    console.log("[Research] Using drafter template for prose output mode");
    outputSection = `## Output Format

${drafterTemplate}

## Source Requirements

- Cite sources inline using markdown links: [Source Name](URL)
- Include a ## Sources section at the end listing all referenced URLs
- EVERY URL must be a real URL from your Google Search results
- Do NOT use placeholder URLs like "url1.com", "example.com", or "source-url.com"
- Do NOT fabricate URLs — only include URLs that Google Search actually returned
- If Google Search returns NO relevant results, state this clearly at the top of your response`;
  } else {
    // JSON MODE: Existing structured output (backward compat)
    outputSection = `## Output Format

Provide your response in this exact JSON format:

\`\`\`json
{
  "summary": "${summaryGuidance}",
  "findings": [
    {
      "claim": "Specific fact or insight discovered",
      "source": "Name of the publication or website",
      "url": "the actual URL from your Google Search results"${depth === "deep" ? ',\n      "author": "Author Name if available",\n      "date": "Publication date if available"' : ""}
    }
  ],
  "sources": ["actual-search-result-url-1", "actual-search-result-url-2", "..."]${depth === "deep" ? ',\n  "bibliography": ["Chicago-style citation 1", "Chicago-style citation 2"]' : ""}
}
\`\`\`

## CRITICAL: Source Integrity

**EVERY URL must be a real URL from your Google Search results.**
- Do NOT use placeholder URLs like "url1.com", "example.com", or "source-url.com"
- Do NOT fabricate URLs - only include URLs that Google Search actually returned
- If Google Search returns NO relevant results for this query, respond with:
\`\`\`json
{
  "error": "NO_SEARCH_RESULTS",
  "summary": "Google Search did not return relevant results for this query. The topic may be too niche, misspelled, or not well-indexed.",
  "findings": [],
  "sources": []
}
\`\`\``;
  }

  // RPO-001: Split prompt into systemInstruction (behavioral) and contents (query).
  // systemInstruction tells Gemini HOW to respond (role, voice, quality, format).
  // contents tells Gemini WHAT to research (query, sources, context).
  // This separation prevents grounding suppression. See docs/RPO-001-ROOT-CAUSE.md.

  const systemInstruction = `You are Atlas Research Agent, an autonomous research assistant with access to Google Search.

## STYLE GUIDELINES (CRITICAL - ADOPT THIS VOICE THROUGHOUT)
${voiceInstructions}

## Instructions

Use Google Search to find current, authoritative information about this topic.
${researchInstructions}

${outputSection}

${qualityBlock}`.trim();

  const contents = `## Research Task
Query: "${config.query}"
${config.sourceUrl ? `Source URL: ${config.sourceUrl}` : ""}
${config.focus ? `Focus Area: ${config.focus}` : ""}
Depth: ${depth} — ${depthCfg.description}
${config.sourceContent ? `\n## Source Content (extracted from shared URL)\nYou have been provided extracted content from the source URL. Use Google Search to find ADDITIONAL context, but ANALYZE this provided material as your baseline — do not discover from scratch.\n\n${config.sourceContent.slice(0, 3000)}\n` : ""}${config.userContext ? `\n## User's Intent\nThe person requesting this research said: "${config.userContext.slice(0, 500)}"\nFactor this into your research angle and framing — this is what they specifically care about.\n` : ""}
Target Sources: ${config.maxSources || depthCfg.targetSources}+

Begin your research now.`;

  return { systemInstruction, contents, isDrafterMode };
}

/**
 * ADR-010: Build synthesis prompt for Phase 2 (Gemini without googleSearch).
 *
 * Takes the retrieval output from Phase 1 (Claude web_search) and builds
 * a prompt for Gemini to synthesize in Jim's voice/format.
 *
 * Parallel to buildResearchPrompt() — reuses voice, quality, drafter config
 * but replaces search instructions with synthesis instructions.
 */
async function buildSynthesisPrompt(
  config: ResearchConfig,
  retrievedText: string,
  citations: { url: string; title: string }[],
): Promise<{ systemInstruction: string; contents: string; isDrafterMode: boolean }> {
  const depth = config.depth || "standard";
  const depthCfg = resolveDepthConfig(depth);

  // Reuse same voice resolution chain as buildResearchPrompt
  let voiceInstructions: string;
  try {
    voiceInstructions = await getVoiceInstructionsAsync(config);
  } catch {
    voiceInstructions = getVoiceInstructions(config);
  }

  // Fetch research instructions from PromptManager (same as buildResearchPrompt)
  const notionInstructions = await getResearchInstructionsFromNotion(config);
  let researchInstructions: string;
  let qualityBlock: string;

  if (notionInstructions) {
    researchInstructions = notionInstructions;
    qualityBlock = '';
  } else {
    const attemptedId = config.pillar && config.useCase
      ? `research-agent.${slugify(config.pillar)}.${slugify(config.useCase)} → ${DEPTH_PROMPT_ID[depth]}`
      : DEPTH_PROMPT_ID[depth];
    logDegradedFallback(attemptedId, 'buildSynthesisPrompt', { depth, pillar: config.pillar, useCase: config.useCase });
    researchInstructions = getDepthInstructions(depth) + '\n' + degradedWarning(DEPTH_PROMPT_ID[depth]);
    qualityBlock = await getQualityGuidelinesAsync(depth);
  }

  const summaryGuidance = await getSummaryGuidanceAsync(depth);
  const drafterTemplate = await getDrafterTemplateAsync(config);
  const isDrafterMode = drafterTemplate !== null;

  // Output section — same logic as buildResearchPrompt, but source references
  // point to provided context, not Google Search results
  let outputSection: string;

  if (isDrafterMode) {
    outputSection = `## Output Format

${drafterTemplate}

## Source Requirements

- Cite sources inline using markdown links: [Source Name](URL)
- Include a ## Sources section at the end listing all referenced URLs
- ONLY use URLs from the Retrieved Web Research section below
- Do NOT fabricate URLs or use placeholder URLs`;
  } else {
    outputSection = `## Output Format

Provide your response in this exact JSON format:

\`\`\`json
{
  "summary": "${summaryGuidance}",
  "findings": [
    {
      "claim": "Specific fact or insight discovered",
      "source": "Name of the publication or website",
      "url": "URL from the retrieved sources"${depth === "deep" ? ',\n      "author": "Author Name if available",\n      "date": "Publication date if available"' : ""}
    }
  ],
  "sources": ["url-from-retrieved-sources-1", "url-from-retrieved-sources-2", "..."]${depth === "deep" ? ',\n  "bibliography": ["Chicago-style citation 1", "Chicago-style citation 2"]' : ""}
}
\`\`\`

## CRITICAL: Source Integrity

**ONLY use URLs from the Retrieved Web Research section below.**
- Do NOT fabricate URLs or use placeholder URLs
- Do NOT search the web — all source material is provided below
- If the retrieved material is insufficient, state this clearly in your summary`;
  }

  // System instruction — same voice/format, different task framing
  const systemInstruction = `You are Atlas Research Agent, synthesizing from provided web research.

## STYLE GUIDELINES (CRITICAL - ADOPT THIS VOICE THROUGHOUT)
${voiceInstructions}

## Instructions

You are synthesizing from web research that has already been retrieved for you.
Do NOT search the web. All source material is provided in the query below.
Analyze the provided sources and produce a ${depth}-depth research output.
${researchInstructions}

${outputSection}

${qualityBlock}`.trim();

  // Contents — research task + retrieved context + source URLs
  const sourceList = citations
    .map((c) => `- [${c.title || 'Source'}](${c.url})`)
    .join('\n');

  const contents = `## Research Task
Query: "${config.query}"
${config.focus ? `Focus Area: ${config.focus}` : ""}
Depth: ${depth} — ${depthCfg.description}
${config.userContext ? `\n## User's Intent\nThe person requesting this research said: "${config.userContext.slice(0, 500)}"\nFactor this into your research angle and framing.\n` : ""}
Target Sources: ${config.maxSources || depthCfg.targetSources}+

## Retrieved Web Research

${retrievedText}

## Source URLs

${sourceList}

Synthesize these sources now.`;

  return { systemInstruction, contents, isDrafterMode };
}

function getDepthInstructions(depth: ResearchDepth): string {
  switch (depth) {
    case "light":
      return `This is a QUICK research task. Focus on:
- Getting the key facts fast
- 2-3 authoritative sources maximum
- Brief, actionable summary
- Skip deep analysis — surface-level overview only`;

    case "standard":
      return `This is a STANDARD research task. Focus on:
- Comprehensive coverage of the topic
- Multiple perspectives from 5-8 sources
- SYNTHESIZE information - don't just list facts, explain what they MEAN
- Identify patterns, trends, and connections across sources
- Provide YOUR analysis: What's the current state? Where is this heading?
- Cross-reference claims across sources
- Note any conflicting information or debates
- Include specific recommendations or implications for someone building in this space`;

    case "deep":
      return `This is a DEEP RESEARCH task requiring ACADEMIC RIGOR. You must:
- Conduct exhaustive research from 10+ authoritative sources
- Prioritize peer-reviewed, academic, and primary sources
- Cross-reference ALL claims across multiple sources
- Note methodology, sample sizes, and limitations where relevant
- Identify consensus views vs. minority positions
- Flag any conflicting evidence or ongoing debates
- Provide full Chicago-style citations for EVERY source
- Include author names, publication dates, and access dates
- Distinguish between primary and secondary sources`;
  }
}

function getSummaryGuidance(depth: ResearchDepth): string {
  switch (depth) {
    case "light":
      return "2-3 sentence executive summary with key takeaways";
    case "standard":
      return "Write 3-5 FULL paragraphs that SYNTHESIZE your research. Para 1: Current landscape overview. Para 2-3: Key players, approaches, and trade-offs. Para 4: Emerging trends and where things are heading. Para 5: Practical implications - what should someone building in this space know? Be opinionated and analytical, not just descriptive.";
    case "deep":
      return "Comprehensive 4-6 paragraph academic summary including: research context, methodology overview, key findings with evidence strength, limitations, areas of consensus/debate, and implications for further research. Use your full token budget.";
  }
}

/**
 * PM-gated summary guidance — tries Notion slug `research-agent.summary.{depth}`
 * before falling back to hardcoded getSummaryGuidance() + degraded warning.
 */
async function getSummaryGuidanceAsync(depth: ResearchDepth): Promise<string> {
  const slug = `research-agent.summary.${depth}`;
  try {
    const pm = getPromptManager();
    const notionGuidance = await pm.getPromptById(slug);
    if (notionGuidance) {
      console.log(`[Research] Loaded summary guidance from PromptManager (ID: ${slug})`);
      return notionGuidance;
    }
    // Null result — slug not found in Notion
    logDegradedFallback(slug, 'getSummaryGuidanceAsync', { depth });
  } catch (err) {
    // PM threw — network error, bad config, etc.
    logDegradedFallback(slug, 'getSummaryGuidanceAsync', { depth, error: String(err) });
  }
  return getSummaryGuidance(depth);
}

function getQualityGuidelines(depth: ResearchDepth): string {
  switch (depth) {
    case "light":
      return `## Guidelines
- Speed over depth — get the essentials
- Prefer recent, well-known sources
- One source per major claim is acceptable
- Summary should be 2-3 complete sentences`;

    case "standard":
      return `## Guidelines
- Balance depth with practicality
- Cross-reference important claims
- Include specific data points and statistics
- DO NOT just list sources - ANALYZE them
- What patterns emerge? What's the consensus? Where do experts disagree?
- Be OPINIONATED: What's working? What's hype? What's the smart path forward?
- End with actionable insights for someone building in this space

## CRITICAL: Summary Quality
Your summary is the MOST IMPORTANT part. It should:
- Read like an expert briefing, not a book report
- Provide genuine insight, not just facts
- Help the reader make decisions
- Be worth reading even without the source list
- Note publication dates for time-sensitive info
- Be objective — present multiple viewpoints

## IMPORTANT: Response Length
- Summary MUST be 2-4 full paragraphs (not sentences)
- Include at least 6-8 distinct findings
- Do NOT truncate your response — use the full output capacity
- Complete every section fully before ending`;

    case "deep":
      return `## Quality Standards (REQUIRED)
- EVERY factual claim must cite a source
- Prefer: peer-reviewed > government/institutional > reputable journalism > other
- Note the TYPE of source (study, report, news article, etc.)
- Include sample sizes and methodologies for research studies
- Flag limitations: small samples, self-reported data, potential conflicts
- Chicago citations MUST include: Author(s), "Title," Publication, Date, URL, Accessed Date
- Example citation: Smith, John. "AI Coding Assistants in 2025." Tech Review, January 15, 2025. https://example.com/article. Accessed January 30, 2026.
- If a source lacks author, use organization name
- Distinguish opinion/editorial from factual reporting

## CRITICAL: Response Length
- Summary MUST be 4-6 full paragraphs covering context, findings, limitations, and implications
- Include at least 10-15 distinct findings with full citations
- Bibliography must be comprehensive with full Chicago-style entries
- Do NOT truncate your response — you have ~65,000 tokens available
- Complete every section fully before ending your response`;
  }
}

/**
 * PM-gated quality guidelines: try Notion slug `research-agent.quality.{depth}`,
 * fall back to hardcoded getQualityGuidelines().
 */
async function getQualityGuidelinesAsync(depth: ResearchDepth): Promise<string> {
  const slug = `research-agent.quality.${depth}`;
  try {
    const pm = getPromptManager();
    const notionGuidelines = await pm.getPromptById(slug);
    if (notionGuidelines) {
      console.log(`[Research] Loaded quality guidelines from PromptManager (ID: ${slug})`);
      return notionGuidelines;
    }
    // Null result — slug not found in Notion
    logDegradedFallback(slug, 'getQualityGuidelinesAsync', { depth });
  } catch (err) {
    // PM threw — network error, bad config, etc.
    logDegradedFallback(slug, 'getQualityGuidelinesAsync', { depth, error: String(err) });
  }
  return getQualityGuidelines(depth);
}

/**
 * PM-gated drafter template resolution for prose output mode.
 *
 * Resolution chain:
 *   1. Pillar-specific drafter (e.g. `drafter.the-grove.research`)
 *   2. Default drafter (`drafter.default.research`)
 *   3. null → JSON mode (backward compat)
 *
 * Returns the drafter template body text or null if no drafter exists.
 */
async function getDrafterTemplateAsync(config: ResearchConfig): Promise<string | null> {
  const pm = getPromptManager();

  // 1. Try pillar-specific drafter
  if (config.pillar) {
    const pillarDrafterId = resolveDrafterId(config.pillar, 'research');
    try {
      const template = await pm.getPromptById(pillarDrafterId);
      if (template) {
        console.log(`[Research] Loaded drafter template from PromptManager (ID: ${pillarDrafterId})`);
        return template;
      }
    } catch (err) {
      console.warn(`[Research] Drafter fetch failed for ${pillarDrafterId}:`, String(err));
    }
  }

  // 2. Try default drafter
  const defaultDrafterId = resolveDefaultDrafterId('research');
  try {
    const template = await pm.getPromptById(defaultDrafterId);
    if (template) {
      console.log(`[Research] Loaded default drafter template from PromptManager (ID: ${defaultDrafterId})`);
      return template;
    }
  } catch (err) {
    console.warn(`[Research] Default drafter fetch failed for ${defaultDrafterId}:`, String(err));
  }

  // 3. No drafter found → JSON mode (backward compat)
  console.log('[Research] No drafter template found — using JSON output mode');
  return null;
}

// ==========================================
// Research Agent Executor
// ==========================================

/**
 * Execute a research task using the two-phase decoupled search pipeline (ADR-010).
 * Phase 1: Claude Haiku + web_search for retrieval (deterministic URLs).
 * Phase 2: Gemini without googleSearch for synthesis (no grounding suppression).
 * Fallback: Gemini-with-googleSearch if Claude retrieval returns 0 citations.
 */
export async function executeResearch(
  config: ResearchConfig,
  agent: Agent,
  registry: AgentRegistry
): Promise<AgentResult> {
  const startTime = Date.now();
  let apiCalls = 0;

  const depth = config.depth || "standard";
  const depthCfg = resolveDepthConfig(depth);

  // Sprint A: Provenance chain — continue from adapter or create fresh
  const chain = config.provenanceChain ?? createProvenanceChain('research-agent', ['research-agent']);
  appendPath(chain, 'research');
  setConfig(chain, {
    source: 'notion',
    depth,
    pillar: config.pillar,
  });
  if (config.sourceUrl) {
    setContext(chain, { sourceUrl: config.sourceUrl });
  }

  try {
    // Report starting
    await registry.updateProgress(agent.id, 5, `Starting ${depth} research`);

    // ============================================================
    // ADR-010: Decoupled Search — Two-Phase Pipeline
    // Phase 1: RETRIEVE (Claude Haiku + web_search)
    // Phase 2: SYNTHESIZE (Gemini without googleSearch)
    // Fallback: Gemini-with-googleSearch if Claude retrieval fails
    // ============================================================

    // === PHASE 1: RETRIEVE ===
    await registry.updateProgress(agent.id, 15, "Searching with Claude");
    const phase1Start = Date.now();
    const retrievalProvider = getFallbackProvider(); // ClaudeSearchProvider (promoted to primary)
    const retrievalResult = await retrievalProvider.generate({
      query: config.query,
      systemInstruction: 'Search the web for current, authoritative information. Return comprehensive results with source URLs.',
      maxOutputTokens: 4096,
    });
    apiCalls++;
    appendPhase(chain, {
      name: 'retrieve',
      provider: 'claude-haiku',
      tools: ['web_search'],
      durationMs: Date.now() - phase1Start,
    });

    let retrievedText = retrievalResult.text;
    let retrievedCitations = retrievalResult.citations;
    let usedFallback = false;
    let isDrafterMode = false;

    // Build prompt for V2 context (needed for both synthesis and Gemini fallback paths)
    let systemInstruction: string;
    let contents: string;
    if (isResearchConfigV2(config)) {
      const v2Sections = buildResearchPromptV2(config);
      const v1Result = await buildResearchPrompt(config);
      systemInstruction = v1Result.systemInstruction;
      contents = v1Result.contents.replace(
        'Begin your research now.',
        v2Sections + '\n\nBegin your research now.',
      );
      isDrafterMode = v1Result.isDrafterMode;
      console.log('[Research] V2 prompt composed — structured context injected', {
        hasThesisHook: !!(config as any).thesisHook,
        hasPovContext: !!(config as any).povContext,
        hasEvidenceReqs: !!(config as any).evidenceRequirements,
        v2SectionsLength: v2Sections.length,
      });
    } else {
      const result = await buildResearchPrompt(config);
      systemInstruction = result.systemInstruction;
      contents = result.contents;
      isDrafterMode = result.isDrafterMode;
    }

    let searchResult: SearchProviderResult;

    // ADR-010: If Claude retrieval returned 0 citations, retry with reformulated query.
    // Do NOT fall back to Gemini-with-googleSearch — that's the unreliable path we decoupled from.
    if (retrievedCitations.length === 0) {
      console.warn('[Research] Claude retrieval returned 0 citations — retrying with reformulated query');
      await registry.updateProgress(agent.id, 30, "Retry: reformulated search");

      // Retry with a broader, reformulated query
      const reformulated = `Find recent news, analysis, and authoritative sources about: ${config.query}`;
      try {
        const retryResult = await retrievalProvider.generate({
          query: reformulated,
          systemInstruction: 'Search the web thoroughly. Try multiple search queries if needed. Return comprehensive results with source URLs.',
          maxOutputTokens: 4096,
        });
        apiCalls++;

        if (retryResult.citations.length > 0) {
          console.log(`[Research] Claude retry succeeded: ${retryResult.citations.length} citations`);
          retrievedText = retryResult.text;
          retrievedCitations = retryResult.citations;
          logFallbackToFeed(config.query, retryResult.citations.length).catch(() => {});
        } else {
          console.warn('[Research] Claude retry also returned 0 citations — proceeding with ungrounded result');
          usedFallback = true;
        }
      } catch (retryError) {
        console.error('[Research] Claude retry failed:', retryError instanceof Error ? retryError.message : retryError);
        usedFallback = true;
      }
    }

    if (retrievedCitations.length === 0) {
      // Both Claude attempts failed — no web data available.
      // Sprint C Bug 6: Do NOT synthesize from ungrounded text. Fail fast.
      // Previously did "graceful degradation" which produced training-data hallucinations.
      console.error('[Research] Both retrieval attempts returned 0 citations — refusing to synthesize without sources');
      appendPhase(chain, {
        name: 'synthesize-refused',
        provider: 'none',
        tools: [],
        durationMs: 0,
      });
      throw new Error("HALLUCINATION: No web sources found — both retrieval attempts returned 0 citations. Cannot produce grounded research.");
    } else {
      // Sprint C Bug 6: Very few citations — warn and mark as thinly sourced
      if (retrievedCitations.length < 3 && depth !== 'light') {
        console.warn(`[Research] Only ${retrievedCitations.length} citations found — synthesis will be thinly sourced`);
      }
      // === PHASE 2: SYNTHESIZE (only when Phase 1 succeeded) ===
      console.log(`[Research] Phase 1 complete: ${retrievedCitations.length} citations from Claude retrieval`);
      await registry.updateProgress(agent.id, 50, `Synthesizing ${depth} analysis`);

      const phase2Start = Date.now();
      const synthesis = await buildSynthesisPrompt(config, retrievedText, retrievedCitations);
      isDrafterMode = synthesis.isDrafterMode; // Synthesis prompt resolves drafter independently
      const synthesisProvider = getSearchProvider(); // Gemini
      const synthesisResult = await synthesisProvider.generate({
        query: synthesis.contents,
        systemInstruction: synthesis.systemInstruction,
        maxOutputTokens: depthCfg.maxTokens,
        useSearchTool: false, // ADR-010: No googleSearch — pure synthesis
      });
      apiCalls++;
      appendPhase(chain, {
        name: 'synthesize',
        provider: 'gemini-flash',
        tools: [],
        durationMs: Date.now() - phase2Start,
      });

      // Build result: Phase 2 text + Phase 1 citations
      searchResult = {
        text: synthesisResult.text,
        citations: retrievedCitations,       // From Phase 1
        groundingUsed: true,                 // Phase 1 did the grounding
        searchQueries: retrievalResult.searchQueries,
        groundingSupportCount: retrievedCitations.length,
      };
    }

    // Convert to legacy GeminiResponse shape
    const response = toGeminiResponse(searchResult);

    // DEBUG: Log raw response for troubleshooting
    const providerChain = usedFallback
      ? "claude-retrieve (degraded, 0 citations) → gemini-synthesize (ungrounded)"
      : "claude-retrieve → gemini-synthesize";
    console.log("[Research] ========== RAW RESPONSE ==========");
    console.log("[Research] Provider:", providerChain);
    console.log("[Research] Text length:", response.text?.length || 0);
    console.log("[Research] Text preview (first 1000 chars):", response.text?.substring(0, 1000));
    console.log("[Research] Citations count:", response.citations?.length || 0);
    if (response.citations?.length > 0) {
      console.log("[Research] First 3 citations:", response.citations.slice(0, 3));
    }
    console.log("[Research] ============================================");

    // Warn if response may have been truncated (text ends without proper JSON closure)
    if (response.text && response.text.length > 40000) {
      const lastChars = response.text.trim().slice(-10);
      if (!lastChars.includes('}') && !lastChars.includes('```')) {
        console.warn(`[Research] WARNING: Response appears truncated (${response.text.length} chars, ends with: "${lastChars}")`);
      }
    }

    await registry.updateProgress(agent.id, 75, "Synthesizing findings");

    // CRITICAL: Fail fast if grounding didn't work
    // In two-phase mode, groundingUsed = true when Phase 1 returned citations.
    // In fallback mode, this checks Gemini's own grounding.
    if (!response.groundingUsed) {
      console.error("[Research] GROUNDING FAILURE: No search results from either provider");
      console.error("[Research] Neither Claude retrieval nor Gemini grounding returned citations");
      throw new Error("HALLUCINATION: Grounding failure — neither Claude retrieval nor Gemini grounding returned search results");
    }

    // Parse research result from response (async for URL resolution)
    const researchResult = await parseResearchResponse(
      response.text,
      response.citations,
      config,
      depth,
      isDrafterMode
    );

    // CHECK: Did parsing detect hallucination?
    const isHallucinated = researchResult.summary.startsWith("Research FAILED:");
    if (isHallucinated) {
      console.error("[Research Agent] Hallucination detected, throwing error");
      throw new Error("HALLUCINATION: " + researchResult.summary);
    }

    // Validate source count for deep research
    if (depth === "deep" && researchResult.sources.length < depthCfg.minSources) {
      console.warn(
        `[Research Agent] Deep research returned only ${researchResult.sources.length} sources (min: ${depthCfg.minSources})`
      );
    }

    await registry.updateProgress(agent.id, 95, "Finalizing report");

    // Calculate metrics
    const metrics: AgentMetrics = {
      durationMs: Date.now() - startTime,
      apiCalls,
      tokensUsed: Math.ceil((systemInstruction.length + contents.length) / 4) + Math.ceil(response.text.length / 4),
      retries: 0,
    };

    // Sprint C: Populate ragChunks with honest context source references
    const ragChunkRefs: string[] = [];
    if ((config as any).worldviewContext?.povTitle) {
      ragChunkRefs.push(`pov:${(config as any).worldviewContext.povTitle}`);
    }
    if (config.sourceContent) {
      ragChunkRefs.push('pre-reader:extracted');
    }
    if ((config as any).povContext?.title) {
      ragChunkRefs.push(`pov-library:${(config as any).povContext.title}`);
    }

    // Sprint C: Detect sensitive claims
    const { detectSensitiveClaims } = await import('../services/claim-detector');
    const claimsText = researchResult.summary + ' ' +
      (researchResult.findings?.map((f: any) => f.detail || f.claim || '').join(' ') ?? '');
    const claims = detectSensitiveClaims(claimsText);
    if (claims.flags.length > 0) {
      console.log('[Research] Sensitive claims detected:', claims.flags, claims.matchedPatterns);
    }

    // Sprint A+C: Finalize provenance with result data + claims + ragChunks
    setResult(chain, {
      findingCount: researchResult.findings?.length ?? 0,
      citations: (response.citations || []).map((c: { url: string }) => c.url),
      ragChunks: ragChunkRefs,
      hallucinationDetected: false,
      claimFlags: claims.flags,
    });
    chain.compute.apiCalls = apiCalls;
    finalizeProvenance(chain);

    // Build agent result - include FULL raw response for lossless capture
    const result: AgentResult = {
      success: true,
      output: {
        ...researchResult,
        rawResponse: response.text, // Preserve complete Gemini output
        provenanceChain: chain,     // Sprint A: attach provenance for delivery
        claimFlags: claims.flags,   // Sprint C: for downstream Andon
      },
      summary: researchResult.summary.substring(0, 500), // Brief preview for Notes field
      artifacts: researchResult.sources,
      metrics,
    };

    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error("[Research Agent] Error:", errorMessage);
    if (errorStack) {
      console.error("[Research Agent] Stack:", errorStack);
    }

    return {
      success: false,
      output: { error: errorMessage, stack: errorStack },
      summary: `Research failed: ${errorMessage}`,
      metrics: {
        durationMs: Date.now() - startTime,
        apiCalls,
        retries: 0,
      },
    };
  }
}

/**
 * Validate that sources are real URLs, not template placeholders
 * Catches hallucination when Gemini's grounding fails
 */
function detectHallucination(
  sources: string[],
  citations: Array<{ url: string; title: string }>,
  findings: Array<{ url?: string; source?: string }>
): { isHallucinated: boolean; reason: string } {
  // Pattern 1: Template placeholder URLs
  const placeholderPatterns = [
    /^https?:\/\/url\d+\.com/i,           // url1.com, url2.com
    /^https?:\/\/source-url\.com/i,       // source-url.com
    /^https?:\/\/example\.com/i,          // example.com (unless intentional)
    /^https?:\/\/.*placeholder/i,         // anything with "placeholder"
  ];

  const placeholderUrls = sources.filter(url =>
    placeholderPatterns.some(pattern => pattern.test(url))
  );

  if (placeholderUrls.length > 0) {
    return {
      isHallucinated: true,
      reason: `Template placeholder URLs detected: ${placeholderUrls.slice(0, 3).join(', ')}`,
    };
  }

  // Pattern 2: Zero grounding citations + generic sources
  if (citations.length === 0) {
    const hasUnspecifiedSources = findings.some(f =>
      f.source?.toLowerCase().includes('unspecified') ||
      f.url === 'unavailable' ||
      f.url === ''
    );

    if (hasUnspecifiedSources) {
      return {
        isHallucinated: true,
        reason: 'Google Search grounding returned 0 citations and findings have unspecified sources',
      };
    }
  }

  // Pattern 3: All findings have identical placeholder sources
  const uniqueSourceUrls = new Set(
    findings.map(f => f.url).filter(url => url && url.length > 0)
  );

  if (findings.length > 3 && uniqueSourceUrls.size === 0) {
    return {
      isHallucinated: true,
      reason: 'All findings have empty or missing URLs despite research completing',
    };
  }

  return { isHallucinated: false, reason: '' };
}

/**
 * Attempt to repair truncated JSON responses from Gemini.
 *
 * When the model hits MAX_TOKENS, it often truncates mid-array or mid-object,
 * producing JSON like: {"findings": [{"claim":"..."}, {"claim":"... (cut off)
 *
 * This function attempts to close open brackets/braces to recover partial data
 * rather than falling through to regex (which loses most of the structure).
 */
function repairTruncatedJson(text: string): any | null {
  // Find the JSON content (strip markdown fences if present)
  const jsonMatch = text.match(/```json\s*([\s\S]*)/);
  let jsonText = jsonMatch ? jsonMatch[1].replace(/\s*```\s*$/, '') : text;

  // Find the start of the JSON object
  const objStart = jsonText.indexOf('{');
  if (objStart === -1) return null;
  jsonText = jsonText.substring(objStart);

  // Try parsing as-is first (maybe it's valid)
  try {
    return JSON.parse(jsonText);
  } catch { /* expected — continue to repair */ }

  // Strategy: walk through the text, track bracket depth, and close what's open
  // First, strip any trailing incomplete string value (truncated mid-value)
  // Look for the last complete key-value pair
  let repaired = jsonText;

  // Remove trailing incomplete string (e.g., "claim": "some text that got cu)
  // Find last complete string value by looking for last '", ' or '"}'
  const lastCompleteValue = repaired.lastIndexOf('",');
  const lastCompleteObjEnd = repaired.lastIndexOf('"}');
  const lastComplete = Math.max(lastCompleteValue, lastCompleteObjEnd);

  if (lastComplete > 0) {
    // Cut after the last complete value
    repaired = repaired.substring(0, lastComplete + 1);
  }

  // Now close open brackets/braces
  const openBrackets: string[] = [];
  let inString = false;
  let escaped = false;

  for (let i = 0; i < repaired.length; i++) {
    const ch = repaired[i];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (ch === '\\') {
      escaped = true;
      continue;
    }

    if (ch === '"') {
      inString = !inString;
      continue;
    }

    if (inString) continue;

    if (ch === '{') openBrackets.push('}');
    else if (ch === '[') openBrackets.push(']');
    else if (ch === '}' || ch === ']') {
      if (openBrackets.length > 0 && openBrackets[openBrackets.length - 1] === ch) {
        openBrackets.pop();
      }
    }
  }

  // Close everything that's still open
  if (openBrackets.length > 0) {
    repaired += openBrackets.reverse().join('');
  }

  try {
    const result = JSON.parse(repaired);
    console.warn(`[Research] JSON REPAIR successful — recovered from truncated response (${openBrackets.length} brackets closed)`);
    return result;
  } catch (e) {
    console.warn("[Research] JSON repair failed:", (e as Error).message);
    return null;
  }
}

/**
 * Parse Gemini's response into structured ResearchResult
 *
 * HANDLES: Malformed JSON from Gemini (incomplete arrays, multiple JSON blocks, etc.)
 * Uses regex extraction as primary method since Gemini often returns broken JSON.
 */
async function parseResearchResponse(
  text: string,
  citations: Array<{ url: string; title: string }>,
  config: ResearchConfig,
  depth: ResearchDepth,
  isDrafterMode: boolean = false
): Promise<ResearchResult> {
  console.log("[Research] === PARSING RESPONSE ===");
  console.log("[Research] Raw text length:", text.length);
  console.log("[Research] Grounding citations:", citations.length);
  console.log("[Research] isDrafterMode:", isDrafterMode);

  // PROSE MODE: Early return — drafter produced prose markdown, not JSON
  if (isDrafterMode) {
    console.log("[Research] Prose mode — skipping JSON extraction");

    // Extract source URLs from grounding citations ONLY (deduped)
    // CRITICAL: Model-generated markdown links in prose body are NOT sources.
    // They are presentation — the model fabricates URLs that look real but aren't.
    // Only groundingMetadata.groundingChunks citations count as evidence.
    const sources: string[] = [];
    const seenUrls = new Set<string>();
    for (const citation of citations) {
      if (citation.url && !seenUrls.has(citation.url)) {
        sources.push(citation.url);
        seenUrls.add(citation.url);
      }
    }

    // Log discrepancy between grounding citations and prose links for diagnostics
    const markdownLinkPattern = /\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;
    let proseLinksCount = 0;
    let linkMatch;
    while ((linkMatch = markdownLinkPattern.exec(text)) !== null) {
      if (!seenUrls.has(linkMatch[1])) proseLinksCount++;
    }
    if (proseLinksCount > 0) {
      console.warn(`[Research] PROSE LINK DISCREPANCY: ${proseLinksCount} markdown links in prose body are NOT grounding citations — excluded from source count (grounding: ${citations.length}, prose-only: ${proseLinksCount})`);
    }

    // Hallucination check with empty findings (citation-only checks still work)
    const hallucinationCheck = detectHallucination(sources, citations, []);
    if (hallucinationCheck.isHallucinated) {
      console.error("[Research] HALLUCINATION DETECTED in prose mode:", hallucinationCheck.reason);
      return {
        summary: `Research FAILED: ${hallucinationCheck.reason}. Google Search grounding did not return real results for this query.`,
        findings: [],
        sources: [],
        query: config.query,
        focus: config.focus,
        depth,
      };
    }

    // Resolve Vertex AI grounding redirect URLs to real destinations
    // (Same resolution the JSON path uses — prose path must not skip it)
    const { resolvedSources } = await resolveAllRedirectUrls(sources, []);

    // Also resolve vertex redirect URLs embedded in prose body markdown links
    let resolvedText = text;
    const vertexUrlsInBody = new Set<string>();
    const bodyLinkPattern = /\[[^\]]*\]\((https?:\/\/vertexaisearch\.cloud\.google\.com\/grounding-api-redirect\/[^)]+)\)/g;
    let bodyMatch;
    while ((bodyMatch = bodyLinkPattern.exec(text)) !== null) {
      vertexUrlsInBody.add(bodyMatch[1]);
    }

    if (vertexUrlsInBody.size > 0) {
      console.log(`[Research] Resolving ${vertexUrlsInBody.size} vertex URLs in prose body...`);
      const bodyUrlArray = Array.from(vertexUrlsInBody);
      const bodyBatchSize = 5;
      const bodyResolvedMap = new Map<string, string | null>();
      for (let i = 0; i < bodyUrlArray.length; i += bodyBatchSize) {
        const batch = bodyUrlArray.slice(i, i + bodyBatchSize);
        const results = await Promise.all(batch.map(resolveRedirectUrl));
        batch.forEach((url, idx) => {
          bodyResolvedMap.set(url, results[idx]);
        });
      }

      // Replace vertex URLs in prose body with resolved destinations
      for (const [vertexUrl, resolvedUrl] of bodyResolvedMap) {
        if (resolvedUrl && resolvedUrl !== vertexUrl) {
          resolvedText = resolvedText.split(vertexUrl).join(resolvedUrl);
        } else if (resolvedUrl === null) {
          // Unresolvable — remove the markdown link but keep the link text
          const linkWithVertex = new RegExp(
            `\\[([^\\]]*)\\]\\(${vertexUrl.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`,
            'g'
          );
          resolvedText = resolvedText.replace(linkWithVertex, '$1');
        }
      }
    }

    // Build summary preview from first 500 chars (for Notes field)
    const summaryPreview = resolvedText
      .replace(/^#+\s+.*$/gm, '') // Strip headings
      .replace(/\n{2,}/g, '\n')   // Collapse whitespace
      .trim()
      .substring(0, 500);

    return {
      summary: summaryPreview,
      findings: [],
      sources: resolvedSources,
      query: config.query,
      focus: config.focus,
      depth,
      contentMode: 'prose',
      proseContent: resolvedText,
    };
  }

  // JSON MODE: Existing structured parsing (unchanged below)

  // STRATEGY 1: Try to parse JSON first (most reliable if it works)
  let parsedJson: any = null;
  try {
    // Extract JSON block if present
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1] : text;

    // Try to find and parse the JSON object
    const jsonObjectMatch = jsonText.match(/\{[\s\S]*(?:"summary"|"error")[\s\S]*\}/);
    if (jsonObjectMatch) {
      parsedJson = JSON.parse(jsonObjectMatch[0]);
      console.log("[Research] Successfully parsed JSON, summary length:", parsedJson.summary?.length || 0);

      // CHECK: Did the model report an error (no search results)?
      if (parsedJson.error === "NO_SEARCH_RESULTS") {
        console.error("[Research] Model reported NO_SEARCH_RESULTS");
        // ALWAYS start with "Research FAILED:" to ensure failure detection works
        return {
          summary: `Research FAILED: ${parsedJson.summary || "Google Search returned no relevant results for this query."}`,
          findings: [],
          sources: [],
          query: config.query,
          focus: config.focus,
          depth,
        };
      }
    }
  } catch (e) {
    console.warn("[Research] JSON parse failed, attempting repair:", (e as Error).message);
    // Phase 3a: Try to repair truncated JSON before falling to regex
    parsedJson = repairTruncatedJson(text);
    if (parsedJson) {
      console.warn("[Research] JSON repair recovered data — findings:", parsedJson.findings?.length || 0, "sources:", parsedJson.sources?.length || 0);
    } else {
      console.warn("[Research] JSON repair failed, falling back to regex extraction — DATA LOSS LIKELY");
    }
  }

  // Use parsed JSON if available
  let summary = "";
  if (parsedJson?.summary) {
    summary = parsedJson.summary
      .replace(/\[cite:\s*[\d,\s]+\]/g, '') // Remove [cite: N] or [cite: 1, 2] markers
      .trim();
    console.log("[Research] Using JSON-parsed summary, length:", summary.length);
  } else {
    // STRATEGY 2: Fall back to regex extraction
    console.warn("[Research] WARNING: Using regex fallback for summary extraction — structured parsing failed");
    // This regex handles escaped characters in JSON strings
    const summaryMatch = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (summaryMatch) {
      summary = summaryMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\[cite:\s*[\d,\s]+\]/g, '') // Remove [cite: N] or [cite: 1, 2] markers
        .trim();
      console.warn("[Research] Extracted summary via regex, length:", summary.length);
    }
  }

  // Extract findings - use parsed JSON or fall back to regex
  const findings: ResearchFinding[] = [];
  if (parsedJson?.findings && Array.isArray(parsedJson.findings)) {
    for (const f of parsedJson.findings) {
      if (f.claim) {
        findings.push({
          claim: String(f.claim).replace(/\[cite:\s*\d+\]/g, '').trim(),
          source: String(f.source || ''),
          url: String(f.url || ''),
          author: f.author,
          date: f.date,
          relevance: 90,
        });
      }
    }
    console.log("[Research] Using JSON-parsed findings:", findings.length);
  } else {
    // Fall back to regex extraction
    console.warn("[Research] WARNING: Using regex fallback for findings extraction — potential data loss");
    const findingsBlockMatch = text.match(/"findings"\s*:\s*\[([\s\S]*?)(?:\]\s*,|\]\s*\}|\]\s*```)/);
    if (findingsBlockMatch) {
      const findingPattern = /\{\s*"claim"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"source"\s*:\s*"((?:[^"\\]|\\.)*)"\s*,\s*"url"\s*:\s*"((?:[^"\\]|\\.)*)"/g;
      let match;
      while ((match = findingPattern.exec(findingsBlockMatch[1])) !== null) {
        findings.push({
          claim: match[1].replace(/\\"/g, '"').replace(/\[cite:\s*\d+\]/g, '').trim(),
          source: match[2].replace(/\\"/g, '"'),
          url: match[3],
          relevance: 90,
        });
      }
      console.warn("[Research] Extracted findings via regex:", findings.length);
    }
  }

  // Extract sources - use parsed JSON or fall back to regex
  const sources: string[] = [];
  if (parsedJson?.sources && Array.isArray(parsedJson.sources)) {
    for (const s of parsedJson.sources) {
      if (s && typeof s === 'string' && !sources.includes(s)) {
        sources.push(s);
      }
    }
    console.log("[Research] Using JSON-parsed sources:", sources.length);
  } else {
    console.warn("[Research] WARNING: Using regex fallback for sources extraction — potential data loss");
    const sourcesBlockMatch = text.match(/"sources"\s*:\s*\[([\s\S]*?)(?:\]|\n\s*```)/);
    if (sourcesBlockMatch) {
      const urlPattern = /"(https?:\/\/[^"]+)"/g;
      let match;
      while ((match = urlPattern.exec(sourcesBlockMatch[1])) !== null) {
        if (!sources.includes(match[1])) {
          sources.push(match[1]);
        }
      }
      console.warn("[Research] Extracted sources via regex:", sources.length);
    }
  }

  // ALWAYS merge grounding citations — they are the authoritative source list
  // from Google Search and should never be discarded, even if JSON parsing
  // extracted some data (which may be truncated/partial).
  const existingUrls = new Set(sources);
  const existingFindingUrls = new Set(findings.map(f => f.url));

  for (const citation of citations) {
    if (citation.url) {
      // Add to sources if not already present
      if (!existingUrls.has(citation.url)) {
        sources.push(citation.url);
        existingUrls.add(citation.url);
      }
      // Add as finding if not already covered
      if (!existingFindingUrls.has(citation.url)) {
        findings.push({
          claim: `Reference: ${citation.title}`,
          source: citation.title,
          url: citation.url,
          relevance: 80,
        });
        existingFindingUrls.add(citation.url);
      }
    }
  }

  if (citations.length > 0) {
    console.log(`[Research] Merged ${citations.length} grounding citations — total sources: ${sources.length}, findings: ${findings.length}`);
  }

  // RESOLVE REDIRECT URLs: Convert Gemini grounding redirects to actual URLs
  const { resolvedSources, resolvedFindings } = await resolveAllRedirectUrls(sources, findings);

  // HALLUCINATION CHECK: Validate before returning "success"
  const hallucinationCheck = detectHallucination(resolvedSources, citations, resolvedFindings);
  if (hallucinationCheck.isHallucinated) {
    console.error("[Research] HALLUCINATION DETECTED:", hallucinationCheck.reason);
    // Return error result instead of fake content
    return {
      summary: `Research FAILED: ${hallucinationCheck.reason}. Google Search grounding did not return real results for this query. The topic may be too niche, misspelled, or not well-indexed.`,
      findings: [],
      sources: [],
      query: config.query,
      focus: config.focus,
      depth,
    };
  }

  // If we got a summary and passed hallucination check, we succeeded
  if (summary.length > 50) {
    console.log("[Research] SUCCESS via regex extraction");
    return {
      summary,
      findings: resolvedFindings,
      sources: resolvedSources,
      query: config.query,
      focus: config.focus,
      depth,
    };
  }

  // Last resort: Try to extract any prose before the JSON
  console.log("[Research] Trying prose extraction...");
  const proseMatch = text.match(/^([\s\S]*?)(?:```json|\{"summary")/);
  if (proseMatch && proseMatch[1].trim().length > 50) {
    console.log("[Research] Found prose before JSON");
    return {
      summary: proseMatch[1].trim(),
      findings: resolvedFindings,
      sources: resolvedSources,
      query: config.query,
      focus: config.focus,
      depth,
    };
  }

  // Absolute fallback - return something useful
  console.log("[Research] FALLBACK - minimal extraction");
  return {
    summary: summary || "Research completed. See findings below.",
    findings: resolvedFindings.length > 0 ? resolvedFindings : citations.map((c) => ({
      claim: `Reference: ${c.title}`,
      source: c.title,
      url: c.url,
      relevance: 80,
    })),
    sources: resolvedSources.length > 0 ? resolvedSources : citations.map((c) => c.url).filter(Boolean),
    query: config.query,
    focus: config.focus,
    depth,
  };
}

// ==========================================
// Fallback Chain — Feed 2.0 Logging
// ==========================================

/**
 * Fire-and-forget Feed 2.0 entry when search fallback chain activates.
 * Pattern follows error-escalation.ts: lazy client, never throws.
 */
async function logFallbackToFeed(query: string, citationCount: number): Promise<void> {
  try {
    const { Client } = await import('@notionhq/client');
    const { NOTION_DB, ATLAS_NODE } = await import('@atlas/shared/config');

    const notion = new Client({ auth: process.env.NOTION_API_KEY });

    await notion.pages.create({
      parent: { database_id: NOTION_DB.FEED },
      properties: {
        Entry: {
          title: [{ text: { content: `[Search Fallback] Gemini->Claude: ${query.substring(0, 60)}` } }],
        },
        Source: { select: { name: `Atlas [${ATLAS_NODE}]` } },
        'Action Type': { select: { name: 'Logged' } },
        Status: { select: { name: 'Logged' } },
        Keywords: {
          multi_select: [
            { name: 'research:search:fallback' },
            { name: 'gemini-0-citations' },
          ],
        },
      },
    });

    console.log(`[Research] Fallback logged to Feed 2.0: ${citationCount} citations from Claude`);
  } catch (error) {
    console.error('[Research] Failed to log fallback to Feed:', error instanceof Error ? error.message : error);
  }
}

// ==========================================
// Research Agent Factory
// ==========================================

/**
 * Spawn and execute a research agent
 *
 * @example
 * ```typescript
 * // Light research - quick facts
 * const result = await runResearchAgent(registry, {
 *   query: "What is the current price of Bitcoin?",
 *   depth: "light"
 * });
 *
 * // Standard research - thorough analysis
 * const result = await runResearchAgent(registry, {
 *   query: "Compare AI coding assistants",
 *   depth: "standard",
 *   focus: "pricing"
 * });
 *
 * // Deep research - academic rigor
 * const result = await runResearchAgent(registry, {
 *   query: "Impact of AI on software development productivity",
 *   depth: "deep"
 * });
 * ```
 */
export async function runResearchAgent(
  registry: AgentRegistry,
  config: ResearchConfig,
  workItemId?: string
): Promise<{ agent: Agent; result: AgentResult }> {
  const depth = config.depth || "standard";

  // Spawn the agent
  const agent = await registry.spawn({
    type: "research",
    name: `Research (${depth}): ${config.query.substring(0, 40)}`,
    instructions: JSON.stringify(config),
    priority: depth === "deep" ? "P1" : "P2",
    workItemId,
  });

  // Start the agent
  await registry.start(agent.id);

  try {
    // Execute research
    const result = await executeResearch(config, agent, registry);

    // Complete or fail based on result
    if (result.success) {
      await registry.complete(agent.id, result);
    } else {
      await registry.fail(
        agent.id,
        result.summary || "Research failed",
        true
      );
    }

    // Get final agent state
    const finalAgent = await registry.status(agent.id);

    return {
      agent: finalAgent || agent,
      result,
    };
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";

    await registry.fail(agent.id, errorMessage, true);

    const finalAgent = await registry.status(agent.id);

    return {
      agent: finalAgent || agent,
      result: {
        success: false,
        summary: `Research failed: ${errorMessage}`,
      },
    };
  }
}

// ==========================================
// Exports
// ==========================================

export { DEPTH_CONFIG, FALLBACK_VOICE_DEFAULTS as VOICE_DEFAULTS };
export type { ResearchConfig, ResearchFinding, ResearchResult, ResearchDepth, ResearchVoice };
