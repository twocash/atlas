import type { TaskQueueState, Segment } from "~src/types/leads"

interface RunSummaryProps {
  queue: TaskQueueState
}

interface SegmentStats {
  total: number
  saved: number
  followed: number
  failed: number
  skipped: number
}

const SEGMENT_LABELS: Record<Segment, string> = {
  academic: "Academic",
  technical: "Technical",
  enterprise: "Enterprise",
  influencer: "Influencer",
}

export function RunSummary({ queue }: RunSummaryProps) {
  const bySegment = new Map<Segment, SegmentStats>()

  for (const lead of queue.leads) {
    const existing = bySegment.get(lead.segment) || {
      total: 0,
      saved: 0,
      followed: 0,
      failed: 0,
      skipped: 0,
    }
    existing.total++
    if (lead.status === "completed") existing.saved++
    if (lead.status === "failed") existing.failed++
    if (lead.status === "skipped") existing.skipped++
    if (lead.result?.followed) existing.followed++
    bySegment.set(lead.segment, existing)
  }

  const totalSaved = queue.leads.filter((l) => l.status === "completed").length
  const totalFailed = queue.leads.filter((l) => l.status === "failed").length
  const totalSkipped = queue.leads.filter((l) => l.status === "skipped").length

  return (
    <div className="p-4 space-y-3">
      <div className="text-xs font-medium text-gray-700">Run Summary</div>

      {/* Totals */}
      <div className="grid grid-cols-3 gap-2">
        <StatCard label="Saved" value={totalSaved} color="text-green-600" />
        <StatCard label="Failed" value={totalFailed} color="text-red-500" />
        <StatCard label="Skipped" value={totalSkipped} color="text-gray-400" />
      </div>

      {/* By segment */}
      <div className="space-y-1">
        {Array.from(bySegment.entries()).map(([segment, stats]) => (
          <div
            key={segment}
            className="flex items-center justify-between text-xs px-2 py-1.5 bg-white rounded border border-gray-100"
          >
            <span className="font-medium text-gray-700">
              {SEGMENT_LABELS[segment]}
            </span>
            <span className="text-gray-500">
              <span className="text-green-600">{stats.saved}</span>
              {" / "}
              {stats.total}
              {stats.failed > 0 && (
                <span className="text-red-500 ml-1">({stats.failed} err)</span>
              )}
            </span>
          </div>
        ))}
      </div>

      {/* Timing */}
      {queue.startedAt && queue.completedAt && (
        <div className="text-[10px] text-gray-400 text-center">
          {formatDuration(
            new Date(queue.startedAt).getTime(),
            new Date(queue.completedAt).getTime()
          )}
        </div>
      )}
    </div>
  )
}

function StatCard({
  label,
  value,
  color,
}: {
  label: string
  value: number
  color: string
}) {
  return (
    <div className="bg-white rounded border border-gray-100 p-2 text-center">
      <div className={`text-lg font-bold ${color}`}>{value}</div>
      <div className="text-[10px] text-gray-400">{label}</div>
    </div>
  )
}

function formatDuration(startMs: number, endMs: number): string {
  const seconds = Math.round((endMs - startMs) / 1000)
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.floor(seconds / 60)
  const remainingSeconds = seconds % 60
  return `${minutes}m ${remainingSeconds}s`
}
