import React, { useCallback, useEffect, useMemo, useState } from 'react'
import { useFeedPolling } from './hooks/useFeedPolling'
import { useActionWrite } from './hooks/useActionWrite'
import { InfoCard } from './cards/InfoCard'
import { AlertCard } from './cards/AlertCard'
import { TriageCard } from './cards/TriageCard'
import { ApprovalCard } from './cards/ApprovalCard'
import { ReviewCard } from './cards/ReviewCard'
import { BatchActions } from './BatchActions'
import { FeedFilters } from './FeedFilters'
import { FeedSettings, type FeedSettingsData } from './FeedSettings'
import type { ActionFeedEntry, ActionType } from '~src/types/action-feed'

interface ActionFeedProps {
  pollingInterval?: number
}

export function ActionFeed({ pollingInterval: initialInterval = 30000 }: ActionFeedProps) {
  const [pollingInterval, setPollingInterval] = useState(initialInterval)
  const [showFilters, setShowFilters] = useState(false)

  const { entries, isLoading, error, lastSynced, refresh } = useFeedPolling({
    intervalMs: pollingInterval,
    enabled: true,
  })

  const { writeAction, pendingWriteCount, isWriting } = useActionWrite()

  // Batch mode state
  const [batchMode, setBatchMode] = useState(false)
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set())

  // Filter state
  const [activeTypes, setActiveTypes] = useState<Set<ActionType>>(
    new Set(['Triage', 'Approval', 'Review', 'Alert', 'Info'])
  )
  const [activeSources, setActiveSources] = useState<Set<string>>(new Set())

  // Derive available sources
  const availableSources = useMemo(() => {
    const sources = new Set(entries.map(e => e.source))
    return Array.from(sources).sort()
  }, [entries])

  // Initialize active sources when sources become available
  useEffect(() => {
    if (activeSources.size === 0 && availableSources.length > 0) {
      setActiveSources(new Set(availableSources))
    }
  }, [availableSources, activeSources.size])

  // Filter entries
  const filteredEntries = useMemo(() => {
    return entries.filter(entry =>
      activeTypes.has(entry.actionType) &&
      (activeSources.size === 0 || activeSources.has(entry.source))
    )
  }, [entries, activeTypes, activeSources])

  const handleAction = useCallback(async (
    entryId: string,
    updates: Partial<ActionFeedEntry>
  ) => {
    await writeAction(entryId, updates)
    await refresh()
  }, [writeAction, refresh])

  const handleSelect = useCallback((entryId: string, selected: boolean) => {
    setSelectedIds(prev => {
      const next = new Set(prev)
      if (selected) {
        next.add(entryId)
      } else {
        next.delete(entryId)
      }
      return next
    })
  }, [])

  const handleBatchAction = useCallback(async (
    ids: string[],
    updates: Record<string, any>
  ) => {
    await Promise.all(
      ids.map(id => {
        const entry = entries.find(e => e.id === id)
        if (!entry) return Promise.resolve()

        return writeAction(id, {
          actionStatus: updates.actionStatus,
          actionData: {
            ...entry.actionData,
            pillar: updates.pillar,
            disposition: updates.disposition,
            create_wq_item: updates.create_wq_item,
          },
          actionedAt: updates.actionedAt,
          actionedVia: updates.actionedVia,
        })
      })
    )
    await refresh()
  }, [entries, writeAction, refresh])

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set())
  }, [])

  const handleToggleType = useCallback((type: ActionType) => {
    setActiveTypes(prev => {
      const next = new Set(prev)
      if (next.has(type)) {
        next.delete(type)
      } else {
        next.add(type)
      }
      return next
    })
  }, [])

  const handleToggleSource = useCallback((source: string) => {
    setActiveSources(prev => {
      const next = new Set(prev)
      if (next.has(source)) {
        next.delete(source)
      } else {
        next.add(source)
      }
      return next
    })
  }, [])

  const handleSettingsChange = useCallback((settings: FeedSettingsData) => {
    setPollingInterval(settings.pollingIntervalMs)
    if (settings.batchModeDefault !== batchMode && !selectedIds.size) {
      setBatchMode(settings.batchModeDefault)
    }
  }, [batchMode, selectedIds.size])

  const renderCard = (entry: ActionFeedEntry) => {
    const cardProps = {
      entry,
      onAction: handleAction,
      key: entry.id,
      isSelected: selectedIds.has(entry.id),
      onSelect: handleSelect,
      batchMode,
    }

    switch (entry.actionType) {
      case 'Triage':
        return <TriageCard {...cardProps} />
      case 'Approval':
        return <ApprovalCard {...cardProps} />
      case 'Review':
        return <ReviewCard {...cardProps} />
      case 'Alert':
        return <AlertCard {...cardProps} />
      case 'Info':
      default:
        return <InfoCard {...cardProps} />
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-gray-100">
        <h2 className="text-sm font-bold text-gray-900">Action Feed</h2>
        <div className="flex items-center gap-2 text-[10px] text-gray-400">
          {isWriting && <span className="text-blue-500">Saving...</span>}
          {pendingWriteCount > 0 && (
            <span className="text-amber-500">{pendingWriteCount} pending</span>
          )}
          {lastSynced && (
            <span>Synced {formatSyncTime(lastSynced)}</span>
          )}
          <button
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
              showFilters
                ? 'bg-gray-700 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            onClick={() => setShowFilters(!showFilters)}
          >
            Filter
          </button>
          <button
            className={`px-2 py-0.5 rounded text-[10px] font-medium transition-all ${
              batchMode
                ? 'bg-blue-600 text-white'
                : 'bg-gray-100 text-gray-500 hover:bg-gray-200'
            }`}
            onClick={() => {
              setBatchMode(!batchMode)
              if (batchMode) clearSelection()
            }}
          >
            Batch
          </button>
          <button
            className="p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-colors disabled:opacity-50"
            onClick={refresh}
            disabled={isLoading}
            title="Refresh"
          >
            <svg className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
            </svg>
          </button>
        </div>
      </div>

      {/* Filters */}
      {showFilters && (
        <FeedFilters
          activeTypes={activeTypes}
          onToggleType={handleToggleType}
          activeSources={activeSources}
          availableSources={availableSources}
          onToggleSource={handleToggleSource}
        />
      )}

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-50 text-red-600 text-xs flex justify-between items-center">
          <span>{error}</span>
          {lastSynced && <span className="text-red-400">Showing cached data</span>}
        </div>
      )}

      {/* Content */}
      {isLoading && entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-gray-400 py-12">
          <svg className="w-6 h-6 animate-spin mb-3" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
          </svg>
          <span className="text-sm">Loading feed...</span>
        </div>
      ) : entries.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center py-12">
          <div className="text-2xl mb-2">✅</div>
          <p className="text-sm text-gray-600 font-medium">No pending actions</p>
          <p className="text-xs text-gray-400 mt-1">
            Items will appear here when Atlas needs your input
          </p>
        </div>
      ) : (
        <div className="flex-1 overflow-y-auto p-2">
          {batchMode && (
            <BatchActions
              selectedIds={selectedIds}
              entries={filteredEntries}
              onBatchAction={handleBatchAction}
              onClearSelection={clearSelection}
            />
          )}
          {filteredEntries.length === 0 ? (
            <div className="text-center text-gray-400 py-8 text-xs">
              No items match current filters
            </div>
          ) : (
            filteredEntries.map(renderCard)
          )}
        </div>
      )}

      {/* Settings */}
      <FeedSettings onSettingsChange={handleSettingsChange} />
    </div>
  )
}

function formatSyncTime(date: Date): string {
  const now = new Date()
  const diffMs = now.getTime() - date.getTime()
  const diffSecs = Math.floor(diffMs / 1000)

  if (diffSecs < 60) return 'just now'
  if (diffSecs < 120) return '1m ago'
  return `${Math.floor(diffSecs / 60)}m ago`
}
