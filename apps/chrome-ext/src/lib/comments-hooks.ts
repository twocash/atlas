/**
 * React hooks for Comments state management
 */

import { useEffect, useState, useCallback } from "react"
import { Storage } from "@plasmohq/storage"
import { STORAGE_KEYS } from "./storage"
import type { CommentsState, LinkedInComment } from "~src/types/comments"
import { DEFAULT_COMMENTS_STATE } from "~src/types/comments"

const storage = new Storage({ area: "local" })

// Add comments storage key
const COMMENTS_KEY = "atlas_comments_state"

function normalizeCommentsState(raw: unknown): CommentsState {
  if (!raw || typeof raw !== "object") return DEFAULT_COMMENTS_STATE
  const s = raw as Record<string, unknown>
  return {
    comments: Array.isArray(s.comments) ? s.comments : [],
    lastFetched: typeof s.lastFetched === "string" ? s.lastFetched : undefined,
  }
}

/**
 * Hook to manage comments state
 */
export function useCommentsState(): [CommentsState, {
  addComment: (comment: LinkedInComment) => Promise<void>
  updateComment: (comment: LinkedInComment) => Promise<void>
  removeComment: (id: string) => Promise<void>
  replaceAllComments: (comments: LinkedInComment[]) => Promise<void>
  clearComments: () => Promise<void>
  loadMockData: () => Promise<void>
}] {
  const [state, setState] = useState<CommentsState>(DEFAULT_COMMENTS_STATE)

  useEffect(() => {
    // Initial read
    storage.get<CommentsState>(COMMENTS_KEY).then((val) => {
      setState(normalizeCommentsState(val))
    })

    // Watch for changes
    storage.watch({
      [COMMENTS_KEY]: (change) => {
        setState(normalizeCommentsState(change.newValue))
      },
    })
  }, [])

  const addComment = useCallback(async (comment: LinkedInComment) => {
    const current = await storage.get<CommentsState>(COMMENTS_KEY) || DEFAULT_COMMENTS_STATE
    if (current.comments.some((c) => c.id === comment.id)) return

    const updated: CommentsState = {
      comments: [comment, ...current.comments],
      lastFetched: new Date().toISOString(),
    }
    await storage.set(COMMENTS_KEY, updated)
  }, [])

  const updateComment = useCallback(async (comment: LinkedInComment) => {
    const current = await storage.get<CommentsState>(COMMENTS_KEY) || DEFAULT_COMMENTS_STATE
    const updated: CommentsState = {
      comments: current.comments.map((c) => (c.id === comment.id ? comment : c)),
      lastFetched: current.lastFetched,
    }
    await storage.set(COMMENTS_KEY, updated)
  }, [])

  const removeComment = useCallback(async (id: string) => {
    const current = await storage.get<CommentsState>(COMMENTS_KEY) || DEFAULT_COMMENTS_STATE
    const updated: CommentsState = {
      comments: current.comments.filter((c) => c.id !== id),
      lastFetched: current.lastFetched,
    }
    await storage.set(COMMENTS_KEY, updated)
  }, [])

  // Load mock data for testing
  const loadMockData = useCallback(async () => {
    const mockComments: LinkedInComment[] = [
      {
        id: "comment-1",
        postId: "7421974761578336256",
        postTitle: "Sam Altman Just Warned You. Then Told You to Ignore It.",
        author: {
          name: "Sarah Chen",
          headline: "AI/ML Engineer @ Google | Building distributed systems",
          profileUrl: "https://www.linkedin.com/in/sarahchen/",
          linkedInDegree: "2nd",
          sector: "AI/ML Specialist",
          groveAlignment: "⭐⭐⭐⭐ Strong Alignment",
          priority: "High",
        },
        content: "Great insights on the concentration risks! How do you see edge computing evolving to handle the latency requirements for real-time AI applications?",
        commentUrl: "https://www.linkedin.com/feed/update/urn:li:activity:7421974761578336256",
        commentedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
        status: "needs_reply",
      },
      {
        id: "comment-2",
        postId: "7421974761578336256",
        postTitle: "Sam Altman Just Warned You. Then Told You to Ignore It.",
        author: {
          name: "Marcus Johnson",
          headline: "CTO @ EdgeAI Startup | Y Combinator W24",
          profileUrl: "https://www.linkedin.com/in/marcusjohnson/",
          linkedInDegree: "3rd+",
          sector: "Tech",
          groveAlignment: "⭐⭐⭐ Moderate Interest",
          priority: "Medium",
        },
        content: "The Stargate comparison is spot on. We're betting big on federated learning for exactly this reason.",
        commentUrl: "https://www.linkedin.com/feed/update/urn:li:activity:7421974761578336256",
        commentedAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
        status: "needs_reply",
      },
      {
        id: "comment-3",
        postId: "7421974761578336256",
        postTitle: "Sam Altman Just Warned You. Then Told You to Ignore It.",
        author: {
          name: "Dr. Emily Watson",
          headline: "Professor of Computer Science @ MIT | AI Ethics Researcher",
          profileUrl: "https://www.linkedin.com/in/emilywatson/",
          linkedInDegree: "2nd",
          sector: "Academia",
          groveAlignment: "⭐⭐⭐⭐⭐ Strong Thesis Alignment",
          priority: "High",
        },
        content: "This aligns with our research on AI sovereignty. Would love to discuss potential collaboration on the governance implications.",
        commentUrl: "https://www.linkedin.com/feed/update/urn:li:activity:7421974761578336256",
        commentedAt: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString(),
        status: "needs_reply",
      },
    ]

    const updated: CommentsState = {
      comments: mockComments,
      lastFetched: new Date().toISOString(),
    }
    await storage.set(COMMENTS_KEY, updated)
  }, [])

  const replaceAllComments = useCallback(async (comments: LinkedInComment[]) => {
    const updated: CommentsState = {
      comments,
      lastFetched: new Date().toISOString(),
    }
    await storage.set(COMMENTS_KEY, updated)
  }, [])

  const clearComments = useCallback(async () => {
    await storage.set(COMMENTS_KEY, DEFAULT_COMMENTS_STATE)
  }, [])

  return [state, { addComment, updateComment, removeComment, replaceAllComments, clearComments, loadMockData }]
}
