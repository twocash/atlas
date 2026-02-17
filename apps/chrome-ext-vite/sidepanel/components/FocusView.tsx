/**
 * FocusView — The primary engagement workflow view.
 *
 * Replaces old Inbox + CommentQueue. Full pipeline:
 *   Extract Comments → tier-colored cards → Draft Reply → Mark Replied → Cultivate
 *
 * Includes collapsible AdHocReply at top, Extract button,
 * and click-to-reply on each FocusCard (opens ReplyHelper).
 */

import React, { useState, useMemo, useEffect, useCallback } from "react"
import { useCommentsState } from "~src/lib/comments-hooks"
import { AdHocReply } from "./AdHocReply"
import { ReplyHelper } from "./ReplyHelper"
import { CultivateToast } from "./CultivateToast"
import type { LinkedInComment } from "~src/types/comments"
import type { ExtractionResultMessage, ExtractionErrorMessage } from "~src/types/selectors"
import type { InteractionTier } from "~src/types/classification"
import { TIER_COLORS } from "~src/lib/classification-prompts"
import { TIER_LABELS } from "~src/types/classification"

type FilterMode = "needs_reply" | "all" | "replied"

export function FocusView() {
  const [commentsState, { updateComment, removeComment, mergeComments }] = useCommentsState()
  const [filter, setFilter] = useState<FilterMode>("needs_reply")
  const [adHocExpanded, setAdHocExpanded] = useState(false)
  const [selectedComment, setSelectedComment] = useState<LinkedInComment | null>(null)
  const [isExtracting, setIsExtracting] = useState(false)
  const [extractionStatus, setExtractionStatus] = useState<string | null>(null)
  const [toastProfile, setToastProfile] = useState<string | null>(null)

  // Clear badge when FocusView mounts (user has opened the panel)
  useEffect(() => {
    chrome.runtime.sendMessage({ name: "CLEAR_BADGE" }).catch(() => {})
  }, [])

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

  // Sort by AI tier: grove > consulting > recruiting > general
  // Falls back to legacy priority if no tier assigned
  const tierOrder: Record<string, number> = { grove: 0, consulting: 1, recruiting: 2, general: 3 }
  const legacyPriorityOrder: Record<string, number> = { High: 0, Medium: 1, Standard: 2, Low: 3 }
  const sortedComments = useMemo(() => {
    return [...filteredComments].sort((a, b) => {
      const ta = a.author.tier ? tierOrder[a.author.tier] ?? 3 : (legacyPriorityOrder[a.author.priority] ?? 3)
      const tb = b.author.tier ? tierOrder[b.author.tier] ?? 3 : (legacyPriorityOrder[b.author.priority] ?? 3)
      if (ta !== tb) return ta - tb
      // Secondary: newest first
      return new Date(b.commentedAt).getTime() - new Date(a.commentedAt).getTime()
    })
  }, [filteredComments])

  // Detect repeat engagers: profiles that appear across multiple posts
  const repeatProfileUrls = useMemo(() => {
    const profilePosts = new Map<string, Set<string>>()
    for (const c of commentsState.comments) {
      if (!c.author.profileUrl) continue
      const posts = profilePosts.get(c.author.profileUrl) || new Set()
      posts.add(c.postId)
      profilePosts.set(c.author.profileUrl, posts)
    }
    const repeats = new Set<string>()
    for (const [url, posts] of profilePosts) {
      if (posts.size > 1) repeats.add(url)
    }
    return repeats
  }, [commentsState.comments])

  const needsReplyCount = commentsState.comments.filter(
    (c) => (c.status === "needs_reply" || c.status === "draft_in_progress") && !c.hiddenLocally
  ).length

  // ─── Extract Comments from LinkedIn page ────────────────

  const handleExtractComments = async () => {
    setIsExtracting(true)
    setExtractionStatus("Extracting from LinkedIn...")

    try {
      const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
      if (!tab?.id) {
        setExtractionStatus("No active tab found")
        setTimeout(() => setExtractionStatus(null), 3000)
        return
      }

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

        const newCount = await mergeComments(result.comments)
        setExtractionStatus(
          `${result.extractedCount} extracted, ${newCount} new — syncing to Notion...`
        )

        // Report selector health issues (non-blocking, fire-and-forget)
        if (result.repairPackets && result.repairPackets.length > 0) {
          chrome.runtime.sendMessage({
            name: "REPORT_SELECTOR_HEALTH",
            body: { repairPackets: result.repairPackets, postUrl: result.postUrl },
          }).catch(() => {})
        }

        // Fire Notion sync in background (non-blocking)
        chrome.runtime.sendMessage({
          name: "SYNC_EXTRACTED_COMMENTS",
          body: {
            comments: result.comments,
            postUrl: result.postUrl,
            postTitle: result.comments[0]?.postTitle,
          },
        })
          .then((syncResponse: any) => {
            if (syncResponse?.ok) {
              const { contactsCreated, contactsUpdated, engagementsCreated, notionIdMap } = syncResponse
              setExtractionStatus(
                `${result.extractedCount} extracted, ${newCount} new — ${contactsCreated + contactsUpdated} contacts, ${engagementsCreated} engagements synced`
              )

              // Enrich comments with Notion IDs + tier from sync response
              if (notionIdMap && Object.keys(notionIdMap).length > 0) {
                for (const comment of result.comments) {
                  const ids = notionIdMap[comment.author.profileUrl]
                  if (ids) {
                    updateComment({
                      ...comment,
                      notionPageId: ids.notionPageId,
                      notionContactId: ids.notionContactId,
                      author: {
                        ...comment.author,
                        ...(ids.tier && { tier: ids.tier }),
                        ...(ids.tierConfidence !== undefined && { tierConfidence: ids.tierConfidence }),
                        ...(ids.tierMethod && { tierMethod: ids.tierMethod as any }),
                      },
                    })
                  }
                }
              }
            } else {
              setExtractionStatus(
                `${result.extractedCount} extracted, ${newCount} new — sync error: ${syncResponse?.error || 'unknown'}`
              )
            }
            setTimeout(() => setExtractionStatus(null), 8000)
          })
          .catch((err: Error) => {
            console.error("[FocusView] Notion sync failed:", err)
            setExtractionStatus(
              `${result.extractedCount} extracted, ${newCount} new`
            )
            setTimeout(() => setExtractionStatus(null), 5000)
          })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Extraction failed"
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

  // ─── Reply Actions ──────────────────────────────────────

  const handleMarkReplied = async (comment: LinkedInComment, finalReply: string) => {
    // Persist immediately
    await updateComment({
      ...comment,
      status: "replied",
      finalReply,
      repliedAt: new Date().toISOString(),
    })

    // Auto-advance to next unreplied comment
    const unreplied = sortedComments.filter(
      (c) => c.id !== comment.id && (c.status === "needs_reply" || c.status === "draft_in_progress")
    )
    if (unreplied.length > 0) {
      setSelectedComment(unreplied[0])
    } else {
      setSelectedComment(null)
    }
  }

  const handleHideComment = (comment: LinkedInComment) => {
    updateComment({ ...comment, hiddenLocally: true })
  }

  const handleToastUndo = useCallback(async () => {
    if (!toastProfile) return
    try {
      const FOLLOWS_KEY = "atlas:pending-follows"
      const result = await chrome.storage.local.get(FOLLOWS_KEY)
      const follows = (result[FOLLOWS_KEY] ?? []).filter(
        (f: any) => f.profileUrl !== toastProfile
      )
      await chrome.storage.local.set({ [FOLLOWS_KEY]: follows })
    } catch (e) {
      console.error("Failed to undo follow-up:", e)
    }
    setToastProfile(null)
  }, [toastProfile])

  // ─── Render ─────────────────────────────────────────────

  // If a comment is selected, show ReplyHelper full-screen
  if (selectedComment) {
    return (
      <ReplyHelper
        key={selectedComment.id}
        comment={selectedComment}
        onClose={() => setSelectedComment(null)}
        onMarkReplied={handleMarkReplied}
        onFollowQueued={setToastProfile}
      />
    )
  }

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

      {/* Extract Comments Button */}
      <div className="px-3 py-2 border-b border-gray-100">
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
          <div className={`mt-1 text-[10px] text-center ${
            extractionStatus.startsWith("Error") || extractionStatus.startsWith("Navigate")
              ? "text-amber-600"
              : "text-green-600"
          }`}>
            {extractionStatus}
          </div>
        )}
      </div>

      {/* Collapsible Ad-Hoc Reply */}
      <div className="border-b border-gray-100">
        <button
          onClick={() => setAdHocExpanded(!adHocExpanded)}
          className="w-full flex items-center justify-between px-3 py-1.5 text-[10px] text-gray-400 hover:text-gray-600 hover:bg-gray-50 transition-colors"
        >
          <span>Quick Reply (ad-hoc)</span>
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
              Navigate to a LinkedIn post and click "Extract Comments" to begin
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            {sortedComments.map((comment) => (
              <FocusCard
                key={comment.id}
                comment={comment}
                isRepeatEngager={repeatProfileUrls.has(comment.author.profileUrl)}
                onReply={() => setSelectedComment(comment)}
                onHide={() => handleHideComment(comment)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Cultivate Toast */}
      <CultivateToast
        visible={!!toastProfile}
        profileUrl={toastProfile || ""}
        onUndo={handleToastUndo}
        onDismiss={() => setToastProfile(null)}
      />
    </div>
  )
}

// ─── Focus Card ─────────────────────────────────────────

interface FocusCardProps {
  comment: LinkedInComment
  isRepeatEngager?: boolean
  onReply: () => void
  onHide: () => void
}

function FocusCard({ comment, isRepeatEngager, onReply, onHide }: FocusCardProps) {
  // Use AI tier colors if available, fall back to gray
  const tier = comment.author.tier as InteractionTier | undefined
  const colors = tier ? TIER_COLORS[tier] : null
  const tierBorder = colors?.border ?? "border-l-gray-300"
  const isReplied = comment.status === "replied"
  const isDraft = comment.status === "draft_in_progress"

  const handleOpenThread = async (e: React.MouseEvent) => {
    e.stopPropagation()
    const url = comment.commentUrl || `https://www.linkedin.com/feed/update/${comment.postId}`
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.update(tab.id, { url })
    }
  }

  return (
    <div
      onClick={onReply}
      className={`border-l-4 ${tierBorder} bg-white rounded-lg shadow-sm p-3 transition-all hover:shadow-md cursor-pointer ${
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
            {isRepeatEngager && !comment.isMe && (
              <span className="text-[8px] bg-orange-100 text-orange-700 px-1 rounded font-medium">Repeat</span>
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

        {/* Open thread in active tab */}
        <button
          onClick={handleOpenThread}
          className="p-1 text-gray-300 hover:text-blue-500 transition-colors"
          title="Open thread in active tab"
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </button>
      </div>

      {/* Comment text */}
      <p className="text-xs text-gray-700 leading-relaxed mb-1 line-clamp-3">
        {comment.content}
      </p>
      {comment.postTitle && (
        <p className="text-[9px] text-gray-300 truncate mb-2">
          On: {comment.postTitle}
        </p>
      )}

      {/* Footer: status + tier + actions */}
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
          {tier && colors && !isReplied && (
            <span className={`text-[9px] ${colors.badge} px-1.5 py-0.5 rounded font-medium`}>
              {TIER_LABELS[tier]}
            </span>
          )}
          {comment.author.tierMethod === "ai" && (
            <span className="text-[8px] text-gray-400" title={`AI confidence: ${Math.round((comment.author.tierConfidence || 0) * 100)}%`}>
              AI
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={(e) => {
              e.stopPropagation()
              onHide()
            }}
            className="text-[9px] text-gray-300 hover:text-gray-500 transition-colors"
          >
            Hide
          </button>
          <span className="text-[9px] text-gray-300">
            {formatTimeAgo(comment.commentedAt)}
          </span>
        </div>
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
