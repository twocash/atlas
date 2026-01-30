import React, { useState } from "react"
import { useCommentsState } from "~src/lib/comments-hooks"
import { ReplyHelper } from "./ReplyHelper"
import type { LinkedInComment } from "~src/types/comments"

export function Inbox() {
  const [commentsState, { updateComment }] = useCommentsState()
  const [selectedComment, setSelectedComment] = useState<LinkedInComment | null>(null)

  // Filter for needs reply + not hidden
  const inboxItems = commentsState.comments.filter(
    (c) => c.status === 'needs_reply' && !c.hiddenLocally
  )

  const getRelativeTime = (isoDate: string) => {
    const date = new Date(isoDate)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHours > 0) return `${diffHours}h ago`
    if (diffMins > 0) return `${diffMins}m ago`
    return "just now"
  }

  const handleMarkReplied = (comment: LinkedInComment, finalReply: string) => {
    updateComment({ ...comment, status: 'replied', finalReply, repliedAt: new Date().toISOString() })
    setSelectedComment(null)
  }

  return (
    <div className="h-full flex flex-col bg-white">
      {/* 1. Inbox Header */}
      <div className="p-4 border-b border-gray-100 flex justify-between items-center">
        <h2 className="text-sm font-bold text-gray-900">Inbox</h2>
        {inboxItems.length > 0 && (
          <span className="text-xs bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">
            {inboxItems.length} New
          </span>
        )}
      </div>

      {/* 2. The Split View */}
      <div className="flex-1 overflow-hidden flex flex-col">
        {selectedComment ? (
          // --- REPLY MODE (Full-screen Reply Helper) ---
          <ReplyHelper
            comment={selectedComment}
            onClose={() => setSelectedComment(null)}
            onMarkReplied={handleMarkReplied}
          />
        ) : (
          // --- LIST MODE ---
          <div className="flex-1 overflow-y-auto">
            {inboxItems.length === 0 ? (
              <div className="p-8 text-center">
                <div className="text-4xl mb-2">✨</div>
                <div className="text-sm font-medium text-gray-800 mb-1">All caught up!</div>
                <div className="text-xs text-gray-400">
                  No comments need reply. Check back after running Sync.
                </div>
              </div>
            ) : (
              inboxItems.map((comment) => (
                <button
                  key={comment.id}
                  onClick={() => setSelectedComment(comment)}
                  className="w-full p-4 border-b border-gray-50 hover:bg-gray-50 text-left group transition-colors"
                >
                  <div className="flex justify-between mb-1">
                    <span className="text-xs font-bold text-gray-800">{comment.author.name}</span>
                    <span className="text-[10px] text-gray-400">{getRelativeTime(comment.commentedAt)}</span>
                  </div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-[9px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                      {comment.author.sector}
                    </span>
                    <span className="text-[9px] text-gray-500">{comment.author.groveAlignment.slice(0, 10)}</span>
                  </div>
                  <div className="text-xs text-gray-600 line-clamp-2 leading-relaxed">
                    <span className="inline-block w-2 h-2 rounded-full mr-2 bg-orange-400" />
                    {comment.content}
                  </div>
                  <div className="text-[9px] text-gray-400 mt-1">
                    On: {comment.postTitle}
                  </div>
                </button>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  )
}
