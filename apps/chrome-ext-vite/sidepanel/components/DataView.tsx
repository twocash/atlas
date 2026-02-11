/**
 * Data View - Passive background tasks
 * - Contact enrichment
 * - Phantom monitoring
 * - Export/import utilities
 */

import { useState } from "react"
import { EnrichmentImport } from "./EnrichmentImport"

export function DataView() {
  const [activeTab, setActiveTab] = useState<'enrichment' | 'monitor'>('enrichment')

  return (
    <div className="h-full flex flex-col">
      {/* Header with tabs */}
      <div className="px-4 py-3 border-b border-gray-200 bg-white">
        <h2 className="text-sm font-bold text-gray-900 mb-3">Data & Monitoring</h2>
        <div className="flex gap-2">
          <button
            onClick={() => setActiveTab('enrichment')}
            className={`text-xs px-3 py-1.5 rounded transition-colors ${
              activeTab === 'enrichment'
                ? 'bg-atlas-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Enrichment
          </button>
          <button
            onClick={() => setActiveTab('monitor')}
            className={`text-xs px-3 py-1.5 rounded transition-colors ${
              activeTab === 'monitor'
                ? 'bg-atlas-600 text-white'
                : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
            }`}
          >
            Phantom Status
          </button>
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'enrichment' && (
          <div className="p-4">
            <EnrichmentImport onComplete={(count) => console.log(`Enriched ${count} contacts`)} />

            <div className="mt-6 p-3 bg-blue-50 border border-blue-200 rounded text-xs text-gray-700 leading-relaxed">
              <div className="font-semibold text-blue-900 mb-1">💡 How Enrichment Works</div>
              <ol className="list-decimal list-inside space-y-1 text-[11px]">
                <li>Export contacts from PhantomBuster Leads as CSV</li>
                <li>Upload CSV here</li>
                <li>Atlas matches by LinkedIn URL (memberIds change)</li>
                <li>Updates Notion with job titles, bios, skills, etc.</li>
              </ol>
              <div className="mt-2 text-[10px] text-gray-500">
                This runs in the background. Check Logs in Settings for progress.
              </div>
            </div>
          </div>
        )}

        {activeTab === 'monitor' && (
          <div className="p-4">
            <div className="text-sm font-semibold text-gray-800 mb-3">Phantom Status</div>

            {/* Phantom Slots Status */}
            <div className="space-y-3">
              <PhantomSlotCard
                slot="A"
                agentId="5464281464072346"
                name="Post Scraper A"
                status="idle"
              />
              <PhantomSlotCard
                slot="B"
                agentId="2175964471330352"
                name="Post Scraper B"
                status="idle"
              />
            </div>

            <div className="mt-6 p-3 bg-amber-50 border border-amber-200 rounded text-xs text-gray-700 leading-relaxed">
              <div className="font-semibold text-amber-900 mb-1">🔄 Phantom Slots</div>
              <p className="text-[11px] mb-2">
                We use 2 phantom slots because LinkedIn posts 1-2x/week. Phantoms can't easily update URLs,
                so we rotate between Slot A and Slot B for each new post.
              </p>
              <div className="text-[10px] text-gray-500">
                Status updates every 5 seconds when a phantom is running.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}

function PhantomSlotCard({
  slot,
  agentId,
  name,
  status,
}: {
  slot: string
  agentId: string
  name: string
  status: 'idle' | 'running' | 'finished' | 'error'
}) {
  const statusColors = {
    idle: 'bg-gray-100 text-gray-600',
    running: 'bg-amber-100 text-amber-700',
    finished: 'bg-green-100 text-green-700',
    error: 'bg-red-100 text-red-700',
  }

  return (
    <div className="p-3 border border-gray-200 rounded-lg">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="text-xs font-bold text-gray-900">Slot {slot}</div>
          <span className={`text-[10px] px-2 py-0.5 rounded ${statusColors[status]}`}>
            {status}
          </span>
        </div>
        <button
          onClick={() => window.open(`https://phantombuster.com/2316148405398457/phantoms/${agentId}/dashboard`, '_blank')}
          className="text-[10px] text-atlas-600 hover:text-atlas-700"
        >
          View in PB →
        </button>
      </div>
      <div className="text-[10px] text-gray-500">{name}</div>
      <div className="text-[9px] text-gray-400 mt-1 font-mono">{agentId}</div>
    </div>
  )
}
