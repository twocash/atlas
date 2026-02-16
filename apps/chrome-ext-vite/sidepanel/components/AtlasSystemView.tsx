/**
 * AtlasSystemView — Consolidated system panel absorbing ActionFeed + DataView + Settings.
 *
 * Three collapsible sections:
 * 1. Action Feed — live Atlas activity stream
 * 2. Data — CSV import, enrichment, export
 * 3. Settings — model selector, API keys, debug logs
 */

import React, { useState, useEffect } from "react"
import { ActionFeed } from "./ActionFeed/ActionFeed"
import { DataView } from "./DataView"
import { ModelSelector } from "./ModelSelector"
import { ApiKeySetup } from "./ApiKeySetup"
import { DebugLogViewer } from "./DebugLogViewer"
import { BRIDGE_URL_STORAGE_KEY, DEFAULT_BRIDGE_WS_URL } from "~src/lib/claude-code-hooks"

type Section = "feed" | "data" | "settings"

export function AtlasSystemView({ atlasConnected = false }: { atlasConnected?: boolean }) {
  const [expanded, setExpanded] = useState<Section | null>("feed")

  const toggle = (section: Section) => {
    setExpanded((prev) => (prev === section ? null : section))
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-gray-100">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-bold text-gray-900">Atlas</h2>
          <span
            className={`w-2 h-2 rounded-full ${
              atlasConnected ? "bg-green-500" : "bg-gray-400"
            }`}
            title={atlasConnected ? "Connected" : "Disconnected"}
          />
        </div>

        {/* Section tabs */}
        <div className="flex gap-1">
          {(["feed", "data", "settings"] as Section[]).map((section) => (
            <button
              key={section}
              onClick={() => toggle(section)}
              className={`text-[10px] px-2 py-0.5 rounded-full capitalize transition-colors ${
                expanded === section
                  ? "bg-blue-100 text-blue-700 font-medium"
                  : "text-gray-400 hover:text-gray-600 hover:bg-gray-50"
              }`}
            >
              {section}
            </button>
          ))}
        </div>
      </div>

      {/* Content */}
      <div className="flex-1 overflow-y-auto">
        {expanded === "feed" && (
          <ActionFeed pollingInterval={30000} />
        )}

        {expanded === "data" && (
          <DataView />
        )}

        {expanded === "settings" && (
          <div className="p-4 space-y-6">
            <section>
              <h2 className="text-sm font-bold text-gray-900 mb-3">Intelligence</h2>
              <ModelSelector />
              <div className="mt-2"><ApiKeySetup /></div>
            </section>
            <section className="pt-4 border-t border-gray-100">
              <BridgeUrlSetting />
            </section>
            <section className="pt-4 border-t border-gray-100">
              <h2 className="text-sm font-bold text-gray-900 mb-3">Debug Logs</h2>
              <div className="h-64 border rounded bg-gray-50 overflow-hidden"><DebugLogViewer /></div>
              <div className="mt-2 text-[10px] text-gray-400">
                Shows sync progress, phantom fetches, Notion updates, and errors.
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Bridge URL Setting ────────────────────────────────────

function BridgeUrlSetting() {
  const [url, setUrl] = useState(DEFAULT_BRIDGE_WS_URL)
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    chrome.storage.local.get(BRIDGE_URL_STORAGE_KEY).then((result) => {
      const stored = result[BRIDGE_URL_STORAGE_KEY]
      if (stored && typeof stored === "string") setUrl(stored)
    })
  }, [])

  const save = () => {
    const trimmed = url.trim()
    if (!trimmed || !trimmed.startsWith("ws")) return
    chrome.storage.local.set({ [BRIDGE_URL_STORAGE_KEY]: trimmed })
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  const reset = () => {
    setUrl(DEFAULT_BRIDGE_WS_URL)
    chrome.storage.local.remove(BRIDGE_URL_STORAGE_KEY)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div>
      <h2 className="text-sm font-bold text-gray-900 mb-2">Claude Bridge</h2>
      <label className="block text-[11px] text-gray-500 mb-1">
        WebSocket URL (change for remote machines)
      </label>
      <div className="flex gap-1">
        <input
          type="text"
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && save()}
          placeholder={DEFAULT_BRIDGE_WS_URL}
          className="flex-1 text-xs px-2 py-1.5 border border-gray-200 rounded bg-white focus:outline-none focus:ring-1 focus:ring-blue-400 font-mono"
        />
        <button
          onClick={save}
          className="text-[10px] px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
        >
          Save
        </button>
      </div>
      <div className="flex items-center justify-between mt-1">
        <button onClick={reset} className="text-[10px] text-gray-400 hover:text-gray-600">
          Reset to default
        </button>
        {saved && <span className="text-[10px] text-green-600">Saved — reconnect to apply</span>}
      </div>
    </div>
  )
}
