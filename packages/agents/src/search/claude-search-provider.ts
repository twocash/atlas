/**
 * Claude Search Provider
 *
 * Implements SearchProvider using Claude's web_search_20250305 connector tool.
 * Used as fallback when GeminiSearchProvider returns 0 citations.
 *
 * Response format: Claude returns content blocks including:
 *   - server_tool_use: Claude's decision to search
 *   - web_search_tool_result: Array of { url, title, encrypted_content, page_age }
 *   - text (with citations): Synthesized answer with inline citations
 */

import type {
  SearchProvider,
  SearchRequest,
  SearchResult,
  Citation,
} from "./types";

export class ClaudeSearchProvider implements SearchProvider {
  readonly name = "claude-web-search";

  private client: any = null;
  private readonly apiKey: string;
  private readonly model: string;

  constructor(apiKey?: string, model?: string) {
    this.apiKey = apiKey || process.env.ANTHROPIC_API_KEY || "";
    this.model = model || "claude-haiku-4-5-20251001";

    if (!this.apiKey) {
      throw new Error("ANTHROPIC_API_KEY is required for ClaudeSearchProvider");
    }
  }

  private async ensureClient(): Promise<any> {
    if (!this.client) {
      const Anthropic = (await import("@anthropic-ai/sdk")).default;
      this.client = new Anthropic({ apiKey: this.apiKey });
      console.log(`[ClaudeSearch] Initialized @anthropic-ai/sdk, model=${this.model}`);
    }
    return this.client;
  }

  async generate(request: SearchRequest): Promise<SearchResult> {
    const client = await this.ensureClient();

    console.log("[ClaudeSearch] Calling Claude with web_search tool (fallback)...");
    console.log(`[ClaudeSearch] Query length: ${request.query.length}`);

    const startTime = Date.now();

    const response = await client.messages.create({
      model: this.model,
      max_tokens: Math.min(request.maxOutputTokens || 4096, 8192),
      // TODO: ADR-001 — resolve from Notion System Prompts DB
      system: request.systemInstruction,
      tools: [
        {
          type: "web_search_20250305",
          name: "web_search",
        } as any,
      ],
      messages: [
        {
          role: "user",
          content: request.query,
        },
      ],
    });

    const elapsed = Date.now() - startTime;
    console.log(`[ClaudeSearch] Response received in ${elapsed}ms`);

    return this.parseResponse(response);
  }

  private parseResponse(response: any): SearchResult {
    const content: any[] = response.content || [];

    // Extract text from text blocks
    const textParts: string[] = [];
    // Extract citations from web_search_tool_result blocks
    const citationMap = new Map<string, Citation>();

    for (const block of content) {
      if (block.type === "text") {
        textParts.push(block.text);

        // Also extract inline citations from text blocks
        if (block.citations) {
          for (const cite of block.citations) {
            if (cite.url && !citationMap.has(cite.url)) {
              citationMap.set(cite.url, {
                url: cite.url,
                title: cite.title || "",
              });
            }
          }
        }
      }

      if (block.type === "web_search_tool_result") {
        const results: any[] = Array.isArray(block.content)
          ? block.content
          : [];
        for (const result of results) {
          if (result.type === "web_search_result" && result.url) {
            if (!citationMap.has(result.url)) {
              citationMap.set(result.url, {
                url: result.url,
                title: result.title || "",
              });
            }
          }
        }
      }
    }

    const text = textParts.join("");
    const citations = Array.from(citationMap.values());
    const groundingUsed = citations.length > 0;

    console.log("[ClaudeSearch] Parse result:", {
      textLength: text.length,
      citations: citations.length,
      groundingUsed,
      stopReason: response.stop_reason,
      searchRequests: response.usage?.server_tool_use?.web_search_requests ?? 0,
    });

    return {
      text,
      citations,
      groundingUsed,
      searchQueries: [/* raw query passed by caller */],
      groundingSupportCount: citations.length,
    };
  }
}
