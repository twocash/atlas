import { useCallback, useRef, useState } from "react"
import Papa from "papaparse"
import { Storage } from "@plasmohq/storage"
import { STORAGE_KEYS } from "~src/lib/storage"
import type { Lead, Segment, TaskQueueState } from "~src/types/leads"

const storage = new Storage({ area: "local" })
const VALID_SEGMENTS: Segment[] = ["academic", "technical", "enterprise", "influencer"]

interface CsvImportProps {
  onImported: () => void
}

interface CsvRow {
  name?: string
  profileUrl?: string
  profile_url?: string
  url?: string
  segment?: string
  [key: string]: string | undefined
}

function normalizeSegment(raw: string | undefined): Segment | null {
  if (!raw) return null
  const lower = raw.trim().toLowerCase()
  if (VALID_SEGMENTS.includes(lower as Segment)) return lower as Segment
  // Common aliases
  if (lower === "builder" || lower === "tech") return "technical"
  if (lower === "amplifier" || lower === "influence") return "influencer"
  if (lower === "academia") return "academic"
  return null
}

function parseLeads(rows: CsvRow[]): { leads: Lead[]; errors: string[] } {
  const leads: Lead[] = []
  const errors: string[] = []

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (!row) continue

    const name = row.name?.trim()
    const profileUrl = (row.profileUrl || row.profile_url || row.url)?.trim()
    const segment = normalizeSegment(row.segment)

    if (!name) {
      errors.push(`Row ${i + 1}: missing name`)
      continue
    }
    if (!profileUrl) {
      errors.push(`Row ${i + 1}: missing profileUrl`)
      continue
    }
    if (!segment) {
      errors.push(`Row ${i + 1}: invalid segment "${row.segment || ""}"`)
      continue
    }

    leads.push({
      id: profileUrl,
      profileUrl,
      name,
      segment,
      status: "pending",
    })
  }

  return { leads, errors }
}

export function CsvImport({ onImported }: CsvImportProps) {
  const fileRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [parseInfo, setParseInfo] = useState<string | null>(null)

  const handleCsvText = useCallback(
    (text: string) => {
      setError(null)
      setParseInfo(null)

      const result = Papa.parse<CsvRow>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
      })

      if (result.errors.length > 0) {
        setError(`CSV parse error: ${result.errors[0]?.message}`)
        return
      }

      const { leads, errors } = parseLeads(result.data)

      if (leads.length === 0) {
        setError(errors.length > 0 ? errors.slice(0, 3).join("; ") : "No valid leads found")
        return
      }

      const queueState: TaskQueueState = {
        status: "idle",
        leads,
        current: 0,
        activeTabId: null,
        lastActionTimestamp: 0,
      }

      storage.set(STORAGE_KEYS.QUEUE_STATE, queueState).then(() => {
        setParseInfo(
          `${leads.length} leads loaded` +
            (errors.length > 0 ? ` (${errors.length} skipped)` : "")
        )
        onImported()
      })
    },
    [onImported]
  )

  const handleFile = useCallback(
    (file: File) => {
      if (!file.name.endsWith(".csv") && file.type !== "text/csv") {
        setError("Please upload a .csv file")
        return
      }
      const reader = new FileReader()
      reader.onload = (e) => handleCsvText(e.target?.result as string)
      reader.readAsText(file)
    },
    [handleCsvText]
  )

  return (
    <div className="p-4 space-y-3">
      <div className="text-xs font-medium text-gray-700">Import Leads</div>

      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center cursor-pointer transition-colors ${
          dragOver
            ? "border-atlas-400 bg-atlas-50"
            : "border-gray-300 hover:border-gray-400"
        }`}
        onDragOver={(e) => {
          e.preventDefault()
          setDragOver(true)
        }}
        onDragLeave={() => setDragOver(false)}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          const file = e.dataTransfer.files[0]
          if (file) handleFile(file)
        }}
        onClick={() => fileRef.current?.click()}
      >
        <div className="text-sm text-gray-500">
          Drop CSV here or <span className="text-atlas-600 font-medium">browse</span>
        </div>
        <div className="text-[10px] text-gray-400 mt-1">
          Columns: name, profileUrl, segment
        </div>
      </div>

      <input
        ref={fileRef}
        type="file"
        accept=".csv,text/csv"
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0]
          if (file) handleFile(file)
        }}
      />

      {/* Paste area */}
      <div>
        <textarea
          className="w-full border border-gray-300 rounded-md p-2 text-xs font-mono h-20 resize-none focus:outline-none focus:ring-1 focus:ring-atlas-400"
          placeholder="Or paste CSV text here..."
          onPaste={(e) => {
            const text = e.clipboardData.getData("text")
            if (text.trim()) {
              e.preventDefault()
              handleCsvText(text)
            }
          }}
        />
      </div>

      {/* Status messages */}
      {error && (
        <div className="text-xs text-red-600 bg-red-50 rounded px-2 py-1.5">{error}</div>
      )}
      {parseInfo && (
        <div className="text-xs text-green-700 bg-green-50 rounded px-2 py-1.5">
          {parseInfo}
        </div>
      )}
    </div>
  )
}
