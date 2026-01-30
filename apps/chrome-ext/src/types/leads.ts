export type Segment = "academic" | "technical" | "enterprise" | "influencer"
export type SalesNavList = "Academics" | "Builders" | "Enterprise" | "Amplifiers"
export type LeadStatus = "pending" | "in_progress" | "completed" | "failed" | "skipped"

export interface Lead {
  id: string // profileUrl as unique key
  profileUrl: string
  name: string
  segment: Segment
  status: LeadStatus
  result?: LeadResult
  selected?: boolean       // For review mode (Green Room)
  notionPageId?: string    // For syncing back to Notion after processing
  notionData?: {           // Rich context from Notion
    sector?: string
    groveAlignment?: string
    priority?: string
  }
}

export interface LeadResult {
  success: boolean
  status: LeadStatus
  savedToList?: boolean
  followed?: boolean
  error?: string
  errorType?: "SELECTOR_FAILURE" | "TIMEOUT" | "NETWORK" | "UNKNOWN"
  logs?: string[]
  scrapedText?: string // Profile text for later LLM batch
  salesNavUrl?: string // Sales Navigator URL captured during automation
  timestamp: number
}

export interface TaskQueueState {
  status: "idle" | "running" | "paused" | "completed"
  leads: Lead[]
  current: number // Index of lead being processed
  activeTabId: number | null // Singleton worker tab
  lastActionTimestamp: number // For cooldown calc after crash recovery
  startedAt?: string
  completedAt?: string
}

export const SEGMENT_TO_LIST: Record<Segment, SalesNavList> = {
  academic: "Academics",
  technical: "Builders",
  enterprise: "Enterprise",
  influencer: "Amplifiers",
}
