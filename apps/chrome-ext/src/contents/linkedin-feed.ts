/**
 * Content script for LinkedIn feed and post detail pages.
 *
 * SAFETY-FIRST: This script does NOTHING on load. Zero DOM queries,
 * zero observers, zero polling, zero logging. It only registers a
 * passive message listener that Chrome manages internally.
 *
 * DOM interaction happens ONLY when the user explicitly clicks
 * "Extract Comments" in the sidepanel.
 */

import type { PlasmoCSConfig } from "plasmo"

// ─── Plasmo Config ────────────────────────────────────────

export const config: PlasmoCSConfig = {
  matches: [
    "https://www.linkedin.com/feed/*",
    "https://www.linkedin.com/posts/*",
  ],
  run_at: "document_idle",
}

// ─── Message Handling (passive — only fires on explicit user action) ───

chrome.runtime.onMessage.addListener(
  (message: { type: string; postUrl?: string }, _sender, sendResponse) => {
    // CHECK_POST_READY: sidepanel asks if we're on a usable page
    if (message.type === "CHECK_POST_READY") {
      // Lazy-import to avoid running any code on load
      import("~src/lib/page-observer").then(({ isPostPage }) => {
        import("~src/lib/selector-registry").then(({ allCanariesPass }) => {
          import("~src/lib/page-observer").then(({ commentsVisible }) => {
            const onPostPage = isPostPage(window.location.href)
            const ready = onPostPage && (allCanariesPass() || commentsVisible())
            sendResponse({
              type: "POST_READY",
              ready,
              postUrl: window.location.href,
            })
          })
        })
      })
      return true // Keep channel open for async response
    }

    // EXTRACT_COMMENTS: user clicked the button in sidepanel
    if (message.type === "EXTRACT_COMMENTS") {
      import("~src/lib/comment-extractor").then(({ extractComments }) => {
        try {
          const postUrl = message.postUrl ?? window.location.href
          const result = extractComments(postUrl)

          if (result.warnings.length > 0) {
            console.log("[Atlas Feed] Extraction warnings:", result.warnings.join("; "))
          }

          console.log(`[Atlas Feed] Extracted ${result.comments.length} comments`)
          sendResponse({
            type: "EXTRACTION_RESULT",
            comments: result.comments,
            postUrl: result.postUrl,
            warnings: result.warnings,
            extractedCount: result.comments.length,
          })
        } catch (err) {
          const errorMessage = err instanceof Error ? err.message : "Unknown extraction error"
          console.log("[Atlas Feed] Extraction failed:", errorMessage)
          sendResponse({
            type: "EXTRACTION_ERROR",
            error: errorMessage,
          })
        }
      })
      return true // Keep channel open for async response
    }

    return false
  },
)
