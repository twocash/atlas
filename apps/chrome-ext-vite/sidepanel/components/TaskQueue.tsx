import type { TaskQueueState } from "~src/types/leads"
import { LeadRow } from "./LeadRow"

interface TaskQueueProps {
  queue: TaskQueueState
}

export function TaskQueue({ queue }: TaskQueueProps) {
  if (queue.leads.length === 0) {
    return (
      <div className="p-4 text-center text-xs text-gray-400">
        No leads loaded. Import a CSV to get started.
      </div>
    )
  }

  return (
    <div className="flex-1 overflow-y-auto border-t border-gray-200">
      {queue.leads.map((lead, idx) => (
        <LeadRow key={lead.id} lead={lead} isCurrent={idx === queue.current && queue.status === "running"} />
      ))}
    </div>
  )
}
