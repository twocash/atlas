/**
 * MissionReport - Post-processing summary
 * Shows results + "Close the Loop" action to update Notion
 */

import { useState, useEffect } from "react"
import type { TaskQueueState } from "~src/types/leads"
import { RunSummary } from "./RunSummary"
import { ExportResults } from "./ExportResults"

interface MissionReportProps {
  queue: TaskQueueState
  onClose: () => void
}

export function MissionReport({ queue, onClose }: MissionReportProps) {
  const [isSyncing, setIsSyncing] = useState(false)
  const [synced, setSynced] = useState(false)
  const [autoSynced, setAutoSynced] = useState(false)
  const [syncError, setSyncError] = useState<string | null>(null)
  const [syncStats, setSyncStats] = useState<{ succeeded: number; failed: number } | null>(null)

  const succeeded = queue.leads.filter((l) => l.status === "completed")
  const failed = queue.leads.filter((l) => l.status === "failed")

  // Detect auto-sync completion (within last 60 seconds)
  useEffect(() => {
    if (queue.status === "completed" && queue.completedAt) {
      const completedTime = new Date(queue.completedAt).getTime()
      const now = Date.now()
      if (now - completedTime < 60000) {
        // Assume auto-sync ran successfully
        setAutoSynced(true)
        setSynced(true)
      }
    }
  }, [queue])

  const handleSyncToNotion = async () => {
    setIsSyncing(true)
    setSyncError(null)

    try {
      // Update Notion: mark all succeeded contacts as "Following"
      // Build contact data with Sales Nav URLs from results
      const contacts = succeeded
        .filter((l) => l.notionPageId)
        .map((l) => ({
          pageId: l.notionPageId!,
          salesNavUrl: l.result?.salesNavUrl,
        }))

      const response = await chrome.runtime.sendMessage({
        name: "UPDATE_PROCESSED_CONTACTS",
        body: {
          contacts,
          includeExtendedFields: true,
        },
      })

      if (response?.ok) {
        setSynced(true)
        setSyncStats({ succeeded: response.updated, failed: 0 })
        if (response.errors?.length > 0) {
          setSyncError(`${response.errors.length} errors occurred`)
        }
      } else {
        setSyncError(response?.error || "Unknown error")
      }
    } catch (e) {
      console.error("Failed to sync to Notion:", e)
      setSyncError(e instanceof Error ? e.message : "Unknown error")
    } finally {
      setIsSyncing(false)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="px-4 py-4 bg-gradient-to-r from-green-50 to-blue-50 border-b border-gray-200">
        <div className="text-center">
          <div className="text-4xl mb-2">
            {failed.length === 0 ? "🎉" : succeeded.length > failed.length ? "✅" : "⚠️"}
          </div>
          <h2 className="text-lg font-bold text-gray-900 mb-1">Session Complete</h2>
          <div className="text-sm text-gray-600">
            {succeeded.length}/{queue.leads.length} Successful
          </div>
        </div>
      </div>

      {/* Stats summary */}
      <div className="px-4 py-4">
        <RunSummary queue={queue} />
      </div>

      {/* Actions */}
      <div className="px-4 py-4 border-t border-gray-200 bg-gray-50 space-y-3">
        {/* Auto-sync success banner */}
        {autoSynced && !syncError && (
          <div className="text-center py-3 text-sm text-green-700 bg-green-100 rounded-lg font-medium">
            ✓ Notion updated automatically
          </div>
        )}

        {/* Partial failure or error banner */}
        {syncError && (
          <div className="text-center py-2 text-xs text-orange-700 bg-orange-100 rounded-lg">
            ⚠️ {syncError}
          </div>
        )}

        {/* Manual sync button (shown if not synced or as retry) */}
        {!synced ? (
          <button
            onClick={handleSyncToNotion}
            disabled={isSyncing || succeeded.length === 0}
            className="w-full bg-green-600 text-white py-3 rounded-lg font-bold shadow-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isSyncing
              ? "Syncing to Notion..."
              : syncError
                ? `Retry Sync (${succeeded.length} Contacts)`
                : `Update ${succeeded.length} Contacts in Notion`}
          </button>
        ) : !autoSynced ? (
          <div className="text-center py-3 text-sm text-green-700 bg-green-100 rounded-lg font-medium">
            {syncStats
              ? `✓ Updated ${syncStats.succeeded}/${succeeded.length} contacts`
              : "✓ Notion updated successfully"}
          </div>
        ) : null}

        <ExportResults queue={queue} />

        <button
          onClick={onClose}
          className="w-full bg-white border border-gray-300 text-gray-700 py-2 rounded-lg hover:bg-gray-50"
        >
          Return to Segments
        </button>
      </div>

      {/* Failed contacts (if any) */}
      {failed.length > 0 && (
        <div className="px-4 pb-4">
          <details className="bg-red-50 border border-red-200 rounded-lg">
            <summary className="px-3 py-2 cursor-pointer text-xs font-medium text-red-800">
              {failed.length} Failed Contacts
            </summary>
            <div className="px-3 pb-2 space-y-1">
              {failed.map((lead) => (
                <div key={lead.id} className="text-xs text-gray-700">
                  • {lead.name}
                  {lead.result?.error && (
                    <span className="text-red-600 ml-2">({lead.result.error})</span>
                  )}
                </div>
              ))}
            </div>
          </details>
        </div>
      )}
    </div>
  )
}
