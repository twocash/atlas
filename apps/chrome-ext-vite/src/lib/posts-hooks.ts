/**
 * React hooks for Posts state management
 */

import { useEffect, useState, useCallback } from "react"
import { Storage } from "~src/lib/chrome-storage"
import { STORAGE_KEYS } from "./storage"
import type { PostsState, MonitoredPost } from "~src/types/posts"
import { DEFAULT_POSTS_STATE, extractActivityId, normalizePostUrl } from "~src/types/posts"

const storage = new Storage({ area: "local" })

function normalizePostsState(raw: unknown): PostsState {
  if (!raw || typeof raw !== "object") return DEFAULT_POSTS_STATE
  const s = raw as Record<string, unknown>
  return {
    posts: Array.isArray(s.posts) ? s.posts : [],
    lastUpdated: typeof s.lastUpdated === "string" ? s.lastUpdated : undefined,
  }
}

/**
 * Hook to subscribe to posts state changes
 */
export function usePostsState(): [PostsState, {
  addPost: (url: string, title?: string) => Promise<MonitoredPost | null>
  updatePost: (id: string, patch: Partial<MonitoredPost>) => Promise<void>
  removePost: (id: string) => Promise<void>
  refreshStats: () => Promise<void>
}] {
  const [state, setState] = useState<PostsState>(DEFAULT_POSTS_STATE)

  useEffect(() => {
    // Initial read
    storage.get<PostsState>(STORAGE_KEYS.POSTS_STATE).then((val) => {
      setState(normalizePostsState(val))
    })

    // Watch for changes
    storage.watch({
      [STORAGE_KEYS.POSTS_STATE]: (change) => {
        setState(normalizePostsState(change.newValue))
      },
    })
  }, [])

  const addPost = useCallback(async (url: string, title?: string): Promise<MonitoredPost | null> => {
    const activityId = extractActivityId(url)
    if (!activityId) {
      console.error("Could not extract activity ID from URL:", url)
      return null
    }

    const current = await storage.get<PostsState>(STORAGE_KEYS.POSTS_STATE) || DEFAULT_POSTS_STATE

    // Check for duplicates
    if (current.posts.some((p) => p.id === activityId)) {
      console.log("Post already exists:", activityId)
      return current.posts.find((p) => p.id === activityId) || null
    }

    const newPost: MonitoredPost = {
      id: activityId,
      url: normalizePostUrl(url),
      title: title || `Post ${activityId.slice(-6)}`,
      authorName: "Jim Calhoun",
      addedAt: new Date().toISOString(),
      impressions: 0,
      reactions: 0,
      comments: 0,
      scrapeStatus: "idle",
      phantomSlot: null,
    }

    const updated: PostsState = {
      posts: [newPost, ...current.posts],
      lastUpdated: new Date().toISOString(),
    }

    await storage.set(STORAGE_KEYS.POSTS_STATE, updated)
    return newPost
  }, [])

  const updatePost = useCallback(async (id: string, patch: Partial<MonitoredPost>) => {
    const current = await storage.get<PostsState>(STORAGE_KEYS.POSTS_STATE) || DEFAULT_POSTS_STATE
    const updated: PostsState = {
      posts: current.posts.map((p) => (p.id === id ? { ...p, ...patch } : p)),
      lastUpdated: new Date().toISOString(),
    }
    await storage.set(STORAGE_KEYS.POSTS_STATE, updated)
  }, [])

  const removePost = useCallback(async (id: string) => {
    const current = await storage.get<PostsState>(STORAGE_KEYS.POSTS_STATE) || DEFAULT_POSTS_STATE
    const updated: PostsState = {
      posts: current.posts.filter((p) => p.id !== id),
      lastUpdated: new Date().toISOString(),
    }
    await storage.set(STORAGE_KEYS.POSTS_STATE, updated)
  }, [])

  const refreshStats = useCallback(async () => {
    // Send message to background to refresh all post stats
    chrome.runtime.sendMessage({ name: "REFRESH_POST_STATS" })
  }, [])

  return [state, { addPost, updatePost, removePost, refreshStats }]
}
