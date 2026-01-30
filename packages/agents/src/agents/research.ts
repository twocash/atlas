/**
 * Atlas Research Agent
 *
 * Autonomous agent for web research tasks.
 * Uses Claude with web search tool to find, analyze, and summarize
 * information with proper source citations.
 */

import Anthropic from "@anthropic-ai/sdk";
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
  model: "claude-sonnet-4-20250514",
  maxTokens: 4096,
};

// ==========================================
// Claude Client
// ==========================================

let _anthropic: Anthropic | null = null;

function getAnthropicClient(): Anthropic {
  if (!_anthropic) {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error("ANTHROPIC_API_KEY environment variable is required");
    }
    _anthropic = new Anthropic({ apiKey });
  }
  return _anthropic;
}

// ==========================================
// Web Search Tool Definition
// ==========================================

const WEB_SEARCH_TOOL: Anthropic.Tool = {
  name: "web_search",
  description:
    "Search the web for information. Returns relevant results with titles, URLs, and snippets.",
  input_schema: {
    type: "object" as const,
    properties: {
      query: {
        type: "string",
        description: "The search query",
      },
      num_results: {
        type: "number",
        description: "Number of results to return (default 5, max 10)",
      },
    },
    required: ["query"],
  },
};

const FETCH_URL_TOOL: Anthropic.Tool = {
  name: "fetch_url",
  description:
    "Fetch and read the content of a specific URL. Use this to get detailed information from a source.",
  input_schema: {
    type: "object" as const,
    properties: {
      url: {
        type: "string",
        description: "The URL to fetch",
      },
    },
    required: ["url"],
  },
};

// ==========================================
// System Prompts
// ==========================================

function buildResearchSystemPrompt(config: ResearchConfig): string {
  const maxSources =
    config.depth === "thorough"
      ? RESEARCH_DEFAULTS.maxSourcesThorough
      : RESEARCH_DEFAULTS.maxSourcesQuick;

  return `You are Atlas Research Agent, an autonomous research assistant.

## Your Task
Research the following query and provide a comprehensive, well-cited response.

## Research Parameters
- Query: "${config.query}"
- Depth: ${config.depth || "quick"} (${config.depth === "thorough" ? "thorough analysis with 5-8 sources" : "quick overview with 2-3 sources"})
${config.focus ? `- Focus Area: ${config.focus}` : ""}
- Target Sources: ${maxSources}

## Instructions

1. **Search Phase**: Use web_search to find relevant, authoritative sources
2. **Analysis Phase**: Use fetch_url to read promising sources in detail
3. **Synthesis Phase**: Combine findings into a coherent summary

## Output Requirements

After completing your research, provide a final response in this EXACT JSON format:

\`\`\`json
{
  "summary": "A 2-4 paragraph executive summary of key findings",
  "findings": [
    {
      "claim": "Specific fact or insight discovered",
      "source": "Name of the source (e.g., 'TechCrunch Article')",
      "url": "https://...",
      "relevance": 95
    }
  ],
  "sources": ["https://url1.com", "https://url2.com"]
}
\`\`\`

## Guidelines

- Prioritize recent, authoritative sources
- Cross-reference claims across multiple sources when possible
- Include specific data points, quotes, or statistics when available
- Be objective - present findings without bias
- If information is conflicting, note the discrepancy
${config.focus ? `- Focus specifically on aspects related to: ${config.focus}` : ""}

Begin your research now.`;
}

// ==========================================
// Tool Execution
// ==========================================

interface WebSearchResult {
  title: string;
  url: string;
  snippet: string;
}

interface FetchResult {
  url: string;
  title: string;
  content: string;
  success: boolean;
  error?: string;
}

/**
 * Execute web search (simulated - in production would use real search API)
 *
 * NOTE: This is a placeholder. In production, integrate with:
 * - Perplexity API for AI-powered search
 * - Google Custom Search API
 * - Bing Search API
 * - Or use Claude's native web search when available
 */
async function executeWebSearch(
  query: string,
  numResults: number = 5
): Promise<WebSearchResult[]> {
  // In production, this would call a real search API
  // For now, we'll use Claude's built-in web search capability if available
  // or return a message indicating manual search is needed

  console.log(`[Research Agent] Web search: "${query}" (${numResults} results)`);

  // Placeholder - in real implementation:
  // return await perplexitySearch(query, numResults);
  // return await googleCustomSearch(query, numResults);

  return [
    {
      title: `Search results for: ${query}`,
      url: `https://search.example.com/q=${encodeURIComponent(query)}`,
      snippet:
        "This is a placeholder. Integrate with Perplexity, Google, or Bing Search API for real results.",
    },
  ];
}

/**
 * Fetch URL content (simulated - in production would fetch real content)
 */
