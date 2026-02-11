import type { TaskQueueState } from "~src/types/leads"

interface ProgressBarProps {
  queue: TaskQueueState
}

export function ProgressBar({ queue }: ProgressBarProps) {
  const total = queue.leads.length
  const completed = queue.leads.filter(
    (l) => l.status === "completed" || l.status === "failed" || l.status === "skipped"
  ).length
  const pct = total > 0 ? Math.round((completed / total) * 100) : 0

  const succeeded = queue.leads.filter((l) => l.status === "completed").length
  const failed = queue.leads.filter((l) => l.status === "failed").length

  return (
    <div className="px-4 py-2 border-b border-gray-200 bg-white">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-gray-700">
          {completed}/{total} processed
        </span>
        <span className="text-[10px] text-gray-400">
          {succeeded > 0 && <span className="text-green-600">{succeeded} saved</span>}
          {failed > 0 && (
            <span className="text-red-500 ml-2">{failed} failed</span>
          )}
        </span>
      </div>
      <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
        <div
          className="h-full bg-atlas-500 rounded-full transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
