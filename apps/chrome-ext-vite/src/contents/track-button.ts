/**
 * Track Button Injection — Floating pill overlay on LinkedIn post containers.
 *
 * Behavior:
 * - Default: opacity-0 (invisible)
 * - Hover over post: opacity-100, slides in from right
 * - Click: toggles tracking state, pulses blue when tracked
 * - Communicates with sidepanel via chrome.runtime messages
 *
 * Injected via INJECT_TRACK_BUTTON message from sidepanel or
 * automatically on feed pages.
 */

import { isTracked, trackPost, untrackPost } from "~src/lib/tracked-posts-store"
import { extractActivityId, normalizePostUrl } from "~src/types/posts"

const BUTTON_CLASS = "atlas-track-button"
const TRACKED_CLASS = "atlas-tracked"

// ─── Style Injection ────────────────────────────────────

let styleInjected = false

function injectStyles() {
  if (styleInjected) return
  const style = document.createElement("style")
  style.id = "atlas-track-button-styles"
  style.textContent = `
    .${BUTTON_CLASS} {
      position: absolute;
      top: 8px;
      right: 8px;
      z-index: 100;
      display: flex;
      align-items: center;
      gap: 4px;
      padding: 4px 10px;
      border-radius: 16px;
      border: 1px solid rgba(59, 130, 246, 0.3);
      background: rgba(255, 255, 255, 0.95);
      backdrop-filter: blur(4px);
      color: #6b7280;
      font-size: 11px;
      font-weight: 500;
      cursor: pointer;
      opacity: 0;
      transform: translateX(8px);
      transition: opacity 0.2s ease, transform 0.2s ease, background-color 0.2s ease;
      pointer-events: none;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    }

    /* Show on parent hover */
    .feed-shared-update-v2:hover .${BUTTON_CLASS},
    div[data-urn]:hover .${BUTTON_CLASS} {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
    }

    /* Always show when tracked */
    .${BUTTON_CLASS}.${TRACKED_CLASS} {
      opacity: 1;
      transform: translateX(0);
      pointer-events: auto;
      background: rgba(59, 130, 246, 0.1);
      border-color: rgba(59, 130, 246, 0.5);
      color: #3b82f6;
    }

    .${BUTTON_CLASS}.${TRACKED_CLASS} .atlas-track-dot {
      animation: atlas-pulse 2s ease-in-out infinite;
    }

    .${BUTTON_CLASS}:hover {
      background: rgba(59, 130, 246, 0.1);
      border-color: rgba(59, 130, 246, 0.5);
      color: #3b82f6;
    }

    .atlas-track-dot {
      width: 6px;
      height: 6px;
      border-radius: 50%;
      background: currentColor;
    }

    @keyframes atlas-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.4; }
    }
  `
  document.head.appendChild(style)
  styleInjected = true
}

// ─── Button Creation ────────────────────────────────────

function createTrackButton(container: Element, postUrl: string): HTMLButtonElement {
  const btn = document.createElement("button")
  btn.className = BUTTON_CLASS
  btn.innerHTML = `<span class="atlas-track-dot"></span><span class="atlas-track-label">Track</span>`

  // Ensure parent has relative positioning for absolute button
  const computedStyle = window.getComputedStyle(container)
  if (computedStyle.position === "static") {
    ;(container as HTMLElement).style.position = "relative"
  }

  btn.addEventListener("click", async (e) => {
    e.stopPropagation()
    e.preventDefault()

    const activityId = extractActivityId(postUrl)
    if (!activityId) return

    const tracked = btn.classList.contains(TRACKED_CLASS)
    if (tracked) {
      await untrackPost(activityId)
      btn.classList.remove(TRACKED_CLASS)
      btn.querySelector(".atlas-track-label")!.textContent = "Track"
    } else {
      // Extract post title from the container
      const titleEl = container.querySelector(
        ".feed-shared-update-v2__description, .update-components-text"
      )
      const title = titleEl?.textContent?.trim().slice(0, 100) ?? "LinkedIn Post"
      await trackPost(postUrl, title)
      btn.classList.add(TRACKED_CLASS)
      btn.querySelector(".atlas-track-label")!.textContent = "Tracking"
    }
  })

  return btn
}

// ─── Injection ──────────────────────────────────────────

async function injectTrackButtons() {
  injectStyles()

  const containers = document.querySelectorAll(
    ".feed-shared-update-v2, div[data-urn^='urn:li:activity']"
  )

  for (const container of containers) {
    // Skip if already has a button
    if (container.querySelector(`.${BUTTON_CLASS}`)) continue

    // Extract post URL from the container
    const urn = container.getAttribute("data-urn")
    let postUrl = ""

    if (urn) {
      const activityId = urn.replace("urn:li:activity:", "")
      postUrl = `https://www.linkedin.com/feed/update/urn:li:activity:${activityId}`
    } else {
      // Try to find a permalink in the container
      const permalink = container.querySelector<HTMLAnchorElement>(
        "a[href*='/feed/update/'], a[href*='/posts/']"
      )
      if (permalink) {
        postUrl = normalizePostUrl(permalink.href)
      }
    }

    if (!postUrl) continue

    const btn = createTrackButton(container, postUrl)

    // Check if already tracked
    const alreadyTracked = await isTracked(postUrl)
    if (alreadyTracked) {
      btn.classList.add(TRACKED_CLASS)
      btn.querySelector(".atlas-track-label")!.textContent = "Tracking"
    }

    container.appendChild(btn)
  }
}

// ─── Message Handler ────────────────────────────────────

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message.type === "INJECT_TRACK_BUTTONS") {
    injectTrackButtons().then(() => {
      const count = document.querySelectorAll(`.${BUTTON_CLASS}`).length
      sendResponse({ type: "TRACK_BUTTONS_INJECTED", count })
    })
    return true // Async response
  }
  return false
})
