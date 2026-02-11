/**
 * usePhantomStatus - Real-time phantom execution status
 * Polls PB container status every 5s and returns current state
 */

import { useState, useEffect } from "react"

export interface PhantomStatus {
  status: 'idle' | 'running' | 'finished' | 'error'
  progress?: number
  exitMessage?: string
  containerId?: string
}

/**
 * Hook to monitor a phantom's execution status
 * @param containerId - PB container ID (from launch response)
 * @param autoRefresh - Poll every 5s when true
 */
export function usePhantomStatus(
  containerId: string | null,
  autoRefresh: boolean = true
): PhantomStatus {
  const [status, setStatus] = useState<PhantomStatus>({
    status: 'idle',
    containerId: containerId || undefined,
  })

  useEffect(() => {
    if (!containerId || !autoRefresh) {
      setStatus({ status: 'idle' })
      return
    }

    let active = true

    const poll = async () => {
      try {
        const response = await chrome.runtime.sendMessage({
          name: 'GET_PHANTOM_STATUS',
          body: { containerId },
        })

        if (!active) return

        if (response?.ok) {
          setStatus({
            status: response.status,
            progress: response.progress,
            exitMessage: response.exitMessage,
            containerId,
          })

          // Stop polling if finished or errored
          if (response.status === 'finished' || response.status === 'error') {
            return
          }
        }
      } catch (e) {
        console.error('[usePhantomStatus] Poll error:', e)
      }

      // Continue polling
      if (active) {
        setTimeout(poll, 5000) // Every 5 seconds
      }
    }

    // Start polling
    poll()

    return () => {
      active = false
    }
  }, [containerId, autoRefresh])

  return status
}
