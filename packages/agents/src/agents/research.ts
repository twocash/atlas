/**
 * Atlas Research Agent
 *
 * Autonomous agent for web research tasks.
 * Uses Gemini 2.0 Flash with Google Search grounding for
 * live web research with proper source citations.
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
  | "grove-analytical"
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
// Research Depth Configuration
// ==========================================

interface DepthConfig {
  maxTokens: number;
  targetSources: number;
  minSources: number;
  description: string;
  citationStyle: "inline" | "chicago";
}

const DEPTH_CONFIG: Record<ResearchDepth, DepthConfig> = {
  light: {
    maxTokens: 2048,
    targetSources: 3,
    minSources: 2,
    description: "Quick overview with key facts",
    citationStyle: "inline",
  },
  standard: {
    maxTokens: 8192,
    targetSources: 6,
    minSources: 4,
    description: "Thorough analysis with multiple perspectives",
    citationStyle: "inline",
  },
  deep: {
    maxTokens: 65536,
    targetSources: 12,
    minSources: 8,
    description: "Academic-grade research with rigorous citations",
    citationStyle: "chicago",
  },
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
// Gemini Client with Google Search Grounding
// ==========================================

interface GeminiClient {
  generateContent: (prompt: string, maxTokens: number) => Promise<GeminiResponse>;
}

interface GeminiResponse {
  text: string;
  citations: Array<{ url: string; title: string }>;
  groundingMetadata?: unknown;
  groundingUsed?: boolean; // True if grounding evidence was found
}

let _geminiClient: GeminiClient | null = null;

async function getGeminiClient(): Promise<GeminiClient> {
  if (!_geminiClient) {
    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey) {
      throw new Error("GEMINI_API_KEY environment variable is required");
    }

    // Use the new @google/genai SDK (recommended for Gemini 2.0+)
    // Falls back to legacy SDK if new one isn't available
    let useNewSdk = false;
    let genaiModule: any;

    try {
      genaiModule = await import("@google/genai");
      useNewSdk = true;
    } catch {
      // Fall back to legacy SDK
      genaiModule = await import("@google/generative-ai");
    }

    if (useNewSdk) {
      // New SDK: @google/genai
      const { GoogleGenAI } = genaiModule;
      const ai = new GoogleGenAI({ apiKey });
      console.log("[Research] Using NEW SDK (@google/genai)");

      _geminiClient = {
        generateContent: async (prompt: string, maxTokens: number): Promise<GeminiResponse> => {
          console.log("[Research] Calling Gemini with Google Search grounding...");
          const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} }],
              maxOutputTokens: maxTokens,
            },
          });

          // Extract grounding metadata from response
          const candidate = response.candidates?.[0];
          const groundingMetadata = candidate?.groundingMetadata;

          // DEBUG: Log full grounding structure
          console.log("[Research] Grounding metadata keys:", groundingMetadata ? Object.keys(groundingMetadata) : "null");
          console.log("[Research] Candidate finishReason:", candidate?.finishReason);

          const groundingChunks = (groundingMetadata as any)?.groundingChunks || [];
          const searchEntryPoint = (groundingMetadata as any)?.searchEntryPoint;
          const webSearchQueries = (groundingMetadata as any)?.webSearchQueries || [];

          console.log("[Research] Web search queries:", webSearchQueries);
          console.log("[Research] Grounding chunks count:", groundingChunks.length);
          if (searchEntryPoint) {
            console.log("[Research] Search entry point present:", !!searchEntryPoint.renderedContent);
          }

          const citations: Array<{ url: string; title: string }> = [];
          for (const chunk of groundingChunks) {
            if (chunk.web) {
              citations.push({
                url: chunk.web.uri || "",
                title: chunk.web.title || "",
              });
            }
          }

          // Check if grounding was actually used (Gemini 2.0 has different structure)
          const groundingSupports = (groundingMetadata as any)?.groundingSupports || [];

          // Gemini 2.0 uses groundingSupports instead of groundingChunks
          // If groundingSupports exists, grounding DID run even if we don't have URLs
          if (groundingSupports.length > 0) {
            console.log("[Research] Grounding confirmed via groundingSupports:", groundingSupports.length, "segments");
          } else if (webSearchQueries.length === 0 && citations.length === 0) {
            console.warn("[Research] WARNING: No grounding evidence found - results may be from training data!");
          }

          // Grounding is confirmed if ANY of these are present:
          // - groundingSupports (Gemini 2.0 style)
          // - groundingChunks (legacy style)
          // - citations extracted from groundingChunks
          // - webSearchQueries (Gemini searched for something)
          const groundingUsed = groundingSupports.length > 0 || groundingChunks.length > 0 || citations.length > 0 || webSearchQueries.length > 0;
          console.log("[Research] Grounding used:", groundingUsed, {
            groundingSupports: groundingSupports.length,
            groundingChunks: groundingChunks.length,
            citations: citations.length,
            webSearchQueries: webSearchQueries.length,
          });

          return {
            text: response.text || "",
            citations,
            groundingMetadata,
            groundingUsed,
          };
        },
      };
    } else {
      // Legacy SDK: @google/generative-ai
      const { GoogleGenerativeAI } = genaiModule;
      const genAI = new GoogleGenerativeAI(apiKey);
      console.log("[Research] Using LEGACY SDK (@google/generative-ai)");

      _geminiClient = {
        generateContent: async (prompt: string, maxTokens: number): Promise<GeminiResponse> => {
          console.log("[Research] Calling Gemini with Google Search grounding (legacy)...");
          // For legacy SDK with Gemini 2.0, use google_search (not googleSearchRetrieval)
          const model = genAI.getGenerativeModel({
            model: "gemini-2.0-flash",
            tools: [{ google_search: {} }] as any,
            generationConfig: {
              maxOutputTokens: maxTokens,
            },
          });

          const result = await model.generateContent(prompt);
          const response = result.response;

          // Extract grounding citations
          const candidate = response.candidates?.[0];
          const groundingMetadata = candidate?.groundingMetadata;

          // DEBUG: Log full grounding structure
          console.log("[Research] Grounding metadata keys:", groundingMetadata ? Object.keys(groundingMetadata as object) : "null");
          console.log("[Research] Candidate finishReason:", candidate?.finishReason);

          const groundingChunks = (groundingMetadata as any)?.groundingChunks ||
                                  (groundingMetadata as any)?.groundingChuncks || []; // Typo in some SDK versions
          const webSearchQueries = (groundingMetadata as any)?.webSearchQueries || [];

          console.log("[Research] Web search queries:", webSearchQueries);
          console.log("[Research] Grounding chunks count:", groundingChunks.length);

          const citations: Array<{ url: string; title: string }> = [];
          for (const chunk of groundingChunks) {
            if (chunk.web) {
              citations.push({
                url: chunk.web.uri || "",
                title: chunk.web.title || "",
              });
            }
          }

          // Check if grounding was actually used (Gemini 2.0 has different structure)
          const groundingSupports = (groundingMetadata as any)?.groundingSupports || [];

          // Gemini 2.0 uses groundingSupports instead of groundingChunks
          if (groundingSupports.length > 0) {
            console.log("[Research] Grounding confirmed via groundingSupports:", groundingSupports.length, "segments");
          } else if (webSearchQueries.length === 0 && citations.length === 0) {
            console.warn("[Research] WARNING: No grounding evidence found - results may be from training data!");
          }

          // Grounding is confirmed if ANY of these are present:
          // - groundingSupports (Gemini 2.0 style)
          // - citations extracted from groundingChunks
          // - webSearchQueries (Gemini searched for something)
          // - groundingChunks (legacy style)
          const groundingUsed = groundingSupports.length > 0 || citations.length > 0 || webSearchQueries.length > 0 || groundingChunks.length > 0;
          console.log("[Research] Grounding used:", groundingUsed, {
            groundingSupports: groundingSupports.length,
            citations: citations.length,
            webSearchQueries: webSearchQueries.length,
            groundingChunks: groundingChunks.length,
          });

          return {
            text: response.text(),
            citations,
            groundingMetadata,
            groundingUsed,
          };
        },
      };
    }
  }

  return _geminiClient;
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
 * @see apps/telegram/data/migrations/prompts-v1.json
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
  "grove-analytical": `
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
  const voice = config.voice || "grove-analytical";

  // Handle custom voice (pre-loaded content from Telegram voice selection)
  if (voice === "custom" && config.voiceInstructions) {
    return `\n## Writing Voice: Custom\n\n${config.voiceInstructions}\n`;
  }

  // Try to fetch from PromptManager (Notion) by direct ID: "voice.grove-analytical", "voice.consulting", etc.
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
  const fallbackVoice = voice === "custom" ? "grove-analytical" : voice;
  const fallbackText = FALLBACK_VOICE_DEFAULTS[fallbackVoice] || FALLBACK_VOICE_DEFAULTS["grove-analytical"];
  return fallbackText + '\n' + degradedWarning(promptId);
}

/**
 * Sync wrapper for backwards compatibility - uses fallback only
 * @deprecated Use getVoiceInstructionsAsync for PromptManager integration
 */
