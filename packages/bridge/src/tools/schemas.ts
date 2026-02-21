/**
 * Tool Schemas — MCP tool definitions for the 6 read-only browser tools.
 *
 * These are registered with the MCP server so Claude Code discovers them
 * on startup via .mcp.json. All tools are read-only (no mutations).
 */

import type { ToolSchema } from "../types/tool-protocol"
import { BRIDGE_MEMORY_TOOL_SCHEMA } from "./bridge-memory"
import { BRIDGE_GOALS_TOOL_SCHEMA } from "./bridge-goals"

// ─── Tool Definitions ────────────────────────────────────────

export const TOOL_SCHEMAS: ToolSchema[] = [
  {
    name: "atlas_read_current_page",
    description:
      "Read the current browser tab's page content. Returns the URL, title, " +
      "and full text content (innerText) of the active tab. Content is " +
      "truncated to 50KB if larger. Use this to understand what the user " +
      "is looking at in their browser.",
    inputSchema: {
      type: "object",
      properties: {
        maxLength: {
          type: "number",
          description:
            "Maximum characters to return. Defaults to 50000 (~50KB). " +
            "Use a smaller value if you only need a summary.",
          default: 50000,
        },
      },
    },
  },

  {
    name: "atlas_get_dom_element",
    description:
      "Query a single DOM element by CSS selector. Returns whether the " +
      "element was found, its tag name, text content, attributes, bounding " +
      "box, and child count. Useful for inspecting specific parts of a page.",
    inputSchema: {
      type: "object",
      properties: {
        selector: {
          type: "string",
          description: "CSS selector to query (e.g. '#main', '.post-title', 'article > h1').",
        },
      },
      required: ["selector"],
    },
  },

  {
    name: "atlas_get_console_errors",
    description:
      "Retrieve recent console errors from the browser's developer console. " +
      "Returns an array of error messages with timestamps and source info. " +
      "Useful for debugging page issues.",
    inputSchema: {
      type: "object",
      properties: {
        limit: {
          type: "number",
          description: "Maximum number of errors to return. Defaults to 50.",
          default: 50,
        },
      },
    },
  },

  {
    name: "atlas_get_extension_state",
    description:
      "Get the current state of the Atlas browser extension. Returns the " +
      "current view, bridge connection status, Claude connection status, " +
      "and active tab URL/title. Useful for diagnostics.",
    inputSchema: {
      type: "object",
      properties: {},
    },
  },

  {
    name: "atlas_query_selectors",
    description:
      "Test multiple CSS selectors against the current page. For each " +
      "selector, returns whether it matched, how many elements matched, " +
      "and the text of the first match. Useful for exploring page structure " +
      "or finding the right selector.",
    inputSchema: {
      type: "object",
      properties: {
        selectors: {
          type: "array",
          description: "Array of CSS selectors to test against the page.",
          items: {
            type: "string",
          },
        },
      },
      required: ["selectors"],
    },
  },

  {
    name: "atlas_get_linkedin_context",
    description:
      "Extract structured context from LinkedIn pages. Detects the page " +
      "type (profile, feed, post, company, search) and extracts relevant " +
      "structured data. Only works on linkedin.com pages — returns an " +
      "error if the current tab is not LinkedIn.",
    inputSchema: {
      type: "object",
      properties: {
        includeComments: {
          type: "boolean",
          description: "Whether to include post comments. Defaults to false.",
          default: false,
        },
      },
    },
  },

  {
    name: "atlas_refresh_cookies",
    description:
      "Refresh browser cookies for SPA sites (Threads, LinkedIn, Instagram). " +
      "Reads cookies from Chrome via the extension's chrome.cookies API and " +
      "saves them to data/cookies/ for use by the content extractor. " +
      "Call this when content extraction hits a login wall.",
    inputSchema: {
      type: "object",
      properties: {
        domains: {
          type: "array",
          description:
            'Domains to refresh cookies for. Defaults to [".threads.com", ".instagram.com", ".linkedin.com"].',
          items: { type: "string" },
        },
      },
    },
  },

  // ─── Bridge-Local Tools (handled by MCP server, not dispatched to browser) ───

  BRIDGE_MEMORY_TOOL_SCHEMA as ToolSchema,
  BRIDGE_GOALS_TOOL_SCHEMA as ToolSchema,
]

/** Tools that are handled locally by the MCP server (not dispatched to the browser). */
export const LOCAL_TOOL_NAMES = new Set([
  BRIDGE_MEMORY_TOOL_SCHEMA.name,
  BRIDGE_GOALS_TOOL_SCHEMA.name,
])

// ─── Lookup Helper ───────────────────────────────────────────

const schemaMap = new Map(TOOL_SCHEMAS.map((s) => [s.name, s]))

/** Get a tool schema by name, or undefined if not found. */
export function getToolSchema(name: string): ToolSchema | undefined {
  return schemaMap.get(name)
}

/** All tool names as a set for fast membership checks. */
export const TOOL_NAMES = new Set(TOOL_SCHEMAS.map((s) => s.name))
