/**
 * FocusView — Engagement cards for reply work.
 *
 * Replaces the old Inbox view. Shows tier-colored comment cards
 * sorted by priority, with inline reply drafting and cultivate toast.
 *
 * Includes collapsible AdHocReply section at the top.
 */

import React, { useState, useMemo } from "react"
import { useCommentsState } from "~src/lib/comments-hooks"
import { AdHocReply } from "./AdHocReply"
import { CommentQueue } from "./CommentQueue"
import type { LinkedInComment } from "~src/types/comments"

// Tier colors for comment priority
const TIER_BORDER: Record<string, string> = {
  High: "border-l-amber-500",
  Medium: "border-l-blue-400",
  Standard: "border-l-gray-300",
  Low: "border-l-gray-200",
  "": "border-l-gray-200",
}

type FilterMode = "needs_reply" | "all" | "replied"

export function FocusView() {
  const [commentsState] = useCommentsState()
  const [filter, setFilter] = useState<FilterMode>("needs_reply")
  const [adHocExpanded, setAdHocExpanded] = useState(false)

  const filteredComments = useMemo(() => {
    const comments = commentsState.comments.filter((c) => !c.hiddenLocally)
    switch (filter) {
      case "needs_reply":
        return comments.filter((c) => c.status === "needs_reply" || c.status === "draft_in_progress")
      case "replied":
        return comments.filter((c) => c.status === "replied")
      case "all":
      default:
        return comments
    }
  }, [commentsState.comments, filter])

  // Sort by priority tier: High → Medium → Standard → Low
  const priorityOrder: Record<string, number> = { High: 0, Medium: 1, Standard: 2, Low: 3, "": 4 }
  const sortedComments = useMemo(() => {
    return [...filteredComments].sort((a, b) => {
      const pa = priorityOrder[a.author.priority] ?? 4
      const pb = priorityOrder[b.author.priority] ?? 4
      if (pa !== pb) return pa - pb
      // Secondary: newest first
      return new Date(b.commentedAt).getTime() - new Date(a.commentedAt).getTime()
    })
  }, [filteredComments])

  const needsReplyCount = commentsState.comments.filter(
    (c) => (c.status === "needs_reply" || c.status === "draft_in_progress") && !c.hiddenLocally
  ).length

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900">Focus</h2>
          {needsReplyCount > 0 && (
            <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
              {needsReplyCount}
            </span>
          )}
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1">
          {(["needs_reply", "all", "replied"] as FilterMode[]).map((mode) => (
            <button
              key={mode}
              onClick={() => setFilter(mode)}
              className={`text-[10px] px-2 py-0.5 rounded-full transition-colors ${
                filter === mode
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
              }`}
            >
              {mode === "needs_reply" ? "Active" : mode === "all" ? "All" : "Done"}
            </button>
          ))}
        </div>
      </div>

      {/* Collapsible Ad-Hoc Reply */}
      <div className="border-b border-gray-100">
        <button
          onClick={() => setAdHocExpanded(!adHocExpanded)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <span>Quick Reply</span>
          <svg
            className={`w-3 h-3 transition-transform ${adHocExpanded ? "rotate-180" : ""}`}
            fill="none"
            stroke="currentColor"
            viewBox="0 0 24 24"
          >
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
          </svg>
        </button>
        {adHocExpanded && (
          <div className="px-2 pb-2">
            <AdHocReply />
          </div>
        )}
      </div>

      {/* Comment Cards */}
      <div className="flex-1 overflow-y-auto">
        {sortedComments.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg className="w-10 h-10 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <circle cx="12" cy="12" r="10" strokeWidth={1.5} />
              <circle cx="12" cy="12" r="6" strokeWidth={1.5} />
              <circle cx="12" cy="12" r="2" strokeWidth={1.5} />
            </svg>
            <p className="text-xs">
              {filter === "needs_reply" ? "All caught up!" : "No comments yet"}
            </p>
            <p className="text-[10px] mt-1 text-gray-300">
              Extract comments from a LinkedIn post to get started
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {sortedComments.map((comment) => (
              <FocusCard key={comment.id} comment={comment} />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Focus Card ─────────────────────────────────────────

function FocusCard({ comment }: { comment: LinkedInComment }) {
  const tierBorder = TIER_BORDER[comment.author.priority] ?? TIER_BORDER[""]
  const isReplied = comment.status === "replied"
  const isDraft = comment.status === "draft_in_progress"

  const handlePeek = () => {
    if (!comment.domSignature) return
    // Send SCROLL_TO_COMMENT to the active tab's content script
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]?.id) {
        chrome.tabs.sendMessage(tabs[0].id, {
          type: "SCROLL_TO_COMMENT",
          domSignature: comment.domSignature,
        })
      }
    })
  }

  return (
    <div
      className={`border-l-4 ${tierBorder} bg-white rounded-lg shadow-sm p-3 transition-all hover:shadow-md ${
        isReplied ? "opacity-60" : ""
      }`}
    >
      {/* Author row */}
      <div className="flex items-start justify-between mb-1">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-semibold text-gray-900 truncate">
              {comment.author.name}
            </span>
            {comment.isMe && (
              <span className="text-[8px] bg-blue-50 text-blue-500 px-1 rounded font-medium">You</span>
            )}
            {comment.threadDepth > 0 && (
              <span className="text-[8px] text-gray-400">
                {"↳".repeat(comment.threadDepth)}
                {comment.parentAuthorName && ` to ${comment.parentAuthorName}`}
              </span>
            )}
          </div>
          <p className="text-[10px] text-gray-400 truncate">{comment.author.headline}</p>
        </div>

        {/* Peek button */}
        {comment.domSignature && (
          <button
            onClick={handlePeek}
            className="p-1 text-gray-300 hover:text-blue-500 transition-colors"
            title="Scroll to comment"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
            </svg>
          </button>
        )}
      </div>

      {/* Comment text */}
      <p className="text-xs text-gray-700 leading-relaxed mb-2 line-clamp-3">
        {comment.content}
      </p>

      {/* Footer: status + time */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1.5">
          {isDraft && (
            <span className="text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-medium">
              Draft
            </span>
          )}
          {isReplied && (
            <span className="text-[9px] bg-green-50 text-green-600 px-1.5 py-0.5 rounded font-medium">
              Replied
            </span>
          )}
          {comment.author.priority === "High" && !isReplied && (
            <span className="text-[9px] bg-amber-50 text-amber-600 px-1.5 py-0.5 rounded font-medium">
              Priority
            </span>
          )}
        </div>
        <span className="text-[9px] text-gray-300">
          {formatTimeAgo(comment.commentedAt)}
        </span>
      </div>
    </div>
  )
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h`
  const days = Math.floor(hours / 24)
  return `${days}d`
}
