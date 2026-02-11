/**
 * Client-side types for the Claude Code bridge connection.
 * Mirrors the server-side sdk-protocol types but adds UI state.
 */

// ─── Connection State ────────────────────────────────────────

export type BridgeConnectionState = "disconnected" | "connecting" | "connected" | "error"

export interface BridgeStatus {
  bridge: BridgeConnectionState
  claude: "connected" | "disconnected"
}

// ─── Messages (Client → Bridge → Claude) ─────────────────────

export interface UserMessage {
  type: "user_message"
  content: ContentBlock[]
  sessionId?: string
}

// ─── Messages (Claude → Bridge → Client) ─────────────────────

/**
 * Claude Code CLI protocol — `assistant` message (complete turn).
 * Sent via `-p --output-format stream-json`.
 */
export interface ClaudeAssistantMessage {
  type: "assistant"
  message: AssistantMessage
}

/**
 * Claude Code CLI protocol — `result` message (final summary).
 * Contains the complete text result, cost, and duration.
 */
export interface ClaudeResultMessage {
  type: "result"
  subtype: "success" | "error"
  result?: string
  error?: string
  duration_ms?: number
  total_cost_usd?: number
  session_id?: string
}

/**
 * Claude Code CLI protocol — `system` init message.
 * Sent at startup with session/model info.
 */
export interface ClaudeSystemInit {
  type: "system"
  subtype: "init"
  session_id: string
  model: string
  tools?: unknown[]
}

/**
 * Bridge-originated system events (claude_connected, error, etc.)
 */
export interface BridgeSystemEvent {
  type: "system"
  event: string
  data?: unknown
}

export type SystemEvent = ClaudeSystemInit | BridgeSystemEvent

/** Legacy streaming format (kept for future streaming support) */
export interface StreamEvent {
  type: "stream_event"
  event: StreamEventPayload
}

export type IncomingMessage =
  | ClaudeAssistantMessage
  | ClaudeResultMessage
  | SystemEvent
  | StreamEvent

// ─── Stream Event Payloads ───────────────────────────────────

export type StreamEventPayload =
  | { type: "message_start"; message: AssistantMessage }
  | { type: "message_delta"; delta: { stop_reason?: string }; usage?: TokenUsage }
  | { type: "message_stop" }
  | { type: "content_block_start"; index: number; content_block: ContentBlock }
  | { type: "content_block_delta"; index: number; delta: ContentDelta }
  | { type: "content_block_stop"; index: number }

// ─── Content Types ───────────────────────────────────────────

export type ContentBlock = TextBlock | ToolUseBlock

export interface TextBlock {
  type: "text"
  text: string
}

export interface ToolUseBlock {
  type: "tool_use"
  id: string
  name: string
  input: Record<string, unknown>
}

export type ContentDelta =
  | { type: "text_delta"; text: string }
  | { type: "input_json_delta"; partial_json: string }

// ─── Assistant Message ───────────────────────────────────────

export interface AssistantMessage {
  id: string
  type: "message"
  role: "assistant"
  content: ContentBlock[]
  model?: string
  stop_reason?: string
  usage?: TokenUsage
}

export interface TokenUsage {
  input_tokens?: number
  output_tokens?: number
}

// ─── Chat UI Types ───────────────────────────────────────────

export interface ChatMessage {
  id: string
  role: "user" | "assistant"
  content: string
  timestamp: number
  /** true while streaming is in progress */
  streaming?: boolean
  /** tool calls observed during this turn */
  toolCalls?: ToolCallInfo[]
}

export interface ToolCallInfo {
  id: string
  name: string
  status: "running" | "complete" | "error"
}
