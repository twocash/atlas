/**
 * Content script for LinkedIn feed and post detail pages.
 *
 * Plasmo CSConfig matches:
 *   - https://www.linkedin.com/feed/*
 *   - https://www.linkedin.com/posts/*
 *   - https://www.linkedin.com/feed/update/*
 *   - https://www.linkedin.com/pulse/*
 *
 * Coexists with the existing linkedin.ts content script (Sales Nav + profiles).
 * This script handles comment extraction and page observation for the
 * engagement intelligence pipeline.
 */

import type { PlasmoCSConfig } from "plasmo"
import { PageObserver, isPostPage, commentsVisible } from "~src/lib/page-observer"
import { extractComments } from "~src/lib/comment-extractor"
import { allCanariesPass } from "~src/lib/selector-registry"
import type {
  ExtractCommentsMessage,
  CheckPostReadyMessage,
  ExtractionResultMessage,
  PostReadyMessage,
  ExtractionErrorMessage,
} from "~src/types/selectors"

// ─── Plasmo Config ────────────────────────────────────────

export const config: PlasmoCSConfig = {
  matches: [
    "https://www.linkedin.com/feed/*",
    "https://www.linkedin.com/posts/*",
  ],
  run_at: "document_idle",
}

// ─── Logging ──────────────────────────────────────────────

const LOG_PREFIX = "[Atlas Feed]"

function log(...args: unknown[]): void {
  console.log(LOG_PREFIX, ...args)
}

// ─── Page Observer Setup ──────────────────────────────────
// SAFETY: Observer is passive — only detects URL changes via browser events.
// NO MutationObserver, NO aggressive DOM polling.
// DOM queries happen ONLY when user explicitly clicks "Extract Comments".

let observer: PageObserver | null = null

function ensureObserver(): PageObserver {
  if (!observer) {
    observer = new PageObserver((event, url) => {
      if (event === "post-detected") {
        log("Post detected:", url)
      }
    })
    observer.start()
  }
  return observer
}

// Start lightweight observer (URL-change only, no DOM queries)
ensureObserver()
log("Content script loaded on", window.location.pathname)

// ─── Message Handling ─────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: ExtractCommentsMessage | CheckPostReadyMessage | { type: string },
    _sender,
    sendResponse,
  ) => {
    // CHECK_POST_READY: sidepanel asks if we're on a post page with comments
    // This is an on-demand check — only runs when sidepanel asks
    if (message.type === "CHECK_POST_READY") {
      const onPostPage = isPostPage(window.location.href)
      // Only query DOM if we're on a post page
      const ready = onPostPage && (allCanariesPass() || commentsVisible())
      const response: PostReadyMessage = {
        type: "POST_READY",
        ready,
        postUrl: window.location.href,
      }
      sendResponse(response)
      return true
    }

    // EXTRACT_COMMENTS: sidepanel triggers comment extraction (user-initiated only)
    if (message.type === "EXTRACT_COMMENTS") {
      try {
        const postUrl = (message as ExtractCommentsMessage).postUrl ?? window.location.href
        log("Extracting comments from:", postUrl)

        const result = extractComments(postUrl)

        // Log warnings once, not in a loop
        if (result.warnings.length > 0) {
          log("Extraction warnings:", result.warnings.join("; "))
        }

        const response: ExtractionResultMessage = {
          type: "EXTRACTION_RESULT",
          comments: result.comments,
          postUrl: result.postUrl,
          warnings: result.warnings,
          extractedCount: result.comments.length,
        }

        log(`Extracted ${result.comments.length} comments`)
        sendResponse(response)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "Unknown extraction error"
        log("Extraction failed:", errorMessage)

        const response: ExtractionErrorMessage = {
          type: "EXTRACTION_ERROR",
          error: errorMessage,
        }
        sendResponse(response)
      }
      return true
    }

    return false
  },
)

// ─── Cleanup on unload ────────────────────────────────────

window.addEventListener("unload", () => {
  observer?.stop()
})
