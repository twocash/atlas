import React, { useState, useEffect } from 'react'
import { Storage } from '@plasmohq/storage'
import type { ActionType } from '~src/types/action-feed'

const storage = new Storage({ area: 'local' })
const SETTINGS_KEY = 'atlas_feed_settings'

export interface FeedSettingsData {
  pollingIntervalMs: number
  notificationTypes: ActionType[]
  autoDismissInfoHours: number
  batchModeDefault: boolean
}

const DEFAULT_SETTINGS: FeedSettingsData = {
  pollingIntervalMs: 30000,
  notificationTypes: ['Approval', 'Alert'],
  autoDismissInfoHours: 12,
  batchModeDefault: false,
}

interface FeedSettingsProps {
  onSettingsChange: (settings: FeedSettingsData) => void
}

export function FeedSettings({ onSettingsChange }: FeedSettingsProps) {
  const [settings, setSettings] = useState<FeedSettingsData>(DEFAULT_SETTINGS)
  const [isExpanded, setIsExpanded] = useState(false)

  useEffect(() => {
    storage.get<FeedSettingsData>(SETTINGS_KEY).then((saved) => {
      if (saved) {
        const merged = { ...DEFAULT_SETTINGS, ...saved }
        setSettings(merged)
        onSettingsChange(merged)
      }
    })
  }, [])

  const updateSetting = <K extends keyof FeedSettingsData>(
    key: K,
    value: FeedSettingsData[K]
  ) => {
    const newSettings = { ...settings, [key]: value }
    setSettings(newSettings)
    storage.set(SETTINGS_KEY, newSettings)
    onSettingsChange(newSettings)
  }

  if (!isExpanded) {
    return (
      <button
        className="w-full px-4 py-2 text-xs text-gray-400 hover:text-gray-600 text-left border-t border-gray-100 bg-gray-50"
        onClick={() => setIsExpanded(true)}
      >
        Settings
      </button>
    )
  }

  return (
    <div className="border-t border-gray-100 bg-gray-50 p-3">
      <div className="flex items-center justify-between mb-3">
        <span className="text-xs font-semibold text-gray-700">Feed Settings</span>
        <button
          className="text-gray-400 hover:text-gray-600 text-sm"
          onClick={() => setIsExpanded(false)}
        >
          ×
        </button>
      </div>

      <div className="space-y-3">
        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Polling interval</label>
          <select
            value={settings.pollingIntervalMs}
            onChange={(e) => updateSetting('pollingIntervalMs', Number(e.target.value))}
            className="w-full px-2 py-1 bg-white border border-gray-200 rounded text-xs text-gray-700"
          >
            <option value={15000}>15 seconds</option>
            <option value={30000}>30 seconds</option>
            <option value={60000}>1 minute</option>
            <option value={120000}>2 minutes</option>
            <option value={300000}>5 minutes</option>
          </select>
        </div>

        <div>
          <label className="block text-[10px] text-gray-500 mb-1">Auto-dismiss Info cards after</label>
          <select
            value={settings.autoDismissInfoHours}
            onChange={(e) => updateSetting('autoDismissInfoHours', Number(e.target.value))}
            className="w-full px-2 py-1 bg-white border border-gray-200 rounded text-xs text-gray-700"
          >
            <option value={6}>6 hours</option>
            <option value={12}>12 hours</option>
            <option value={24}>24 hours</option>
            <option value={48}>48 hours</option>
          </select>
        </div>

        <label className="flex items-center gap-2 text-xs text-gray-600 cursor-pointer">
          <input
            type="checkbox"
            checked={settings.batchModeDefault}
            onChange={(e) => updateSetting('batchModeDefault', e.target.checked)}
            className="rounded border-gray-300"
          />
          Enable batch mode by default
        </label>
      </div>
    </div>
  )
}
