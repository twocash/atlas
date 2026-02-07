import React, { useState } from 'react'
import type { ActionFeedEntry, Pillar } from '~src/types/action-feed'
import { PILLARS } from '~src/types/action-feed'

interface BatchActionsProps {
  selectedIds: Set<string>
  entries: ActionFeedEntry[]
  onBatchAction: (ids: string[], updates: Record<string, any>) => Promise<void>
  onClearSelection: () => void
}

export function BatchActions({
  selectedIds,
  entries,
  onBatchAction,
  onClearSelection,
}: BatchActionsProps) {
  const [batchPillar, setBatchPillar] = useState<Pillar | null>(null)
  const [isProcessing, setIsProcessing] = useState(false)

  const selectedCount = selectedIds.size
  const selectedEntries = entries.filter((e) => selectedIds.has(e.id))
  const triageCount = selectedEntries.filter((e) => e.actionType === 'Triage').length

  if (selectedCount === 0) return null

  const handleBatchDisposition = async (disposition: string) => {
    if (!batchPillar && disposition !== 'Dismiss') return

    setIsProcessing(true)
    try {
      const ids = Array.from(selectedIds)
      await onBatchAction(ids, {
        actionStatus: disposition === 'Dismiss' ? 'Dismissed' : 'Actioned',
        pillar: batchPillar,
        disposition,
        actionedAt: new Date().toISOString(),
        actionedVia: 'Extension',
        create_wq_item: disposition === 'Research' || disposition === 'Act On',
      })
      onClearSelection()
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <div className="sticky top-0 z-10 bg-white border-b-2 border-blue-500 p-3 -mx-2 -mt-2 mb-2 rounded-t-lg">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold text-gray-800">
          {selectedCount} selected
          {triageCount > 0 && (
            <span className="text-gray-400 ml-1">({triageCount} triage)</span>
          )}
        </span>
        <button
          className="text-xs text-gray-400 hover:text-gray-600"
          onClick={onClearSelection}
        >
          Clear
        </button>
      </div>

      {triageCount > 0 && (
        <>
          <div className="flex gap-1 mb-2">
            {PILLARS.map((pillar) => (
              <button
                key={pillar}
                className={`
                  flex-1 py-1 px-1 rounded text-[10px] font-medium transition-all
                  ${batchPillar === pillar
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}
                `}
                onClick={() => setBatchPillar(pillar)}
                disabled={isProcessing}
              >
                {pillar}
              </button>
            ))}
          </div>

          <div className="flex gap-1.5">
            <button
              className="flex-1 py-1.5 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 disabled:opacity-40"
              onClick={() => handleBatchDisposition('Capture')}
              disabled={!batchPillar || isProcessing}
            >
              Capture All
            </button>
            <button
              className="flex-1 py-1.5 rounded text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-40"
              onClick={() => handleBatchDisposition('Research')}
              disabled={!batchPillar || isProcessing}
            >
              Research All
            </button>
            <button
              className="flex-1 py-1.5 rounded text-xs font-medium bg-red-500 text-white hover:bg-red-600 disabled:opacity-40"
              onClick={() => handleBatchDisposition('Dismiss')}
              disabled={isProcessing}
            >
              Dismiss All
            </button>
          </div>
        </>
      )}
    </div>
  )
}
