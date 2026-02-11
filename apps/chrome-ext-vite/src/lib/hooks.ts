import { useEffect, useState, useCallback } from "react"
import { Storage } from "~src/lib/chrome-storage"
import { STORAGE_KEYS } from "./storage"
import type { TaskQueueState } from "~src/types/leads"

const storage = new Storage({ area: "local" })

/** Ensure queue state always has safe defaults for all fields */
function normalizeQueue(raw: unknown): TaskQueueState | null {
  if (!raw || typeof raw !== "object") return null
  const q = raw as Record<string, unknown>

  // Handle possible Plasmo storage wrapping — dig into nested value if needed
  const leads = Array.isArray(q.leads)
    ? q.leads
    : q.leads && typeof q.leads === "object"
      ? Object.values(q.leads)
      : []

  return {
    status: (q.status as TaskQueueState["status"]) || "idle",
    leads,
    current: typeof q.current === "number" ? q.current : 0,
    activeTabId: typeof q.activeTabId === "number" ? q.activeTabId : null,
    lastActionTimestamp: typeof q.lastActionTimestamp === "number" ? q.lastActionTimestamp : 0,
    startedAt: q.startedAt as string | undefined,
    completedAt: q.completedAt as string | undefined,
  }
}

/** Subscribe to TaskQueueState changes in chrome.storage.local */
export function useQueueState(): [TaskQueueState | null, (patch: Partial<TaskQueueState>) => Promise<void>] {
  const [state, setState] = useState<TaskQueueState | null>(null)

  useEffect(() => {
    // Initial read via Plasmo (properly deserializes)
    storage.get<TaskQueueState>(STORAGE_KEYS.QUEUE_STATE).then((val) => {
      const normalized = normalizeQueue(val)
      if (normalized) setState(normalized)
    })

    // Use Plasmo's watch API instead of raw chrome.storage.onChanged
    // This ensures proper deserialization matching how we write
    storage.watch({
      [STORAGE_KEYS.QUEUE_STATE]: (change) => {
        const normalized = normalizeQueue(change.newValue)
        if (normalized) setState(normalized)
      },
    })

    // No cleanup needed — Plasmo handles unwatch internally
  }, [])

  const update = useCallback(async (patch: Partial<TaskQueueState>) => {
    const current = await storage.get<TaskQueueState>(STORAGE_KEYS.QUEUE_STATE)
    if (current) {
      const next = { ...current, ...patch }
      await storage.set(STORAGE_KEYS.QUEUE_STATE, next)
    }
  }, [])

  return [state, update]
}

/** Simple key-value storage hook */
export function useStorageValue<T>(key: string, defaultValue: T): [T, (val: T) => Promise<void>] {
  const [value, setValue] = useState<T>(defaultValue)

  useEffect(() => {
    storage.get<T>(key).then((val) => {
      if (val !== undefined && val !== null) setValue(val)
    })

    storage.watch({
      [key]: (change: { newValue?: T }) => {
        if (change.newValue !== undefined) {
          setValue(change.newValue)
        }
      },
    })
  }, [key])

  const set = useCallback(async (val: T) => {
    await storage.set(key, val)
  }, [key])

  return [value, set]
}
