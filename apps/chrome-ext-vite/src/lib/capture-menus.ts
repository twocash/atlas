/**
 * Atlas Chrome Extension - Simplified Capture Menus (Gate 1.8)
 *
 * Two menu items replace the 24+ hierarchical items:
 * 1. "Capture with Atlas" — domain-based auto-routing
 * 2. "Quick Capture" — bypass classification, personal pillar
 *
 * Pillar/action/voice selection is now handled automatically by
 * capture-router.ts based on URL domain patterns.
 */

// ─── Menu IDs ───────────────────────────────────────────

export const MENU_IDS = {
  ROOT: "atlas-root",
  CAPTURE: "atlas-capture",
  QUICK: "atlas-quick",
  SEPARATOR: "atlas-separator",
} as const

export type CaptureMenuId = typeof MENU_IDS[keyof typeof MENU_IDS]

// ─── Menu Creation ──────────────────────────────────────

/**
 * Create simplified capture menus on install/update.
 *
 * Structure:
 * Send to Atlas (Root)
 * ├── Capture with Atlas   ← domain-based auto-routing
 * ├── ─────────────
 * └── Quick Capture        ← bypass, personal pillar
 */
export function createCaptureMenus(): void {
  chrome.contextMenus.removeAll(() => {
    // Root menu
    chrome.contextMenus.create({
      id: MENU_IDS.ROOT,
      title: "Send to Atlas",
      contexts: ["page", "selection", "link"],
    })

    // Primary: Capture with Atlas (auto-routes via domain)
    chrome.contextMenus.create({
      id: MENU_IDS.CAPTURE,
      parentId: MENU_IDS.ROOT,
      title: "Capture with Atlas",
      contexts: ["page", "selection", "link"],
    })

    chrome.contextMenus.create({
      id: MENU_IDS.SEPARATOR,
      parentId: MENU_IDS.ROOT,
      type: "separator",
      contexts: ["page", "selection", "link"],
    })

    // Fallback: Quick Capture (no classification)
    chrome.contextMenus.create({
      id: MENU_IDS.QUICK,
      parentId: MENU_IDS.ROOT,
      title: "Quick Capture",
      contexts: ["page", "selection", "link"],
    })

    console.log("Atlas: Simplified capture menus created (Gate 1.8)")
  })
}
