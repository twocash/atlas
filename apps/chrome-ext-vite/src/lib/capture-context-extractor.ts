/**
 * Capture Context Extractor — Gate 1.8
 *
 * Extracts page context from the active tab for capture routing:
 * URL, domain, title, selected text, meta tags.
 *
 * Two modes:
 * 1. Basic: from chrome.contextMenus.OnClickData + tab (always available)
 * 2. Rich: via content script message for meta/OG tags (best-effort)
 */

import type { CaptureContext } from "~src/types/capture"

// ─── Domain Extraction ──────────────────────────────────

/**
 * Extract the domain from a URL string.
 * Strips protocol, www prefix, port, and path.
 */
export function extractDomain(url: string): string {
  try {
    const parsed = new URL(url)
    return parsed.hostname.replace(/^www\./, "")
  } catch {
    // Fallback: strip protocol and path manually
    return url.replace(/^https?:\/\//, "").replace(/^www\./, "").split("/")[0].split(":")[0]
  }
}

// ─── Basic Context (from menu click data) ───────────────

/**
 * Build CaptureContext from chrome.contextMenus.OnClickData + tab info.
 * Always available, no content script needed.
 */
export function extractBasicContext(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): CaptureContext {
  const url = info.linkUrl || info.pageUrl || tab?.url || ""
  const title = tab?.title || url

  return {
    url,
    domain: extractDomain(url),
    title,
    selectedText: info.selectionText || undefined,
  }
}

// ─── Rich Context (with meta extraction) ────────────────

/** Response shape from content script meta extraction */
interface MetaExtractionResponse {
  metaDescription?: string
  ogTitle?: string
  canonicalUrl?: string
}

/**
 * Request meta tag extraction from the active tab's content script.
 * Returns extracted meta or empty object if content script unavailable.
 */
async function requestMetaExtraction(tabId: number): Promise<MetaExtractionResponse> {
  try {
    const response = await chrome.tabs.sendMessage(tabId, {
      name: "EXTRACT_PAGE_META",
    })
    return response ?? {}
  } catch {
    // Content script not injected or tab not accessible
    console.log("[Capture] Meta extraction unavailable for tab", tabId)
    return {}
  }
}

/**
 * Build enriched CaptureContext with meta tags from content script.
 * Falls back to basic context if content script is unavailable.
 */
export async function extractRichContext(
  info: chrome.contextMenus.OnClickData,
  tab: chrome.tabs.Tab | undefined,
): Promise<CaptureContext> {
  const basic = extractBasicContext(info, tab)

  // Try to enrich with meta tags if we have a tab
  if (tab?.id) {
    const meta = await requestMetaExtraction(tab.id)
    return {
      ...basic,
      metaDescription: meta.metaDescription,
      ogTitle: meta.ogTitle,
      canonicalUrl: meta.canonicalUrl,
    }
  }

  return basic
}
