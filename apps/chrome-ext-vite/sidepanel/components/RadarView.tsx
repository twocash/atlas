/**
 * RadarView — Tracked post portfolio with Pipeline Cards.
 *
 * Shows all posts the user is actively tracking through the
 * engagement pipeline. Each post gets a PipelineCard showing
 * the micro-funnel progress (watching → extracting → replying → cultivating).
 */

import React, { useState, useEffect } from "react"
import { getTrackedPosts } from "~src/lib/tracked-posts-store"
import type { TrackedPost } from "~src/types/posts"
import { PipelineCard } from "./PipelineCard"

export function RadarView() {
  const [trackedPosts, setTrackedPosts] = useState<TrackedPost[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    loadPosts()
    // Listen for storage changes to live-update
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ("atlas:tracked-posts" in changes) {
        loadPosts()
      }
    }
    chrome.storage.local.onChanged.addListener(listener)
    return () => chrome.storage.local.onChanged.removeListener(listener)
  }, [])

  async function loadPosts() {
    const posts = await getTrackedPosts()
    setTrackedPosts(posts)
    setLoading(false)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        <div className="animate-pulse text-xs">Loading tracked posts...</div>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900">Radar</h2>
          {trackedPosts.length > 0 && (
            <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
              {trackedPosts.length}
            </span>
          )}
        </div>
      </div>

      {/* Post cards */}
      <div className="flex-1 overflow-y-auto">
        {trackedPosts.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg className="w-10 h-10 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path d="M2 12a10 10 0 0 1 18-6" />
              <path d="M5.2 5.2a7 7 0 0 1 12.1 3.6" />
              <circle cx="12" cy="12" r="2" />
            </svg>
            <p className="text-xs">No tracked posts</p>
            <p className="text-[10px] mt-1 text-gray-300">
              Click the Track button on a LinkedIn post to start monitoring
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {trackedPosts.map((post) => (
              <PipelineCard key={post.id} post={post} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
