import React from "react"

export type ViewId = "radar" | "focus" | "network" | "atlas" | "claude"

interface NavRailProps {
  activeView: ViewId
  onSelect: (view: ViewId) => void
  focusCount?: number
  trackedCount?: number
  atlasConnected?: boolean
  claudeConnected?: boolean
}

export function NavRail({ activeView, onSelect, focusCount = 0, trackedCount = 0, atlasConnected = false, claudeConnected = false }: NavRailProps) {
  return (
    <div className="w-14 flex flex-col items-center py-4 bg-gray-50 border-r border-gray-200 gap-6 flex-shrink-0">

      {/* 1. Radar — Tracked post portfolio + pipeline overview */}
      <NavButton
        id="radar"
        label="Radar"
        active={activeView === "radar"}
        onClick={() => onSelect("radar")}
        badge={trackedCount > 0}
        badgeCount={trackedCount}
      >
        {/* Radar Icon — Lucide Radio/Signal */}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M2 12a10 10 0 0 1 18-6" />
          <path d="M5.2 5.2a7 7 0 0 1 12.1 3.6" />
          <path d="M8.4 8.4a4 4 0 0 1 5.8 1.4" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      </NavButton>

      {/* 2. Focus — Engagement cards for reply work */}
      <NavButton
        id="focus"
        label="Focus"
        active={activeView === "focus"}
        onClick={() => onSelect("focus")}
        badge={focusCount > 0}
        badgeCount={focusCount}
      >
        {/* Focus Icon — Lucide Target/Crosshair */}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" />
          <circle cx="12" cy="12" r="6" />
          <circle cx="12" cy="12" r="2" />
        </svg>
      </NavButton>

      {/* 3. Network — Follow-up queue + relationship tracking */}
      <NavButton
        id="network"
        label="Network"
        active={activeView === "network"}
        onClick={() => onSelect("network")}
      >
        {/* Network Icon — Lucide Users */}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2" />
          <circle cx="9" cy="7" r="4" />
          <path d="M22 21v-2a4 4 0 0 0-3-3.87" />
          <path d="M16 3.13a4 4 0 0 1 0 7.75" />
        </svg>
      </NavButton>

      {/* 4. Claude Code — Bridge Terminal */}
      <NavButton
        id="claude"
        label="Claude"
        active={activeView === "claude"}
        onClick={() => onSelect("claude")}
        badge={true}
        badgeColor={claudeConnected ? "green" : "gray"}
      >
        {/* Claude Icon — Terminal/Code */}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <polyline points="4 17 10 11 4 5" />
          <line x1="12" y1="19" x2="20" y2="19" />
        </svg>
      </NavButton>

      {/* 5. Atlas — System HUD, action feed, settings */}
      <div className="mt-auto">
        <NavButton
          id="atlas"
          label="Atlas"
          active={activeView === "atlas"}
          onClick={() => onSelect("atlas")}
          badge={true}
          badgeColor={atlasConnected ? "green" : "gray"}
        >
          {/* Atlas Icon — Robot */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="10" rx="2" />
            <circle cx="12" cy="5" r="2" />
            <path d="M12 7v4" />
            <line x1="8" y1="16" x2="8" y2="16" />
            <line x1="16" y1="16" x2="16" y2="16" />
          </svg>
        </NavButton>
      </div>
    </div>
  )
}

interface NavButtonProps {
  id: string
  label: string
  active: boolean
  onClick: () => void
  children: React.ReactNode
  badge?: boolean
  badgeCount?: number
  badgeColor?: "green" | "gray" | "blue"
}

function NavButton({ id, label, active, onClick, children, badge, badgeCount, badgeColor }: NavButtonProps) {
  return (
    <button
      onClick={onClick}
      className={`group relative p-2 rounded-xl transition-all duration-200 ${
        active
          ? "bg-blue-100 text-blue-600 shadow-sm"
          : "text-gray-400 hover:bg-gray-100 hover:text-gray-600"
      }`}
      title={label}
    >
      {children}
      {active && <div className="absolute left-0 top-1/2 -translate-y-1/2 w-1 h-8 bg-blue-600 rounded-r-full -ml-2" />}
      {badge && (
        <>
          {badgeCount && badgeCount > 0 ? (
            <span className="absolute -top-1 -right-1 min-w-[18px] h-[18px] bg-blue-500 text-white text-[9px] font-bold rounded-full flex items-center justify-center px-1">
              {badgeCount > 99 ? '99+' : badgeCount}
            </span>
          ) : badgeColor === "gray" ? (
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-gray-400 border-2 border-white rounded-full" />
          ) : (
            <span className="absolute top-1 right-1 w-2.5 h-2.5 bg-green-500 border-2 border-white rounded-full">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-green-400 opacity-75"></span>
            </span>
          )}
        </>
      )}
    </button>
  )
}
