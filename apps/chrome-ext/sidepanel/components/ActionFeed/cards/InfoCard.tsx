import React from 'react'
import { ActionCard } from '../ActionCard'
import type { ActionCardProps } from '~src/types/action-feed'

export function InfoCard({ entry, onAction, ...props }: ActionCardProps) {
  const handleDismiss = async () => {
    await onAction(entry.id, {
      actionStatus: 'Dismissed',
      actionedAt: new Date().toISOString(),
      actionedVia: 'Extension',
    })
  }

  const actionData = entry.actionData as { message?: string; details?: string }

  return (
    <ActionCard entry={entry} onAction={onAction} {...props}>
      {actionData.details && (
        <p className="text-xs text-gray-500 mb-2">{actionData.details}</p>
      )}
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <button
          className="flex-1 py-1.5 px-3 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          onClick={handleDismiss}
        >
          Dismiss
        </button>
      </div>
    </ActionCard>
  )
}
