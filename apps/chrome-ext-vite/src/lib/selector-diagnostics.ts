/**
 * SelectorDiagnostics — Repair Packet generation when selectors fail.
 *
 * When extraction finds 0 results but the page appears loaded (canary passes),
 * this module captures structured diagnostic data that can be fed to Claude
 * for rapid selector updates.
 *
 * A Repair Packet includes:
 *   - outerHTML of the container where elements should be
 *   - All visible class names / data-* / ARIA attributes
 *   - What was expected vs. what was found
 */

import type { RepairPacket, SelectorEntry } from "~src/types/selectors"

// ─── Class / Attribute Inventory ──────────────────────────

/**
 * Collect all unique class names from an element and its descendants.
 */
function collectClasses(root: Element, maxDepth: number = 5): string[] {
  const classes = new Set<string>()

  function walk(el: Element, depth: number): void {
    if (depth > maxDepth) return
    for (const cls of el.classList) {
      classes.add(cls)
    }
    for (const child of el.children) {
      walk(child, depth + 1)
    }
  }

  walk(root, 0)
  return Array.from(classes).sort()
}

/**
 * Collect all data-* attributes from an element and its descendants.
 */
function collectDataAttributes(root: Element, maxDepth: number = 5): string[] {
  const attrs = new Set<string>()

  function walk(el: Element, depth: number): void {
    if (depth > maxDepth) return
    for (const attr of el.attributes) {
      if (attr.name.startsWith("data-")) {
        attrs.add(`${attr.name}="${attr.value}"`)
      }
    }
    for (const child of el.children) {
      walk(child, depth + 1)
    }
  }

  walk(root, 0)
  return Array.from(attrs).sort()
}

/**
 * Collect all ARIA roles and labels from an element and its descendants.
 */
function collectAriaAttributes(root: Element, maxDepth: number = 5): string[] {
  const attrs = new Set<string>()

  function walk(el: Element, depth: number): void {
    if (depth > maxDepth) return
    const role = el.getAttribute("role")
    if (role) attrs.add(`role="${role}"`)
    const label = el.getAttribute("aria-label")
    if (label) attrs.add(`aria-label="${label}"`)
    const labelledBy = el.getAttribute("aria-labelledby")
    if (labelledBy) attrs.add(`aria-labelledby="${labelledBy}"`)
    for (const child of el.children) {
      walk(child, depth + 1)
    }
  }

  walk(root, 0)
  return Array.from(attrs).sort()
}

// ─── Repair Packet Generation ─────────────────────────────

/** Max outerHTML size to include in repair packet (chars) */
const MAX_HTML_SIZE = 10_000

/**
 * Find the best container element to capture for diagnostics.
 * Looks for the comments section or falls back to main content area.
 */
function findDiagnosticContainer(): Element | null {
  // Try comments section first
  const commentsSection =
    document.querySelector(".comments-comments-list") ??
    document.querySelector("[data-finite-scroll-hotkey-context='COMMENTS']") ??
    document.querySelector("section[class*='comments']")

  if (commentsSection) return commentsSection

  // Fall back to main content
  return (
    document.querySelector("main") ??
    document.querySelector(".scaffold-layout__main") ??
    document.querySelector("#main")
  )
}

/**
 * Generate a Repair Packet for a failed selector entry.
 *
 * Call this when extraction returns 0 results but canaries indicate
 * the page loaded correctly — the DOM structure likely changed.
 */
export function generateRepairPacket(
  entry: SelectorEntry,
  pageUrl?: string,
): RepairPacket {
  const container = findDiagnosticContainer()

  let containerHtml = "<no container found>"
  if (container) {
    const raw = container.outerHTML
    containerHtml = raw.length > MAX_HTML_SIZE
      ? raw.slice(0, MAX_HTML_SIZE) + `\n<!-- ... truncated at ${MAX_HTML_SIZE} chars -->`
      : raw
  }

  return {
    selectorName: entry.name,
    failedAt: new Date().toISOString(),
    pageUrl: pageUrl ?? window.location.href,
    containerHtml,
    visibleClasses: container ? collectClasses(container) : [],
    dataAttributes: container ? collectDataAttributes(container) : [],
    ariaAttributes: container ? collectAriaAttributes(container) : [],
    expectedDescription: describeExpectation(entry),
  }
}

/**
 * Build a human-readable description of what a selector entry expects.
 */
function describeExpectation(entry: SelectorEntry): string {
  const layerDescs = entry.layers
    .map((l) => `  ${l.type}: ${l.description}`)
    .join("\n")
  return `Expected to find "${entry.name}" using:\n${layerDescs}`
}

/**
 * Format a Repair Packet as a compact string for logging.
 */
export function formatRepairPacketForLog(packet: RepairPacket): string {
  return [
    `[Repair Packet] ${packet.selectorName}`,
    `  Failed at: ${packet.failedAt}`,
    `  Page: ${packet.pageUrl}`,
    `  Expected: ${packet.expectedDescription}`,
    `  Classes found (${packet.visibleClasses.length}): ${packet.visibleClasses.slice(0, 20).join(", ")}${packet.visibleClasses.length > 20 ? "..." : ""}`,
    `  Data attrs (${packet.dataAttributes.length}): ${packet.dataAttributes.slice(0, 10).join(", ")}${packet.dataAttributes.length > 10 ? "..." : ""}`,
    `  ARIA attrs (${packet.ariaAttributes.length}): ${packet.ariaAttributes.slice(0, 10).join(", ")}${packet.ariaAttributes.length > 10 ? "..." : ""}`,
    `  Container HTML length: ${packet.containerHtml.length} chars`,
  ].join("\n")
}
