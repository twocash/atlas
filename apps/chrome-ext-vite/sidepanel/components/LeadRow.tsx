import type { Lead } from "~src/types/leads"
import { SegmentIcon } from "./SegmentIcon"

type Segment = "academic" | "technical" | "enterprise" | "influencer"

const SEGMENT_COLORS: Record<Segment, string> = {
  academic: "text-purple-600 bg-purple-50 border-purple-100",
  technical: "text-cyan-600 bg-cyan-50 border-cyan-100",
  enterprise: "text-blue-600 bg-blue-50 border-blue-100",
  influencer: "text-orange-600 bg-orange-50 border-orange-100",
}

const STATUS_ICONS: Record<string, { icon: string; color: string }> = {
  pending: { icon: "\u25CB", color: "text-gray-400" },      // ○
  in_progress: { icon: "\u25D4", color: "text-atlas-500" }, // ◔
  completed: { icon: "\u2713", color: "text-green-600" },   // ✓
  failed: { icon: "\u2717", color: "text-red-500" },        // ✗
  skipped: { icon: "\u2013", color: "text-gray-400" },      // –
}

interface LeadRowProps {
  lead: Lead
  isCurrent: boolean
}

export function LeadRow({ lead, isCurrent }: LeadRowProps) {
  const status = STATUS_ICONS[lead.status] || STATUS_ICONS.pending
  const badgeStyle = SEGMENT_COLORS[lead.segment as Segment] || "text-gray-600 bg-gray-50 border-gray-100"

  return (
    <div
      className={`flex items-center gap-2 px-3 py-1.5 text-xs ${
        isCurrent ? "bg-atlas-50 border-l-2 border-atlas-500" : "border-l-2 border-transparent"
      }`}
    >
      <span className={`text-sm font-mono ${status.color}`}>{status.icon}</span>
      <span className="flex-1 truncate text-gray-800">{lead.name}</span>
      <span className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-md text-[10px] font-medium border ${badgeStyle}`}>
        <SegmentIcon segment={lead.segment} className="w-3 h-3" />
        <span className="capitalize">{lead.segment}</span>
      </span>
    </div>
  )
}
