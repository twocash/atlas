/**
 * PipelineCard — Micro-funnel bar component for a tracked post.
 *
 * Shows 4-segment pipeline progress:
 * - Gray (watching) — post is being monitored
 * - Blue (extracting) — comments are being extracted
 * - Green (replying) — user is drafting/sending replies
 * - Gold (cultivating) — follow-ups queued
 */

import React from "react"
import type { TrackedPost, PipelineStage } from "~src/types/posts"

const STAGE_CONFIG: Record<PipelineStage, { color: string; label: string; bgFill: string }> = {
  watching: { color: "bg-gray-400", label: "Watching", bgFill: "bg-gray-200" },
  extracting: { color: "bg-blue-500", label: "Extracting", bgFill: "bg-blue-100" },
  replying: { color: "bg-green-500", label: "Replying", bgFill: "bg-green-100" },
  cultivating: { color: "bg-amber-500", label: "Cultivating", bgFill: "bg-amber-100" },
}

const STAGE_ORDER: PipelineStage[] = ["watching", "extracting", "replying", "cultivating"]

interface PipelineCardProps {
  post: TrackedPost
}

export function PipelineCard({ post }: PipelineCardProps) {
  const currentStageIndex = STAGE_ORDER.indexOf(post.pipelineStage)
  const config = STAGE_CONFIG[post.pipelineStage]

  // Compute funnel ratios for the bar segments
  const total = Math.max(post.commentCount, 1)
  const repliedRatio = post.commentCount > 0 ? post.repliedCount / total : 0
  const followedRatio = post.commentCount > 0 ? post.followedCount / total : 0

  return (
    <div className="bg-white rounded-lg shadow-sm border border-gray-100 p-3 hover:shadow-md transition-shadow">
      {/* Title row */}
      <div className="flex items-start justify-between mb-2">
        <div className="flex-1 min-w-0 mr-2">
          <h3 className="text-xs font-semibold text-gray-900 truncate leading-tight">
            {post.title || "Untitled Post"}
          </h3>
          <p className="text-[10px] text-gray-400 mt-0.5">
            {formatTrackedDate(post.trackedAt)}
          </p>
        </div>
        <span className={`text-[9px] font-medium px-1.5 py-0.5 rounded-full ${config.bgFill} text-gray-700`}>
          {config.label}
        </span>
      </div>

      {/* Pipeline bar */}
      <div className="flex h-2 rounded-full overflow-hidden bg-gray-100 mb-2">
        {STAGE_ORDER.map((stage, i) => {
          const stageConfig = STAGE_CONFIG[stage]
          const isActive = i <= currentStageIndex
          const isCurrent = i === currentStageIndex

          // Width based on stage
          let widthPercent = 25
          if (stage === "replying" && post.commentCount > 0) {
            widthPercent = Math.max(5, repliedRatio * 25)
          }
          if (stage === "cultivating" && post.commentCount > 0) {
            widthPercent = Math.max(5, followedRatio * 25)
          }

          return (
            <div
              key={stage}
              className={`transition-all duration-500 ${
                isActive ? stageConfig.color : "bg-gray-100"
              } ${isCurrent ? "animate-pulse" : ""}`}
              style={{ width: `${widthPercent}%` }}
              title={`${stageConfig.label}${isCurrent ? " (active)" : ""}`}
            />
          )
        })}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-3 text-[10px] text-gray-400">
        <span title="Comments extracted">
          <svg className="w-3 h-3 inline mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
          </svg>
          {post.commentCount}
        </span>
        <span title="Replies sent" className={post.repliedCount > 0 ? "text-green-500" : ""}>
          <svg className="w-3 h-3 inline mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path d="M9 10l-5 5 5 5" />
            <path d="M20 4v7a4 4 0 0 1-4 4H4" />
          </svg>
          {post.repliedCount}
        </span>
        <span title="Follow-ups queued" className={post.followedCount > 0 ? "text-amber-500" : ""}>
          <svg className="w-3 h-3 inline mr-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
            <circle cx="9" cy="7" r="4" />
            <line x1="19" y1="8" x2="19" y2="14" />
            <line x1="22" y1="11" x2="16" y2="11" />
          </svg>
          {post.followedCount}
        </span>
      </div>
    </div>
  )
}

function formatTrackedDate(isoDate: string): string {
  const date = new Date(isoDate)
  const diff = Date.now() - date.getTime()
  const days = Math.floor(diff / (1000 * 60 * 60 * 24))
  if (days === 0) return "Tracked today"
  if (days === 1) return "Tracked yesterday"
  return `Tracked ${days}d ago`
}
