/**
 * CommentExtractor — DOM extraction service for LinkedIn comments.
 *
 * Extracts from post detail pages: commenter name, headline, profile URL,
 * comment text, timestamp. Handles thread nesting (top-level vs reply).
 *
 * Deduplicates by commenter URL + post URL composite key.
 * Returns LinkedInComment[] compatible with existing CommentsState.
 * Prioritizes recent engagements — extracts newest-first from visible DOM.
 *
 * Uses SelectorRegistry for all DOM queries (no hardcoded selectors).
 */

import type { LinkedInComment, CommentAuthor } from "~src/types/comments"
import type { RepairPacket } from "~src/types/selectors"
import {
  SELECTOR_REGISTRY,
  resolveSelector,
  resolveSelectorText,
  resolveSelectorHref,
  resolveSelectorFirst,
  allCanariesPass,
  getEntry,
} from "./selector-registry"
import { generateRepairPacket, formatRepairPacketForLog } from "./selector-diagnostics"
import { extractActivityId } from "./page-observer"
import { generateDomSignature } from "./dom-resolver"
import { getCachedIdentity } from "./identity-cache"
import { classifyContact, type PBLead } from "./classification"

// ─── Types ────────────────────────────────────────────────

export interface ExtractionResult {
  comments: LinkedInComment[]
  postUrl: string
  warnings: string[]
  repairPackets: RepairPacket[]
}

// ─── Deduplication ────────────────────────────────────────

/**
 * Generate a composite dedup key from commenter profile URL + post URL.
 */
function deduplicationKey(profileUrl: string, postUrl: string): string {
  // Normalize: strip trailing slashes, query params
  const normalizeUrl = (url: string) =>
    url.split("?")[0]?.replace(/\/+$/, "") ?? url
  return `${normalizeUrl(profileUrl)}::${normalizeUrl(postUrl)}`
}

// ─── ID Generation ────────────────────────────────────────

let extractionCounter = 0

/**
 * Generate a unique ID for an extracted comment.
 * Format: dom-{activityId}-{counter}
 */
function generateCommentId(postUrl: string): string {
  const activityId = extractActivityId(postUrl) ?? "unknown"
  return `dom-${activityId}-${++extractionCounter}`
}

// ─── Profile URL Normalization ────────────────────────────

/**
 * Normalize a LinkedIn profile URL to canonical form.
 * Input: https://www.linkedin.com/in/john-doe-123abc/
 * Output: https://www.linkedin.com/in/john-doe-123abc
 */
function normalizeProfileUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl, window.location.origin)
    // Keep only the pathname, strip trailing slash
    return `https://www.linkedin.com${url.pathname.replace(/\/+$/, "")}`
  } catch {
    return rawUrl
  }
}

// ─── DOM → PBLead Adapter ────────────────────────────────

/**
 * Convert a LinkedInComment into a PBLead for classification.
 * Only `occupation` (headline) is needed to drive all classification.
 */
export function commentToPBLead(comment: LinkedInComment): PBLead {
  return {
    fullName: comment.author.name,
    occupation: comment.author.headline,
    profileUrl: comment.author.profileUrl,
    comments: comment.content,
    hasCommented: "true",
  }
}

// ─── Single Comment Extraction ────────────────────────────

/**
 * Extract data from a single comment container element.
 */
function extractSingleComment(
  container: Element,
  postUrl: string,
  postTitle: string,
  isReply: boolean,
  commentIndex: number,
): { comment: LinkedInComment; profileUrl: string } | null {
  // Name
  const nameEntry = getEntry("commenter-name")
  const name = resolveSelectorText(nameEntry, container)?.trim()
  if (!name) return null

  // Profile URL
  const profileUrlEntry = getEntry("commenter-profile-url")
  const rawProfileUrl = resolveSelectorHref(profileUrlEntry, container)
  if (!rawProfileUrl) return null
  const profileUrl = normalizeProfileUrl(rawProfileUrl)

  // Headline
  const headlineEntry = getEntry("commenter-headline")
  const headline = resolveSelectorText(headlineEntry, container)?.trim() ?? ""

  // Comment text
  const textEntry = getEntry("comment-text")
  const content = resolveSelectorText(textEntry, container)?.trim()
  if (!content) return null

  // Timestamp
  const timestampEntry = getEntry("comment-timestamp")
  const timestampEl = resolveSelectorFirst(timestampEntry, container)
  const commentedAt = timestampEl?.getAttribute("datetime")
    ?? timestampEl?.textContent?.trim()
    ?? new Date().toISOString()

  // Classify contact from headline + comment text (client-side, zero API calls)
  const classification = classifyContact({
    fullName: name,
    occupation: headline,
    profileUrl,
    comments: content,
    hasCommented: "true",
  })

  const author: CommentAuthor = {
    name,
    headline,
    profileUrl,
    linkedInDegree: "",
    sector: classification.sector,
    groveAlignment: classification.alignment,
    priority: classification.priority,
  }

  // Phase B: generate DOM fingerprint for scroll-to-view
  const textFragment = content.slice(0, 80)
  const domSig = generateDomSignature({
    authorUrl: profileUrl,
    textFragment,
    index: commentIndex,
  })

  const comment: LinkedInComment = {
    id: generateCommentId(postUrl),
    postId: extractActivityId(postUrl) ?? postUrl,
    postTitle,
    author,
    content,
    commentUrl: postUrl,
    commentedAt,
    threadDepth: isReply ? 1 : 0,
    childCount: 0,
    isMe: false,
    domSignature: domSig,
    status: "needs_reply",
    extractedFromDom: true,
  }

  return { comment, profileUrl }
}

// ─── Post Title Extraction ────────────────────────────────

