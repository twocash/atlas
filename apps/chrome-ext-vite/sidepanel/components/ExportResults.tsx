import Papa from "papaparse"
import type { TaskQueueState } from "~src/types/leads"

interface ExportResultsProps {
  queue: TaskQueueState
}

export function ExportResults({ queue }: ExportResultsProps) {
  const handleExport = () => {
    const rows = queue.leads.map((lead) => ({
      name: lead.name,
      profileUrl: lead.profileUrl,
      segment: lead.segment,
      status: lead.status,
      savedToList: lead.result?.savedToList ? "yes" : "no",
      followed: lead.result?.followed ? "yes" : "no",
      error: lead.result?.error || "",
      errorType: lead.result?.errorType || "",
      timestamp: lead.result?.timestamp
        ? new Date(lead.result.timestamp).toISOString()
        : "",
    }))

    const csv = Papa.unparse(rows)
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" })
    const url = URL.createObjectURL(blob)

    const a = document.createElement("a")
    a.href = url
    a.download = `atlas-results-${new Date().toISOString().slice(0, 10)}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  const hasResults = queue.leads.some(
    (l) => l.status === "completed" || l.status === "failed" || l.status === "skipped"
  )

  if (!hasResults) return null

  return (
    <div className="px-4 py-2">
      <button
        onClick={handleExport}
        className="w-full py-1.5 rounded text-xs font-medium bg-gray-100 text-gray-700 hover:bg-gray-200 transition-colors"
      >
        Export Results CSV
      </button>
    </div>
  )
}
