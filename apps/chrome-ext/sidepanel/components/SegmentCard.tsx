import { SegmentIcon } from "./SegmentIcon"

/**
 * SegmentCard - "Job Card" for segment selection
 */

interface SegmentCardProps {
  segment: {
    id: string
    name: string
    icon: string
    salesNavStatus: string
    listName: string
  }
  pendingCount: number
  onClick: () => void
}

export function SegmentCard({ segment, pendingCount, onClick }: SegmentCardProps) {
  const priorityColor = pendingCount > 10 ? 'text-red-600' : pendingCount > 5 ? 'text-amber-600' : 'text-gray-600'

  return (
    <button
      onClick={onClick}
      disabled={pendingCount === 0}
      className="group w-full p-4 bg-white border-2 border-gray-200 rounded-xl hover:border-atlas-400 hover:shadow-soft transition-all text-left disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:border-gray-200 disabled:hover:shadow-none"
    >
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-gray-50 flex items-center justify-center text-gray-500 group-hover:bg-atlas-50 group-hover:text-atlas-600 transition-colors">
            <SegmentIcon segment={segment.id} className="w-5 h-5" />
          </div>
          <span className="font-bold text-gray-900 tracking-tight">{segment.name}</span>
        </div>
        {pendingCount > 0 && (
          <span className={`text-sm font-bold ${priorityColor}`}>
            {pendingCount} pending
          </span>
        )}
      </div>

      <div className="text-xs text-gray-500 ml-[52px]">
        → {segment.listName} list
      </div>

      {pendingCount === 0 && (
        <div className="mt-2 text-xs text-gray-400 italic ml-[52px]">
          All contacts processed ✓
        </div>
      )}
    </button>
  )
}
