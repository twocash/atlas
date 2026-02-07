import React from 'react'
import type { ActionType } from '~src/types/action-feed'
import { ACTION_TYPE_ICONS } from '~src/types/action-feed'

interface FeedFiltersProps {
  activeTypes: Set<ActionType>
  onToggleType: (type: ActionType) => void
  activeSources: Set<string>
  availableSources: string[]
  onToggleSource: (source: string) => void
}

const ALL_TYPES: ActionType[] = ['Triage', 'Approval', 'Review', 'Alert', 'Info']

const TYPE_ACTIVE_CLASSES: Record<ActionType, string> = {
  Triage: 'bg-blue-500 text-white',
  Approval: 'bg-amber-500 text-white',
  Review: 'bg-purple-500 text-white',
  Alert: 'bg-red-500 text-white',
  Info: 'bg-gray-400 text-white',
}

export function FeedFilters({
  activeTypes,
  onToggleType,
  activeSources,
  availableSources,
  onToggleSource,
}: FeedFiltersProps) {
  return (
    <div className="px-3 py-2 border-b border-gray-100 bg-gray-50">
      <div className="flex items-center gap-2 mb-1.5">
        <span className="text-[10px] text-gray-400 min-w-[36px]">Type:</span>
        <div className="flex flex-wrap gap-1">
          {ALL_TYPES.map((type) => (
            <button
              key={type}
              className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                activeTypes.has(type)
                  ? TYPE_ACTIVE_CLASSES[type]
                  : 'bg-white text-gray-400 border border-gray-200 hover:text-gray-600'
              }`}
              onClick={() => onToggleType(type)}
            >
              {ACTION_TYPE_ICONS[type]} {type}
            </button>
          ))}
        </div>
      </div>

      {availableSources.length > 0 && (
        <div className="flex items-center gap-2">
          <span className="text-[10px] text-gray-400 min-w-[36px]">Src:</span>
          <div className="flex flex-wrap gap-1">
            {availableSources.map((source) => (
              <button
                key={source}
                className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
                  activeSources.has(source)
                    ? 'bg-gray-700 text-white'
                    : 'bg-white text-gray-400 border border-gray-200 hover:text-gray-600'
                }`}
                onClick={() => onToggleSource(source)}
              >
                {source}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
