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

    const { GoogleGenerativeAI } = await import("@google/generative-ai");
    const genAI = new GoogleGenerativeAI(apiKey);

    _geminiClient = {
      generateContent: async (prompt: string, maxTokens: number): Promise<GeminiResponse> => {
        // Get model with Google Search grounding enabled
        const model = genAI.getGenerativeModel({
          model: "gemini-2.0-flash",
          tools: [{ googleSearch: {} }],
          generationConfig: {
            maxOutputTokens: maxTokens,
          },
        });

        const result = await model.generateContent(prompt);
        const response = result.response;

        // Extract grounding citations
        const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
        const groundingChunks = groundingMetadata?.groundingChunks || [];

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

  return _geminiClient;
}

// ==========================================
// System Prompts by Depth
// ==========================================

function buildResearchPrompt(config: ResearchConfig): string {
  const depth = config.depth || "standard";
  const depthCfg = DEPTH_CONFIG[depth];

  const basePrompt = `You are Atlas Research Agent, an autonomous research assistant with access to Google Search.

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
- Analyze and synthesize information
- Cross-reference claims across sources
- Note any conflicting information`;

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
      return "2-4 paragraph summary covering main findings, key insights, and implications";
    case "deep":
      return "Comprehensive 4-6 paragraph academic summary including: research context, methodology overview, key findings with evidence strength, limitations, areas of consensus/debate, and implications for further research";
  }
}

function getQualityGuidelines(depth: ResearchDepth): string {
  switch (depth) {
    case "light":
      return `## Guidelines
- Speed over depth — get the essentials
- Prefer recent, well-known sources
- One source per major claim is acceptable`;

    case "standard":
      return `## Guidelines
- Balance depth with practicality
- Cross-reference important claims
- Include specific data points and statistics
- Note publication dates for time-sensitive info
- Be objective — present multiple viewpoints`;

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
- Distinguish opinion/editorial from factual reporting`;
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

    // Build agent result
    const result: AgentResult = {
      success: true,
      output: researchResult,
      summary: researchResult.summary.substring(0, 500),
      artifacts: researchResult.sources,
      metrics,
    };

    return result;
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    console.error("[Research Agent] Error:", errorMessage);

    return {
      success: false,
      output: { error: errorMessage },
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
 */
function parseResearchResponse(
  text: string,
  citations: Array<{ url: string; title: string }>,
  config: ResearchConfig,
  depth: ResearchDepth
): ResearchResult {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);

      // Merge grounding citations with parsed findings
      const findings: ResearchFinding[] = parsed.findings || [];

      // Add any citations from grounding that aren't in findings
      for (const citation of citations) {
        const exists = findings.some((f) => f.url === citation.url);
        if (!exists && citation.url) {
          findings.push({
            claim: `Source: ${citation.title}`,
            source: citation.title,
            url: citation.url,
            relevance: 80,
          });
        }
      }

      // Collect all unique source URLs
      const sources = [
        ...new Set([
          ...(parsed.sources || []),
          ...citations.map((c) => c.url).filter(Boolean),
        ]),
      ];

      return {
        summary: parsed.summary || text,
        findings,
        sources,
        query: config.query,
        focus: config.focus,
        depth,
        bibliography: parsed.bibliography,
      };
    } catch {
      // JSON parsing failed, fall through to text extraction
    }
  }

  // Try to parse as raw JSON (no code block)
  try {
    const parsed = JSON.parse(text);
    if (parsed.summary && parsed.findings) {
      return {
        summary: parsed.summary,
        findings: parsed.findings || [],
        sources: [
          ...new Set([
            ...(parsed.sources || []),
            ...citations.map((c) => c.url).filter(Boolean),
          ]),
        ],
        query: config.query,
        focus: config.focus,
        depth,
        bibliography: parsed.bibliography,
      };
    }
  } catch {
    // Not valid JSON
  }

  // Fallback: use text as summary, citations as sources
  return {
    summary: text,
    findings: citations.map((c) => ({
      claim: `Reference: ${c.title}`,
      source: c.title,
      url: c.url,
      relevance: 80,
    })),
    sources: citations.map((c) => c.url).filter(Boolean),
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

export { DEPTH_CONFIG };
export type { ResearchConfig, ResearchFinding, ResearchResult, ResearchDepth };
