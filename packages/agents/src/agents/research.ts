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
    maxTokens: 25000,
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
 * Resolve a single Gemini grounding redirect URL to its actual destination
 */
async function resolveRedirectUrl(url: string): Promise<string> {
  if (!GROUNDING_REDIRECT_PATTERN.test(url)) {
    return url; // Not a redirect URL, return as-is
  }

  try {
    // Use HEAD request to follow redirects without downloading content
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000); // 5s timeout

    const response = await fetch(url, {
      method: 'HEAD',
      redirect: 'follow',
      signal: controller.signal,
    });

    clearTimeout(timeout);

    // The final URL after following redirects
    return response.url || url;
  } catch (error) {
    console.log(`[Research] Failed to resolve redirect URL: ${url.substring(0, 80)}...`, error);
    return url; // Return original on error
  }
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
  const resolvedMap = new Map<string, string>();

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
  for (const [original, actual] of resolvedMap) {
    if (original !== actual) {
      resolved++;
      console.log(`[Research] Resolved: ${actual.substring(0, 60)}...`);
    }
  }
  console.log(`[Research] Successfully resolved ${resolved}/${urlsToResolve.size} URLs`);

  // Apply resolutions to sources
  const resolvedSources = sources.map(s => resolvedMap.get(s) || s);

  // Apply resolutions to findings
  const resolvedFindings = findings.map(f => ({
    ...f,
    url: f.url ? (resolvedMap.get(f.url) || f.url) : f.url,
  }));

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
const FALLBACK_VOICE_DEFAULTS: Record<Exclude<ResearchVoice, "custom">, string> = {
  "grove-analytical": `
## Writing Voice: Grove Analytical

Write with technical depth while remaining accessible. Key characteristics:
- Evidence-based claims with citations
- Forward-looking analysis ("This suggests...", "The trajectory points to...")
- Balanced skepticism (acknowledge hype vs. substance)
- Builder's perspective (practical implications)
- Confident but not arrogant tone
- Lead with insights, not summaries
- Use concrete examples
- End with implications or next questions
- Avoid: buzzwords, hype, vague conclusions
`,

  "linkedin-punchy": `
## Writing Voice: LinkedIn Punchy

Write for professional engagement and shareability. Key characteristics:
- Hook in first line (pattern interrupt)
- Short paragraphs (1-2 sentences max)
- Scannable structure with clear takeaways
- Confident, authoritative tone
- Slightly provocative (challenge assumptions)
- Authentic, not corporate
- Use numbered lists for key points
- End with a question or call to reflection
- No walls of text
`,

  "consulting": `
## Writing Voice: Consulting/Executive

Write for senior decision-makers. Key characteristics:
- Executive summary up front
- Recommendations-driven structure
- Clear "so what" for each point
- Quantify impact where possible
- Professional, measured tone
- Action-oriented conclusions
- Risk/benefit framing
- MECE structure (mutually exclusive, collectively exhaustive)
`,

  "raw-notes": `
## Writing Voice: Raw Notes

Provide research in working-notes format. Key characteristics:
- Bullet points over prose
- Include raw quotes and data points
- Note contradictions and uncertainties
- Keep synthesis minimal
- Organized by source or theme
- Include URLs inline with each point
- Good for further processing/editing
`,
};

/**
 * Get voice instructions for the research output.
 * Tries PromptManager first, falls back to hardcoded defaults.
 */