async function executeFetchUrl(url: string): Promise<FetchResult> {
  console.log(`[Research Agent] Fetching: ${url}`);

  // In production, this would fetch and parse the actual URL
  // For now, return placeholder

  try {
    // Placeholder - in real implementation:
    // const response = await fetch(url);
    // const html = await response.text();
    // return { url, title: extractTitle(html), content: extractContent(html), success: true };

    return {
      url,
      title: "Placeholder Content",
      content:
        "This is placeholder content. Integrate with a web scraping service for real content.",
      success: true,
    };
  } catch (error) {
    return {
      url,
      title: "",
      content: "",
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Execute a tool call from Claude
 */
async function executeToolCall(
  toolName: string,
  input: unknown
): Promise<unknown> {
  switch (toolName) {
    case "web_search": {
      const params = input as { query: string; num_results?: number };
      return await executeWebSearch(params.query, params.num_results || 5);
    }

    case "fetch_url": {
      const params = input as { url: string };
      return await executeFetchUrl(params.url);
    }

    default:
      return { error: `Unknown tool: ${toolName}` };
  }
}

// ==========================================
// Research Agent Executor
// ==========================================

/**
 * Execute a research task
 */
export async function executeResearch(
  config: ResearchConfig,
  agent: Agent,
  registry: AgentRegistry
): Promise<AgentResult> {
  const startTime = Date.now();
  let apiCalls = 0;
  let tokensUsed = 0;

  const depth = config.depth || RESEARCH_DEFAULTS.depth;
  const anthropic = getAnthropicClient();

  try {
    // Report starting
    await registry.updateProgress(agent.id, 10, "Initializing research");

    const systemPrompt = buildResearchSystemPrompt({ ...config, depth });
    const tools = [WEB_SEARCH_TOOL, FETCH_URL_TOOL];

    const messages: Anthropic.MessageParam[] = [
      {
        role: "user",
        content: `Research query: ${config.query}${config.focus ? `\nFocus on: ${config.focus}` : ""}`,
      },
    ];

    // Report search phase
    await registry.updateProgress(agent.id, 20, "Searching for sources");

    // Initial request
    let response = await anthropic.messages.create({
      model: RESEARCH_DEFAULTS.model,
      max_tokens: RESEARCH_DEFAULTS.maxTokens,
      system: systemPrompt,
      messages,
      tools,
    });
    apiCalls++;
    tokensUsed += response.usage?.input_tokens || 0;
    tokensUsed += response.usage?.output_tokens || 0;

    // Tool use loop
    let iterations = 0;
    const maxIterations = depth === "thorough" ? 10 : 5;

    while (response.stop_reason === "tool_use" && iterations < maxIterations) {
      iterations++;

      // Find tool use blocks
      const toolUseBlocks = response.content.filter(
        (block) => block.type === "tool_use"
      );

      if (toolUseBlocks.length === 0) break;

      // Update progress based on iterations
      const progressPercent = Math.min(20 + iterations * 10, 80);
      const activity =
        iterations <= 3 ? "Gathering sources" : "Analyzing content";
      await registry.updateProgress(agent.id, progressPercent, activity);

      // Execute all tool calls
      const toolResults: Anthropic.ToolResultBlockParam[] = [];

      for (const toolBlock of toolUseBlocks) {
        if (toolBlock.type !== "tool_use") continue;

        console.log(
          `[Research Agent] Tool call: ${toolBlock.name}`,
          toolBlock.input
        );

        const result = await executeToolCall(toolBlock.name, toolBlock.input);

        toolResults.push({
          type: "tool_result",
          tool_use_id: toolBlock.id,
          content: JSON.stringify(result),
        });
      }

      // Continue conversation with tool results
      messages.push({ role: "assistant", content: response.content });
      messages.push({ role: "user", content: toolResults });

      response = await anthropic.messages.create({
        model: RESEARCH_DEFAULTS.model,
        max_tokens: RESEARCH_DEFAULTS.maxTokens,
        system: systemPrompt,
        messages,
        tools,
      });
      apiCalls++;
      tokensUsed += response.usage?.input_tokens || 0;
      tokensUsed += response.usage?.output_tokens || 0;
    }

    // Report synthesis phase
    await registry.updateProgress(agent.id, 90, "Synthesizing findings");

    // Extract final response
    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    // Parse research result from response
    const researchResult = parseResearchResponse(
      textContent.text,
      config,
      depth
    );

    // Calculate metrics
    const metrics: AgentMetrics = {
      durationMs: Date.now() - startTime,
      apiCalls,
      tokensUsed,
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
        tokensUsed,
        retries: 0,
      },
    };
  }
}

/**
 * Parse Claude's response into structured ResearchResult
 */
function parseResearchResponse(
  text: string,
  config: ResearchConfig,
  depth: "quick" | "thorough"
): ResearchResult {
  // Try to extract JSON from the response
  const jsonMatch = text.match(/```json\s*([\s\S]*?)\s*```/);

  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      return {
        summary: parsed.summary || text,
        findings: parsed.findings || [],
        sources: parsed.sources || [],
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
        sources: parsed.sources || [],
        query: config.query,
        focus: config.focus,
        depth,
      };
    }
  } catch {
    // Not valid JSON
  }

  // Fallback: treat entire response as summary
  return {
    summary: text,
    findings: [],
    sources: [],
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
