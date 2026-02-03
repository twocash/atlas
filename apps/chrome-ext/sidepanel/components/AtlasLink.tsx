import React, { useState, useEffect } from 'react'

interface AtlasActivity {
  id: string
  skill: string
  step: string
  status: 'running' | 'success' | 'error' | 'waiting'
  timestamp: Date
  detail?: string
}

export function AtlasLink() {
  const [activities, setActivities] = useState<AtlasActivity[]>([])
  const [connected, setConnected] = useState(false)
  const [currentSkill, setCurrentSkill] = useState<string | null>(null)

  useEffect(() => {
    // Listen for HUD updates from Atlas
    const handler = (msg: { type: string; data?: { skill: string; step: string; status: string; logs?: string[] } }) => {
      if (msg.type === 'atlas:skill:update') {
        const { skill, step, status, logs } = msg.data || {}

        // Track current skill
        if (status === 'running' && !currentSkill) {
          setCurrentSkill(skill || null)
        } else if (status === 'success' || status === 'error') {
          // Skill completed - keep showing for a moment
          setTimeout(() => setCurrentSkill(null), 2000)
        }

        setActivities(prev => [...prev.slice(-49), {
          id: crypto.randomUUID(),
          skill: skill || 'unknown',
          step: step || 'unknown',
          status: (status as AtlasActivity['status']) || 'running',
          timestamp: new Date(),
          detail: logs?.join(', ')
        }])

        setConnected(true)
      } else if (msg.type === 'atlas:pong') {
        setConnected(true)
      }
    }

    chrome.runtime.onMessage.addListener(handler)

    // Check connection status
    chrome.runtime.sendMessage({ type: 'atlas:ping' }, response => {
      if (chrome.runtime.lastError) {
        setConnected(false)
      } else if (response?.ok) {
        setConnected(true)
      }
    })

    return () => chrome.runtime.onMessage.removeListener(handler)
  }, [currentSkill])

  const handleEmergencyStop = () => {
    chrome.runtime.sendMessage({ type: 'atlas:emergency_stop' })
    setCurrentSkill(null)
    setActivities(prev => [...prev, {
      id: crypto.randomUUID(),
      skill: currentSkill || 'unknown',
      step: 'emergency_stop',
      status: 'error',
      timestamp: new Date(),
      detail: 'Stopped by user'
    }])
  }

  const handleClearLog = () => {
    setActivities([])
  }

  return (
    <div className="h-full flex flex-col p-4 space-y-4">
      {/* Connection Status */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <div className={`w-2 h-2 rounded-full ${connected ? 'bg-green-500' : 'bg-red-500'}`} />
          <span className="text-sm text-gray-600">
            {connected ? 'Atlas Connected' : 'Atlas Offline'}
          </span>
        </div>
        {currentSkill && (
          <button
            onClick={handleEmergencyStop}
            className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
          >
            Stop
          </button>
        )}
      </div>

      {/* Current Skill */}
      {currentSkill && (
        <div className="p-3 bg-blue-50 border border-blue-200 rounded-lg">
          <div className="flex items-center gap-2">
            <div className="animate-spin w-4 h-4 border-2 border-blue-500 border-t-transparent rounded-full" />
            <span className="font-medium text-blue-700">{currentSkill}</span>
          </div>
        </div>
      )}

      {/* Activity Log */}
      <div className="flex-1 flex flex-col min-h-0">
        <div className="flex items-center justify-between mb-2">
          <h3 className="text-sm font-medium text-gray-700">Activity Log</h3>
          {activities.length > 0 && (
            <button
              onClick={handleClearLog}
              className="text-xs text-gray-400 hover:text-gray-600"
            >
              Clear
            </button>
          )}
        </div>
        <div className="flex-1 overflow-y-auto space-y-1">
          {activities.slice().reverse().map(activity => (
            <div
              key={activity.id}
              className={`text-xs p-2 rounded ${
                activity.status === 'error' ? 'bg-red-50 text-red-700' :
                activity.status === 'success' ? 'bg-green-50 text-green-700' :
                activity.status === 'waiting' ? 'bg-yellow-50 text-yellow-700' :
                'bg-gray-50 text-gray-600'
              }`}
            >
              <div className="flex justify-between">
                <span className="font-medium">{activity.step}</span>
                <span className="text-gray-400">
                  {activity.timestamp.toLocaleTimeString()}
                </span>
              </div>
              <div className="text-gray-500 mt-0.5">{activity.skill}</div>
              {activity.detail && (
                <div className="mt-1 text-gray-500 truncate">{activity.detail}</div>
              )}
            </div>
          ))}
          {activities.length === 0 && (
            <div className="text-center text-gray-400 py-8">
              <div className="text-2xl mb-2">🤖</div>
              <div className="text-sm">No activity yet</div>
              <div className="text-xs mt-1">Atlas skills will appear here when running</div>
            </div>
          )}
        </div>
      </div>

      {/* Info */}
      <div className="text-[10px] text-gray-400 pt-2 border-t border-gray-100">
        Atlas Link shows browser automation activity from Telegram skills.
      </div>
    </div>
  )
}
