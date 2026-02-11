/**
 * Outreach View - Notion-integrated Save+Follow automation
 * State machine: Selection → Review → Running → Summary
 */

import { useState, useEffect } from "react"
import { useQueueState } from "~src/lib/hooks"
import type { TaskQueueState, Lead } from "~src/types/leads"
import { SegmentCard } from "./SegmentCard"
import { ReviewList } from "./ReviewList"
import { ActiveRunView } from "./ActiveRunView"
import { MissionReport } from "./MissionReport"
import { CsvImport } from "./CsvImport"

type QueueMode = "selection" | "review" | "running" | "summary"
type Segment = "academic" | "technical" | "enterprise" | "influencer"

const SEGMENTS = [
  { id: "academic", name: "Academic Pacesetters", icon: "🎓", salesNavStatus: "Saved - Academic", listName: "Academics" },
  { id: "technical", name: "Technical Builders", icon: "⚙️", salesNavStatus: "Saved - Technical", listName: "Builders" },
  { id: "enterprise", name: "Enterprise Targets", icon: "🏢", salesNavStatus: "Saved - Enterprise", listName: "Enterprise" },
  { id: "influencer", name: "Content Amplifiers", icon: "📢", salesNavStatus: "Saved - Influencer", listName: "Amplifiers" },
] as const

