/**
 * ActiveRunView - Minimal processing view
 * Shows where we are, what's next (user's eyes are on main window)
 */

import type { TaskQueueState } from "~src/types/leads"
import { TaskQueue } from "./TaskQueue"
import { ProgressBar } from "./ProgressBar"
import { Controls } from "./Controls"

interface ActiveRunViewProps {
  queue: TaskQueueState
}

export function ActiveRunView({ queue }: ActiveRunViewProps) {
  const current = queue.leads[queue.current]
  const completed = queue.leads.filter((l) => l.status === "completed").length
  const failed = queue.leads.filter((l) => l.status === "failed").length

  return (
    <div className="h-full flex flex-col">
      {/* Progress header */}
      <div className="px-4 py-3 bg-white border-b border-gray-200">
        <div className="flex items-center justify-between mb-2">
          <h2 className="text-sm font-bold text-gray-900">Processing...</h2>
          <div className="text-xs text-gray-500">
            {queue.current + 1} / {queue.leads.length}
          </div>
        </div>
        <ProgressBar queue={queue} />
      </div>

      {/* Current contact (if running) */}
      {queue.status === "running" && current && (
        <div className="px-4 py-3 bg-blue-50 border-b border-blue-200">
          <div className="text-xs font-medium text-blue-900 mb-1">Current:</div>
          <div className="text-sm font-bold text-gray-900">{current.name}</div>
          <div className="text-xs text-gray-500 mt-1">
            {current.status === "in_progress" ? "Working..." : "Waiting..."}
          </div>
        </div>
      )}

      {/* Stats bar */}
      <div className="px-4 py-2 bg-gray-50 border-b border-gray-200 flex items-center gap-4 text-xs">
        <div className="flex items-center gap-1">
          <span className="text-green-600">✓</span>
          <span className="text-gray-600">{completed} completed</span>
        </div>
        {failed > 0 && (
          <div className="flex items-center gap-1">
            <span className="text-red-600">✗</span>
            <span className="text-gray-600">{failed} failed</span>
          </div>
        )}
      </div>

      {/* Minimal task list (auto-scroll to current) */}
      <div className="flex-1 overflow-y-auto">
        <TaskQueue queue={queue} />
      </div>

      {/* Controls footer */}
      <Controls queue={queue} />
    </div>
  )
}
