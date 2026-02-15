/**
 * DomResolver — Parse domSignature fingerprints and scroll to the
 * corresponding comment in the LinkedIn DOM.
 *
 * A domSignature is a base64-encoded string of:
 *   authorProfileUrl|textFragment|commentIndex
 *
 * This allows us to re-find comments without mutating LinkedIn's DOM
 * with data attributes (which could trigger their CSP or bot detection).
 *
 * Used by FocusView's "Peek" action to scroll the LinkedIn tab to the
 * matching comment and briefly highlight it.
 */

// ─── Signature Generation ───────────────────────────────

export interface SignatureComponents {
  authorUrl: string       // Normalized profile URL
  textFragment: string    // First 80 chars of comment text
  index: number           // 0-based position among visible comments
}

/**
 * Generate a domSignature from its components.
 * Returns a base64 string safe for storage/transport.
 */
export function generateDomSignature(components: SignatureComponents): string {
  const payload = `${components.authorUrl}|${components.textFragment}|${components.index}`
  // btoa() can't handle Unicode — encode to UTF-8 bytes first
  const bytes = new TextEncoder().encode(payload)
  let binary = ""
  for (const b of bytes) binary += String.fromCharCode(b)
  return btoa(binary)
}

/**
 * Parse a domSignature back into its components.
 * Returns null if the signature is invalid.
 */
export function parseDomSignature(signature: string): SignatureComponents | null {
  try {
    const binary = atob(signature)
    // Reverse the UTF-8 encoding from generateDomSignature
    const bytes = Uint8Array.from(binary, (c) => c.charCodeAt(0))
    const decoded = new TextDecoder().decode(bytes)
    const parts = decoded.split("|")
    if (parts.length < 3) return null

    const index = parseInt(parts[parts.length - 1], 10)
    if (isNaN(index)) return null

    // textFragment is second-to-last, authorUrl is everything before
    // (handles URLs with | which shouldn't happen, but defensively)
    const textFragment = parts[parts.length - 2]
    const authorUrl = parts.slice(0, parts.length - 2).join("|")

    return { authorUrl, textFragment, index }
  } catch {
    return null
  }
}

// ─── DOM Resolution ─────────────────────────────────────

/**
 * Find the comment element in the LinkedIn DOM that matches the given signature.
 * Uses a cascading match strategy:
 * 1. Exact match: author URL + text fragment + index
 * 2. Fuzzy match: author URL + text fragment (ignoring index)
 * 3. Index fallback: just the index position
 */
export function resolveCommentElement(signature: string): Element | null {
  const components = parseDomSignature(signature)
  if (!components) return null

  // Get all comment containers
  const containers = document.querySelectorAll(
    "article.comments-comment-entity, .comments-comment-item"
  )
  if (containers.length === 0) return null

  // Strategy 1: Exact match (author URL + text + index)
  if (components.index < containers.length) {
    const candidate = containers[components.index]
    if (matchesAuthorAndText(candidate, components)) {
      return candidate
    }
  }

  // Strategy 2: Fuzzy match (scan all containers for author + text)
  for (const container of containers) {
    if (matchesAuthorAndText(container, components)) {
      return container
    }
  }

  // Strategy 3: Index fallback
  if (components.index < containers.length) {
    return containers[components.index]
  }

  return null
}

/**
 * Check if a container element matches the given author URL and text fragment.
 */
function matchesAuthorAndText(
  container: Element,
  components: SignatureComponents,
): boolean {
  // Check author URL
  const profileLink = container.querySelector("a[href*='/in/']")
  if (profileLink) {
    const href = profileLink.getAttribute("href") ?? ""
    const normalizedHref = normalizeForMatch(href)
    const normalizedTarget = normalizeForMatch(components.authorUrl)
    if (normalizedHref !== normalizedTarget) return false
  }

  // Check text fragment
  const textContent = container.textContent ?? ""
  if (components.textFragment && textContent.includes(components.textFragment)) {
    return true
  }

  return false
}

function normalizeForMatch(url: string): string {
  try {
    const parsed = new URL(url, "https://www.linkedin.com")
    return parsed.pathname.replace(/\/+$/, "").toLowerCase()
  } catch {
    return url.toLowerCase().replace(/\/+$/, "")
  }
}

// ─── Scroll + Highlight ─────────────────────────────────

const HIGHLIGHT_CLASS = "atlas-comment-highlight"
const HIGHLIGHT_DURATION = 2000 // 2 seconds

/**
 * Scroll to a comment identified by its domSignature and briefly highlight it.
 * Returns true if the comment was found, false otherwise.
 */
export function scrollToComment(signature: string): boolean {
  const element = resolveCommentElement(signature)
  if (!element) return false

  // Scroll into view with smooth behavior
  element.scrollIntoView({ behavior: "smooth", block: "center" })

  // Add highlight
  element.classList.add(HIGHLIGHT_CLASS)

  // Inject highlight style if not already present
  if (!document.getElementById("atlas-highlight-style")) {
    const style = document.createElement("style")
    style.id = "atlas-highlight-style"
    style.textContent = `
      .${HIGHLIGHT_CLASS} {
        outline: 2px solid #3b82f6 !important;
        outline-offset: 2px;
        border-radius: 8px;
        transition: outline-color 0.3s ease;
      }
    `
    document.head.appendChild(style)
  }

  // Remove highlight after duration
  setTimeout(() => {
    element.classList.remove(HIGHLIGHT_CLASS)
  }, HIGHLIGHT_DURATION)

  return true
}
