import { useState } from "react"
import type { LinkedInComment } from "~src/types/comments"
import type { ExtractionResultMessage, ExtractionErrorMessage } from "~src/types/selectors"
import { ReplyHelper } from "./ReplyHelper"

interface CommentQueueProps {
  comments: LinkedInComment[]
  onUpdateComment: (comment: LinkedInComment) => void
  onRemoveComment: (id: string) => void
  onBulkMarkReplied: () => void
  onExtractedComments?: (comments: LinkedInComment[]) => Promise<number>
}

export function CommentQueue({ comments, onUpdateComment, onRemoveComment, onBulkMarkReplied, onExtractedComments }: CommentQueueProps) {
  const [selectedComment, setSelectedComment] = useState<LinkedInComment | null>(null)
  const [filter, setFilter] = useState<'all' | 'needs_reply' | 'replied'>('needs_reply')
  const [showHidden, setShowHidden] = useState(false)
  const [searchQuery, setSearchQuery] = useState("")
  const [isClearing, setIsClearing] = useState(false)
  const [isDeleting, setIsDeleting] = useState(false)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null)

  const filteredComments = comments.filter((c) => {
    // Filter out hidden unless showHidden is true
    if (c.hiddenLocally && !showHidden) return false

    // Status filter
    if (filter === 'needs_reply' && c.status !== 'needs_reply' && c.status !== 'draft_in_progress') return false
    if (filter === 'replied' && c.status !== 'replied') return false

    // Search filter
    if (searchQuery.trim()) {
      const query = searchQuery.toLowerCase()
      const matchesName = c.author.name.toLowerCase().includes(query)
      const matchesHeadline = c.author.headline.toLowerCase().includes(query)
      const matchesContent = c.content.toLowerCase().includes(query)
      const matchesPost = c.postTitle.toLowerCase().includes(query)

      if (!matchesName && !matchesHeadline && !matchesContent && !matchesPost) {
        return false
      }
    }

    return true
  })

  const hiddenCount = comments.filter((c) => c.hiddenLocally).length

  const needsReplyCount = comments.filter((c) => c.status === 'needs_reply').length

  const handleMarkReplied = (comment: LinkedInComment, finalReply: string) => {
    const updated: LinkedInComment = {
      ...comment,
      status: 'replied',
      finalReply,
      repliedAt: new Date().toISOString(),
    }
    onUpdateComment(updated)
    setSelectedComment(null)
  }

  const handleBulkClear = async () => {
    if (!confirm(`Hide all ${needsReplyCount} comments locally? (Won't update Notion)`)) {
      return
    }
    setIsClearing(true)

    // Just mark as hidden locally
    const needsReply = comments.filter((c) => c.status === 'needs_reply')
    for (const comment of needsReply) {
      onUpdateComment({ ...comment, hiddenLocally: true })
    }

    setIsClearing(false)
  }

  const handleHideComment = (comment: LinkedInComment) => {
    onUpdateComment({ ...comment, hiddenLocally: true })
  }

  const handleDeleteHidden = async () => {
    if (!confirm(`Permanently delete all ${hiddenCount} hidden comments? (Cannot be undone)`)) {
      return
    }
    setIsDeleting(true)

    const hidden = comments.filter((c) => c.hiddenLocally)
    for (const comment of hidden) {
      onRemoveComment(comment.id)
    }

    setIsDeleting(false)
  }

  const handleExtractComments = async () => {
    if (!onExtractedComments) return
    setIsExtracting(true)
    setExtractionStatus("Extracting from LinkedIn...")

    try {
      // Get the active tab
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        setExtractionStatus("No active tab found")
        setTimeout(() => setExtractionStatus(null), 3000)
        return
      }

      // Send extraction request to content script
      const response = await chrome.tabs.sendMessage(tab.id, { type: "EXTRACT_COMMENTS" }) as
        | ExtractionResultMessage
        | ExtractionErrorMessage

      if (response.type === "EXTRACTION_ERROR") {
        setExtractionStatus(`Error: ${response.error}`)
        setTimeout(() => setExtractionStatus(null), 5000)
        return
      }

      if (response.type === "EXTRACTION_RESULT") {
        const result = response as ExtractionResultMessage
        if (result.comments.length === 0) {
          const warning = result.warnings[0] || "No comments found on this page"
          setExtractionStatus(warning)
          setTimeout(() => setExtractionStatus(null), 5000)
          return
        }

        // Merge extracted comments into state
        const newCount = await onExtractedComments(result.comments)
        setExtractionStatus(
          `${result.extractedCount} extracted, ${newCount} new`
        )
        setTimeout(() => setExtractionStatus(null), 5000)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extraction failed"
      // Common case: content script not injected on this page
      if (msg.includes("Could not establish connection") || msg.includes("Receiving end does not exist")) {
        setExtractionStatus("Navigate to a LinkedIn post page first")
      } else {
        setExtractionStatus(`Error: ${msg}`)
      }
      setTimeout(() => setExtractionStatus(null), 5000)
    } finally {
      setIsExtracting(false)
    }
  }

  const getPriorityColor = (priority: string) => {
    switch (priority) {
      case 'High': return 'bg-red-100 text-red-700'
      case 'Medium': return 'bg-amber-100 text-amber-700'
      case 'Standard': return 'bg-blue-100 text-blue-700'
      default: return 'bg-gray-100 text-gray-600'
    }
  }

  const getStatusBadge = (status: LinkedInComment['status']) => {
    switch (status) {
      case 'needs_reply':
        return <span className="text-[9px] px-1.5 py-0.5 bg-amber-100 text-amber-700 rounded">Needs Reply</span>
      case 'draft_in_progress':
        return <span className="text-[9px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">Drafting</span>
      case 'replied':
        return <span className="text-[9px] px-1.5 py-0.5 bg-green-100 text-green-700 rounded">Replied</span>
      default:
        return null
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-semibold text-gray-800">
            Comments
            {needsReplyCount > 0 && (
              <span className="ml-2 text-xs font-normal text-amber-600">
                {needsReplyCount} need reply
              </span>
            )}
            {hiddenCount > 0 && (
              <span className="ml-2 text-xs font-normal text-gray-400">
                ({hiddenCount} hidden)
              </span>
            )}
          </h3>
          <div className="flex items-center gap-2">
            {hiddenCount > 0 && (
              <>
                <button
                  onClick={() => setShowHidden(!showHidden)}
                  className="text-[10px] text-gray-500 hover:text-gray-700"
                >
                  {showHidden ? 'Hide done' : 'Show hidden'}
                </button>
                {showHidden && (
                  <button
                    onClick={handleDeleteHidden}
                    disabled={isDeleting}
                    className="text-[10px] text-red-500 hover:text-red-600 disabled:opacity-50"
                  >
                    {isDeleting ? "Deleting..." : "Delete hidden"}
                  </button>
                )}
              </>
            )}
            {needsReplyCount > 0 && (
              <button
                onClick={handleBulkClear}
                disabled={isClearing}
                className="text-[10px] text-gray-500 hover:text-gray-700 disabled:opacity-50"
              >
                {isClearing ? "Clearing..." : "Hide all"}
              </button>
            )}
          </div>
        </div>

        {/* Extract Comments button */}
        {onExtractedComments && (
          <div className="mb-2">
            <button
              onClick={handleExtractComments}
              disabled={isExtracting}
              className="w-full py-2 bg-atlas-600 text-white text-xs font-medium rounded-lg hover:bg-atlas-700 disabled:opacity-50 disabled:cursor-wait transition-colors flex items-center justify-center gap-2"
            >
              {isExtracting ? (
                <>
                  <svg className="animate-spin h-3 w-3" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                  </svg>
                  Extracting...
                </>
              ) : (
                <>
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4" />
                  </svg>
                  Extract Comments from Page
                </>
              )}
            </button>
            {extractionStatus && (
              <div className={`mt-1 text-[10px] text-center ${extractionStatus.startsWith("Error") || extractionStatus.startsWith("Navigate") ? "text-amber-600" : "text-green-600"}`}>
                {extractionStatus}
              </div>
            )}
          </div>
        )}

        {/* Search bar */}
        <div className="mb-2">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by name, headline, or content..."
            className="w-full text-xs border border-gray-300 rounded px-2 py-1.5 focus:outline-none focus:ring-1 focus:ring-atlas-500"
          />
        </div>

        {/* Filter tabs */}
        <div className="flex gap-1">
          {[
            { key: 'needs_reply', label: 'Needs Reply' },
            { key: 'replied', label: 'Replied' },
            { key: 'all', label: 'All' },
          ].map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setFilter(key as typeof filter)}
              className={`text-[10px] px-2 py-1 rounded transition-colors ${
                filter === key
                  ? 'bg-atlas-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Comment List */}
      <div className="flex-1 overflow-y-auto">
        {filteredComments.length === 0 ? (
          <div className="flex items-center justify-center h-full p-4">
            <div className="text-center text-gray-400 text-sm">
              {filter === 'needs_reply' ? 'No comments need reply' : 'No comments yet'}
            </div>
          </div>
        ) : (
          <div className="divide-y divide-gray-100">
            {filteredComments.map((comment) => (
              <div key={comment.id} className="px-4 py-3 hover:bg-gray-50 transition-colors">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-full bg-atlas-100 flex items-center justify-center text-atlas-600 font-medium text-sm flex-shrink-0">
                    {comment.author.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 mb-0.5">
                      <span className="text-xs font-medium text-gray-800 truncate">
                        {comment.author.name}
                      </span>
                      <span className={`text-[9px] px-1.5 py-0.5 rounded ${getPriorityColor(comment.author.priority)}`}>
                        {comment.author.priority}
                      </span>
                      {getStatusBadge(comment.status)}
                    </div>
                    <div className="text-[10px] text-gray-500 truncate mb-1">
                      {comment.author.headline}
                    </div>
                    <div className="text-xs text-gray-700 line-clamp-2">
                      "{comment.content}"
                    </div>
                    <div className="flex items-center gap-2 mt-1">
                      <span className="text-[9px] text-gray-400">On: {comment.postTitle}</span>
                      <span className="text-gray-300">•</span>
                      <button
                        onClick={() => setSelectedComment(comment)}
                        className="text-[9px] text-atlas-600 hover:text-atlas-700"
                      >
                        Draft Reply
                      </button>
                      <span className="text-gray-300">•</span>
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          handleHideComment(comment)
                        }}
                        className="text-[9px] text-gray-500 hover:text-gray-700"
                      >
                        Hide
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Reply Helper Modal */}
      {selectedComment && (
        <ReplyHelper
          comment={selectedComment}
          onClose={() => setSelectedComment(null)}
          onMarkReplied={handleMarkReplied}
        />
      )}
    </div>
  )
}
