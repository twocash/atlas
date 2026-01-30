import { useState } from "react"
import { AtlasLogo } from "./AtlasLogo"

interface HeaderProps {
  connected: boolean
  onSyncComplete?: (commentsNeedingReply: any[]) => void
}

export function Header({ connected, onSyncComplete }: HeaderProps) {
  const [isSyncing, setIsSyncing] = useState(false)

  const handleGlobalSync = async () => {
    setIsSyncing(true)
    try {
      const response = await chrome.runtime.sendMessage({ name: "RUN_FULL_SYNC" })
      console.log("Global sync result:", response)

      // Notify parent to update comment state
      if (response?.ok && response.result?.commentsNeedingReply && onSyncComplete) {
        onSyncComplete(response.result.commentsNeedingReply)
      }
    } catch (e) {
      console.error("Sync failed:", e)
    } finally {
      // Show spinner for at least 1 second for feedback
      setTimeout(() => setIsSyncing(false), 1000)
    }
  }

  return (
    <div className="flex items-center gap-3 px-4 py-3 border-b border-gray-200 bg-white/80 backdrop-blur-sm">
      <div className="flex items-center gap-3 flex-shrink-0">
        <div className="text-atlas-600">
          <AtlasLogo className="w-6 h-6" />
        </div>
        <div className="flex flex-col">
          <span className="text-[13px] font-bold text-gray-900 tracking-tight">Atlas</span>
          <span className="text-[10px] font-medium text-gray-400 uppercase tracking-wide">Operating System</span>
        </div>
      </div>

      <div className="flex-1" />

      <div className="flex items-center gap-3">
        {/* GLOBAL SYNC BUTTON (Always Visible) */}
        <button
          onClick={handleGlobalSync}
          disabled={isSyncing}
          className={`p-1.5 rounded-md hover:bg-gray-100 text-gray-400 hover:text-gray-600 transition-all ${isSyncing ? 'animate-spin text-atlas-500' : ''}`}
          title="Sync All (Notion + Phantoms)"
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-9-9c2.52 0 4.93 1 6.74 2.74L21 8" />
            <path d="M21 3v5h-5" />
          </svg>
        </button>

        {/* Status Pill */}
        <div className={`inline-flex items-center gap-1.5 px-2 py-1 rounded-full border text-[10px] font-medium ${
          connected
            ? "bg-green-50 text-green-700 border-green-200"
            : "bg-gray-50 text-gray-500 border-gray-200"
        }`}>
          <div className={`w-1.5 h-1.5 rounded-full ${connected ? "bg-green-500 animate-pulse" : "bg-gray-400"}`} />
          <span>{connected ? "Ready" : "Idle"}</span>
        </div>
      </div>
    </div>
  )
}
