/**
 * Search Provider Types
 *
 * Provider-agnostic abstraction for web search + grounding.
 * ADR-003: Query drives search. System prompt drives analysis.
 */

/** Result from a search-grounded generation */
export interface SearchResult {
  /** Generated text content */
  text: string;

  /** Citations extracted from grounding metadata */
  citations: Citation[];

  /** Whether the search tool was actually invoked by the model */
  groundingUsed: boolean;

  /** Raw grounding metadata for diagnostics */
  groundingMetadata?: unknown;

  /** Search queries the model generated (diagnostic) */
  searchQueries: string[];

  /** Number of grounding support segments */
  groundingSupportCount: number;

  /** Retrieval-synthesis fidelity score (0-1). Set after Phase 2 fidelity check.
   *  Only present in two-phase pipeline results. */
  fidelityScore?: number;
}

/** A citation from search grounding */
export interface Citation {
  url: string;
  title: string;
}

/** Configuration for a search-grounded generation request */
export interface SearchRequest {
  /** The user-facing query/prompt content */
  query: string;

  /** System-level instructions (role, voice, quality guidelines) */
  systemInstruction: string;

  /** Maximum output tokens */
  maxOutputTokens: number;

  /** When false, provider skips search tools (synthesis-only mode). Default: true.
   *  ADR-010: Decoupled Search — allows Gemini to run as pure LLM without googleSearch. */
  useSearchTool?: boolean;
}

/** Provider-agnostic interface for search-grounded generation */
export interface SearchProvider {
  /** Execute a search-grounded generation */
  generate(request: SearchRequest): Promise<SearchResult>;

  /** Provider name for diagnostics */
  readonly name: string;
}
