/**
 * ClaudeCodePanel — streaming chat UI for Claude Code via the bridge.
 *
 * Shows connection status, message history with streaming, and a
 * simple input field. Gracefully degrades when bridge/Claude disconnected.
 */

import React, { useState, useRef, useEffect } from "react"
import { useClaudeCode } from "~src/lib/claude-code-hooks"
import type { ChatMessage } from "~src/types/claude-sdk"

export function ClaudeCodePanel() {
  const { status, messages, send, clearMessages } = useClaudeCode()
  const [input, setInput] = useState("")
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" })
  }, [messages])

  const handleSend = () => {
    const text = input.trim()
    if (!text) return
    send(text)
    setInput("")
    inputRef.current?.focus()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  const isReady = status.bridge === "connected" && status.claude === "connected"
  const isStreaming = messages.some((m) => m.streaming)

  return (
    <div className="h-full flex flex-col">
      {/* Status Bar */}
      <StatusBar status={status} onClear={clearMessages} messageCount={messages.length} />

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-3 space-y-3">
        {messages.length === 0 && isReady && <EmptyState />}
        {messages.length === 0 && !isReady && <SetupGuide status={status} />}

        {messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="border-t border-gray-200 p-3">
        <div className="flex gap-2">
          <textarea
            ref={inputRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              isReady
                ? "Message Claude Code..."
                : status.bridge !== "connected"
                  ? "Bridge not connected..."
                  : "Waiting for Claude Code..."
            }
            disabled={!isReady || isStreaming}
            rows={1}
            className="flex-1 resize-none rounded-lg border border-gray-300 px-3 py-2 text-sm
              focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
              disabled:bg-gray-100 disabled:text-gray-400
              placeholder:text-gray-400"
          />
          <button
            onClick={handleSend}
            disabled={!isReady || isStreaming || !input.trim()}
            className="px-3 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium
              hover:bg-blue-700 disabled:bg-gray-300 disabled:cursor-not-allowed
              transition-colors"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Sub-Components ──────────────────────────────────────────

function StatusBar({
  status,
  onClear,
  messageCount,
}: {
  status: { bridge: string; claude: string }
  onClear: () => void
  messageCount: number
}) {
  const bridgeColor =
    status.bridge === "connected" ? "bg-green-500" : status.bridge === "connecting" ? "bg-yellow-500" : "bg-gray-400"
  const claudeColor = status.claude === "connected" ? "bg-green-500" : "bg-gray-400"

  return (
    <div className="flex items-center justify-between px-3 py-2 border-b border-gray-200 bg-gray-50">
      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${bridgeColor}`} />
          Bridge
        </span>
        <span className="flex items-center gap-1.5">
          <span className={`w-2 h-2 rounded-full ${claudeColor}`} />
          Claude
        </span>
      </div>
      {messageCount > 0 && (
        <button onClick={onClear} className="text-xs text-gray-400 hover:text-gray-600 transition-colors">
          Clear
        </button>
      )}
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex-1 flex items-center justify-center text-center p-6">
      <div>
        <div className="text-2xl mb-2">{"{ }"}</div>
        <div className="text-sm font-medium text-gray-700 mb-1">Claude Code Connected</div>
        <div className="text-xs text-gray-400">Send a message to start a conversation.</div>
      </div>
    </div>
  )
}

function SetupGuide({ status }: { status: { bridge: string; claude: string } }) {
  const bridgeDown = status.bridge !== "connected"

  return (
    <div className="flex-1 flex items-center justify-center p-6">
      <div className="max-w-xs text-center">
        <div className="text-2xl mb-3">{">"}_</div>
        <div className="text-sm font-medium text-gray-700 mb-3">
          {bridgeDown ? "Bridge Not Running" : "Waiting for Claude Code"}
        </div>
        <div className="text-xs text-gray-500 space-y-2 text-left bg-gray-50 rounded-lg p-3">
          {bridgeDown ? (
            <>
              <p className="font-medium">Start the bridge:</p>
              <code className="block bg-gray-900 text-green-400 rounded px-2 py-1 text-[10px]">
                bun run packages/bridge/src/server.ts
              </code>
            </>
          ) : (
            <>
              <p className="font-medium">Start Claude Code with SDK mode:</p>
              <code className="block bg-gray-900 text-green-400 rounded px-2 py-1 text-[10px]">
                claude --sdk-url ws://localhost:3848/claude
              </code>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function MessageBubble({ message }: { message: ChatMessage }) {
  const isUser = message.role === "user"

  return (
    <div className={`flex ${isUser ? "justify-end" : "justify-start"}`}>
      <div
        className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
          isUser
            ? "bg-blue-600 text-white"
            : "bg-gray-100 text-gray-900"
        }`}
      >
        {/* Tool calls indicator */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mb-1.5 space-y-0.5">
            {message.toolCalls.map((tc) => (
              <div key={tc.id} className="flex items-center gap-1 text-[10px] text-gray-500">
                <span>{tc.status === "running" ? "..." : "done"}</span>
                <span className="font-mono">{tc.name}</span>
              </div>
            ))}
          </div>
        )}

        {/* Message text with basic whitespace preservation */}
        <div className="whitespace-pre-wrap break-words">{message.content}</div>

        {/* Streaming indicator */}
        {message.streaming && (
          <span className="inline-block w-1.5 h-4 bg-gray-400 animate-pulse ml-0.5 align-middle" />
        )}
      </div>
    </div>
  )
}
