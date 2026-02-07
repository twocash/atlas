import React, { useState } from 'react'
import { ActionCard } from '../ActionCard'
import type { ActionCardProps, Pillar } from '~src/types/action-feed'
import { PILLARS } from '~src/types/action-feed'

type TriageDisposition = 'Capture' | 'Research' | 'Act On' | 'Dismiss'

interface TriageData {
  platform: string
  title: string
  creator?: string
  url: string
  thumbnail?: string
  pillar?: Pillar
  disposition?: TriageDisposition
}

export function TriageCard({ entry, onAction, ...props }: ActionCardProps) {
  const triageData = entry.actionData as TriageData
  const [selectedPillar, setSelectedPillar] = useState<Pillar | null>(
    triageData.pillar || null
  )
  const [isProcessing, setIsProcessing] = useState(false)

  // Write pillar immediately when selected
  const handlePillarSelect = async (pillar: Pillar) => {
    setSelectedPillar(pillar)
    await onAction(entry.id, {
      actionData: { ...triageData, pillar },
    })
  }

  const handleDisposition = async (disposition: TriageDisposition) => {
    if (!selectedPillar && disposition !== 'Dismiss') return

    setIsProcessing(true)
    try {
      const updatedData: Record<string, any> = {
        ...triageData,
        pillar: selectedPillar,
        disposition,
      }

      if (disposition === 'Research' || disposition === 'Act On') {
        updatedData.create_wq_item = true
      }

      await onAction(entry.id, {
        actionStatus: disposition === 'Dismiss' ? 'Dismissed' : 'Actioned',
        actionData: updatedData,
        actionedAt: new Date().toISOString(),
        actionedVia: 'Extension',
      })
    } finally {
      setIsProcessing(false)
    }
  }

  return (
    <ActionCard entry={entry} onAction={onAction} {...props}>
      {/* Content preview */}
      <div className="flex gap-3 mb-3">
        {triageData.thumbnail && (
          <img
            src={triageData.thumbnail}
            alt=""
            className="w-16 h-16 object-cover rounded-md flex-shrink-0"
          />
        )}
        <div className="flex flex-col gap-1 text-xs text-gray-500 min-w-0">
          {triageData.creator && (
            <span className="italic truncate">by {triageData.creator}</span>
          )}
          {triageData.url && (
            <a
              href={triageData.url}
              target="_blank"
              rel="noopener noreferrer"
              className="text-blue-600 hover:underline truncate"
            >
              View source →
            </a>
          )}
        </div>
      </div>

      {/* Pillar selector */}
      <div className="flex gap-1.5 mb-3">
        {PILLARS.map((pillar) => (
          <button
            key={pillar}
            className={`
              flex-1 py-2 px-1 rounded-md text-xs font-medium transition-all
              ${selectedPillar === pillar
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-700 hover:bg-gray-200 border border-transparent'}
            `}
            onClick={() => handlePillarSelect(pillar)}
            disabled={isProcessing}
          >
            {pillar}
          </button>
        ))}
      </div>

      {/* Disposition actions */}
      <div className="flex gap-2 pt-2 border-t border-gray-100">
        <button
          className="flex-1 py-1.5 px-2 rounded-md text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors disabled:opacity-40"
          onClick={() => handleDisposition('Capture')}
          disabled={!selectedPillar || isProcessing}
          title={!selectedPillar ? 'Select a pillar first' : ''}
        >
          Capture
        </button>
        <button
          className="flex-1 py-1.5 px-2 rounded-md text-xs font-medium bg-blue-600 text-white hover:bg-blue-700 transition-colors disabled:opacity-40"
          onClick={() => handleDisposition('Research')}
          disabled={!selectedPillar || isProcessing}
          title={!selectedPillar ? 'Select a pillar first' : ''}
        >
          Research
        </button>
        <button
          className="flex-1 py-1.5 px-2 rounded-md text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors disabled:opacity-40"
          onClick={() => handleDisposition('Act On')}
          disabled={!selectedPillar || isProcessing}
          title={!selectedPillar ? 'Select a pillar first' : ''}
        >
          Act On
        </button>
        <button
          className="flex-1 py-1.5 px-2 rounded-md text-xs font-medium bg-red-500 text-white hover:bg-red-600 transition-colors"
          onClick={() => handleDisposition('Dismiss')}
          disabled={isProcessing}
        >
          Dismiss
        </button>
      </div>
    </ActionCard>
  )
}
