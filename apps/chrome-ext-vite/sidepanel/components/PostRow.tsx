import type { MonitoredPost, PhantomSlot } from "~src/types/posts"
import { PB_PHANTOM_SLOTS } from "~src/types/posts"

interface PostRowProps {
  post: MonitoredPost
  onMonitor: () => void
  onRemove: () => void
  onAssignSlot: (slot: PhantomSlot) => void
}

export function PostRow({ post, onMonitor, onRemove, onAssignSlot }: PostRowProps) {
  const isRunning = post.scrapeStatus === "running"
  const isFailed = post.scrapeStatus === "failed"
  const hasSlot = post.phantomSlot !== null

  // Format relative time
  const getRelativeTime = (isoDate: string) => {
    const date = new Date(isoDate)
    const now = new Date()
    const diffMs = now.getTime() - date.getTime()
    const diffMins = Math.floor(diffMs / 60000)
    const diffHours = Math.floor(diffMins / 60)
    const diffDays = Math.floor(diffHours / 24)

    if (diffDays > 0) return `${diffDays}d ago`
    if (diffHours > 0) return `${diffHours}h ago`
    if (diffMins > 0) return `${diffMins}m ago`
    return "just now"
  }

  return (
    <div className="px-4 py-3 hover:bg-gray-50 transition-colors">
      {/* Title row */}
      <div className="flex items-start justify-between gap-2 mb-2">
        <div className="flex-1 min-w-0">
          <a
            href={post.url}
            target="_blank"
            rel="noopener noreferrer"
            className="text-xs font-medium text-gray-800 hover:text-atlas-600 line-clamp-2"
            title={post.title}
          >
            {post.title}
          </a>
          <div className="text-[9px] text-gray-400 mt-0.5">
            Added {getRelativeTime(post.addedAt)}
            {post.lastScrapedAt && (
              <span> • Scraped {getRelativeTime(post.lastScrapedAt)}</span>
            )}
          </div>
        </div>

        {/* Status badge */}
        <div className="flex-shrink-0">
          {isRunning && (
            <span className="inline-flex items-center gap-1 text-[9px] text-amber-600 bg-amber-50 px-1.5 py-0.5 rounded">
              <span className="w-1.5 h-1.5 bg-amber-500 rounded-full animate-pulse" />
              Scraping
            </span>
          )}
          {isFailed && (
            <span className="text-[9px] text-red-600 bg-red-50 px-1.5 py-0.5 rounded">
              Failed
            </span>
          )}
        </div>
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 mb-2">
        <div className="flex items-center gap-1">
          <svg className="w-3 h-3 text-gray-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M2.458 12C3.732 7.943 7.523 5 12 5c4.478 0 8.268 2.943 9.542 7-1.274 4.057-5.064 7-9.542 7-4.477 0-8.268-2.943-9.542-7z" />
          </svg>
          <span className="text-[10px] text-gray-600">{post.impressions.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1">
          <svg className="w-3 h-3 text-blue-400" fill="currentColor" viewBox="0 0 20 20">
            <path d="M2 10.5a1.5 1.5 0 113 0v6a1.5 1.5 0 01-3 0v-6zM6 10.333v5.43a2 2 0 001.106 1.79l.05.025A4 4 0 008.943 18h5.416a2 2 0 001.962-1.608l1.2-6A2 2 0 0015.56 8H12V4a2 2 0 00-2-2 1 1 0 00-1 1v.667a4 4 0 01-.8 2.4L6.8 7.933a4 4 0 00-.8 2.4z" />
          </svg>
          <span className="text-[10px] text-gray-600">{post.reactions.toLocaleString()}</span>
        </div>
        <div className="flex items-center gap-1">
          <svg className="w-3 h-3 text-green-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
          </svg>
          <span className="text-[10px] text-gray-600">{post.comments.toLocaleString()}</span>
        </div>
      </div>

      {/* Slot Assignment */}
      <div className="flex items-center gap-2 mb-2">
        <span className="text-[9px] text-gray-500">Phantom:</span>
        <div className="flex gap-1">
          {(['A', 'B'] as const).map((slot) => (
            <button
              key={slot}
              onClick={() => onAssignSlot(post.phantomSlot === slot ? null : slot)}
              className={`text-[9px] px-2 py-0.5 rounded transition-colors ${
                post.phantomSlot === slot
                  ? 'bg-atlas-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              Slot {slot}
            </button>
          ))}
        </div>
        {hasSlot && (
          <span className="text-[9px] text-green-600">
            → {PB_PHANTOM_SLOTS[post.phantomSlot!].name}
          </span>
        )}
      </div>

      {/* Actions row */}
      <div className="flex items-center gap-2">
        <button
          onClick={() => {
            // Copy post URL to clipboard and open assigned PB phantom config
            navigator.clipboard.writeText(post.url)
            const slot = post.phantomSlot || 'A'
            window.open(PB_PHANTOM_SLOTS[slot].setupUrl, "_blank")
          }}
          className="text-[10px] text-atlas-600 hover:text-atlas-700"
        >
          Setup in PB{hasSlot ? ` (Slot ${post.phantomSlot})` : ''} →
        </button>
        <span className="text-gray-300">|</span>
        <a
          href={post.url}
          target="_blank"
          rel="noopener noreferrer"
          className="text-[10px] text-gray-500 hover:text-gray-700"
        >
          Open Post
        </a>
        <span className="text-gray-300">|</span>
        <button
          onClick={onRemove}
          className="text-[10px] text-red-500 hover:text-red-600"
        >
          Remove
        </button>
      </div>

      {/* Error message */}
      {isFailed && post.scrapeError && (
        <div className="mt-2 text-[9px] text-red-500 bg-red-50 p-1.5 rounded">
          {post.scrapeError}
        </div>
      )}
    </div>
  )
}
