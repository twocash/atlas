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
import { ensureIdentityCached } from "~src/lib/identity-cache"
import { scrollToComment } from "~src/lib/dom-resolver"

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

    // SCROLL_TO_COMMENT: sidepanel requests scroll to a specific comment
    if (message.type === "SCROLL_TO_COMMENT") {
      const signature = (message as any).domSignature as string
      const found = scrollToComment(signature)
      sendResponse({
        type: "SCROLL_RESULT",
        found,
      })
      return false // Synchronous response
    }

    // CACHE_IDENTITY: sidepanel requests identity extraction
    if (message.type === "CACHE_IDENTITY") {
      ensureIdentityCached().then((profileUrl) => {
        sendResponse({
          type: "IDENTITY_RESULT",
          profileUrl,
          cached: profileUrl !== null,
        })
      })
      return true // Async response
    }

    // EXTRACT_COMMENTS: user clicked the button in sidepanel
    if (message.type === "EXTRACT_COMMENTS") {
      const postUrl = message.postUrl ?? window.location.href
      extractComments(postUrl).then((result) => {
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
      }).catch((err) => {
        const errorMessage = err instanceof Error ? err.message : "Unknown extraction error"
        console.log("[Atlas Feed] Extraction failed:", errorMessage)
        sendResponse({
          type: "EXTRACTION_ERROR",
          error: errorMessage,
        })
      })
      return true // Async response
    }

    return false
  },
)
