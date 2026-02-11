import { TAB_LOAD_TIMEOUT, READY_POLL_INTERVAL, READY_TIMEOUT } from "~src/lib/constants"

/**
 * Get the existing worker tab or create a new one.
 * Ensures a singleton tab for all automation.
 */
export async function getOrCreateWorkerTab(
  existingTabId: number | null
): Promise<number> {
  if (existingTabId) {
    try {
      const tab = await chrome.tabs.get(existingTabId)
      if (tab?.id) return tab.id
    } catch {
      // Tab was closed or doesn't exist
    }
  }
  const newTab = await chrome.tabs.create({
    url: "https://www.linkedin.com/sales/",
    active: true,
  })
  return newTab.id!
}

/**
 * Wait for a tab to reach "complete" load status.
 * Times out after TAB_LOAD_TIMEOUT ms.
 */
export function waitForTabComplete(tabId: number): Promise<void> {
  return new Promise<void>((resolve) => {
    const listener = (
      tid: number,
      changeInfo: chrome.tabs.TabChangeInfo
    ) => {
      if (tid === tabId && changeInfo.status === "complete") {
        chrome.tabs.onUpdated.removeListener(listener)
        resolve()
      }
    }
    chrome.tabs.onUpdated.addListener(listener)

    // Safety timeout
    setTimeout(() => {
      chrome.tabs.onUpdated.removeListener(listener)
      resolve()
    }, TAB_LOAD_TIMEOUT)
  })
}

/**
 * SPA Hydration Gate (Trap 1 fix).
 *
 * LinkedIn's Ember.js renders buttons 1-3s AFTER the browser fires "complete".
 * This function pings the content script until the profile container is present,
 * confirming the page is actually ready for DOM automation.
 */
export async function waitForContentReady(
  tabId: number,
  timeout = READY_TIMEOUT
): Promise<void> {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const resp = await chrome.tabs.sendMessage(tabId, {
        name: "CHECK_READY",
      })
      if (resp?.ready) return
    } catch {
      // Content script not yet injected — retry
    }
    await new Promise<void>((r) => setTimeout(r, READY_POLL_INTERVAL))
  }
  throw new Error("Content script not ready within timeout")
}
