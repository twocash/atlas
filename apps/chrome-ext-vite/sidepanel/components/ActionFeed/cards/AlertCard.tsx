import React from 'react'
import { ActionCard } from '../ActionCard'
import type { ActionCardProps } from '~src/types/action-feed'

interface AlertData {
  alert_type: string
  platform?: string
  breakage_type?: string
  failed_selectors?: string[]
  dev_pipeline_url?: string
}

export function AlertCard({ entry, onAction, ...props }: ActionCardProps) {
  const alertData = entry.actionData as AlertData

  const handleAcknowledge = async () => {
    await onAction(entry.id, {
      actionStatus: 'Actioned',
      actionData: { ...alertData, disposition: 'Acknowledge' },
      actionedAt: new Date().toISOString(),
      actionedVia: 'Extension',
    })
  }

  const handleEscalate = async () => {
    await onAction(entry.id, {
      actionStatus: 'Actioned',
      actionData: { ...alertData, disposition: 'Escalate' },
      actionedAt: new Date().toISOString(),
      actionedVia: 'Extension',
    })
  }

  const handleSnooze = async () => {
    const snoozeUntil = new Date(Date.now() + 4 * 60 * 60 * 1000).toISOString()
    await onAction(entry.id, {
      actionStatus: 'Snoozed',
      actionData: { ...alertData, disposition: 'Snooze', snooze_until: snoozeUntil },
      actionedAt: new Date().toISOString(),
      actionedVia: 'Extension',
    })
  }

  const severityClasses: Record<string, string> = {
    TOTAL: 'bg-red-500 text-white',
    PARTIAL: 'bg-amber-500 text-white',
    WARNING: 'bg-gray-200 text-amber-600',
  }

  return (
    <ActionCard entry={entry} onAction={onAction} {...props}>
      <div className="flex gap-2 mb-2">
        {alertData.platform && (
          <span className="px-2 py-0.5 bg-gray-100 rounded text-xs text-gray-600">
            {alertData.platform}
          </span>
        )}
        {alertData.breakage_type && (
          <span className={`px-2 py-0.5 rounded text-xs font-semibold ${severityClasses[alertData.breakage_type] || 'bg-gray-100 text-gray-600'}`}>
            {alertData.breakage_type}
          </span>
        )}
      </div>

      {alertData.failed_selectors && alertData.failed_selectors.length > 0 && (
        <details className="text-xs mb-2">
          <summary className="cursor-pointer text-gray-500 hover:text-gray-700">
            Failed selectors ({alertData.failed_selectors.length})
          </summary>
          <ul className="mt-1 ml-4 list-disc text-gray-500">
            {alertData.failed_selectors.map((sel, i) => (
              <li key={i}><code className="text-[10px] bg-gray-100 px-1 rounded">{sel}</code></li>
            ))}
          </ul>
        </details>
      )}

      {alertData.dev_pipeline_url && (
        <a
          href={alertData.dev_pipeline_url}
          target="_blank"
          rel="noopener noreferrer"
          className="block text-xs text-blue-600 hover:underline mb-2"
        >
          View Pit Crew ticket →
        </a>
      )}

      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <button
          className="flex-1 py-1.5 px-3 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors"
          onClick={handleAcknowledge}
        >
          Acknowledge
        </button>
        <button
          className="flex-1 py-1.5 px-3 rounded-md text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors"
          onClick={handleEscalate}
        >
          Escalate
        </button>
        <button
          className="flex-1 py-1.5 px-3 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
          onClick={handleSnooze}
        >
          Snooze 4h
        </button>
      </div>
    </ActionCard>
  )
}
