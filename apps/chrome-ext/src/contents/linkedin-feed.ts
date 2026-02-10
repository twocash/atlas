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
import { PageObserver, isPostPage } from "~src/lib/page-observer"
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

function warn(...args: unknown[]): void {
  console.warn(LOG_PREFIX, ...args)
}

// ─── Page Observer Setup ──────────────────────────────────

const observer = new PageObserver((event, url) => {
  switch (event) {
    case "post-detected":
      log("Post detected:", url)
      break
    case "comments-visible":
      log("Comments section visible on:", url)
      break
    case "page-changed":
      log("Page navigated to:", url)
      break
  }
})

// Start observing immediately
observer.start()
log("Content script loaded on", window.location.pathname)

// ─── Message Handling ─────────────────────────────────────

chrome.runtime.onMessage.addListener(
  (
    message: ExtractCommentsMessage | CheckPostReadyMessage | { type: string },
    _sender,
    sendResponse,
  ) => {
    // CHECK_POST_READY: sidepanel asks if we're on a post page with comments
    if (message.type === "CHECK_POST_READY") {
      const ready = isPostPage(window.location.href) && allCanariesPass()
      const response: PostReadyMessage = {
        type: "POST_READY",
        ready,
        postUrl: window.location.href,
      }
      sendResponse(response)
      return true
    }

    // EXTRACT_COMMENTS: sidepanel triggers comment extraction
    if (message.type === "EXTRACT_COMMENTS") {
      try {
        const postUrl = (message as ExtractCommentsMessage).postUrl ?? window.location.href
        log("Extracting comments from:", postUrl)

        const result = extractComments(postUrl)

        if (result.warnings.length > 0) {
          for (const w of result.warnings) {
            warn(w)
          }
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
        warn("Extraction failed:", errorMessage)

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
  observer.stop()
})
