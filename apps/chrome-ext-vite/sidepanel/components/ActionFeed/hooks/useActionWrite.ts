import { useCallback, useState } from 'react'
import { updateFeedEntryAction } from '~src/lib/notion-api'
import type { ActionedVia } from '~src/types/action-feed'

interface ActionWriteQueue {
  entryId: string
  updates: Record<string, any>
  timestamp: number
}

export function useActionWrite() {
  const [pendingWrites, setPendingWrites] = useState<ActionWriteQueue[]>([])
  const [isWriting, setIsWriting] = useState(false)

  const writeAction = useCallback(async (
    entryId: string,
    updates: Partial<{
      actionStatus: string
      actionData: Record<string, any>
      actionedAt: string
      actionedVia: ActionedVia
    }>
  ): Promise<boolean> => {
    try {
      setIsWriting(true)
      await updateFeedEntryAction(entryId, updates)
      return true
    } catch (err) {
      console.error('[ActionFeed] Failed to write action:', err)
      // Queue for retry
      setPendingWrites(prev => [...prev, {
        entryId,
        updates,
        timestamp: Date.now(),
      }])
      return false
    } finally {
      setIsWriting(false)
    }
  }, [])

  const flushPendingWrites = useCallback(async () => {
    if (pendingWrites.length === 0) return

    const toFlush = [...pendingWrites]
    setPendingWrites([])

    for (const write of toFlush) {
      try {
        await updateFeedEntryAction(write.entryId, write.updates)
      } catch {
        // Re-queue failures
        setPendingWrites(prev => [...prev, write])
      }
    }
  }, [pendingWrites])

  return {
    writeAction,
    flushPendingWrites,
    pendingWriteCount: pendingWrites.length,
    isWriting,
  }
}
