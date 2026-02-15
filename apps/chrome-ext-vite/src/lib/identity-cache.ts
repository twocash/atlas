/**
 * IdentityCache — Extracts and caches the logged-in user's LinkedIn profile URL.
 *
 * Used by comment-extractor to set `isMe` on LinkedInComment when
 * the comment author URL matches the cached identity.
 *
 * The profile URL is extracted from the LinkedIn feed identity module
 * (left sidebar) or the global nav "Me" photo link. Cached in
 * chrome.storage.session for tab-lifetime persistence.
 */

import {
  SELECTOR_REGISTRY,
  resolveSelectorHref,
} from "./selector-registry"

const STORAGE_KEY = "atlas:identity-cache"

export interface CachedIdentity {
  profileUrl: string    // Normalized: https://www.linkedin.com/in/slug
  extractedAt: string   // ISO date
}

// ─── Normalization ──────────────────────────────────────

/**
 * Normalize a LinkedIn profile URL to canonical form.
 * Strips query params, hash, trailing slashes.
 */
function normalizeProfileUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, "https://www.linkedin.com")
    return `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}`
  } catch {
    return rawUrl
  }
}

// ─── Extraction ─────────────────────────────────────────

/**
 * Attempt to extract the logged-in user's profile URL from the current page DOM.
 * Returns null if not found (e.g., on non-feed pages).
 */
export function extractIdentityFromDom(): string | null {
  const entry = SELECTOR_REGISTRY["feed-identity-profile-url"]
  if (!entry) return null

  const href = resolveSelectorHref(entry)
  if (!href || !href.includes("/in/")) return null

  return normalizeProfileUrl(href)
}

// ─── Cache Operations ───────────────────────────────────

/**
 * Read the cached identity from chrome.storage.session.
 */
export async function getCachedIdentity(): Promise<CachedIdentity | null> {
  try {
    const result = await chrome.storage.session.get(STORAGE_KEY)
    const cached = result[STORAGE_KEY]
    if (cached && typeof cached.profileUrl === "string") {
      return cached as CachedIdentity
    }
    return null
  } catch {
    return null
  }
}

/**
 * Store the identity in chrome.storage.session.
 */
export async function setCachedIdentity(profileUrl: string): Promise<void> {
  const identity: CachedIdentity = {
    profileUrl: normalizeProfileUrl(profileUrl),
    extractedAt: new Date().toISOString(),
  }
  await chrome.storage.session.set({ [STORAGE_KEY]: identity })
}

/**
 * Extract + cache in one call. Returns the profile URL or null.
 * Idempotent: if already cached and fresh, returns the cached value.
 */
export async function ensureIdentityCached(): Promise<string | null> {
  // Check cache first
  const cached = await getCachedIdentity()
  if (cached) return cached.profileUrl

  // Extract from DOM
  const profileUrl = extractIdentityFromDom()
  if (profileUrl) {
    await setCachedIdentity(profileUrl)
    return profileUrl
  }

  return null
}

/**
 * Check if a given profile URL matches the cached identity (i.e., "is me").
 */
export async function isMe(profileUrl: string): Promise<boolean> {
  const cached = await getCachedIdentity()
  if (!cached) return false
  return normalizeProfileUrl(profileUrl) === cached.profileUrl
}
