/**
 * NetworkView — Scaffold for follow-up queue + relationship tracking.
 *
 * Phase B scaffold: shows pending follows list.
 * Full implementation (contact cards, DM queue) deferred to Phase C.
 */

import React, { useState, useEffect } from "react"

interface PendingFollow {
  profileUrl: string
  name: string
  queuedAt: string
  fromPostTitle: string
}

const FOLLOWS_KEY = "atlas:pending-follows"

export function NetworkView() {
  const [follows, setFollows] = useState<PendingFollow[]>([])

  useEffect(() => {
    loadFollows()
    const listener = (changes: Record<string, chrome.storage.StorageChange>) => {
      if (FOLLOWS_KEY in changes) {
        loadFollows()
      }
    }
    chrome.storage.local.onChanged.addListener(listener)
    return () => chrome.storage.local.onChanged.removeListener(listener)
  }, [])

  async function loadFollows() {
    try {
      const result = await chrome.storage.local.get(FOLLOWS_KEY)
      setFollows(result[FOLLOWS_KEY] ?? [])
    } catch {
      setFollows([])
    }
  }

  async function navigateActiveTab(url: string) {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
    if (tab?.id) {
      chrome.tabs.update(tab.id, { url })
    }
  }

  async function removeFollow(profileUrl: string) {
    const updated = follows.filter((f) => f.profileUrl !== profileUrl)
    await chrome.storage.local.set({ [FOLLOWS_KEY]: updated })
    setFollows(updated)
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900">Network</h2>
          {follows.length > 0 && (
            <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded-full">
              {follows.length}
            </span>
          )}
        </div>
      </div>

      {/* Pending Follows */}
      <div className="flex-1 overflow-y-auto">
        {follows.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full text-gray-400">
            <svg className="w-10 h-10 mb-2 opacity-50" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={1.5}>
              <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
              <circle cx="9" cy="7" r="4" />
              <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
              <path d="M16 3.13a4 4 0 0 1 0 7.75" />
            </svg>
            <p className="text-xs">No pending follows</p>
            <p className="text-[10px] mt-1 text-gray-300">
              Reply to comments — follows are auto-queued via cultivate toast
            </p>
          </div>
        ) : (
          <div className="p-2 space-y-2">
            <h3 className="text-[10px] font-bold text-gray-400 uppercase tracking-wider px-1">
              Pending Follows ({follows.length})
            </h3>
            {follows.map((follow) => (
              <div
                key={follow.profileUrl}
                className="bg-white rounded-lg shadow-sm border border-gray-100 p-3 flex items-center justify-between"
              >
                <div className="flex-1 min-w-0">
                  <button
                    onClick={() => navigateActiveTab(follow.profileUrl)}
                    className="text-xs font-semibold text-blue-600 hover:underline truncate block text-left"
                  >
                    {follow.name}
                  </button>
                  <p className="text-[10px] text-gray-400 truncate">
                    From: {follow.fromPostTitle}
                  </p>
                  <p className="text-[9px] text-gray-300">
                    Queued {formatTimeAgo(follow.queuedAt)}
                  </p>
                </div>
                <button
                  onClick={() => removeFollow(follow.profileUrl)}
                  className="ml-2 p-1 text-gray-300 hover:text-red-400 transition-colors"
                  title="Remove from queue"
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function formatTimeAgo(isoDate: string): string {
  const diff = Date.now() - new Date(isoDate).getTime()
  const minutes = Math.floor(diff / 60000)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  return `${days}d ago`
}
