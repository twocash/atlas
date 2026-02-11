/**
 * useClaudeCode() — React hook for the Claude Code bridge connection.
 *
 * Manages WebSocket lifecycle, message parsing, and streaming state.
 * Exposes a simple send/messages/status API to ClaudeCodePanel.
 */

import { useState, useEffect, useRef, useCallback } from "react"
import type {
  BridgeConnectionState,
  BridgeStatus,
  ChatMessage,
  IncomingMessage,
  ToolCallInfo,
} from "../types/claude-sdk"

// ─── Config ──────────────────────────────────────────────────

const BRIDGE_WS_URL = "ws://localhost:3848/client"
const RECONNECT_BASE = 2000   // 2s
const RECONNECT_MAX = 30000   // 30s
const RECONNECT_BACKOFF = 1.5

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

  const wsRef = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reconnectDelay = useRef(RECONNECT_BASE)
  const mountedRef = useRef(true)

  // Streaming state — tracks the current assistant turn being streamed
  const streamingText = useRef("")
  const streamingMsgId = useRef<string | null>(null)
  const toolCalls = useRef<ToolCallInfo[]>([])

  // ─── WebSocket Lifecycle ─────────────────────────────────

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) return
    if (wsRef.current?.readyState === WebSocket.CONNECTING) return

    setBridgeState("connecting")

    const ws = new WebSocket(BRIDGE_WS_URL)

    ws.onopen = () => {
      if (!mountedRef.current) return
      setBridgeState("connected")
      reconnectDelay.current = RECONNECT_BASE
      console.log("[claude-hook] Bridge connected")
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setBridgeState("disconnected")
      setClaudeState("disconnected")
      scheduleReconnect()
    }

    ws.onerror = () => {
      if (!mountedRef.current) return
      setBridgeState("error")
    }

    ws.onmessage = (event) => {
      if (!mountedRef.current) return
      handleIncomingMessage(event.data as string)
    }

    wsRef.current = ws
  }, [])

  const scheduleReconnect = useCallback(() => {
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
    reconnectTimer.current = setTimeout(() => {
      if (mountedRef.current) {
        reconnectDelay.current = Math.min(
          reconnectDelay.current * RECONNECT_BACKOFF,
          RECONNECT_MAX,
        )
        connect()
      }
    }, reconnectDelay.current)
  }, [connect])

  // ─── Message Processing ──────────────────────────────────

  const handleIncomingMessage = useCallback((raw: string) => {
    // NDJSON: may contain multiple lines
    const lines = raw.split("\n").filter((l) => l.trim())

    for (const line of lines) {
      let msg: IncomingMessage
      try {
        msg = JSON.parse(line)
      } catch {
        console.warn("[claude-hook] Invalid JSON:", line.slice(0, 80))
        continue
      }

      if (msg.type === "system") {
        handleSystemEvent(msg)
      } else if (msg.type === "stream_event") {
        handleStreamEvent(msg)
      } else if (msg.type === "sdk_message") {
        // Final message — finalize the streaming turn
        finalizeStreaming()
      }
    }
  }, [])

  const handleSystemEvent = useCallback((msg: { type: "system"; event: string; data?: unknown }) => {
    if (msg.event === "claude_connected") {
      setClaudeState("connected")
    } else if (msg.event === "claude_disconnected") {
      setClaudeState("disconnected")
    } else if (msg.event === "error") {
      const data = msg.data as { message?: string } | undefined
      console.warn("[claude-hook] Bridge error:", data?.message)
    }
  }, [])

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
    if (!wsRef.current || wsRef.current.readyState !== WebSocket.OPEN) {
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

    // Send to bridge
    const payload = {
      type: "user_message",
      content: [{ type: "text", text }],
    }
    wsRef.current.send(JSON.stringify(payload))
  }, [])

  const clearMessages = useCallback(() => {
    setMessages([])
  }, [])

  // ─── Lifecycle ───────────────────────────────────────────

  useEffect(() => {
    mountedRef.current = true
    connect()

    return () => {
      mountedRef.current = false
      if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
      if (wsRef.current) {
        wsRef.current.onclose = null // prevent reconnect on unmount
        wsRef.current.close()
      }
    }
  }, [connect])

  return {
    status: { bridge: bridgeState, claude: claudeState },
    messages,
    send,
    clearMessages,
  }
}
