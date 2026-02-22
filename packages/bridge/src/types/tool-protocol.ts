/**
 * Tool Protocol Types — shared between bridge, MCP server, and extension.
 *
 * Flow:
 *   Claude → tool_use → MCP Server → POST /tool-dispatch → Bridge
 *   Bridge → tool_request via WebSocket → Extension
 *   Extension → tool_response via WebSocket → Bridge
 *   Bridge → HTTP response → MCP Server → tool_result → Claude
 */

// ─── Tool Schema (MCP tool definition) ─────────────────────

export interface ToolSchema {
  name: string
  description: string
  inputSchema: {
    type: "object"
    properties: Record<string, JsonSchemaProperty>
    required?: string[]
  }
}

export interface JsonSchemaProperty {
  type: string
  description?: string
  enum?: string[]
  default?: unknown
  items?: JsonSchemaProperty
}

// ─── Bridge ↔ Extension (WebSocket messages) ────────────────

/** Bridge → Extension: execute this tool */
export interface ToolRequest {
  type: "tool_request"
  id: string           // Correlates with tool_use_id from Claude
  name: string         // Tool name (without MCP prefix)
  input: Record<string, unknown>
  timestamp: number
}

/** Extension → Bridge: tool execution result */
export interface ToolResponse {
  type: "tool_response"
  id: string           // Must match ToolRequest.id
  result?: unknown     // Success payload
  error?: string       // Error message (mutually exclusive with result)
}

// ─── MCP Server ↔ Bridge (HTTP /tool-dispatch) ──────────────

/** MCP Server → Bridge: POST /tool-dispatch body */
export interface ToolDispatchRequest {
  id: string
  name: string
  input: Record<string, unknown>
}

/** Bridge → MCP Server: POST /tool-dispatch response */
export interface ToolDispatchResponse {
  id: string
  result?: unknown
  error?: string
}

// ─── Tool Result Types (what each tool returns) ─────────────

export interface PageContentResult {
  url: string
  title: string
  content: string       // innerText, truncated to 50KB
  contentLength: number // original length before truncation
  truncated: boolean
}

export interface DomElementResult {
  found: boolean
  selector: string
  tagName?: string
  textContent?: string
  attributes?: Record<string, string>
  boundingBox?: { x: number; y: number; width: number; height: number }
  childCount?: number
}

export interface ConsoleErrorResult {
  errors: Array<{
    message: string
    source?: string
    timestamp: number
  }>
  count: number
}

export interface ExtensionStateResult {
  currentView: string
  bridgeStatus: string
  claudeStatus: string
  tabUrl?: string
  tabTitle?: string
}

export interface SelectorQueryResult {
  results: Array<{
    selector: string
    found: boolean
    count: number
    firstText?: string
  }>
}

export interface LinkedInContextResult {
  pageType: "profile" | "feed" | "post" | "company" | "search" | "unknown"
  url: string
  data: Record<string, unknown>
}

export interface BrowserOpenAndReadResult {
  url: string
  title: string
  content: string
  contentLength: number
  truncated: boolean
  platform: string
  hydrationSelector: string
  hydrationWaitMs: number
  extractionMode: string
  extractionSource: string
  tabClosed: boolean
}

// ─── Constants ──────────────────────────────────────────────

export const TOOL_TIMEOUT_MS = 5000
export const CONTENT_TRUNCATION_BYTES = 50 * 1024 // 50KB
export const MCP_SERVER_NAME = "atlas-browser"

/** Per-tool timeout overrides (ms). Tools not listed use TOOL_TIMEOUT_MS. */
const TOOL_TIMEOUT_OVERRIDES: Record<string, number> = {
  atlas_browser_open_and_read: 30_000,
}

/** Get the timeout for a specific tool (supports long-running browser tools). */
export function getToolTimeout(toolName: string): number {
  return TOOL_TIMEOUT_OVERRIDES[toolName] ?? TOOL_TIMEOUT_MS
}
