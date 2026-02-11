/**
 * Content script for LinkedIn feed and post detail pages.
 *
 * SAFETY-FIRST: This script does NOTHING on load. It only registers a
 * passive message listener that Chrome manages internally.
 *
 * DOM interaction happens ONLY when the user explicitly clicks
 * "Extract Comments" in the sidepanel.
 *
 * All imports are STATIC (bundled inline) to avoid Parcel creating
 * <script> tags in LinkedIn's DOM, which triggers CSP violations
 * and chrome-extension://invalid/ errors.
 */

import { isPostPage, commentsVisible } from "~src/lib/page-observer"
import { allCanariesPass } from "~src/lib/selector-registry"
import { extractComments } from "~src/lib/comment-extractor"

console.log("[Atlas Feed CS] Content script loaded on:", window.location.href)

// ─── Message Handling (passive — only fires on explicit user action) ───

chrome.runtime.onMessage.addListener(
  (message: { type: string; postUrl?: string }, _sender, sendResponse) => {
    // CHECK_POST_READY: sidepanel asks if we're on a usable page
    if (message.type === "CHECK_POST_READY") {
      const onPostPage = isPostPage(window.location.href)
      const ready = onPostPage && (allCanariesPass() || commentsVisible())
      sendResponse({
        type: "POST_READY",
        ready,
        postUrl: window.location.href,
      })
      return false // Synchronous response, no need to keep channel open
    }

    // EXTRACT_COMMENTS: user clicked the button in sidepanel
    if (message.type === "EXTRACT_COMMENTS") {
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
      return false // Synchronous response
    }

    return false
  },
)
