/**
 * Search Provider - Public API
 */

export type {
  SearchProvider,
  SearchRequest,
  SearchResult,
  Citation,
} from "./types";

export { GeminiSearchProvider, type GeminiProviderOptions } from "./gemini-provider";
