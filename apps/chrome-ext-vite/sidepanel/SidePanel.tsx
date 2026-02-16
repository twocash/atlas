import React, { Component, useEffect, useState, useRef } from "react"
// style.css imported in main.tsx
import { useQueueState } from "~src/lib/hooks"
import { Header } from "~sidepanel/components/Header"
import { NavRail, type ViewId } from "~sidepanel/components/NavRail"

// Phase B: 4-view architecture + Claude bridge
import { RadarView } from "~sidepanel/components/RadarView"
import { FocusView } from "~sidepanel/components/FocusView"
import { NetworkView } from "~sidepanel/components/NetworkView"
import { AtlasSystemView } from "~sidepanel/components/AtlasSystemView"
import { ClaudeCodePanel } from "~sidepanel/components/ClaudeCodePanel"
import { useClaudeCode } from "~src/lib/claude-code-hooks"

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
const ATLAS_POLL_INTERVAL = 3000 // 3 seconds when connected
const ATLAS_BACKOFF_MAX = 60000 // Back off to 60s when server unreachable

function SidePanelInner() {
  const [queue] = useQueueState()
  const [commentsState, { replaceAllComments }] = useCommentsState()
  const [view, setView] = useState<ViewId>("focus")
  const [atlasConnected, setAtlasConnected] = useState(false)
  const [trackedCount, setTrackedCount] = useState(0)

  // Claude Code bridge — hook lives HERE so WebSocket survives view switching.
  // The hook's status drives both the NavRail badge and ClaudeCodePanel props.
  const claudeCode = useClaudeCode()
  const claudeConnected = claudeCode.status.claude === "connected"

  const didAutoSwitch = useRef(false)

  const handleSyncComplete = (comments: any[]) => {
    replaceAllComments(comments)
  }

  // Track count of tracked posts for NavRail badge
  useEffect(() => {
    async function loadTrackedCount() {
      try {
        const result = await chrome.storage.local.get("atlas:tracked-posts")
        const state = result["atlas:tracked-posts"]
        setTrackedCount(state?.posts?.length ?? 0)
      } catch {
        setTrackedCount(0)
      }
    }
    loadTrackedCount()
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if ("atlas:tracked-posts" in changes) {
        loadTrackedCount()
      }
    }
    chrome.storage.local.onChanged.addListener(listener)
    return () => chrome.storage.local.onChanged.removeListener(listener)
  }, [])

  // Smart Context Switching — maps LinkedIn page to appropriate view
  useEffect(() => {
    if (didAutoSwitch.current) return
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const url = tabs[0]?.url || ""

      // Post detail page or feed → Focus (reply work)
      if (url.includes("/feed/update/") || url.includes("/posts/")) {
        setView("focus")
      }
      // Sales Navigator → Network
      else if (url.includes("/sales/")) {
        setView("network")
      }
      // Feed browsing → Radar (overview)
      else if (url.includes("/feed") || url.includes("/in/")) {
        setView("radar")
      }
      // Default → Focus

      didAutoSwitch.current = true
    })
  }, [])

  // Cache identity on LinkedIn pages
  useEffect(() => {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      const tab = tabs[0]
      if (tab?.id && tab.url?.includes("linkedin.com")) {
        chrome.tabs.sendMessage(tab.id, { type: "CACHE_IDENTITY" }).catch(() => {
          // Content script not ready — expected on non-LinkedIn pages
        })
      }
    })
  }, [])

  // Atlas Status Polling (for NavRail badge) — with exponential backoff
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null
    let cancelled = false
    let backoff = ATLAS_POLL_INTERVAL

    const checkAtlas = async () => {
      try {
        const res = await fetch(ATLAS_STATUS_URL)
        if (res.ok) {
          const data = await res.json()
          setAtlasConnected(data.connected === true)
          backoff = ATLAS_POLL_INTERVAL // Reset on success
        } else {
          setAtlasConnected(false)
          backoff = Math.min(backoff * 2, ATLAS_BACKOFF_MAX)
        }
      } catch {
        setAtlasConnected(false)
        backoff = Math.min(backoff * 2, ATLAS_BACKOFF_MAX)
      }
    }

    const scheduleNext = () => {
      if (cancelled) return
      timer = setTimeout(async () => {
        await checkAtlas()
        scheduleNext()
      }, backoff)
    }

    checkAtlas().then(() => scheduleNext())
    return () => {
      cancelled = true
      if (timer) clearTimeout(timer)
    }
  }, [])

  const focusCount = commentsState.comments.filter(
    (c) => (c.status === 'needs_reply' || c.status === 'draft_in_progress') && !c.hiddenLocally
  ).length

  return (
    <div className="flex h-screen bg-gray-50 overflow-hidden font-sans">
      {/* LEFT RAIL */}
      <NavRail
        activeView={view}
        onSelect={setView}
        focusCount={focusCount}
        trackedCount={trackedCount}
        atlasConnected={atlasConnected}
        claudeConnected={claudeConnected}
      />

      {/* MAIN CONTENT */}
      <div className="flex-1 flex flex-col min-w-0 bg-white">
        <Header connected={!!queue} onSyncComplete={handleSyncComplete} />

        <div className="flex-1 overflow-hidden relative flex flex-col">
          {view === "radar" && <RadarView />}
          {view === "focus" && <FocusView />}
          {view === "network" && <NetworkView />}
          {view === "atlas" && <AtlasSystemView atlasConnected={atlasConnected} />}
          {view === "claude" && <ClaudeCodePanel {...claudeCode} />}
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
