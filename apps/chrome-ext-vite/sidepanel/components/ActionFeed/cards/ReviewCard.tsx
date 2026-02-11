import React, { useState } from 'react'
import { ActionCard } from '../ActionCard'
import type { ActionCardProps } from '~src/types/action-feed'

interface ReviewData {
  wq_item_id: string
  wq_title: string
  output_url?: string
  disposition?: string
  revision_notes?: string
}

export function ReviewCard({ entry, onAction, ...props }: ActionCardProps) {
  const reviewData = entry.actionData as ReviewData
  const [revisionNotes, setRevisionNotes] = useState('')
  const [showRevisionInput, setShowRevisionInput] = useState(false)
  const [isProcessing, setIsProcessing] = useState(false)

  const handleAccept = async () => {
    setIsProcessing(true)
    try {
      await onAction(entry.id, {
        actionStatus: 'Actioned',
        actionData: { ...reviewData, disposition: 'Accept' },
        actionedAt: new Date().toISOString(),
        actionedVia: 'Extension',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleRevise = async () => {
    if (!showRevisionInput) {
      setShowRevisionInput(true)
      return
    }

    if (!revisionNotes.trim()) return

    setIsProcessing(true)
    try {
      await onAction(entry.id, {
        actionStatus: 'Actioned',
        actionData: {
          ...reviewData,
          disposition: 'Revise',
          revision_notes: revisionNotes,
        },
        actionedAt: new Date().toISOString(),
        actionedVia: 'Extension',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleReject = async () => {
    setIsProcessing(true)
    try {
      await onAction(entry.id, {
        actionStatus: 'Actioned',
        actionData: { ...reviewData, disposition: 'Reject' },
        actionedAt: new Date().toISOString(),
        actionedVia: 'Extension',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <ActionCard entry={entry} onAction={onAction} {...props}>
      <div className="mb-2">
        <span className="text-sm font-medium text-gray-800">{reviewData.wq_title}</span>
      </div>

      {reviewData.output_url && (
        <a
          href={reviewData.output_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-block text-xs text-blue-600 hover:underline mb-3"
        >
          View output →
        </a>
      )}

      {showRevisionInput && (
        <div className="mb-3">
          <textarea
            placeholder="What needs to change?"
            value={revisionNotes}
            onChange={(e) => setRevisionNotes(e.target.value)}
            className="w-full p-2 bg-gray-50 border border-gray-200 rounded-md text-xs text-gray-700 resize-y focus:outline-none focus:border-blue-400 focus:ring-1 focus:ring-blue-400"
            rows={3}
          />
        </div>
      )}

      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <button
          className="flex-1 py-1.5 px-3 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40"
          onClick={handleAccept}
          disabled={isProcessing}
        >
          Accept
        </button>
        <button
          className="flex-1 py-1.5 px-3 rounded-md text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-40"
          onClick={handleRevise}
          disabled={isProcessing}
        >
          {showRevisionInput ? 'Submit' : 'Revise'}
        </button>
        <button
          className="flex-1 py-1.5 px-3 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors disabled:opacity-40"
          onClick={handleReject}
          disabled={isProcessing}
        >
          Reject
        </button>
      </div>
    </ActionCard>
  )
}