export function OutreachView() {
  const [queue] = useQueueState()
  const [mode, setMode] = useState<QueueMode>("selection")
  const [selectedSegment, setSelectedSegment] = useState<typeof SEGMENTS[0] | null>(null)
  const [leads, setLeads] = useState<Lead[]>([])
  const [segmentCounts, setSegmentCounts] = useState<Record<string, number>>({})
  const [isDismissing, setIsDismissing] = useState(false)

  // Fetch pending counts for each segment from Notion
  useEffect(() => {
    fetchSegmentCounts()
  }, [])

  const fetchSegmentCounts = async () => {
    try {
      const response = await chrome.runtime.sendMessage({ name: "GET_SEGMENT_COUNTS" })
      if (response?.ok) {
        setSegmentCounts(response.counts || {})
      }
    } catch (e) {
      console.error("Failed to fetch segment counts:", e)
    }
  }

  const handleSelectSegment = async (segment: typeof SEGMENTS[0]) => {
    setSelectedSegment(segment)
    setMode("review")

    // Fetch contacts from Notion for this segment
    try {
      const response = await chrome.runtime.sendMessage({
        name: "FETCH_SEGMENT_CONTACTS",
        body: { salesNavStatus: segment.salesNavStatus },
      })

      if (response?.ok) {
        // Convert Notion contacts to Lead format
        const leadsFromNotion = response.contacts.map((c: any) => ({
          id: c.properties?.['LinkedIn URL']?.url || c.id,
          profileUrl: c.properties?.['LinkedIn URL']?.url || '',
          name: c.properties?.Name?.title?.[0]?.plain_text || 'Unknown',
          segment: segment.id,
          status: 'pending' as const,
          selected: true, // Default all selected (user can uncheck)
          notionPageId: c.id, // Store for later update
        }))
        setLeads(leadsFromNotion)
      }
    } catch (e) {
      console.error("Failed to fetch segment contacts:", e)
    }
  }

  const handleStartSession = () => {
    // Filter to selected leads only
    const selectedLeads = leads.filter((l) => l.selected)

    // Send to queue state
    chrome.runtime.sendMessage({
      name: "LOAD_QUEUE_FROM_NOTION",
      body: {
        leads: selectedLeads,
        segment: selectedSegment?.id,
      },
    })

    setMode("running")
  }

  const handleToggleLead = (leadId: string) => {
    setLeads(leads.map((l) => (l.id === leadId ? { ...l, selected: !l.selected } : l)))
  }

  const handleSelectAll = (selected: boolean) => {
    setLeads(leads.map((l) => ({ ...l, selected })))
  }

  const handleSelectBatch = (count: number) => {
    // Select first N unselected leads (or all if count >= remaining)
    let remaining = count
    setLeads(leads.map((l) => {
      if (!l.selected && remaining > 0) {
        remaining--
        return { ...l, selected: true }
      }
      return l
    }))
  }

  const handleDismiss = async (leadIds: string[]) => {
    const pageIds = leadIds
      .map((id) => leads.find((l) => l.id === id)?.notionPageId)
      .filter(Boolean) as string[]

    if (pageIds.length === 0) {
      console.error('[Atlas] No valid Notion page IDs found for dismiss')
      return
    }

    setIsDismissing(true)

    try {
      const response = await chrome.runtime.sendMessage({
        name: "DISMISS_CONTACTS",
        body: { pageIds },
      })

      if (response?.ok) {
        // Remove from local list only after successful Notion update
        setLeads(leads.filter((l) => !leadIds.includes(l.id)))
        // Refresh segment counts
        fetchSegmentCounts()
        console.log(`[Atlas] Dismissed ${response.dismissed} contacts`)
      } else {
        console.error('[Atlas] Dismiss failed:', response?.error)
      }
    } catch (e) {
      console.error('[Atlas] Failed to dismiss contacts:', e)
    } finally {
      setIsDismissing(false)
    }
  }

  // Auto-transition to summary when queue completes
  useEffect(() => {
    if (mode === "running" && queue?.status === "completed") {
      setMode("summary")
    }
  }, [queue?.status, mode])

  // --- RENDER MODES ---

  // MODE 1: SELECTION (The Menu of Work)
  if (mode === "selection") {
    return (
      <div className="h-full flex flex-col p-4 space-y-3 overflow-y-auto">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-500 uppercase tracking-wider">Select Workflow</h2>
          <button
            onClick={fetchSegmentCounts}
            className="text-[10px] text-gray-400 hover:text-gray-600"
          >
            Refresh
          </button>
        </div>

        {SEGMENTS.map((seg) => (
          <SegmentCard
            key={seg.id}
            segment={seg}
            pendingCount={segmentCounts[seg.salesNavStatus] || 0}
            onClick={() => handleSelectSegment(seg)}
          />
        ))}

        <div className="pt-4 mt-4 border-t border-gray-200">
          <div className="text-[10px] font-medium text-gray-400 uppercase mb-2">Or upload custom CSV:</div>
          <CsvImport onImported={() => setMode("running")} />
        </div>
      </div>
    )
  }

  // MODE 2: REVIEW (The Green Room)
  if (mode === "review" && selectedSegment) {
    const selectedCount = leads.filter((l) => l.selected).length

    return (
      <div className="flex flex-col h-full">
        <div className="p-4 border-b border-gray-200">
          <button
            onClick={() => setMode("selection")}
            className="text-xs text-gray-500 hover:text-gray-700 mb-2"
          >
            ← Back
          </button>
          <h2 className="text-lg font-bold text-gray-900">{selectedSegment.icon} {selectedSegment.name}</h2>
          <div className="text-xs text-gray-500 mt-1">
            Review contacts before processing
          </div>
        </div>

        <div className="flex-1 overflow-y-auto">
          <ReviewList
            leads={leads}
            onToggle={handleToggleLead}
            onSelectAll={handleSelectAll}
            onSelectBatch={handleSelectBatch}
            onDismiss={handleDismiss}
            isDismissing={isDismissing}
          />
        </div>

        <div className="p-4 border-t border-gray-200 bg-gray-50">
          <button
            className="w-full bg-blue-600 text-white py-3 rounded-lg font-bold shadow-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            onClick={handleStartSession}
            disabled={selectedCount === 0}
          >
            Start Session ({selectedCount})
          </button>
        </div>
      </div>
    )
  }

  // MODE 3: RUNNING (Active Automation) - use existing components
  if (mode === "running" && queue) {
    return <ActiveRunView queue={queue} />
  }

  // MODE 4: SUMMARY (Mission Report)
  if (mode === "summary" && queue) {
    return (
      <MissionReport
        queue={queue}
        onClose={() => {
          setMode("selection")
          fetchSegmentCounts() // Refresh counts after processing
        }}
      />
    )
  }

  // Fallback: show CSV import if no queue and mode isn't set
  return (
    <div className="h-full flex items-center justify-center p-4">
      <div className="text-center">
        <div className="text-gray-400 text-sm mb-2">No workflow loaded</div>
        <CsvImport onImported={() => setMode("running")} />
      </div>
    </div>
  )
}
