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

export interface StreamEvent {
  type: "stream_event"
  event: StreamEventPayload
}

export interface SdkMessage {
  type: "sdk_message"
  message: AssistantMessage
}

export interface SystemEvent {
  type: "system"
  event: string
  data?: unknown
}

export type IncomingMessage = StreamEvent | SdkMessage | SystemEvent

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
