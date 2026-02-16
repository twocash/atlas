/**
 * CultivateToast — Green slide-in toast for follow-up queue confirmation.
 *
 * Shows "Queued for follow-up [Undo]" with auto-dismiss after 3s.
 */

import { useEffect } from "react"

interface CultivateToastProps {
  visible: boolean
  profileUrl: string
  onUndo: () => void
  onDismiss: () => void
}

export function CultivateToast({ visible, profileUrl, onUndo, onDismiss }: CultivateToastProps) {
  useEffect(() => {
    if (!visible) return
    const timer = setTimeout(onDismiss, 3000)
    return () => clearTimeout(timer)
  }, [visible, onDismiss])

  if (!visible) return null

  return (
    <div className="fixed bottom-4 left-4 right-4 z-50 animate-slide-up">
      <div className="bg-green-50 border-l-4 border-green-400 rounded-r-lg shadow-lg px-4 py-3 flex items-center justify-between">
        <div className="flex items-center gap-2">
          <svg className="w-4 h-4 text-green-500 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
          </svg>
          <span className="text-xs text-green-800">Queued for follow-up</span>
        </div>
        <button
          onClick={onUndo}
          className="text-xs font-medium text-green-700 hover:text-green-900 hover:underline ml-3"
        >
          Undo
        </button>
      </div>
    </div>
  )
}
