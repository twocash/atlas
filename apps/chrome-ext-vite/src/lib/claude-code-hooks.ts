/**
 * useClaudeCode() — React hook for the Claude Code bridge connection.
 *
 * Gate 1.7: Delegates WebSocket lifecycle to bridge-client.ts singleton.
 * Retains React state management, message parsing, and streaming state.
 * Exposes a simple send/messages/status API to ClaudeCodePanel.
 */

import { useState, useEffect, useRef, useCallback } from "react"
import type {
  BridgeConnectionState,
  BridgeStatus,
  ChatMessage,
  IncomingMessage,
  ToolCallInfo,
  ClaudeAssistantMessage,
  ClaudeResultMessage,
} from "../types/claude-sdk"
import { executeToolRequest, type ToolRequest } from "./tool-executor"
import {
  updateClaudeState as monitorUpdateClaude,
  onStatusChange,
} from "./bridge-status"
import {
  connect as bridgeConnect,
  disconnect as bridgeDisconnect,
  send as bridgeSend,
  sendRaw,
  onMessage,
} from "./bridge-client"

// ─── Hook ────────────────────────────────────────────────────

export interface UseClaudeCodeReturn {
  status: BridgeStatus
  messages: ChatMessage[]
  send: (text: string) => void
  clearMessages: () => void
}

