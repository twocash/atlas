import React, { useCallback } from 'react'
import { useFeedPolling } from './hooks/useFeedPolling'
import { useActionWrite } from './hooks/useActionWrite'
import { InfoCard } from './cards/InfoCard'
import { AlertCard } from './cards/AlertCard'
import type { ActionFeedEntry } from '~src/types/action-feed'

interface ActionFeedProps {
  pollingInterval?: number
}

export function ActionFeed({ pollingInterval = 30000 }: ActionFeedProps) {
  const { entries, isLoading, error, lastSynced, refresh } = useFeedPolling({
    intervalMs: pollingInterval,
    enabled: true,
  })

  const { writeAction, pendingWriteCount, isWriting } = useActionWrite()

  const handleAction = useCallback(async (
    entryId: string,
    updates: Partial<ActionFeedEntry>
  ) => {
    await writeAction(entryId, updates)
    await refresh()
  }, [writeAction, refresh])

  const renderCard = (entry: ActionFeedEntry) => {
    const cardProps = {
      entry,
      onAction: handleAction,
      key: entry.id,
    }

    switch (entry.actionType) {
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
          {entries.map(renderCard)}
        </div>
      )}
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