function getVoiceInstructions(config: ResearchConfig): string {
  if (!config.voice || config.voice === "grove-analytical") {
    return FALLBACK_VOICE_DEFAULTS["grove-analytical"];
  }

  if (config.voice === "custom" && config.voiceInstructions) {
    return `\n## Writing Voice: Custom\n\n${config.voiceInstructions}\n`;
  }

  // Type assertion needed because voice can be "custom" which isn't in FALLBACK_VOICE_DEFAULTS
  const fallbackVoice = config.voice === "custom" ? "grove-analytical" : config.voice;
  return FALLBACK_VOICE_DEFAULTS[fallbackVoice] || FALLBACK_VOICE_DEFAULTS["grove-analytical"];
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
        '2. Run seed migration: bun run apps/telegram/data/migrations/seed-prompts.ts',
        '3. Check network connectivity to Notion API',
      ],
    });
    return null;
  }
}

async function buildResearchPrompt(config: ResearchConfig): Promise<{ prompt: string; isDrafterMode: boolean }> {
  const depth = config.depth || "standard";
  const depthCfg = DEPTH_CONFIG[depth];

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
      "url": "<THE_ACTUAL_URL_FROM_YOUR_SEARCH>"${depth === "deep" ? ',\n      "author": "Author Name if available",\n      "date": "Publication date if available"' : ""}
    }
  ],
  "sources": ["<REAL_URL_1>", "<REAL_URL_2>", "..."]${depth === "deep" ? ',\n  "bibliography": ["Chicago-style citation 1", "Chicago-style citation 2"]' : ""}
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

  const basePrompt = `You are Atlas Research Agent, an autonomous research assistant with access to Google Search.

## STYLE GUIDELINES (CRITICAL - ADOPT THIS VOICE THROUGHOUT)
${voiceInstructions}

## Research Task
Query: "${config.query}"
${config.focus ? `Focus Area: ${config.focus}` : ""}
Depth: ${depth} — ${depthCfg.description}
Target Sources: ${config.maxSources || depthCfg.targetSources}+

## Instructions

Use Google Search to find current, authoritative information about this topic.
${researchInstructions}

${outputSection}

${qualityBlock}

Begin your research now.`;

  return { prompt: basePrompt, isDrafterMode };
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
 * Execute a research task using Gemini with Google Search grounding
 */
