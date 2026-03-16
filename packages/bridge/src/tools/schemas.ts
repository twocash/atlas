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

  {
    name: "atlas_browser_open_and_read",
    description:
      "Open a URL in a background browser tab, wait for SPA hydration, " +
      "extract the page content, and close the tab. Use this for SPA sites " +
      "(Threads, Twitter/X, LinkedIn, Instagram) that require JavaScript " +
      "rendering and authenticated browser sessions. Returns the page title, " +
      "URL, extracted text content, and metadata. The browser uses the " +
      "user's authenticated sessions, so login-walled content is accessible.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to open and read.",
        },
        waitFor: {
          type: "string",
          description:
            "CSS selector to wait for before extracting content. If not " +
            "provided, a platform-specific default is used based on the URL domain.",
        },
        waitTimeout: {
          type: "number",
          description: "Maximum milliseconds to wait for hydration. Defaults to 10000 (10s).",
          default: 10000,
        },
        extractionMode: {
          type: "string",
          description:
            "Content extraction strategy: 'full' extracts all page text, " +
            "'main' tries to extract only the main content area. Defaults to 'full'.",
          enum: ["full", "main"],
        },
        closeAfter: {
          type: "boolean",
          description: "Whether to close the tab after extraction. Defaults to true.",
          default: true,
        },
      },
      required: ["url"],
    },
  },

  // ─── Bridge-Local Tools (handled by MCP server, not dispatched to browser) ───

  BRIDGE_MEMORY_TOOL_SCHEMA as ToolSchema,
  BRIDGE_GOALS_TOOL_SCHEMA as ToolSchema,

  // ─── Headed Browser Tools (Playwright, bridge-local) ──────────────────────

  {
    name: "atlas_headed_launch",
    description:
      "Launch a visible (headed) browser page at the given URL. Jim can see " +
      "and interact with the window for authentication. Returns a pageId for " +
      "subsequent operations. Saved login sessions are restored automatically.",
    inputSchema: {
      type: "object",
      properties: {
        url: {
          type: "string",
          description: "The URL to open in the headed browser.",
        },
      },
      required: ["url"],
    },
  },

  {
    name: "atlas_headed_auth_wait",
    description:
      "Wait for Jim to complete manual authentication in the headed browser. " +
      "Polls until the URL changes away from a login page, a specific URL " +
      "pattern appears, or a CSS selector becomes visible. Saves session " +
      "state (cookies, localStorage) to disk when auth completes.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "The page ID from atlas_headed_launch.",
        },
        urlPattern: {
          type: "string",
          description: "URL substring that signals auth is complete (e.g., 'mail.google.com/mail').",
        },
        selector: {
          type: "string",
          description: "CSS selector that signals auth is complete (e.g., 'div[role=\"main\"]').",
        },
        timeout: {
          type: "number",
          description: "Max wait time in milliseconds. Defaults to 120000 (2 minutes).",
        },
      },
      required: ["pageId"],
    },
  },

  {
    name: "atlas_headed_interact",
    description:
      "Interact with elements in the headed browser: click, type text, " +
      "select options, or press keys. Use for form filling, button clicks, " +
      "search queries, and navigation after authentication.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "The page ID from atlas_headed_launch.",
        },
        action: {
          type: "string",
          enum: ["click", "type", "select", "press"],
          description: "The interaction type.",
        },
        selector: {
          type: "string",
          description: "CSS selector for the target element.",
        },
        value: {
          type: "string",
          description: "Text to type (for 'type') or option value (for 'select').",
        },
        key: {
          type: "string",
          description: "Key to press (for 'press'). e.g., 'Enter', 'Tab', 'Escape'.",
        },
      },
      required: ["pageId", "action"],
    },
  },

  {
    name: "atlas_headed_content",
    description:
      "Get text content from the headed browser page. Returns the full page " +
      "text or text from a specific CSS selector. Content is truncated to 50KB.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "The page ID from atlas_headed_launch.",
        },
        selector: {
          type: "string",
          description: "Optional CSS selector to extract text from a specific element.",
        },
      },
      required: ["pageId"],
    },
  },

  {
    name: "atlas_headed_screenshot",
    description:
      "Capture a screenshot of the headed browser page. Returns base64-encoded " +
      "PNG data. Use to verify page state, show Jim what the browser sees, or " +
      "debug automation issues.",
    inputSchema: {
      type: "object",
      properties: {
        pageId: {
          type: "string",
          description: "The page ID from atlas_headed_launch.",
        },
      },
      required: ["pageId"],
    },
  },
]

/** Tools that are handled locally by the MCP server (not dispatched to the browser). */
export const LOCAL_TOOL_NAMES = new Set([
  BRIDGE_MEMORY_TOOL_SCHEMA.name,
  BRIDGE_GOALS_TOOL_SCHEMA.name,
  "atlas_headed_launch",
  "atlas_headed_auth_wait",
  "atlas_headed_interact",
  "atlas_headed_content",
  "atlas_headed_screenshot",
])

// ─── Lookup Helper ───────────────────────────────────────────

const schemaMap = new Map(TOOL_SCHEMAS.map((s) => [s.name, s]))

/** Get a tool schema by name, or undefined if not found. */
export function getToolSchema(name: string): ToolSchema | undefined {
  return schemaMap.get(name)
}

/** All tool names as a set for fast membership checks. */
export const TOOL_NAMES = new Set(TOOL_SCHEMAS.map((s) => s.name))
