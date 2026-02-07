import React, { useState } from 'react'
import { ActionCard } from '../ActionCard'
import type { ActionCardProps } from '~src/types/action-feed'

interface ApprovalData {
  skill_id: string
  skill_name: string
  description: string
  wq_item_id?: string
  disposition?: string
}

export function ApprovalCard({ entry, onAction, ...props }: ActionCardProps) {
  const approvalData = entry.actionData as ApprovalData
  const [isProcessing, setIsProcessing] = useState(false)

  const handleApprove = async () => {
    setIsProcessing(true)
    try {
      await onAction(entry.id, {
        actionStatus: 'Actioned',
        actionData: { ...approvalData, disposition: 'Approve' },
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
        actionData: { ...approvalData, disposition: 'Reject' },
        actionedAt: new Date().toISOString(),
        actionedVia: 'Extension',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  const handleModify = async () => {
    window.open(entry.url, '_blank')
    setIsProcessing(true)
    try {
      await onAction(entry.id, {
        actionStatus: 'Actioned',
        actionData: { ...approvalData, disposition: 'Modify' },
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
        <span className="text-sm font-semibold text-blue-600">{approvalData.skill_name}</span>
      </div>
      <p className="text-xs text-gray-500 leading-relaxed mb-3">{approvalData.description}</p>

      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <button
          className="flex-1 py-1.5 px-3 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40"
          onClick={handleApprove}
          disabled={isProcessing}
        >
          Approve
        </button>
        <button
          className="flex-1 py-1.5 px-3 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-40"
          onClick={handleModify}
          disabled={isProcessing}
        >
          Modify
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
