import type { TaskQueueState } from "~src/types/leads"

interface ControlsProps {
  queue: TaskQueueState
}

function sendMessage(name: string) {
  chrome.runtime.sendMessage({ name })
}

export function Controls({ queue }: ControlsProps) {
  const isIdle = queue.status === "idle"
  const isRunning = queue.status === "running"
  const isPaused = queue.status === "paused"
  const isCompleted = queue.status === "completed"
  const hasLeads = queue.leads.length > 0

  return (
    <div className="px-4 py-2 border-t border-gray-200 bg-white space-y-2">
      {/* Status banner */}
      {isRunning && (
        <div className="text-[10px] text-atlas-700 bg-atlas-50 rounded px-2 py-1 text-center">
          Atlas is driving — let it work for a few minutes.
        </div>
      )}
      {isCompleted && (
        <div className="text-[10px] text-green-700 bg-green-50 rounded px-2 py-1 text-center">
          Run complete.
        </div>
      )}

      {/* Action buttons */}
      <div className="flex gap-2">
        {(isIdle || isPaused) && (
          <button
            disabled={!hasLeads}
            onClick={() => sendMessage("START_QUEUE")}
            className="flex-1 py-1.5 rounded text-xs font-medium bg-atlas-600 text-white hover:bg-atlas-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
          >
            {isPaused ? "Resume" : "Start"}
          </button>
        )}

        {isRunning && (
          <>
            <button
              onClick={() => sendMessage("PAUSE_QUEUE")}
              className="flex-1 py-1.5 rounded text-xs font-medium bg-amber-500 text-white hover:bg-amber-600 transition-colors"
            >
              Pause
            </button>
            <button
              onClick={() => sendMessage("SKIP_LEAD")}
              className="py-1.5 px-3 rounded text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
            >
              Skip
            </button>
          </>
        )}

        {(isCompleted || isPaused) && (
          <button
            onClick={() => sendMessage("RESET_QUEUE")}
            className="py-1.5 px-3 rounded text-xs font-medium bg-gray-200 text-gray-700 hover:bg-gray-300 transition-colors"
          >
            Reset
          </button>
        )}
      </div>
    </div>
  )
}
