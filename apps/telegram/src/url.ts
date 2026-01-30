/**
 * Atlas Telegram Bot - URL Extraction & Fetching
 * 
 * Extracts URLs from messages and fetches content for classification.
 * 
 * @see IMPLEMENTATION.md Sprint 2.1-2.2 for requirements
 */

import type { UrlContent } from "./types";
import { logger } from "./logger";

// URL regex pattern
const URL_PATTERN = /https?:\/\/[^\s<>"{}|\\^`[\]]+/gi;

// Fetch timeout in milliseconds
const FETCH_TIMEOUT = 10000;

/**
 * Extract all URLs from a message
 */
export function extractUrls(text: string): string[] {
  const matches = text.match(URL_PATTERN);
  return matches || [];
}

/**
 * Extract the first URL from a message
 */
export function extractFirstUrl(text: string): string | null {
  const urls = extractUrls(text);
  return urls.length > 0 ? urls[0] : null;
}

/**
 * Fetch URL content for classification
 * 
 * Returns title, description, and body snippet.
 */
export async function fetchUrlContent(url: string): Promise<UrlContent> {
  logger.debug("Fetching URL content", { url });

  try {
    // Create abort controller for timeout
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT);

    const response = await fetch(url, {
      signal: controller.signal,
      headers: {
        "User-Agent": "Atlas-Bot/1.0 (Content Classification)",
        "Accept": "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      },
    });

    clearTimeout(timeout);

    if (!response.ok) {
      return {
        url,
        title: "",
        description: "",
        bodySnippet: "",
        fetchedAt: new Date(),
        success: false,
        error: `HTTP ${response.status}: ${response.statusText}`,
      };
    }

    const html = await response.text();

    // Extract metadata
    const title = extractTitle(html);
    const description = extractDescription(html);
    const bodySnippet = extractBodySnippet(html);

    logger.debug("URL content fetched", { url, title });

    return {
      url,
      title,
      description,
      bodySnippet,
      fetchedAt: new Date(),
      success: true,
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    logger.error("Failed to fetch URL", { url, error: errorMessage });

    return {
      url,
      title: "",
      description: "",
      bodySnippet: "",
      fetchedAt: new Date(),
      success: false,
      error: errorMessage,
    };
  }
}

/**
 * Extract title from HTML
 */
function extractTitle(html: string): string {
  // Try <title> tag
  const titleMatch = html.match(/<title[^>]*>([^<]+)<\/title>/i);
  if (titleMatch) {
    return titleMatch[1].trim();
  }

  // Try og:title
  const ogTitleMatch = html.match(/<meta[^>]*property=["']og:title["'][^>]*content=["']([^"']+)["']/i);
  if (ogTitleMatch) {
    return ogTitleMatch[1].trim();
  }

  return "";
}

/**
 * Extract description from HTML
 */
function extractDescription(html: string): string {
  // Try meta description
  const descMatch = html.match(/<meta[^>]*name=["']description["'][^>]*content=["']([^"']+)["']/i);
  if (descMatch) {
    return descMatch[1].trim();
  }

  // Try og:description
  const ogDescMatch = html.match(/<meta[^>]*property=["']og:description["'][^>]*content=["']([^"']+)["']/i);
  if (ogDescMatch) {
    return ogDescMatch[1].trim();
  }

  return "";
}

/**
 * Extract body snippet from HTML
 * 
 * Strips HTML tags and returns first ~500 chars of content.
 */
function extractBodySnippet(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "");
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "");

  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, " ");

  // Normalize whitespace
  text = text.replace(/\s+/g, " ").trim();

  // Return first 500 chars
  return text.substring(0, 500);
}

/**
 * Check if a string contains a URL
 */
export function containsUrl(text: string): boolean {
  return URL_PATTERN.test(text);
}

/**
 * Get URL domain for display
 */
export function getUrlDomain(url: string): string {
  try {
    const urlObj = new URL(url);
    return urlObj.hostname;
  } catch {
    return url;
  }
}
