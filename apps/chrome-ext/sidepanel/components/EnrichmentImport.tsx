import { useState } from "react"
import Papa from "papaparse"

interface EnrichmentImportProps {
  onComplete: (count: number) => void
}

export function EnrichmentImport({ onComplete }: EnrichmentImportProps) {
  const [isProcessing, setIsProcessing] = useState(false)
  const [status, setStatus] = useState("")

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return

    setIsProcessing(true)
    setStatus("Parsing CSV...")

    Papa.parse(file, {
      header: true,
      complete: async (results) => {
        const leads = results.data as Array<Record<string, string>>
        setStatus(`Processing ${leads.length} enriched profiles...`)

        try {
          const response = await chrome.runtime.sendMessage({
            name: "ENRICH_FROM_CSV",
            body: { leads },
          })

          if (response?.ok) {
            setStatus(`✓ Enriched ${response.updated} contacts`)
            setTimeout(() => onComplete(response.updated), 2000)
          } else {
            setStatus(`Error: ${response?.error || "Unknown error"}`)
          }
        } catch (e) {
          setStatus(`Error: ${e}`)
        } finally {
          setIsProcessing(false)
        }
      },
      error: (error) => {
        setStatus(`Parse error: ${error.message}`)
        setIsProcessing(false)
      },
    })
  }

  return (
    <div className="p-4">
      <div className="text-sm font-semibold text-gray-800 mb-2">
        Import Enriched Profiles
      </div>
      <div className="text-[10px] text-gray-500 mb-3">
        Upload a CSV export from PhantomBuster Leads to enrich existing contacts with job titles, bios, skills, etc.
      </div>

      <label className="block">
        <input
          type="file"
          accept=".csv"
          onChange={handleFileUpload}
          disabled={isProcessing}
          className="block w-full text-xs text-gray-500 file:mr-2 file:py-1 file:px-3 file:rounded file:border-0 file:text-xs file:bg-atlas-600 file:text-white hover:file:bg-atlas-700 disabled:opacity-50"
        />
      </label>

      {status && (
        <div className={`mt-3 text-[10px] px-2 py-1.5 rounded ${
          status.includes("Error") ? "bg-red-100 text-red-700" : "bg-green-100 text-green-700"
        }`}>
          {status}
        </div>
      )}
    </div>
  )
}
