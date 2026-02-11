import { SELECTORS } from "~src/lib/constants"
import { executeSaveAndFollow } from "~src/lib/linkedin-actions"
import type { Segment } from "~src/types/leads"

console.log("Atlas: LinkedIn content script loaded on", window.location.pathname)

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  // CHECK_READY: orchestrator polls this to confirm page has rendered
  if (message.name === "CHECK_READY" || message.type === "CHECK_READY") {
    const ready = SELECTORS.profileContainer.some(
      (sel) => document.querySelector(sel) !== null
    )
    sendResponse({ ready })
    return true
  }

  // EXECUTE_ACTION: perform Save and Follow
  if (message.name === "EXECUTE_ACTION") {
    const segment: Segment = message.body?.segment || "technical"

    executeSaveAndFollow(segment)
      .then((result) => sendResponse(result))
      .catch((err) =>
        sendResponse({
          success: false,
          savedToList: false,
          followed: false,
          error: err.message || "Content script error",
          errorType: "UNKNOWN",
          logs: [],
        })
      )

    return true // Keep message channel open for async response
  }

  return false
})
