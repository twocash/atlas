/**
 * Atlas Research Agent
 *
 * Autonomous agent for web research tasks.
 * Uses Gemini 2.0 Flash with Google Search grounding for
 * live web research with proper source citations.
 */

import type { AgentRegistry } from "../registry";
import type { Agent, AgentResult, AgentMetrics } from "../types";

// ==========================================
// Research Agent Types
// ==========================================

/**
 * Configuration for a research task
 */
export interface ResearchConfig {
  /** The research query/question */
  query: string;

  /** Research depth - affects number of sources */
  depth?: "quick" | "thorough";

  /** Focus area to narrow research */
  focus?: string;

  /** Maximum sources to include */
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
  depth: "quick" | "thorough";
}

// ==========================================
// Research Agent Configuration
// ==========================================

const RESEARCH_DEFAULTS = {
  depth: "quick" as const,
  maxSourcesQuick: 3,
  maxSourcesThorough: 8,
  model: "gemini-2.0-flash",
  maxTokens: 8192,
};

// ==========================================
// Gemini Client with Google Search Grounding
// ==========================================

interface GeminiClient {
  generateContent: (prompt: string) => Promise<GeminiResponse>;
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

    // Dynamic import for Google Generative AI SDK
    const { GoogleGenerativeAI } = await import("@google/generative-ai");

    const genAI = new GoogleGenerativeAI(apiKey);

    // Get model with Google Search grounding enabled
    const model = genAI.getGenerativeModel({
      model: "gemini-2.0-flash",
      tools: [{ googleSearch: {} }],
    });

    _geminiClient = {
      generateContent: async (prompt: string): Promise<GeminiResponse> => {
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
// System Prompts
// ==========================================

function buildResearchPrompt(config: ResearchConfig): string {
  const maxSources =
    config.depth === "thorough"
      ? RESEARCH_DEFAULTS.maxSourcesThorough
      : RESEARCH_DEFAULTS.maxSourcesQuick;

  return `You are Atlas Research Agent, an autonomous research assistant with access to Google Search.

## Research Task
Query: "${config.query}"
${config.focus ? `Focus Area: ${config.focus}` : ""}
Depth: ${config.depth || "quick"} (target ${maxSources} sources)

## Instructions

Use Google Search to find current, authoritative information about this topic.
Analyze multiple sources and synthesize findings into a coherent response.

## Output Format

Provide your response in this exact JSON format:

\`\`\`json
{
  "summary": "A 2-4 paragraph executive summary of key findings",
  "findings": [
    {
      "claim": "Specific fact or insight discovered",
      "source": "Name of the source",
      "url": "https://source-url.com",
      "relevance": 95
    }
  ],
  "sources": ["https://url1.com", "https://url2.com"]
}
\`\`\`

## Guidelines

- Use Google Search to find recent, authoritative sources
- Cross-reference claims across multiple sources when possible
- Include specific data points, quotes, or statistics
- Be objective - present findings without bias
- If information conflicts, note the discrepancy
${config.focus ? `- Focus specifically on: ${config.focus}` : ""}

Begin your research now.`;
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

  const depth = config.depth || RESEARCH_DEFAULTS.depth;

  try {
    // Report starting
    await registry.updateProgress(agent.id, 10, "Initializing research");

    // Get Gemini client with grounding
    const gemini = await getGeminiClient();
    await registry.updateProgress(agent.id, 20, "Searching with Google");

    // Build prompt and execute
    const prompt = buildResearchPrompt({ ...config, depth });

    await registry.updateProgress(agent.id, 40, "Analyzing sources");
    const response = await gemini.generateContent(prompt);
    apiCalls++;

    await registry.updateProgress(agent.id, 80, "Synthesizing findings");

    // Parse research result from response
    const researchResult = parseResearchResponse(
      response.text,
      response.citations,
      config,
      depth
    );

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
  depth: "quick" | "thorough"
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
 * const result = await runResearchAgent(registry, {
 *   query: "What are the pricing models for AI coding assistants?",
 *   depth: "thorough",
 *   focus: "pricing"
 * });
 *
 * console.log(result.summary);
 * result.findings.forEach(f => console.log(`- ${f.claim} [${f.source}]`));
 * ```
 */
export async function runResearchAgent(
  registry: AgentRegistry,
  config: ResearchConfig,
  workItemId?: string
): Promise<{ agent: Agent; result: AgentResult }> {
  // Spawn the agent
  const agent = await registry.spawn({
    type: "research",
    name: `Research: ${config.query.substring(0, 50)}`,
    instructions: JSON.stringify(config),
    priority: "P2",
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

export type { ResearchConfig, ResearchFinding, ResearchResult };
