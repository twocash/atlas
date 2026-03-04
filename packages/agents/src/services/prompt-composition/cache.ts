/**
 * In-memory TTL Cache for Prompt Composition
 *
 * Outer caching layer for composed operational doctrine results.
 * PromptManager already has per-entry TTL caching internally;
 * this cache wraps the composed result to avoid repeated
 * assembly + multiple PromptManager lookups on every conversation turn.
 *
 * @module
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
}

export class PromptCache {
  private static instance: PromptCache;
  private cache: Map<string, CacheEntry<any>> = new Map();

  /** Default TTL: 5 minutes (300,000 ms) */
  private readonly DEFAULT_TTL_MS = 5 * 60 * 1000;

  private constructor() {}

  public static getInstance(): PromptCache {
    if (!PromptCache.instance) {
      PromptCache.instance = new PromptCache();
    }
    return PromptCache.instance;
  }

  /**
   * Get a value from cache if it exists and is not expired
   */
  public get<T>(key: string): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    if (Date.now() > entry.expiresAt) {
      this.cache.delete(key);
      return null;
    }

    return entry.value as T;
  }

  /**
   * Set a value in the cache with an optional custom TTL
   */
  public set<T>(key: string, value: T, ttlMs: number = this.DEFAULT_TTL_MS): void {
    this.cache.set(key, {
      value,
      expiresAt: Date.now() + ttlMs,
    });
  }

  /**
   * Wrap an async function with caching
   */
  public async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number = this.DEFAULT_TTL_MS,
  ): Promise<T> {
    const cached = this.get<T>(key);
    if (cached !== null) {
      return cached;
    }

    const value = await fetcher();
    this.set(key, value, ttlMs);
    return value;
  }

  /**
   * Invalidate a specific key
   */
  public invalidateKey(key: string): void {
    this.cache.delete(key);
  }

  /**
   * Clear the entire cache (useful for /reload-prompts command)
   */
  public clear(): void {
    this.cache.clear();
  }
}

export const promptCache = PromptCache.getInstance();
