import React from "react"

export type ViewId = "inbox" | "outreach" | "studio" | "data" | "atlas" | "settings"

interface NavRailProps {
  activeView: ViewId
  onSelect: (view: ViewId) => void
  hasActiveTask: boolean
  inboxCount?: number
}

export function NavRail({ activeView, onSelect, hasActiveTask, inboxCount = 3 }: NavRailProps) {
  return (
    <div className="w-14 flex flex-col items-center py-4 bg-gray-50 border-r border-gray-200 gap-6 flex-shrink-0">

      {/* 1. Inbox (Top Priority) */}
      <NavButton
        id="inbox"
        label="Inbox"
        active={activeView === "inbox"}
        onClick={() => onSelect("inbox")}
        badge={inboxCount > 0}
        badgeCount={inboxCount}
      >
        {/* Inbox Icon - Lucide Tray */}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <path d="M3 15h6l3 3 3-3h6" />
        </svg>
      </NavButton>

      {/* 2. Outreach (The "Work" Mode) */}
      <NavButton
        id="outreach"
        label="Outreach"
        active={activeView === "outreach"}
        onClick={() => onSelect("outreach")}
        badge={hasActiveTask} // Green pulsing dot if scraper is running
      >
        {/* Outreach Icon - Lucide Paper Plane (Send) */}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="m3 3 3 9-3 9 19-9Z" />
          <path d="M6 12h16" />
        </svg>
      </NavButton>

{/* 3. Studio (The "Creative" Mode) */}
      <NavButton
        id="studio"
        label="Studio"
        active={activeView === "studio"}
        onClick={() => onSelect("studio")}
      >
        {/* Studio Icon - Lucide Sparkles */}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z" />
          <path d="M5 3v4M3 5h4M19 17v4M17 19h4" />
        </svg>
      </NavButton>

      {/* 4. Data (Passive Tasks) */}
      <NavButton
        id="data"
        label="Data"
        active={activeView === "data"}
        onClick={() => onSelect("data")}
      >
        {/* Data Icon - Lucide Database */}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <ellipse cx="12" cy="5" rx="9" ry="3" />
          <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
          <path d="M3 12c0 1.66 4 3 9 3s9-1.34 9-3" />
        </svg>
      </NavButton>

      {/* 5. Atlas (Browser Automation HUD) */}
      <NavButton
        id="atlas"
        label="Atlas"
        active={activeView === "atlas"}
        onClick={() => onSelect("atlas")}
      >
        {/* Atlas Icon - Robot */}
        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="11" width="18" height="10" rx="2" />
          <circle cx="12" cy="5" r="2" />
          <path d="M12 7v4" />
          <line x1="8" y1="16" x2="8" y2="16" />
          <line x1="16" y1="16" x2="16" y2="16" />
        </svg>
      </NavButton>

      {/* 6. Settings (Bottom Config) */}
      <div className="mt-auto">
        <NavButton
          id="settings"
          label="Settings"
          active={activeView === "settings"}
          onClick={() => onSelect("settings")}
        >
          {/* Settings Icon - Lucide Settings (Gear) */}
          <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
            <path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z" />
            <circle cx="12" cy="12" r="3" />
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
}

function NavButton({ id, label, active, onClick, children, badge, badgeCount }: NavButtonProps) {
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
