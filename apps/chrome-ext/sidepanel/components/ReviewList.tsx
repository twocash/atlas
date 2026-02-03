/**
 * ReviewList - "Green Room" for contact review before processing
 * Shows checkboxes with batch selection controls
 */

import type { Lead } from "~src/types/leads"

interface ReviewListProps {
  leads: Lead[]
  onToggle: (leadId: string) => void
  onSelectAll: (selected: boolean) => void
  onSelectBatch: (count: number) => void
  onDismiss: (leadIds: string[]) => void
}

const BATCH_SIZE = 20

export function ReviewList({ leads, onToggle, onSelectAll, onSelectBatch, onDismiss }: ReviewListProps) {
  const selectedCount = leads.filter((l) => l.selected).length
  const allSelected = selectedCount === leads.length && leads.length > 0
  const noneSelected = selectedCount === 0

  const handleDismissSelected = () => {
    const selectedIds = leads.filter((l) => l.selected).map((l) => l.id)
    if (selectedIds.length > 0) {
      onDismiss(selectedIds)
    }
  }

  return (
    <div className="divide-y divide-gray-100">
      {/* Batch controls header */}
      <div className="sticky top-0 bg-gray-50 px-4 py-2 border-b border-gray-200 space-y-2">
        {/* Row 1: Select All checkbox + count */}
        <div className="flex items-center justify-between">
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={allSelected}
              onChange={() => onSelectAll(!allSelected)}
              className="w-4 h-4 text-blue-600 rounded border-gray-300"
            />
            <span className="text-xs font-medium text-gray-700">
              {allSelected ? 'Deselect All' : 'Select All'} ({selectedCount}/{leads.length})
            </span>
          </label>
        </div>

        {/* Row 2: Batch actions */}
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={() => onSelectAll(false)}
            disabled={noneSelected}
            className="text-[10px] px-2 py-1 bg-gray-200 text-gray-700 rounded hover:bg-gray-300 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Clear
          </button>
          <button
            onClick={() => onSelectBatch(BATCH_SIZE)}
            disabled={selectedCount >= leads.length}
            className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            +{BATCH_SIZE}
          </button>
          <button
            onClick={() => onSelectBatch(leads.length)}
            disabled={allSelected}
            className="text-[10px] px-2 py-1 bg-blue-100 text-blue-700 rounded hover:bg-blue-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            All
          </button>
          <div className="flex-1" />
          <button
            onClick={handleDismissSelected}
            disabled={noneSelected}
            className="text-[10px] px-2 py-1 bg-red-100 text-red-700 rounded hover:bg-red-200 disabled:opacity-40 disabled:cursor-not-allowed"
          >
            Dismiss ({selectedCount})
          </button>
        </div>
      </div>

      {/* Contact list */}
      {leads.map((lead) => (
        <label
          key={lead.id}
          className="flex items-start gap-3 px-4 py-3 hover:bg-gray-50 cursor-pointer transition-colors"
        >
          <input
            type="checkbox"
            checked={lead.selected}
            onChange={() => onToggle(lead.id)}
            className="mt-1 w-4 h-4 text-blue-600 rounded border-gray-300"
          />
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-gray-900">{lead.name}</div>
            <div className="text-xs text-gray-500 mt-0.5 truncate">
              {lead.profileUrl}
            </div>
            {lead.notionData && (
              <div className="flex items-center gap-2 mt-1">
                <span className="text-[10px] px-1.5 py-0.5 bg-blue-100 text-blue-700 rounded">
                  {lead.notionData.sector}
                </span>
                <span className="text-[10px] text-gray-500">
                  {lead.notionData.groveAlignment?.slice(0, 10)}
                </span>
              </div>
            )}
          </div>
        </label>
      ))}

      {leads.length === 0 && (
        <div className="p-8 text-center text-sm text-gray-400">
          No contacts found for this segment
        </div>
      )}
    </div>
  )
}