export async function executeResearch(
  config: ResearchConfig,
  agent: Agent,
  registry: AgentRegistry
): Promise<AgentResult> {
  const startTime = Date.now();
  let apiCalls = 0;

  const depth = config.depth || "standard";
  const depthCfg = DEPTH_CONFIG[depth];

  try {
    // Report starting
    await registry.updateProgress(agent.id, 5, `Starting ${depth} research`);

    // Get Gemini client with grounding
    const gemini = await getGeminiClient();
    await registry.updateProgress(agent.id, 15, "Searching with Google");

    // Build prompt and execute
    const { prompt, isDrafterMode } = await buildResearchPrompt(config);

    await registry.updateProgress(agent.id, 30, `Analyzing sources (${depth})`);
    const response = await gemini.generateContent(prompt, depthCfg.maxTokens);
    apiCalls++;

    // DEBUG: Log raw response for troubleshooting
    console.log("[Research] ========== GEMINI RAW RESPONSE ==========");
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
    // This catches the case where Gemini responds from training data instead of live search
    if (!response.groundingUsed) {
      console.error("[Research] GROUNDING FAILURE: Google Search did not return results");
      console.error("[Research] Gemini responded from training data - this is NOT live research");
      throw new Error("HALLUCINATION: Grounding failure — Gemini responded from training data instead of performing live web research");
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
      tokensUsed: Math.ceil(prompt.length / 4) + Math.ceil(response.text.length / 4),
      retries: 0,
    };

    // Build agent result - include FULL raw response for lossless capture
    const result: AgentResult = {
      success: true,
      output: {
        ...researchResult,
        rawResponse: response.text, // Preserve complete Gemini output
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

    // Extract source URLs from grounding citations (deduped)
    const sources: string[] = [];
    const seenUrls = new Set<string>();
    for (const citation of citations) {
      if (citation.url && !seenUrls.has(citation.url)) {
        sources.push(citation.url);
        seenUrls.add(citation.url);
      }
    }

    // Also extract markdown link URLs from prose body
    const markdownLinkPattern = /\[[^\]]*\]\((https?:\/\/[^)]+)\)/g;
    let linkMatch;
    while ((linkMatch = markdownLinkPattern.exec(text)) !== null) {
      if (!seenUrls.has(linkMatch[1])) {
        sources.push(linkMatch[1]);
        seenUrls.add(linkMatch[1]);
      }
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

    // Build summary preview from first 500 chars (for Notes field)
    const summaryPreview = text
      .replace(/^#+\s+.*$/gm, '') // Strip headings
      .replace(/\n{2,}/g, '\n')   // Collapse whitespace
      .trim()
      .substring(0, 500);

    return {
      summary: summaryPreview,
      findings: [],
      sources,
      query: config.query,
      focus: config.focus,
      depth,
      contentMode: 'prose',
      proseContent: text,
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
