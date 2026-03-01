/**
 * Gemini Search Provider
 *
 * Implements SearchProvider using Google Gemini with Google Search grounding.
 * Consolidates dual SDK paths to @google/genai only.
 *
 * ROOT CAUSE FIX (RPO-001):
 * - Uses `systemInstruction` to separate behavioral instructions from query
 * - Keeps `contents` focused on the research query + output format
 * - Retries once on grounding failure (probabilistic suppression)
 */

import type {
  SearchProvider,
  SearchRequest,
  SearchResult,
  Citation,
} from "./types";

/** DRC-001a: Default retry max — overridden by Research Pipeline Config.
 *  Gemini probabilistically suppresses Google Search grounding (~20-50% of calls
 *  with long systemInstructions). 2 retries = 3 total attempts for >95% success. */
const DEFAULT_GROUNDING_RETRY_MAX = 2;

/**
 * Gemini 2.0 Flash maxOutputTokens ceiling.
 * The API silently caps at this value — any higher value is ignored without error.
 * ADR-008: Fail loud. If configured maxTokens exceeds this, log degraded warning.
 *
 * Source: https://ai.google.dev/gemini-api/docs/models#gemini-2.0-flash
 */
const GEMINI_FLASH_MAX_OUTPUT_TOKENS = 8192;

/** DRC-001a: Provider config options — resolved from Research Pipeline Config */
export interface GeminiProviderOptions {
  model?: string;
  groundingRetryMax?: number;
}

export class GeminiSearchProvider implements SearchProvider {
  readonly name = "gemini-google-search";

  private ai: any = null;
  private readonly apiKey: string;
  private readonly model: string;
  private readonly groundingRetryMax: number;

  constructor(apiKey?: string, options?: string | GeminiProviderOptions) {
    this.apiKey = apiKey || process.env.GEMINI_API_KEY || "";

    // Backward compat: second arg can be model string or options object
    if (typeof options === 'string') {
      this.model = options;
      this.groundingRetryMax = DEFAULT_GROUNDING_RETRY_MAX;
    } else {
      this.model = options?.model ?? "gemini-2.0-flash";
      this.groundingRetryMax = options?.groundingRetryMax ?? DEFAULT_GROUNDING_RETRY_MAX;
    }

    if (!this.apiKey) {
      throw new Error("GEMINI_API_KEY is required for GeminiSearchProvider");
    }
  }

  private async ensureClient(): Promise<any> {
    if (!this.ai) {
      const { GoogleGenAI } = await import("@google/genai");
      this.ai = new GoogleGenAI({ apiKey: this.apiKey });
      console.log(`[GeminiSearch] Initialized @google/genai, model=${this.model}`);
    }
    return this.ai;
  }

  async generate(request: SearchRequest): Promise<SearchResult> {
    const ai = await this.ensureClient();

    let lastResult: SearchResult | null = null;

    for (let attempt = 0; attempt <= this.groundingRetryMax; attempt++) {
      if (attempt > 0) {
        console.log(
          `[GeminiSearch] Grounding retry ${attempt}/${this.groundingRetryMax} — previous attempt had no grounding`
        );
      }

      const result = await this.executeCall(ai, request);

      // Check for ACTUAL search evidence, not just groundingSupports.
      // Gemini probabilistically returns groundingSupports from training data
      // (groundingUsed=true) without invoking Google Search (0 chunks, 0 queries).
      // The retry must check for real citations, not phantom supports.
      const hasRealGrounding = result.citations.length > 0 || result.searchQueries.length > 0;

      if (hasRealGrounding) {
        if (attempt > 0) {
          console.log(
            `[GeminiSearch] Grounding succeeded on retry ${attempt} — ${result.citations.length} citations`
          );
        }
        return result;
      }

      // Log the phantom supports case for diagnostics
      if (result.groundingUsed && result.citations.length === 0) {
        console.warn(
          `[GeminiSearch] Phantom grounding: ${result.groundingSupportCount} supports but 0 citations, 0 search queries — retrying`
        );
      }

      lastResult = result;
    }

    // All attempts failed grounding — return last result with groundingUsed=false
    // Caller (research.ts) decides whether to throw HALLUCINATION
    console.warn(
      `[GeminiSearch] Grounding failed after ${this.groundingRetryMax + 1} attempts`
    );
    return lastResult!;
  }

  private async executeCall(
    ai: any,
    request: SearchRequest
  ): Promise<SearchResult> {
    console.log("[GeminiSearch] Calling Gemini with Google Search grounding...");
    console.log(
      `[GeminiSearch] Query length: ${request.query.length}, systemInstruction length: ${request.systemInstruction.length}`
    );

    // ADR-008: Detect and cap maxOutputTokens that exceed Gemini's ceiling
    let effectiveMaxTokens = request.maxOutputTokens;
    if (effectiveMaxTokens && effectiveMaxTokens > GEMINI_FLASH_MAX_OUTPUT_TOKENS) {
      console.warn(
        `[GeminiSearch] maxOutputTokens DEGRADED: configured ${effectiveMaxTokens} exceeds Gemini 2.0 Flash ceiling of ${GEMINI_FLASH_MAX_OUTPUT_TOKENS}. ` +
        `Capping at ${GEMINI_FLASH_MAX_OUTPUT_TOKENS}. Update ResearchPipelineConfig depths to reflect API reality.`
      );
      effectiveMaxTokens = GEMINI_FLASH_MAX_OUTPUT_TOKENS;
    }

    const startTime = Date.now();

    const response = await ai.models.generateContent({
      model: this.model,
      contents: request.query,
      config: {
        systemInstruction: request.systemInstruction,
        tools: [{ googleSearch: {} }],
        maxOutputTokens: effectiveMaxTokens,
      },
    });

    const elapsed = Date.now() - startTime;
    console.log(`[GeminiSearch] Response received in ${elapsed}ms`);

    return this.parseResponse(response);
  }

  private parseResponse(response: any): SearchResult {
    const candidate = response.candidates?.[0];
    const gm = candidate?.groundingMetadata;

    // Extract grounding signals
    const groundingChunks: any[] = gm?.groundingChunks || [];
    const groundingSupports: any[] = gm?.groundingSupports || [];
    const webSearchQueries: string[] = gm?.webSearchQueries || [];

    // Extract citations from grounding chunks
    const citations: Citation[] = [];
    for (const chunk of groundingChunks) {
      if (chunk.web) {
        citations.push({
          url: chunk.web.uri || "",
          title: chunk.web.title || "",
        });
      }
    }

    // Grounding confirmed if ANY signal present
    const groundingUsed =
      groundingSupports.length > 0 ||
      groundingChunks.length > 0 ||
      citations.length > 0 ||
      webSearchQueries.length > 0;

    console.log("[GeminiSearch] Grounding status:", {
      used: groundingUsed,
      chunks: groundingChunks.length,
      supports: groundingSupports.length,
      queries: webSearchQueries.length,
      citations: citations.length,
      finishReason: candidate?.finishReason,
    });

    return {
      text: response.text || "",
      citations,
      groundingUsed,
      groundingMetadata: gm,
      searchQueries: webSearchQueries,
      groundingSupportCount: groundingSupports.length,
    };
  }
}
