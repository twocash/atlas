import React, { Component, useEffect, useState, useRef } from "react"
import "./style.css"
import { useQueueState } from "~src/lib/hooks"
import { HEARTBEAT_INTERVAL } from "~src/lib/constants"
import { Header } from "~sidepanel/components/Header"
import { NavRail, type ViewId } from "~sidepanel/components/NavRail"

// Import your existing components
import { PostsTab } from "~sidepanel/components/PostsTab"
import { AdHocReply } from "~sidepanel/components/AdHocReply"
import { TaskQueue } from "~sidepanel/components/TaskQueue"
import { ProgressBar } from "~sidepanel/components/ProgressBar"
import { Controls } from "~sidepanel/components/Controls"
import { RunSummary } from "~sidepanel/components/RunSummary"
import { ExportResults } from "~sidepanel/components/ExportResults"
import { CsvImport } from "~sidepanel/components/CsvImport"
import { ModelSelector } from "~sidepanel/components/ModelSelector"
import { ApiKeySetup } from "~sidepanel/components/ApiKeySetup"
import { EnrichmentImport } from "~sidepanel/components/EnrichmentImport"
import { DebugLogViewer } from "~sidepanel/components/DebugLogViewer"
import { Inbox } from "~sidepanel/components/Inbox"
import { DataView } from "~sidepanel/components/DataView"
import { OutreachView } from "~sidepanel/components/OutreachView"
import { AtlasLink } from "~sidepanel/components/AtlasLink"
import { ActionFeed } from "~sidepanel/components/ActionFeed/ActionFeed"
import { useCommentsState } from "~src/lib/comments-hooks"

// Simple Error Boundary
class ErrorBoundary extends Component<{ children: React.ReactNode }, { hasError: boolean; error: string }> {
  state = { hasError: false, error: "" }

  static getDerivedStateFromError(error: Error) {
    return { hasError: true, error: error.message }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error("Atlas UI crash:", error, info.componentStack)
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="p-4 text-center">
          <div className="text-sm font-medium text-red-600 mb-2">Atlas UI Error</div>
          <div className="text-xs text-gray-500 mb-2">{this.state.error}</div>
          <button
            onClick={() => this.setState({ hasError: false, error: "" })}
            className="text-xs text-atlas-600 underline"
          >
            Retry
          </button>
        </div>
      )
    }
    return this.props.children
  }
}

// Status server URL for Atlas connection check
const ATLAS_STATUS_URL = 'http://localhost:3847/status'
const ATLAS_POLL_INTERVAL = 3000 // 3 seconds (slightly slower than AtlasLink)

function SidePanelInner() {
  const [queue] = useQueueState()
  const [commentsState, { replaceAllComments }] = useCommentsState()
  const [view, setView] = useState<ViewId>("outreach")
  const [atlasConnected, setAtlasConnected] = useState(false)
  const portRef = useRef<chrome.runtime.Port | null>(null)
  const didAutoSwitch = useRef(false)

  const handleSyncComplete = (comments: any[]) => {
    replaceAllComments(comments)
  }

  // 1. Smart Context Switching (The "AI" feel)
  useEffect(() => {
    if (didAutoSwitch.current) return
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || ""

      // Priority: If Queue is running, show queue
      if (queue?.status === "running") {
        setView("outreach")
        didAutoSwitch.current = true
        return
      }

      // Priority: Context
      if (url.includes("/sales/")) setView("outreach")
      else if (url.includes("/feed") || url.includes("/in/")) setView("studio")

      didAutoSwitch.current = true
    })
  }, [queue?.status])

  // 2. Heartbeat (Keep Service Worker Alive)
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | null = null
    const connect = () => {
      try {
        const port = chrome.runtime.connect({ name: "heartbeat" })
        portRef.current = port
        port.onDisconnect.addListener(() => setTimeout(connect, 2000))
        interval = setInterval(() => { try { port.postMessage({ type: "PING" }) } catch { } }, HEARTBEAT_INTERVAL)
      } catch { setTimeout(connect, 2000) }
    }
    connect()
    return () => { if (interval) clearInterval(interval); portRef.current?.disconnect() }
  }, [])

  // 3. Atlas Status Polling (for NavRail badge)
  useEffect(() => {
    const checkAtlas = async () => {
      try {
        const res = await fetch(ATLAS_STATUS_URL)
        if (res.ok) {
          const data = await res.json()
          setAtlasConnected(data.connected === true)
        } else {
          setAtlasConnected(false)
        }
      } catch {
        setAtlasConnected(false)
      }
    }

    checkAtlas()
    const interval = setInterval(checkAtlas, ATLAS_POLL_INTERVAL)
    return () => clearInterval(interval)
  }, [])

  const isRunning = queue?.status === "running"
  const inboxCount = commentsState.comments.filter((c) => c.status === 'needs_reply' && !c.hiddenLocally).length

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      {/* LEFT RAIL */}
      <NavRail
        activeView={view}
        onSelect={setView}
        hasActiveTask={isRunning}
        inboxCount={inboxCount}
        atlasConnected={atlasConnected}
      />

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <Header connected={!!queue} onSyncComplete={handleSyncComplete} />

        <div className="flex-1 overflow-hidden relative flex flex-col">

          {/* VIEW: INBOX */}
          {view === "inbox" && (
            <Inbox />
          )}

          {/* VIEW: OUTREACH (Notion-integrated segments) */}
          {view === "outreach" && (
            <OutreachView />
          )}

          {/* VIEW: STUDIO (Merged Posts + Reply) */}
          {view === "studio" && (
            <div className="h-full flex flex-col overflow-y-auto p-2">
              <div className="mb-6">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Quick Reply</h3>
                <AdHocReply />
              </div>
              <div className="border-t border-gray-100 pt-4">
                <h3 className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2 px-1">Post Analytics</h3>
                <PostsTab />
              </div>
            </div>
          )}

          {/* VIEW: DATA (Passive Tasks) */}
          {view === "data" && (
            <DataView />
          )}

          {/* VIEW: ATLAS (Action Feed + Browser Automation HUD) */}
          {view === "atlas" && (
            <ActionFeed pollingInterval={30000} />
          )}

          {/* VIEW: SETTINGS */}
          {view === "settings" && (
            <div className="h-full overflow-y-auto p-4 space-y-6">
              <section>
                <h2 className="text-sm font-bold text-gray-900 mb-3">Intelligence</h2>
                <ModelSelector />
                <div className="mt-2"><ApiKeySetup /></div>
              </section>
              <section className="pt-4 border-t border-gray-100">
                <h2 className="text-sm font-bold text-gray-900 mb-3">Debug Logs</h2>
                <div className="h-64 border rounded bg-gray-50 overflow-hidden"><DebugLogViewer /></div>
                <div className="mt-2 text-[10px] text-gray-400">
                  Shows sync progress, phantom fetches, Notion updates, and errors.
                </div>
              </section>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function SidePanel() {
  return (
    <ErrorBoundary>
      <SidePanelInner />
    </ErrorBoundary>
  )
}
