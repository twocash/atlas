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
import type { Agent, AgentResult, AgentMetrics } from "../types";

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
// Gemini Client with Google Search Grounding
// ==========================================

interface GeminiClient {
  generateContent: (prompt: string, maxTokens: number) => Promise<GeminiResponse>;
}

interface GeminiResponse {
  text: string;
  citations: Array<{ url: string; title: string }>;
  groundingMetadata?: unknown;
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

      _geminiClient = {
        generateContent: async (prompt: string, maxTokens: number): Promise<GeminiResponse> => {
          const response = await ai.models.generateContent({
            model: "gemini-2.0-flash",
            contents: prompt,
            config: {
              tools: [{ googleSearch: {} }],
              maxOutputTokens: maxTokens,
            },
          });

          // Extract grounding metadata from response
          const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
          const groundingChunks = (groundingMetadata as any)?.groundingChunks || [];

          const citations: Array<{ url: string; title: string }> = [];
          for (const chunk of groundingChunks) {
            if (chunk.web) {
              citations.push({
                url: chunk.web.uri || "",
                title: chunk.web.title || "",
              });
            }
          }

          return {
            text: response.text || "",
            citations,
            groundingMetadata,
          };
        },
      };
    } else {
      // Legacy SDK: @google/generative-ai
      const { GoogleGenerativeAI } = genaiModule;
      const genAI = new GoogleGenerativeAI(apiKey);

      _geminiClient = {
        generateContent: async (prompt: string, maxTokens: number): Promise<GeminiResponse> => {
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
          const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
          const groundingChunks = (groundingMetadata as any)?.groundingChunks ||
                                  (groundingMetadata as any)?.groundingChuncks || []; // Typo in some SDK versions

          const citations: Array<{ url: string; title: string }> = [];
          for (const chunk of groundingChunks) {
            if (chunk.web) {
              citations.push({
                url: chunk.web.uri || "",
                title: chunk.web.title || "",
              });
            }
          }

          return {
            text: response.text(),
            citations,
            groundingMetadata,
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
 * Default voice instructions for each predefined voice
 */
const VOICE_DEFAULTS: Record<Exclude<ResearchVoice, "custom">, string> = {
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
 * Get voice instructions for the research output
 */
function getVoiceInstructions(config: ResearchConfig): string {
  if (!config.voice || config.voice === "grove-analytical") {
    // Default voice
    return VOICE_DEFAULTS["grove-analytical"];
  }

  if (config.voice === "custom" && config.voiceInstructions) {
    return `\n## Writing Voice: Custom\n\n${config.voiceInstructions}\n`;
  }

  return VOICE_DEFAULTS[config.voice] || VOICE_DEFAULTS["grove-analytical"];
}

// ==========================================
// System Prompts by Depth
// ==========================================

function buildResearchPrompt(config: ResearchConfig): string {
  const depth = config.depth || "standard";
  const depthCfg = DEPTH_CONFIG[depth];
  const voiceInstructions = getVoiceInstructions(config);

  // DEBUG: Log voice injection
  console.log("[Research] buildResearchPrompt voice config:", {
    voice: config.voice,
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
      "source": "Name of the source",
      "url": "https://source-url.com"${depth === "deep" ? ',\n      "author": "Author Name if available",\n      "date": "Publication date if available"' : ""}
    }
  ],
  "sources": ["https://url1.com", "https://url2.com"]${depth === "deep" ? ',\n  "bibliography": ["Chicago-style citation 1", "Chicago-style citation 2"]' : ""}
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
    const prompt = buildResearchPrompt(config);

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

    // Parse research result from response
    const researchResult = parseResearchResponse(
      response.text,
      response.citations,
      config,
      depth
    );

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
 * Parse Gemini's response into structured ResearchResult
 *
 * HANDLES: Malformed JSON from Gemini (incomplete arrays, multiple JSON blocks, etc.)
 * Uses regex extraction as primary method since Gemini often returns broken JSON.
 */
function parseResearchResponse(
  text: string,
  citations: Array<{ url: string; title: string }>,
  config: ResearchConfig,
  depth: ResearchDepth
): ResearchResult {
  console.log("[Research] === PARSING RESPONSE ===");
  console.log("[Research] Raw text length:", text.length);

  // STRATEGY 1: Try to parse JSON first (most reliable if it works)
  let parsedJson: any = null;
  try {
    // Extract JSON block if present
    const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);
    const jsonText = jsonMatch ? jsonMatch[1] : text;

    // Try to find and parse the JSON object
    const jsonObjectMatch = jsonText.match(/\{[\s\S]*"summary"[\s\S]*\}/);
    if (jsonObjectMatch) {
      parsedJson = JSON.parse(jsonObjectMatch[0]);
      console.log("[Research] Successfully parsed JSON, summary length:", parsedJson.summary?.length || 0);
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

  // If we got a summary, we succeeded
  if (summary.length > 50) {
    console.log("[Research] SUCCESS via regex extraction");
    return {
      summary,
      findings,
      sources,
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
      findings,
      sources,
      query: config.query,
      focus: config.focus,
      depth,
    };
  }

  // Absolute fallback - return something useful
  console.log("[Research] FALLBACK - minimal extraction");
  return {
    summary: summary || "Research completed. See findings below.",
    findings: findings.length > 0 ? findings : citations.map((c) => ({
      claim: `Reference: ${c.title}`,
      source: c.title,
      url: c.url,
      relevance: 80,
    })),
    sources: sources.length > 0 ? sources : citations.map((c) => c.url).filter(Boolean),
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

export { DEPTH_CONFIG, VOICE_DEFAULTS };
export type { ResearchConfig, ResearchFinding, ResearchResult, ResearchDepth, ResearchVoice };