async function getVoiceInstructionsAsync(config: ResearchConfig): Promise<string> {
  const voice = config.voice || "grove-analytical";

  // Handle custom voice
  if (voice === "custom" && config.voiceInstructions) {
    return `\n## Writing Voice: Custom\n\n${config.voiceInstructions}\n`;
  }

  // Try to fetch from PromptManager (Notion)
  try {
    const promptManager = getPromptManager();
    const pillar = (config.pillar as PromptPillar) || "All";

    // Build voice prompt ID: "voice.grove-analytical" or "voice.linkedin-punchy"
    const voicePrompt = await promptManager.getPrompt({
      capability: "Voice",
      pillar,
      useCase: "General",
    });

    if (voicePrompt) {
      console.log(`[Research] Loaded voice "${voice}" from PromptManager`);
      return voicePrompt;
    }
  } catch (error) {
    console.warn("[Research] PromptManager fetch failed, using fallback:", error);
  }

  // Fallback to hardcoded defaults
  console.log(`[Research] Using fallback voice "${voice}"`);
  // Type assertion needed because voice can be "custom" which isn't in FALLBACK_VOICE_DEFAULTS
  const fallbackVoice = voice === "custom" ? "grove-analytical" : voice;
  return FALLBACK_VOICE_DEFAULTS[fallbackVoice] || FALLBACK_VOICE_DEFAULTS["grove-analytical"];
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

async function buildResearchPrompt(config: ResearchConfig): Promise<string> {
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

  // VOICE FIRST: Put voice/style instructions at the TOP so the model adopts the persona
  // before processing the task. This is critical for voice injection to work.
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
${getDepthInstructions(depth)}

## Output Format

Provide your response in this exact JSON format:

\`\`\`json
{
  "summary": "${getSummaryGuidance(depth)}",
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
\`\`\`

${getQualityGuidelines(depth)}

Begin your research now.`;

  return basePrompt;
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
- Do NOT truncate your response — you have ~25,000 tokens available
- Complete every section fully before ending your response`;
  }
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
    const prompt = await buildResearchPrompt(config);

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
      depth
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
 * Parse Gemini's response into structured ResearchResult
 *
 * HANDLES: Malformed JSON from Gemini (incomplete arrays, multiple JSON blocks, etc.)
 * Uses regex extraction as primary method since Gemini often returns broken JSON.
 */
async function parseResearchResponse(
  text: string,
  citations: Array<{ url: string; title: string }>,
  config: ResearchConfig,
  depth: ResearchDepth
): Promise<ResearchResult> {
  console.log("[Research] === PARSING RESPONSE ===");
  console.log("[Research] Raw text length:", text.length);
  console.log("[Research] Grounding citations:", citations.length);

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
    console.log("[Research] JSON parse failed, falling back to regex:", (e as Error).message);
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
    // This regex handles escaped characters in JSON strings
    const summaryMatch = text.match(/"summary"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    if (summaryMatch) {
      summary = summaryMatch[1]
        .replace(/\\n/g, '\n')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\')
        .replace(/\[cite:\s*[\d,\s]+\]/g, '') // Remove [cite: N] or [cite: 1, 2] markers
        .trim();
      console.log("[Research] Extracted summary via regex, length:", summary.length);
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
      console.log("[Research] Extracted findings via regex:", findings.length);
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
    const sourcesBlockMatch = text.match(/"sources"\s*:\s*\[([\s\S]*?)(?:\]|\n\s*```)/);
    if (sourcesBlockMatch) {
      const urlPattern = /"(https?:\/\/[^"]+)"/g;
      let match;
      while ((match = urlPattern.exec(sourcesBlockMatch[1])) !== null) {
        if (!sources.includes(match[1])) {
          sources.push(match[1]);
        }
      }
      console.log("[Research] Extracted sources via regex:", sources.length);
    }
  }

  // Add grounding citations if we didn't get enough findings
  if (findings.length === 0) {
    for (const citation of citations) {
      if (citation.url) {
        findings.push({
          claim: `Reference: ${citation.title}`,
          source: citation.title,
          url: citation.url,
          relevance: 80,
        });
      }
    }
  }

  // Add citation URLs to sources if we didn't extract any
  if (sources.length === 0) {
    for (const citation of citations) {
      if (citation.url && !sources.includes(citation.url)) {
        sources.push(citation.url);
      }
    }
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
