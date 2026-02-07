import { useState, useEffect, useCallback, useRef } from 'react'
import { queryPendingActionItems } from '~src/lib/notion-api'
import type { ActionFeedEntry } from '~src/types/action-feed'

interface UseFeedPollingOptions {
  intervalMs?: number
  enabled?: boolean
}

interface UseFeedPollingResult {
  entries: ActionFeedEntry[]
  isLoading: boolean
  error: string | null
  lastSynced: Date | null
  refresh: () => Promise<void>
}

export function useFeedPolling(options: UseFeedPollingOptions = {}): UseFeedPollingResult {
  const { intervalMs = 30000, enabled = true } = options

  const [entries, setEntries] = useState<ActionFeedEntry[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [lastSynced, setLastSynced] = useState<Date | null>(null)

  const cacheRef = useRef<Map<string, ActionFeedEntry>>(new Map())

  const fetchPendingEntries = useCallback(async () => {
    try {
      const newEntries = await queryPendingActionItems()

      // Diff against cache to prevent unnecessary re-renders
      const newCache = new Map<string, ActionFeedEntry>()
      let hasChanges = false

      for (const entry of newEntries) {
        newCache.set(entry.id, entry)
        const cached = cacheRef.current.get(entry.id)
        if (!cached || JSON.stringify(cached) !== JSON.stringify(entry)) {
          hasChanges = true
        }
      }

      // Check for removed entries
      if (newCache.size !== cacheRef.current.size) {
        hasChanges = true
      }

      if (hasChanges) {
        cacheRef.current = newCache
        setEntries(newEntries)
      }

      setLastSynced(new Date())
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch feed')
      // Keep showing cached entries on error
    } finally {
      setIsLoading(false)
    }
  }, [])

  const refresh = useCallback(async () => {
    setIsLoading(true)
    await fetchPendingEntries()
  }, [fetchPendingEntries])

  // Initial fetch
  useEffect(() => {
    if (enabled) {
      fetchPendingEntries()
    }
  }, [enabled, fetchPendingEntries])

  // Polling interval
  useEffect(() => {
    if (!enabled) return

    const interval = setInterval(fetchPendingEntries, intervalMs)
    return () => clearInterval(interval)
  }, [enabled, intervalMs, fetchPendingEntries])

  return { entries, isLoading, error, lastSynced, refresh }
}
