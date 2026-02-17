/**
 * Classification Cache — chrome.storage.local with 7-day TTL.
 *
 * Keyed by profileUrl. Automatically prunes expired entries on read
 * and caps total entries to prevent storage bloat.
 */

import type { TierClassificationResult, ClassificationCacheEntry } from "~src/types/classification"
import { CACHE_CONFIG } from "~src/types/classification"

type CacheStore = Record<string, ClassificationCacheEntry>

// ─── Read / Write ───────────────────────────────────────

async function loadCache(): Promise<CacheStore> {
  const result = await chrome.storage.local.get(CACHE_CONFIG.STORAGE_KEY)
  return (result[CACHE_CONFIG.STORAGE_KEY] as CacheStore) || {}
}

async function saveCache(cache: CacheStore): Promise<void> {
  await chrome.storage.local.set({ [CACHE_CONFIG.STORAGE_KEY]: cache })
}

// ─── Public API ─────────────────────────────────────────

/**
 * Get a cached classification result. Returns null if not cached or expired.
 */
export async function getFromCache(profileUrl: string): Promise<TierClassificationResult | null> {
  const cache = await loadCache()
  const entry = cache[profileUrl]

  if (!entry) return null

  // Check expiry
  if (new Date(entry.expiresAt).getTime() < Date.now()) {
    // Expired — remove and return null
    delete cache[profileUrl]
    await saveCache(cache)
    return null
  }

  return entry.result
}

/**
 * Cache a classification result with TTL.
 */
export async function setInCache(
  profileUrl: string,
  result: TierClassificationResult,
): Promise<void> {
  const cache = await loadCache()
  const now = new Date()

  cache[profileUrl] = {
    result,
    cachedAt: now.toISOString(),
    expiresAt: new Date(now.getTime() + CACHE_CONFIG.TTL_MS).toISOString(),
  }

  // Prune if over max entries (remove oldest first)
  const keys = Object.keys(cache)
  if (keys.length > CACHE_CONFIG.MAX_ENTRIES) {
    const sorted = keys.sort((a, b) => {
      const ta = new Date(cache[a]!.cachedAt).getTime()
      const tb = new Date(cache[b]!.cachedAt).getTime()
      return ta - tb
    })
    const toRemove = sorted.slice(0, keys.length - CACHE_CONFIG.MAX_ENTRIES)
    for (const key of toRemove) {
      delete cache[key]
    }
  }

  await saveCache(cache)
}

/**
 * Invalidate a specific profile's cache entry.
 */
export async function invalidateCache(profileUrl: string): Promise<void> {
  const cache = await loadCache()
  delete cache[profileUrl]
  await saveCache(cache)
}

/**
 * Clear all cached classifications.
 */
export async function clearClassificationCache(): Promise<void> {
  await chrome.storage.local.remove(CACHE_CONFIG.STORAGE_KEY)
}

/**
 * Get cache statistics for diagnostics.
 */
export async function getCacheStats(): Promise<{
  total: number
  expired: number
  byTier: Record<string, number>
}> {
  const cache = await loadCache()
  const now = Date.now()
  let expired = 0
  const byTier: Record<string, number> = {}

  for (const entry of Object.values(cache)) {
    if (new Date(entry.expiresAt).getTime() < now) {
      expired++
    } else {
      const tier = entry.result.tier
      byTier[tier] = (byTier[tier] || 0) + 1
    }
  }

  return { total: Object.keys(cache).length, expired, byTier }
}
