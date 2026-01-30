import type { Segment, SalesNavList } from "~src/types/leads"

// --- Delay Ranges (ms) ---

/** Delay between actions within a single lead (save → follow) */
export const INTRA_LEAD_DELAY = { min: 1500, max: 3000 }

/** Delay between leads */
export const INTER_LEAD_DELAY = { min: 5000, max: 12000 }

/** Batch cooldown every N leads */
export const BATCH_COOLDOWN = { every: 10, min: 30000, max: 60000 }

/** Wait for page load after navigation */
export const PAGE_LOAD_WAIT = { min: 3000, max: 5000 }

/** Content script readiness poll interval */
export const READY_POLL_INTERVAL = 500

/** Content script readiness timeout */
export const READY_TIMEOUT = 10000

/** Tab load timeout */
export const TAB_LOAD_TIMEOUT = 30000

/** Heartbeat interval (ms) */
export const HEARTBEAT_INTERVAL = 30000

/** Alarms keepalive period (minutes — Chrome minimum is 0.4 = 24s) */
export const ALARM_KEEPALIVE_MINUTES = 0.5

// --- Human Emulation Delays (ms) ---

/** Scroll-to-element settle time */
export const SCROLL_SETTLE = { min: 500, max: 1500 }

/** Focus-before-click pause */
export const FOCUS_PAUSE = { min: 100, max: 300 }

// --- Selectors ---

export const SELECTORS = {
  // Sales Nav selectors
  saveButton: [
    '[data-anchor-save-to-list]',
    '[aria-label="Save to list"]',
    'button[aria-label*="Save"]',
  ],
  // Regular LinkedIn profile: "Save in Sales Navigator" button
  saveInSalesNavButton: [
    'button[aria-label*="Save in Sales Navigator"]',
    'a[aria-label*="Save in Sales Navigator"]',
  ],
  followButton: [
    '[aria-label*="Follow "]',            // "Follow Jim" — space avoids matching "Following"
    'button[aria-label*="Follow "]',
    '.pvs-profile-actions button[aria-label*="Follow"]',
    '.pv-top-card-v2-ctas button[aria-label*="Follow"]',
  ],
  listDropdownOption: [
    'li[role="option"]',
    'label',
    'div[role="option"]',
  ],
  profileContainer: [
    // Regular LinkedIn profiles
    '.pv-top-card',
    '.scaffold-layout__main',
    'section.artdeco-card',
    // Sales Nav profiles
    '.profile-topcard',
    '[data-x--lead-profile]',
    '.artdeco-entity-lockup',
  ],
} as const

// --- Segment → Sales Nav List Mapping ---

export const SEGMENT_TO_LIST: Record<Segment, SalesNavList> = {
  academic: "Academics",
  technical: "Builders",
  enterprise: "Enterprise",
  influencer: "Amplifiers",
}

// --- Utility ---

export function getRandomDelay(min: number, max: number): number {
  return Math.floor(Math.random() * (max - min + 1)) + min
}