export function useClaudeCode(): UseClaudeCodeReturn {
  const [bridgeState, setBridgeState] = useState<BridgeConnectionState>("disconnected")
  const [claudeState, setClaudeState] = useState<"connected" | "disconnected">("disconnected")
  const [messages, setMessages] = useState<ChatMessage[]>([])

  const mountedRef = useRef(true)

  // Streaming state — tracks the current assistant turn being streamed
  const streamingText = useRef("")
  const streamingMsgId = useRef<string | null>(null)
  const toolCalls = useRef<ToolCallInfo[]>([])

  // ─── Message Processing ──────────────────────────────────

  const handleIncomingMessage = useCallback((raw: string) => {
    // NDJSON: may contain multiple lines
    const lines = raw.split("\n").filter((l) => l.trim())

    for (const line of lines) {
      let msg: any
      try {
        msg = JSON.parse(line)
      } catch {
        console.warn("[claude-hook] Invalid JSON:", line.slice(0, 80))
        continue
      }

      if (msg.type === "tool_request") {
        handleToolRequest(msg as ToolRequest)
      } else if (msg.type === "system") {
        handleSystemEvent(msg)
      } else if (msg.type === "assistant") {
        handleAssistantMessage(msg as ClaudeAssistantMessage)
      } else if (msg.type === "result") {
        handleResultMessage(msg as ClaudeResultMessage)
      } else if (msg.type === "stream_event") {
        // Legacy streaming format (future-proofing)
        handleStreamEvent(msg)
      }
    }
  }, [])

  const handleSystemEvent = useCallback((msg: any) => {
    // Claude Code CLI init: { type: "system", subtype: "init", session_id, model }
    if (msg.subtype === "init") {
      console.log(`[claude-hook] Claude init — session: ${msg.session_id}, model: ${msg.model}`)
      monitorUpdateClaude("connected")
      return
    }

    // Bridge-originated events: { type: "system", event: "claude_connected" | ... }
    if (msg.event === "claude_connected") {
      monitorUpdateClaude("connected")
    } else if (msg.event === "claude_disconnected") {
      monitorUpdateClaude("disconnected")
    } else if (msg.event === "error") {
      const data = msg.data as { message?: string } | undefined
      console.warn("[claude-hook] Bridge error:", data?.message)
    }
  }, [])

  // ─── Tool Request Handler ──────────────────────────────

  const handleToolRequest = useCallback(async (request: ToolRequest) => {
    console.log(`[claude-hook] Tool request: ${request.name} (id: ${request.id})`)

    const response = await executeToolRequest(request, {
      bridgeStatus: bridgeState,
      claudeStatus: claudeState,
    })

    // Send response back via bridge-client
    const sent = sendRaw(JSON.stringify(response))
    if (sent) {
      console.log(`[claude-hook] Tool response sent: ${request.name} (${response.error ? "error" : "ok"})`)
    } else {
      console.warn(`[claude-hook] Cannot send tool response — WebSocket not open`)
    }
  }, [bridgeState, claudeState])

  // ─── Claude Code CLI Protocol Handlers ──────────────────

  const handleAssistantMessage = useCallback((msg: ClaudeAssistantMessage) => {
    const { message } = msg
    if (!message?.content) return

    // Extract text from content blocks
    const textParts: string[] = []
    const tools: ToolCallInfo[] = []

    for (const block of message.content) {
      if (block.type === "text") {
        textParts.push(block.text)
      } else if (block.type === "tool_use") {
        tools.push({ id: block.id, name: block.name, status: "complete" })
      }
    }

    const text = textParts.join("")
    if (!text && tools.length === 0) return

    const chatMsg: ChatMessage = {
      id: message.id || `assistant-${Date.now()}`,
      role: "assistant",
      content: text,
      timestamp: Date.now(),
      streaming: false,
      toolCalls: tools.length > 0 ? tools : undefined,
    }

    setMessages((prev) => [...prev, chatMsg])
  }, [])

  const handleResultMessage = useCallback((msg: ClaudeResultMessage) => {
    if (msg.subtype === "error" && msg.error) {
      // Show error as assistant message
      const errorMsg: ChatMessage = {
        id: `error-${Date.now()}`,
        role: "assistant",
        content: `Error: ${msg.error}`,
        timestamp: Date.now(),
      }
      setMessages((prev) => [...prev, errorMsg])
    }

    // Log cost/duration for debugging
    if (msg.duration_ms || msg.total_cost_usd) {
      console.log(
        `[claude-hook] Result: ${msg.duration_ms}ms, $${msg.total_cost_usd?.toFixed(4) ?? "?"}`
      )
    }

    // Finalize any in-progress streaming
    finalizeStreaming()
  }, [])

  // ─── Legacy Streaming Handlers (future use) ────────────

  const handleStreamEvent = useCallback((msg: { type: "stream_event"; event: any }) => {
    const event = msg.event

    switch (event.type) {
      case "message_start": {
        // New assistant turn — start accumulating
        streamingText.current = ""
        toolCalls.current = []
        streamingMsgId.current = event.message?.id || `msg-${Date.now()}`
        break
      }

      case "content_block_start": {
        const block = event.content_block
        if (block?.type === "tool_use") {
          toolCalls.current.push({
            id: block.id,
            name: block.name,
            status: "running",
          })
        }
        break
      }

      case "content_block_delta": {
        const delta = event.delta
        if (delta?.type === "text_delta") {
          streamingText.current += delta.text

          // Update or create the streaming message
          setMessages((prev) => {
            const msgId = streamingMsgId.current!
            const existing = prev.findIndex((m) => m.id === msgId)

            const updated: ChatMessage = {
              id: msgId,
              role: "assistant",
              content: streamingText.current,
              timestamp: Date.now(),
              streaming: true,
              toolCalls: toolCalls.current.length > 0 ? [...toolCalls.current] : undefined,
            }

            if (existing >= 0) {
              const next = [...prev]
              next[existing] = updated
              return next
            }
            return [...prev, updated]
          })
        }
        break
      }

      case "content_block_stop": {
        // Mark any running tool calls for this block as complete
        const blockIdx = event.index
        if (toolCalls.current[blockIdx]?.status === "running") {
          toolCalls.current[blockIdx].status = "complete"
        }
        break
      }

      case "message_stop": {
        finalizeStreaming()
        break
      }
    }
  }, [])

  const finalizeStreaming = useCallback(() => {
    if (!streamingMsgId.current) return

    setMessages((prev) => {
      const idx = prev.findIndex((m) => m.id === streamingMsgId.current)
      if (idx >= 0) {
        const next = [...prev]
        next[idx] = { ...next[idx], streaming: false }
        return next
      }
      return prev
    })

    streamingMsgId.current = null
    streamingText.current = ""
    toolCalls.current = []
  }, [])

  // ─── Send ────────────────────────────────────────────────

  const send = useCallback((text: string) => {
    const sent = bridgeSend([{ type: "text", text }])
    if (!sent) {
      console.warn("[claude-hook] Cannot send — bridge not connected")
      return
    }

    // Add user message to local state
    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content: text,
      timestamp: Date.now(),
    }
    setMessages((prev) => [...prev, userMsg])
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  // ─── Lifecycle ───────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true

    // Sync bridge-status → React state
    const unsubStatus = onStatusChange((status) => {
      if (!mountedRef.current) return
      setBridgeState(status.bridge)
      setClaudeState(status.claude)
    })

    // Route incoming messages to hook handlers
    const unsubMessages = onMessage((raw) => {
      if (!mountedRef.current) return
      handleIncomingMessage(raw)
    })

    // Connect via bridge-client singleton
    bridgeConnect()

    return () => {
      mountedRef.current = false
      unsubStatus()
      unsubMessages()
      bridgeDisconnect()
    }
  }, [handleIncomingMessage])

  return {
    status: { bridge: bridgeState, claude: claudeState },
    messages,
    send,
    clearMessages,
  }
}
