import React, { useState } from 'react'
import type { ActionCardProps, ActionType } from '~src/types/action-feed'
import { ACTION_TYPE_COLORS, ACTION_TYPE_ICONS } from '~src/types/action-feed'

function formatRelativeTime(dateString: string): string {
  const date = new Date(dateString)
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffMins = Math.floor(diffMs / 60000)

  if (diffMins < 1) return 'just now'
  if (diffMins < 60) return `${diffMins}m ago`

  const diffHours = Math.floor(diffMins / 60)
  if (diffHours < 24) return `${diffHours}h ago`

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d ago`
}

// Map action type to border + badge Tailwind classes
const BORDER_CLASSES: Record<ActionType, string> = {
  Triage: 'border-l-blue-500',
  Approval: 'border-l-amber-500',
  Review: 'border-l-purple-500',
  Alert: 'border-l-red-500',
  Info: 'border-l-gray-400',
}

const BADGE_CLASSES: Record<ActionType, string> = {
  Triage: 'bg-blue-500',
  Approval: 'bg-amber-500',
  Review: 'bg-purple-500',
  Alert: 'bg-red-500',
  Info: 'bg-gray-400',
}

interface ActionCardShellProps extends ActionCardProps {
  children: React.ReactNode
  isResolved?: boolean
  resolvedSummary?: string
}

export function ActionCard({
  entry,
  children,
  isSelected,
  onSelect,
  batchMode,
  isResolved,
  resolvedSummary,
}: ActionCardShellProps) {
  const [isExpanded, setIsExpanded] = useState(false)

  if (isResolved && resolvedSummary) {
    return (
      <div className={`bg-white rounded-lg border-l-4 ${BORDER_CLASSES[entry.actionType]} shadow-sm mb-2 px-3 py-2 opacity-60 text-sm text-gray-500`}>
        {resolvedSummary}
      </div>
    )
  }

  return (
    <div className={`
      bg-white rounded-lg border-l-4 shadow-sm mb-2 overflow-hidden
      ${BORDER_CLASSES[entry.actionType]}
      ${isSelected ? 'ring-2 ring-blue-500' : ''}
    `}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-gray-100 text-xs">
        {batchMode && onSelect && (
          <input
            type="checkbox"
            checked={isSelected}
            onChange={(e) => onSelect(entry.id, e.target.checked)}
            className="rounded border-gray-300"
          />
        )}
        <span className="text-gray-400" title={new Date(entry.createdAt).toLocaleString()}>
          {formatRelativeTime(entry.createdAt)}
        </span>
        <span className={`px-2 py-0.5 rounded text-white text-[10px] font-semibold ${BADGE_CLASSES[entry.actionType]}`}>
          {ACTION_TYPE_ICONS[entry.actionType]} {entry.actionType}
        </span>
        <span className="text-gray-400 ml-auto">{entry.source}</span>
      </div>

      {/* Content */}
      <div className="p-3">
        <div className="font-medium text-gray-800 text-sm mb-2">{entry.title}</div>
        {children}
      </div>

      {/* Expand toggle */}
      {entry.url && (
        <button
          className="w-full px-3 py-2 bg-gray-50 text-gray-500 text-xs text-left hover:text-gray-700 transition-colors"
          onClick={() => setIsExpanded(!isExpanded)}
        >
          {isExpanded ? '▼ Collapse' : '▶ Details'}
        </button>
      )}

      {isExpanded && (
        <div className="px-3 py-2 bg-gray-50 text-xs">
          <a href={entry.url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
            View in Notion →
          </a>
          <pre className="mt-2 p-2 bg-white rounded text-[10px] overflow-x-auto text-gray-600">
            {JSON.stringify(entry.actionData, null, 2)}
          </pre>
        </div>
      )}
    </div>
  )
}
