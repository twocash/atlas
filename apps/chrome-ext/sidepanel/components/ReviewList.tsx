/**
 * ReviewList - "Green Room" for contact review before processing
 * Shows checkboxes (all selected by default) - user can deselect mistakes
 */

import type { Lead } from "~src/types/leads"

interface ReviewListProps {
  leads: Lead[]
  onToggle: (leadId: string) => void
}

export function ReviewList({ leads, onToggle }: ReviewListProps) {
  const allSelected = leads.every((l) => l.selected)
  const selectedCount = leads.filter((l) => l.selected).length

  const handleToggleAll = () => {
    const newState = !allSelected
    leads.forEach((l) => onToggle(l.id))
  }

  return (
    <div className="divide-y divide-gray-100">
      {/* Select All header */}
      <div className="sticky top-0 bg-gray-50 px-4 py-2 border-b border-gray-200">
        <label className="flex items-center gap-2 cursor-pointer">
          <input
            type="checkbox"
            checked={allSelected}
            onChange={handleToggleAll}
            className="w-4 h-4 text-blue-600 rounded border-gray-300"
          />
          <span className="text-xs font-medium text-gray-700">
            Select All ({selectedCount}/{leads.length})
          </span>
        </label>
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
