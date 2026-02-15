/**
 * TrackedPostsStore — CRUD operations for tracked posts in chrome.storage.local.
 *
 * A tracked post is one the user has explicitly chosen to monitor through
 * the engagement pipeline (watching → extracting → replying → cultivating).
 *
 * Storage key: "atlas:tracked-posts"
 */

import type {
  TrackedPost,
  TrackedPostsState,
  PipelineStage,
} from "~src/types/posts"
import { extractActivityId, normalizePostUrl } from "~src/types/posts"

const STORAGE_KEY = "atlas:tracked-posts"

// ─── Read ───────────────────────────────────────────────

/**
 * Get all tracked posts from storage.
 */
export async function getTrackedPosts(): Promise<TrackedPost[]> {
  try {
    const result = await chrome.storage.local.get(STORAGE_KEY)
    const state = result[STORAGE_KEY] as TrackedPostsState | undefined
    return state?.posts ?? []
  } catch {
    return []
  }
}

/**
 * Get a single tracked post by its activity ID or URL.
 */
export async function getTrackedPost(idOrUrl: string): Promise<TrackedPost | null> {
  const posts = await getTrackedPosts()
  const activityId = extractActivityId(idOrUrl) ?? idOrUrl
  return posts.find((p) => p.id === activityId) ?? null
}

// ─── Write ──────────────────────────────────────────────

async function saveTrackedPosts(posts: TrackedPost[]): Promise<void> {
  const state: TrackedPostsState = {
    posts,
    lastUpdated: new Date().toISOString(),
  }
  await chrome.storage.local.set({ [STORAGE_KEY]: state })
}

/**
 * Add a new post to tracking. Initializes at the "watching" pipeline stage.
 * Returns the created TrackedPost, or the existing one if already tracked.
 */
export async function trackPost(
  url: string,
  title: string,
  authorName: string = "Jim Calhoun",
): Promise<TrackedPost> {
  const posts = await getTrackedPosts()
  const activityId = extractActivityId(url)
  if (!activityId) throw new Error(`Cannot extract activity ID from URL: ${url}`)

  // Check if already tracked
  const existing = posts.find((p) => p.id === activityId)
  if (existing) return existing

  const tracked: TrackedPost = {
    id: activityId,
    url: normalizePostUrl(url),
    title,
    authorName,
    addedAt: new Date().toISOString(),
    impressions: 0,
    reactions: 0,
    comments: 0,
    scrapeStatus: "idle",
    phantomSlot: null,
    // Pipeline tracking
    pipelineStage: "watching",
    trackedAt: new Date().toISOString(),
    commentCount: 0,
    repliedCount: 0,
    followedCount: 0,
  }

  posts.unshift(tracked) // Newest first
  await saveTrackedPosts(posts)
  return tracked
}

/**
 * Remove a post from tracking.
 */
export async function untrackPost(activityId: string): Promise<boolean> {
  const posts = await getTrackedPosts()
  const filtered = posts.filter((p) => p.id !== activityId)
  if (filtered.length === posts.length) return false // Not found
  await saveTrackedPosts(filtered)
  return true
}

// ─── Update ─────────────────────────────────────────────

/**
 * Update pipeline stage for a tracked post.
 */
export async function updatePipelineStage(
  activityId: string,
  stage: PipelineStage,
): Promise<TrackedPost | null> {
  const posts = await getTrackedPosts()
  const post = posts.find((p) => p.id === activityId)
  if (!post) return null

  post.pipelineStage = stage
  await saveTrackedPosts(posts)
  return post
}

/**
 * Update engagement counts for a tracked post.
 */
export async function updatePostCounts(
  activityId: string,
  counts: {
    commentCount?: number
    repliedCount?: number
    followedCount?: number
  },
): Promise<TrackedPost | null> {
  const posts = await getTrackedPosts()
  const post = posts.find((p) => p.id === activityId)
  if (!post) return null

  if (counts.commentCount !== undefined) post.commentCount = counts.commentCount
  if (counts.repliedCount !== undefined) post.repliedCount = counts.repliedCount
  if (counts.followedCount !== undefined) post.followedCount = counts.followedCount

  await saveTrackedPosts(posts)
  return post
}

/**
 * Check if a post URL is currently tracked.
 */
export async function isTracked(url: string): Promise<boolean> {
  const activityId = extractActivityId(url)
  if (!activityId) return false
  const post = await getTrackedPost(activityId)
  return post !== null
}
