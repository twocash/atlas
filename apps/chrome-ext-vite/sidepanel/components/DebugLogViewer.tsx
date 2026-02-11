import { useEffect, useState, useRef } from "react"
import { Storage } from "~src/lib/chrome-storage"
import type { LogEntry } from "~src/lib/debug-log"
import { LOG_KEY } from "~src/lib/debug-log"

const storage = new Storage({ area: "local" })

const SRC_COLORS: Record<string, string> = {
  orchestrator: "text-blue-600",
  content: "text-purple-600",
  ui: "text-green-600",
  "tab-mgr": "text-amber-600",
}

/** Normalize logs to always be an array */
function normalizeLogs(raw: unknown): LogEntry[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  if (typeof raw === "object") return Object.values(raw)
  return []
}

export function DebugLogViewer() {
  const [logs, setLogs] = useState<LogEntry[]>([])
  const [autoScroll, setAutoScroll] = useState(true)
  const bottomRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    // Initial read
    storage.get<LogEntry[]>(LOG_KEY).then((val) => {
      setLogs(normalizeLogs(val))
    })

    // Use Plasmo's watch API for proper deserialization
    storage.watch({
      [LOG_KEY]: (change) => {
        setLogs(normalizeLogs(change.newValue))
      },
    })
  }, [])

  // Auto-scroll to bottom
  useEffect(() => {
    if (autoScroll && bottomRef.current) {
      bottomRef.current.scrollIntoView({ behavior: "smooth" })
    }
  }, [logs.length, autoScroll])

  const handleClear = () => {
    storage.set(LOG_KEY, [])
    setLogs([])
  }

  const handleExport = () => {
    const text = logs
      .map((e) => `${e.ts} [${e.src}] ${e.msg}`)
      .join("\n")
    const blob = new Blob([text], { type: "text/plain" })
    const url = URL.createObjectURL(blob)
    const a = document.createElement("a")
    a.href = url
    a.download = `atlas-debug-${new Date().toISOString().slice(0, 19).replace(/:/g, "-")}.log`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar */}
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-gray-200 bg-white">
        <span className="text-[10px] text-gray-400 flex-1">{logs.length} entries</span>
        <label className="flex items-center gap-1 text-[10px] text-gray-500">
          <input
            type="checkbox"
            checked={autoScroll}
            onChange={(e) => setAutoScroll(e.target.checked)}
            className="w-3 h-3"
          />
          Auto-scroll
        </label>
        <button
          onClick={handleExport}
          className="text-[10px] text-atlas-600 hover:text-atlas-700"
        >
          Export
        </button>
        <button
          onClick={handleClear}
          className="text-[10px] text-red-500 hover:text-red-600"
        >
          Clear
        </button>
      </div>

      {/* Log entries */}
      <div className="flex-1 overflow-y-auto font-mono text-[10px] leading-relaxed bg-gray-900 text-gray-300 p-2">
        {logs.length === 0 && (
          <div className="text-gray-500 text-center py-4">No logs yet. Start the queue to see output.</div>
        )}
        {logs.map((entry, i) => (
          <div key={i} className="flex gap-1.5 hover:bg-gray-800 px-1">
            <span className="text-gray-600 flex-shrink-0 select-none">
              {entry.ts.slice(11, 23)}
            </span>
            <span className={`flex-shrink-0 w-16 ${SRC_COLORS[entry.src] || "text-gray-400"}`}>
              [{entry.src}]
            </span>
            <span className={entry.msg.includes("CATCH") || entry.msg.includes("Error") ? "text-red-400" : ""}>
              {entry.msg}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  )
}