/**
 * Try to extract the post title/first line from the current page.
 */
function extractPostTitle(): string {
  // Try the post content directly
  const postText =
    document.querySelector(".feed-shared-update-v2__description")?.textContent?.trim()
    ?? document.querySelector(".update-components-text")?.textContent?.trim()
    ?? ""

  if (postText) {
    // Take first sentence or first 100 chars
    const firstSentence = postText.split(/[.!?\n]/)[0]?.trim() ?? postText
    return firstSentence.length > 100
      ? firstSentence.slice(0, 100) + "..."
      : firstSentence
  }

  return "LinkedIn Post"
}

// ─── Main Extraction ──────────────────────────────────────

/**
 * Extract all visible comments from the current LinkedIn page.
 *
 * Returns newest-first, deduplicates by commenter URL + post URL.
 */
export async function extractComments(postUrl?: string): Promise<ExtractionResult> {
  const url = postUrl ?? window.location.href
  const warnings: string[] = []
  const repairPackets: RepairPacket[] = []

  // Get cached identity for isMe detection
  const identity = await getCachedIdentity().catch(() => null)
  const myProfileUrl = identity?.profileUrl ?? null

  // Health check: are canary elements present?
  const canaryPassed = allCanariesPass()
  if (!canaryPassed) {
    warnings.push("Page canary check failed — page may not be fully loaded")
  }

  // Find all comment containers
  const containerEntry = getEntry("comment-container")
  const containerMatch = resolveSelector(containerEntry)

  if (!containerMatch || containerMatch.elements.length === 0) {
    // No comments found
    if (canaryPassed) {
      // Page loaded but no comments — could be DOM change
      const packet = generateRepairPacket(containerEntry, url)
      repairPackets.push(packet)
      // Log once (not warn) to avoid console spam
      console.log("[Atlas DOM Extraction] Repair packet generated for:", packet.selectorName)
      warnings.push(
        `Comment extraction found 0 comments. DOM structure may have changed. Repair Packet generated.`,
      )
    } else {
      warnings.push("No comments found and page canary failed — page may still be loading")
    }

    return { comments: [], postUrl: url, warnings, repairPackets }
  }

  const postTitle = extractPostTitle()
  const seen = new Set<string>()
  const comments: LinkedInComment[] = []

  // Check for reply indicator entry
  const replyEntry = SELECTOR_REGISTRY["reply-indicator"]

  // Process containers — DOM order is typically newest-first on LinkedIn
  let commentIndex = 0
  for (const container of containerMatch.elements) {
    // Determine if this is a reply (nested comment)
    let isReply = false
    if (replyEntry) {
      const replyMatch = resolveSelector(replyEntry, container)
      isReply = replyMatch !== null && replyMatch.elements.length > 0
      // Also check parent for reply context
      if (!isReply && container.closest(".comments-reply-item, [class*='reply']")) {
        isReply = true
      }
    }

    const result = extractSingleComment(container, url, postTitle, isReply, commentIndex)
    if (!result) {
      commentIndex++
      continue
    }

    // Dedup
    const key = deduplicationKey(result.profileUrl, url)
    if (seen.has(key)) {
      commentIndex++
      continue
    }
    seen.add(key)

    // Phase B: set isMe if profile URL matches cached identity
    if (myProfileUrl && result.profileUrl === myProfileUrl) {
      result.comment.isMe = true
      result.comment.status = "no_reply_needed"
    }

    comments.push(result.comment)
    commentIndex++
  }

  // Update lastVerified on container entry
  if (comments.length > 0) {
    containerEntry.lastVerified = new Date().toISOString()
  }

  // Generate repair packets for sub-selectors that failed on every container
  if (containerMatch.elements.length > 0 && comments.length === 0) {
    // Had containers but couldn't extract any complete comments
    const failedSelectors: string[] = []
    for (const entryName of ["commenter-name", "comment-text", "commenter-profile-url"]) {
      const entry = SELECTOR_REGISTRY[entryName]
      if (entry) {
        const packet = generateRepairPacket(entry, url)
        repairPackets.push(packet)
        failedSelectors.push(entryName)
      }
    }
    // Single log line instead of one per selector
    console.log("[Atlas DOM Extraction] Sub-selectors need updating:", failedSelectors.join(", "))

    // Diagnostic: dump first container's DOM structure for selector repair
    const firstContainer = containerMatch.elements[0]
    if (firstContainer) {
      console.group("[Atlas DOM Diagnostic] First comment container structure")
      console.log("Tag:", firstContainer.tagName, "Classes:", firstContainer.className)
      // Log all anchors (potential profile links)
      const anchors = firstContainer.querySelectorAll("a[href*='/in/']")
      console.log("Profile anchors found:", anchors.length)
      anchors.forEach((a, i) => console.log(`  a[${i}]:`, a.className, a.getAttribute("href"), `text="${a.textContent?.trim().slice(0, 50)}"`))
      // Log all spans with text > 10 chars
      const spans = firstContainer.querySelectorAll("span")
      const textSpans = Array.from(spans).filter(s => (s.textContent?.trim().length ?? 0) > 10)
      console.log("Text spans (>10 chars):", textSpans.length)
      textSpans.slice(0, 8).forEach((s, i) => console.log(`  span[${i}]:`, s.className, `text="${s.textContent?.trim().slice(0, 80)}"`))
      // Log the outer HTML structure (truncated)
      console.log("Container outerHTML (first 2000 chars):", firstContainer.outerHTML.slice(0, 2000))
      console.groupEnd()
    }

    warnings.push(
      `Found ${containerMatch.elements.length} comment containers but could not extract complete data. Sub-selectors may need updating.`,
    )
  }

  return { comments, postUrl: url, warnings, repairPackets }
}
