/**
 * TypeScript types for Claude Code's --sdk-url NDJSON protocol.
 *
 * Claude Code connects to a WebSocket server and exchanges newline-delimited
 * JSON messages. This file defines the message shapes for both directions.
 *
 * Sources: community implementations (companion, claude-agent-server, claude-code-web)
 * and Atlas vision doc (docs/SDK-URL-INTEGRATION.md).
 */

// ─── Client → Claude Code ────────────────────────────────────

/** Send a user message to Claude Code */
export interface UserMessage {
  type: "user_message"
  content: ContentBlock[]
  sessionId?: string
}

/** Resume a conversation by providing a session ID */
export interface ResumeSession {
  type: "resume"
  sessionId: string
}

/** Provide a tool result back to Claude Code */
export interface ToolResultMessage {
  type: "tool_result"
  tool_use_id: string
  content: ContentBlock[]
}

export type ClientToClaudeMessage = UserMessage | ResumeSession | ToolResultMessage

// ─── Claude Code → Client ────────────────────────────────────

/** Streaming event wrapper — all streamed content comes through this */
export interface StreamEvent {
  type: "stream_event"
  event: StreamEventPayload
}

/** Complete response message (after streaming finishes) */
export interface SdkMessage {
  type: "sdk_message"
  message: AssistantMessage
}

/** System-level events (session start, errors, etc.) */
export interface SystemEvent {
  type: "system"
  event: string
  data?: unknown
}

export type ClaudeToClientMessage = StreamEvent | SdkMessage | SystemEvent

// ─── Stream Event Payloads ───────────────────────────────────

export type StreamEventPayload =
  | MessageStartEvent
  | MessageDeltaEvent
  | MessageStopEvent
  | ContentBlockStartEvent
  | ContentBlockDeltaEvent
  | ContentBlockStopEvent

export interface MessageStartEvent {
  type: "message_start"
  message: AssistantMessage
}

export interface MessageDeltaEvent {
  type: "message_delta"
  delta: {
    stop_reason?: string
    stop_sequence?: string | null
  }
  usage?: TokenUsage
}

export interface MessageStopEvent {
  type: "message_stop"
}

export interface ContentBlockStartEvent {
  type: "content_block_start"
  index: number
  content_block: ContentBlock
}

export interface ContentBlockDeltaEvent {
  type: "content_block_delta"
  index: number
  delta: ContentDelta
}

export interface ContentBlockStopEvent {
  type: "content_block_stop"
  index: number
}

// ─── Content Types ───────────────────────────────────────────

export type ContentBlock = TextBlock | ToolUseBlock | ToolResultBlock

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

export interface ToolResultBlock {
  type: "tool_result"
  tool_use_id: string
  content: string | ContentBlock[]
  is_error?: boolean
}

export type ContentDelta = TextDelta | InputJsonDelta

export interface TextDelta {
  type: "text_delta"
  text: string
}

export interface InputJsonDelta {
  type: "input_json_delta"
  partial_json: string
}

// ─── Shared Types ────────────────────────────────────────────

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
  cache_creation_input_tokens?: number
  cache_read_input_tokens?: number
}
