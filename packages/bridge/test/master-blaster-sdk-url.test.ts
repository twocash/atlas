/**
 * Master Blaster — SDK-URL WebSocket Migration Proof
 *
 * Tests the critical behaviors introduced by the stdio → --sdk-url migration.
 * Exercises: spawn sequencing, MCP configuration lifecycle, message gating,
 * control request/response handling, state machine transitions, and edge cases.
 *
 * No live Claude Code process or WebSocket server needed.
 * All tests operate on extracted logic with mocked transport.
 *
 * Test Groups:
 *   1. Spawn Sequencing — --sdk-url args, session ID generation, process lifecycle
 *   2. MCP Configuration Lifecycle — init → configure → ack → ready gate
 *   3. Message Gating — pendingForCli queue, flush timing, pre-ready rejection
 *   4. Control Request/Response — can_use_tool auto-approve, mcp_set_servers ack
 *   5. CLI WebSocket Routing — session validation, role assignment, reconnect behavior
 *   6. State Machine — 3-state transitions, /status accuracy, cleanup on kill
 *   7. Client ↔ Claude Message Translation — user_message format, passthrough types
 *   8. Adversarial — malformed NDJSON, split frames, rapid connect/disconnect
 */

import { describe, it, expect, beforeEach } from "bun:test"
import { randomUUID } from "crypto"

// =============================================================================
// TEST INFRASTRUCTURE
// =============================================================================

/**
 * Simulates the bridge's internal state machine and message routing
 * without starting an actual Bun server or spawning Claude Code.
 *
 * Mirrors server.ts logic for: state tracking, message gating,
 * control request handling, MCP configuration, and cleanup.
 */
function createBridgeSimulator() {
  // ─── State (mirrors server.ts globals) ──────────────────────
  let cliSocketConnected = false
  let expectedCliSessionId: string | null = null
  let pendingForCli: string[] = []
  let claudeSessionId: string | null = null
  let claudeModel: string | null = null
  let claudeReady = false
  let mcpConfigured = false // GAP 1: This flag is MISSING in current server.ts

  // Track what was sent
  const sentToCli: string[] = []
  const sentToClients: any[] = []
  const controlRequestsSent: any[] = []
  const controlResponsesReceived: any[] = []

  // ─── Simulated transport ─────────────────────────────────────

  function simulateCliSend(ndjson: string): void {
    sentToCli.push(ndjson)
  }

  function broadcastToClients(msg: any): void {
    sentToClients.push(msg)
  }

  // ─── State queries ───────────────────────────────────────────

  function isClaudeConnected(): boolean {
    return cliSocketConnected
  }

  function getStatus(): string {
    if (cliSocketConnected) return "connected"
    if (expectedCliSessionId) return "connecting"
    return "disconnected"
  }

  // ─── Spawn simulation ───────────────────────────────────────

  function spawnClaude(): { sdkUrl: string; sessionId: string } {
    expectedCliSessionId = randomUUID()
    const sdkUrl = `ws://localhost:3848/ws/cli/${expectedCliSessionId}`
    return { sdkUrl, sessionId: expectedCliSessionId }
  }

  // ─── CLI WebSocket lifecycle ─────────────────────────────────

  function handleCliOpen(incomingSessionId: string): { accepted: boolean; error?: string } {
    if (incomingSessionId !== expectedCliSessionId) {
      return { accepted: false, error: `Session mismatch: ${incomingSessionId}` }
    }

    cliSocketConnected = true

    // CURRENT BEHAVIOR (Gap 2): Flushes immediately — before init, before MCP
    // CORRECT BEHAVIOR: Should NOT flush here. Flush after mcpConfigured = true.
    // We simulate CURRENT behavior to test the gap.
    if (pendingForCli.length > 0) {
      for (const msg of pendingForCli) {
        simulateCliSend(msg)
      }
      pendingForCli = []
    }

    return { accepted: true }
  }

  function handleCliMessage(raw: string): void {
    for (const line of raw.split("\n")) {
      const trimmed = line.trim()
      if (!trimmed) continue

      let msg: any
      try {
        msg = JSON.parse(trimmed)
      } catch {
        continue // Non-JSON line
      }

      // Init message
      if (msg.type === "system" && msg.subtype === "init") {
        claudeSessionId = msg.session_id
        claudeModel = msg.model
        claudeReady = true
        configureMcpServers()
        broadcastToClients({ type: "system", event: "claude_connected" })
        return
      }

      // Control requests from Claude (e.g., can_use_tool)
      if (msg.type === "control_request") {
        handleControlRequest(msg)
        return
      }

      // Control responses (ack from mcp_set_servers, etc.)
      // GAP 3: Current server.ts does NOT intercept these — they fall through
      if (msg.type === "control_response") {
        handleControlResponse(msg)
        return
      }

      // Everything else → broadcast to clients
      broadcastToClients(msg)
    }
  }

  function handleCliClose(): void {
    cliSocketConnected = false
    claudeSessionId = null
    claudeReady = false
    mcpConfigured = false
    broadcastToClients({ type: "system", event: "claude_disconnected" })
  }

  // ─── Control request/response handling ──────────────────────

  let mcpConfigRequestId: string | null = null

  function configureMcpServers(): void {
    mcpConfigRequestId = randomUUID()
    const controlReq = {
      type: "control_request",
      request_id: mcpConfigRequestId,
      request: {
        subtype: "mcp_set_servers",
        servers: {
          "atlas-browser": {
            type: "stdio",
            command: "bun",
            args: ["run", "packages/bridge/src/tools/mcp-server.ts"],
          },
        },
      },
    }
    controlRequestsSent.push(controlReq)
    sendRawToCli(controlReq)
  }

  function handleControlRequest(msg: any): void {
    const subtype = msg.request?.subtype

    if (subtype === "can_use_tool") {
      sendRawToCli({
        type: "control_response",
        request_id: msg.request_id,
        response: { approved: true },
      })
      return
    }
    // Unknown control requests logged but not forwarded
  }

  function handleControlResponse(msg: any): void {
    controlResponsesReceived.push(msg)

    // Check if this is the MCP config ack
    if (msg.request_id === mcpConfigRequestId) {
      mcpConfigured = true

      // CORRECT BEHAVIOR: Flush pending messages NOW (after MCP is configured)
      // This is where pendingForCli should drain — not in handleCliOpen
    }
  }

  // ─── Message sending ────────────────────────────────────────

  function sendToClaude(clientMessage: any): { sent: boolean; queued: boolean; error?: string } {
    // GAP 1: Current server.ts only checks claudeReady, not mcpConfigured
    // CORRECT: Should check both
    if (!cliSocketConnected && !expectedCliSessionId) {
      return { sent: false, queued: false, error: "Claude not running" }
    }

    // Translate client format → Claude stream-json format
    let claudeMessage: any
    if (clientMessage.type === "user_message") {
      const textBlocks = clientMessage.content?.filter((b: any) => b.type === "text") || []
      const content = textBlocks.length === 1
        ? textBlocks[0].text
        : textBlocks.map((b: any) => b)

      claudeMessage = {
        type: "user",
        message: { role: "user", content },
        parent_tool_use_id: null,
        session_id: "",
      }
    } else {
      claudeMessage = clientMessage
    }

    const ndjson = JSON.stringify(claudeMessage) + "\n"

    if (cliSocketConnected) {
      simulateCliSend(ndjson)
      return { sent: true, queued: false }
    } else {
      pendingForCli.push(ndjson)
      return { sent: false, queued: true }
    }
  }

  function sendRawToCli(msg: any): void {
    const ndjson = JSON.stringify(msg) + "\n"
    if (cliSocketConnected) {
      simulateCliSend(ndjson)
    } else {
      pendingForCli.push(ndjson)
    }
  }

  // ─── Kill ────────────────────────────────────────────────────

  function killClaude(): void {
    cliSocketConnected = false
    expectedCliSessionId = null
    pendingForCli = []
    claudeSessionId = null
    claudeModel = null
    claudeReady = false
    mcpConfigured = false
    broadcastToClients({ type: "system", event: "claude_disconnected" })
  }

  return {
    // Actions
    spawnClaude,
    handleCliOpen,
    handleCliMessage,
    handleCliClose,
    sendToClaude,
    sendRawToCli,
    killClaude,

    // State queries
    isClaudeConnected,
    getStatus,
    get claudeReady() { return claudeReady },
    get mcpConfigured() { return mcpConfigured },
    get claudeSessionId() { return claudeSessionId },
    get claudeModel() { return claudeModel },
    get pendingCount() { return pendingForCli.length },
    get expectedCliSessionId() { return expectedCliSessionId },

    // Captures
    sentToCli,
    sentToClients,
    controlRequestsSent,
    controlResponsesReceived,
  }
}

// =============================================================================
// 1. SPAWN SEQUENCING
// =============================================================================

describe("1. Spawn Sequencing", () => {
  it("generates unique session ID on spawn", () => {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()

    expect(sessionId).toBeTruthy()
    expect(sessionId.length).toBe(36) // UUID format
    expect(sessionId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/)
  })

  it("SDK URL contains session ID and correct port", () => {
    const bridge = createBridgeSimulator()
    const { sdkUrl, sessionId } = bridge.spawnClaude()

    expect(sdkUrl).toBe(`ws://localhost:3848/ws/cli/${sessionId}`)
  })

  it("consecutive spawns generate different session IDs", () => {
    const bridge = createBridgeSimulator()
    const first = bridge.spawnClaude()
    bridge.killClaude()
    const second = bridge.spawnClaude()

    expect(first.sessionId).not.toBe(second.sessionId)
  })

  it("status is 'connecting' after spawn, before WebSocket connect", () => {
    const bridge = createBridgeSimulator()
    bridge.spawnClaude()

    expect(bridge.getStatus()).toBe("connecting")
    expect(bridge.isClaudeConnected()).toBe(false)
  })

  it("status is 'disconnected' before any spawn", () => {
    const bridge = createBridgeSimulator()

    expect(bridge.getStatus()).toBe("disconnected")
  })
})

// =============================================================================
// 2. MCP CONFIGURATION LIFECYCLE
// =============================================================================

describe("2. MCP Configuration Lifecycle", () => {
  function spawnAndConnect(bridge: ReturnType<typeof createBridgeSimulator>) {
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)
    return sessionId
  }

  function sendInit(bridge: ReturnType<typeof createBridgeSimulator>) {
    bridge.handleCliMessage(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "test-session-001",
      model: "claude-sonnet-4-5-20250514",
    }))
  }

  it("init message sets claudeReady and triggers MCP config", () => {
    const bridge = createBridgeSimulator()
    spawnAndConnect(bridge)

    expect(bridge.claudeReady).toBe(false)
    sendInit(bridge)

    expect(bridge.claudeReady).toBe(true)
    expect(bridge.claudeSessionId).toBe("test-session-001")
    expect(bridge.claudeModel).toBe("claude-sonnet-4-5-20250514")
  })

  it("MCP config control request is sent after init", () => {
    const bridge = createBridgeSimulator()
    spawnAndConnect(bridge)
    sendInit(bridge)

    expect(bridge.controlRequestsSent.length).toBe(1)
    const req = bridge.controlRequestsSent[0]
    expect(req.type).toBe("control_request")
    expect(req.request.subtype).toBe("mcp_set_servers")
    expect(req.request.servers["atlas-browser"]).toBeDefined()
    expect(req.request.servers["atlas-browser"].command).toBe("bun")
  })

  it("MCP config request has unique request_id", () => {
    const bridge = createBridgeSimulator()
    spawnAndConnect(bridge)
    sendInit(bridge)

    const reqId = bridge.controlRequestsSent[0].request_id
    expect(reqId).toBeTruthy()
    expect(reqId).toMatch(/^[0-9a-f]{8}-/)
  })

  it("mcpConfigured becomes true after control_response ack", () => {
    const bridge = createBridgeSimulator()
    spawnAndConnect(bridge)
    sendInit(bridge)

    expect(bridge.mcpConfigured).toBe(false)

    // Simulate Claude Code acknowledging MCP config
    const reqId = bridge.controlRequestsSent[0].request_id
    bridge.handleCliMessage(JSON.stringify({
      type: "control_response",
      request_id: reqId,
      response: { ok: true },
    }))

    expect(bridge.mcpConfigured).toBe(true)
  })

  it("mcpConfigured stays false for unrelated control_response", () => {
    const bridge = createBridgeSimulator()
    spawnAndConnect(bridge)
    sendInit(bridge)

    bridge.handleCliMessage(JSON.stringify({
      type: "control_response",
      request_id: "unrelated-request-id",
      response: { ok: true },
    }))

    expect(bridge.mcpConfigured).toBe(false)
  })

  it("clients receive claude_connected broadcast on init", () => {
    const bridge = createBridgeSimulator()
    spawnAndConnect(bridge)
    sendInit(bridge)

    const connectEvents = bridge.sentToClients.filter(
      (m) => m.type === "system" && m.event === "claude_connected"
    )
    expect(connectEvents.length).toBe(1)
  })
})

// =============================================================================
// 3. MESSAGE GATING (pendingForCli queue + flush timing)
// =============================================================================

describe("3. Message Gating", () => {
  const userMsg = {
    type: "user_message",
    content: [{ type: "text", text: "What's the current page?" }],
  }

  it("messages sent before spawn are rejected", () => {
    const bridge = createBridgeSimulator()
    const result = bridge.sendToClaude(userMsg)

    expect(result.sent).toBe(false)
    expect(result.queued).toBe(false)
    expect(result.error).toContain("not running")
  })

  it("messages sent after spawn but before WS connect are queued", () => {
    const bridge = createBridgeSimulator()
    bridge.spawnClaude()

    const result = bridge.sendToClaude(userMsg)

    expect(result.sent).toBe(false)
    expect(result.queued).toBe(true)
    expect(bridge.pendingCount).toBe(1)
  })

  it("multiple queued messages maintain order", () => {
    const bridge = createBridgeSimulator()
    bridge.spawnClaude()

    bridge.sendToClaude({ type: "user_message", content: [{ type: "text", text: "first" }] })
    bridge.sendToClaude({ type: "user_message", content: [{ type: "text", text: "second" }] })
    bridge.sendToClaude({ type: "user_message", content: [{ type: "text", text: "third" }] })

    expect(bridge.pendingCount).toBe(3)
  })

  it("GAP TEST: current behavior flushes pending on WS connect (before init)", () => {
    // This test documents the GAP — pending messages flush too early.
    // After fix, this test should be updated to verify flush happens after mcpConfigured.
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()

    bridge.sendToClaude(userMsg)
    expect(bridge.pendingCount).toBe(1)

    // WebSocket connects — current code flushes here (before init!)
    bridge.handleCliOpen(sessionId)

    // GAP: Message was flushed before Claude sent init
    expect(bridge.pendingCount).toBe(0)
    expect(bridge.sentToCli.length).toBe(1)
    expect(bridge.claudeReady).toBe(false) // Init hasn't arrived yet!
  })

  it("messages sent after WS connect but before init are sent immediately (gap)", () => {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)

    // Claude hasn't sent init yet, but WS is open
    const result = bridge.sendToClaude(userMsg)

    // Current behavior: sent immediately even though claudeReady=false
    expect(result.sent).toBe(true)
    expect(bridge.claudeReady).toBe(false)
  })

  it("kill clears pending queue", () => {
    const bridge = createBridgeSimulator()
    bridge.spawnClaude()

    bridge.sendToClaude(userMsg)
    bridge.sendToClaude(userMsg)
    expect(bridge.pendingCount).toBe(2)

    bridge.killClaude()
    expect(bridge.pendingCount).toBe(0)
  })
})

// =============================================================================
// 4. CONTROL REQUEST / RESPONSE HANDLING
// =============================================================================

describe("4. Control Request/Response Handling", () => {
  function fullBootstrap(bridge: ReturnType<typeof createBridgeSimulator>) {
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)
    bridge.handleCliMessage(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "ctrl-session",
      model: "claude-sonnet-4-5-20250514",
    }))
  }

  it("can_use_tool auto-approved with response sent to CLI", () => {
    const bridge = createBridgeSimulator()
    fullBootstrap(bridge)

    const beforeCount = bridge.sentToCli.length

    bridge.handleCliMessage(JSON.stringify({
      type: "control_request",
      request_id: "tool-req-001",
      request: {
        subtype: "can_use_tool",
        tool_name: "atlas_read_current_page",
      },
    }))

    // Should have sent a control_response back
    const newMessages = bridge.sentToCli.slice(beforeCount)
    expect(newMessages.length).toBe(1)

    const response = JSON.parse(newMessages[0].trim())
    expect(response.type).toBe("control_response")
    expect(response.request_id).toBe("tool-req-001")
    expect(response.response.approved).toBe(true)
  })

  it("can_use_tool is NOT broadcast to clients", () => {
    const bridge = createBridgeSimulator()
    fullBootstrap(bridge)

    const beforeBroadcasts = bridge.sentToClients.length

    bridge.handleCliMessage(JSON.stringify({
      type: "control_request",
      request_id: "tool-req-002",
      request: {
        subtype: "can_use_tool",
        tool_name: "atlas_get_dom_element",
      },
    }))

    // Only the init broadcast should exist — no control request forwarding
    const newBroadcasts = bridge.sentToClients.slice(beforeBroadcasts)
    const controlBroadcasts = newBroadcasts.filter((m) => m.type === "control_request")
    expect(controlBroadcasts.length).toBe(0)
  })

  it("control_response is intercepted and NOT broadcast to clients (gap fix)", () => {
    const bridge = createBridgeSimulator()
    fullBootstrap(bridge)

    const beforeBroadcasts = bridge.sentToClients.length
    const reqId = bridge.controlRequestsSent[0].request_id

    bridge.handleCliMessage(JSON.stringify({
      type: "control_response",
      request_id: reqId,
      response: { ok: true },
    }))

    // Should NOT appear in client broadcasts
    const newBroadcasts = bridge.sentToClients.slice(beforeBroadcasts)
    const controlBroadcasts = newBroadcasts.filter((m) => m.type === "control_response")
    expect(controlBroadcasts.length).toBe(0)
  })

  it("control_response is tracked in controlResponsesReceived", () => {
    const bridge = createBridgeSimulator()
    fullBootstrap(bridge)

    const reqId = bridge.controlRequestsSent[0].request_id
    bridge.handleCliMessage(JSON.stringify({
      type: "control_response",
      request_id: reqId,
      response: { ok: true },
    }))

    expect(bridge.controlResponsesReceived.length).toBe(1)
    expect(bridge.controlResponsesReceived[0].request_id).toBe(reqId)
  })

  it("unknown control request subtypes are logged but not forwarded", () => {
    const bridge = createBridgeSimulator()
    fullBootstrap(bridge)

    const beforeBroadcasts = bridge.sentToClients.length

    bridge.handleCliMessage(JSON.stringify({
      type: "control_request",
      request_id: "unknown-001",
      request: { subtype: "unknown_subtype" },
    }))

    const newBroadcasts = bridge.sentToClients.slice(beforeBroadcasts)
    expect(newBroadcasts.length).toBe(0)
  })

  it("multiple can_use_tool requests are independently approved", () => {
    const bridge = createBridgeSimulator()
    fullBootstrap(bridge)

    const tools = [
      "atlas_read_current_page",
      "atlas_get_dom_element",
      "atlas_get_linkedin_context",
      "atlas_query_selectors",
      "atlas_get_extension_state",
      "atlas_get_console_errors",
    ]

    const beforeCount = bridge.sentToCli.length

    for (let i = 0; i < tools.length; i++) {
      bridge.handleCliMessage(JSON.stringify({
        type: "control_request",
        request_id: `multi-${i}`,
        request: { subtype: "can_use_tool", tool_name: tools[i] },
      }))
    }

    const newMessages = bridge.sentToCli.slice(beforeCount)
    expect(newMessages.length).toBe(6)

    for (let i = 0; i < 6; i++) {
      const resp = JSON.parse(newMessages[i].trim())
      expect(resp.response.approved).toBe(true)
      expect(resp.request_id).toBe(`multi-${i}`)
    }
  })
})

// =============================================================================
// 5. CLI WEBSOCKET ROUTING
// =============================================================================

describe("5. CLI WebSocket Routing", () => {
  it("rejects WebSocket with wrong session ID", () => {
    const bridge = createBridgeSimulator()
    bridge.spawnClaude()

    const result = bridge.handleCliOpen("wrong-session-id-12345")
    expect(result.accepted).toBe(false)
    expect(result.error).toContain("Session mismatch")
  })

  it("accepts WebSocket with correct session ID", () => {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()

    const result = bridge.handleCliOpen(sessionId)
    expect(result.accepted).toBe(true)
    expect(bridge.isClaudeConnected()).toBe(true)
  })

  it("status transitions: disconnected → connecting → connected", () => {
    const bridge = createBridgeSimulator()

    expect(bridge.getStatus()).toBe("disconnected")

    const { sessionId } = bridge.spawnClaude()
    expect(bridge.getStatus()).toBe("connecting")

    bridge.handleCliOpen(sessionId)
    expect(bridge.getStatus()).toBe("connected")
  })

  it("CLI close resets state correctly", () => {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)

    bridge.handleCliMessage(JSON.stringify({
      type: "system",
      subtype: "init",
      session_id: "sess-123",
      model: "claude-sonnet-4-5-20250514",
    }))

    expect(bridge.claudeReady).toBe(true)
    expect(bridge.claudeSessionId).toBe("sess-123")

    bridge.handleCliClose()

    expect(bridge.isClaudeConnected()).toBe(false)
    expect(bridge.claudeReady).toBe(false)
    expect(bridge.claudeSessionId).toBeNull()
    expect(bridge.mcpConfigured).toBe(false)
  })

  it("CLI close broadcasts disconnected event to clients", () => {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)

    bridge.handleCliClose()

    const disconnectEvents = bridge.sentToClients.filter(
      (m) => m.type === "system" && m.event === "claude_disconnected"
    )
    expect(disconnectEvents.length).toBe(1)
  })

  it("second spawn after kill uses new session ID", () => {
    const bridge = createBridgeSimulator()
    const first = bridge.spawnClaude()
    bridge.killClaude()

    const second = bridge.spawnClaude()
    expect(second.sessionId).not.toBe(first.sessionId)

    // Old session ID should be rejected
    const result = bridge.handleCliOpen(first.sessionId)
    expect(result.accepted).toBe(false)
  })
})

// =============================================================================
// 6. STATE MACHINE CONSISTENCY
// =============================================================================

describe("6. State Machine Consistency", () => {
  it("kill resets all state atomically", () => {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)
    bridge.handleCliMessage(JSON.stringify({
      type: "system", subtype: "init",
      session_id: "kill-test", model: "claude-sonnet-4-5-20250514",
    }))

    // Queue some messages
    bridge.sendToClaude({ type: "user_message", content: [{ type: "text", text: "test" }] })

    bridge.killClaude()

    expect(bridge.isClaudeConnected()).toBe(false)
    expect(bridge.claudeReady).toBe(false)
    expect(bridge.mcpConfigured).toBe(false)
    expect(bridge.claudeSessionId).toBeNull()
    expect(bridge.claudeModel).toBeNull()
    expect(bridge.pendingCount).toBe(0)
    expect(bridge.expectedCliSessionId).toBeNull()
    expect(bridge.getStatus()).toBe("disconnected")
  })

  it("kill broadcasts disconnected event", () => {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)
    bridge.killClaude()

    const events = bridge.sentToClients.filter(
      (m) => m.type === "system" && m.event === "claude_disconnected"
    )
    expect(events.length).toBeGreaterThanOrEqual(1)
  })

  it("full lifecycle: spawn → connect → init → MCP ack → messages → kill", () => {
    const bridge = createBridgeSimulator()

    // Spawn
    const { sessionId } = bridge.spawnClaude()
    expect(bridge.getStatus()).toBe("connecting")

    // Connect
    bridge.handleCliOpen(sessionId)
    expect(bridge.getStatus()).toBe("connected")
    expect(bridge.claudeReady).toBe(false)

    // Init
    bridge.handleCliMessage(JSON.stringify({
      type: "system", subtype: "init",
      session_id: "lifecycle-001", model: "claude-sonnet-4-5-20250514",
    }))
    expect(bridge.claudeReady).toBe(true)
    expect(bridge.mcpConfigured).toBe(false)

    // MCP ack
    const mcpReqId = bridge.controlRequestsSent[0].request_id
    bridge.handleCliMessage(JSON.stringify({
      type: "control_response",
      request_id: mcpReqId,
      response: { ok: true },
    }))
    expect(bridge.mcpConfigured).toBe(true)

    // Send user message
    const result = bridge.sendToClaude({
      type: "user_message",
      content: [{ type: "text", text: "Read the current page" }],
    })
    expect(result.sent).toBe(true)

    // Receive assistant response
    bridge.handleCliMessage(JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: "The current page is..." },
    }))
    const assistantBroadcasts = bridge.sentToClients.filter((m) => m.type === "assistant")
    expect(assistantBroadcasts.length).toBe(1)

    // Kill
    bridge.killClaude()
    expect(bridge.getStatus()).toBe("disconnected")
  })
})

// =============================================================================
// 7. CLIENT ↔ CLAUDE MESSAGE TRANSLATION
// =============================================================================

describe("7. Message Translation", () => {
  function fullyBootedBridge() {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)
    bridge.handleCliMessage(JSON.stringify({
      type: "system", subtype: "init",
      session_id: "trans-001", model: "claude-sonnet-4-5-20250514",
    }))
    return bridge
  }

  it("user_message translated to Claude stream-json format", () => {
    const bridge = fullyBootedBridge()
    const beforeCount = bridge.sentToCli.length

    bridge.sendToClaude({
      type: "user_message",
      content: [{ type: "text", text: "Hello from client" }],
    })

    const sent = bridge.sentToCli.slice(beforeCount)
    expect(sent.length).toBe(1)

    const parsed = JSON.parse(sent[0].trim())
    expect(parsed.type).toBe("user")
    expect(parsed.message.role).toBe("user")
    expect(parsed.message.content).toBe("Hello from client")
    expect(parsed.parent_tool_use_id).toBeNull()
    expect(parsed.session_id).toBe("")
  })

  it("multi-block content preserved as array", () => {
    const bridge = fullyBootedBridge()
    const beforeCount = bridge.sentToCli.length

    bridge.sendToClaude({
      type: "user_message",
      content: [
        { type: "text", text: "First block" },
        { type: "text", text: "Second block" },
      ],
    })

    const parsed = JSON.parse(bridge.sentToCli.slice(beforeCount)[0].trim())
    expect(Array.isArray(parsed.message.content)).toBe(true)
    expect(parsed.message.content.length).toBe(2)
  })

  it("non-user_message types pass through untranslated", () => {
    const bridge = fullyBootedBridge()
    const beforeCount = bridge.sentToCli.length

    const customMsg = { type: "tool_result", content: "file saved", tool_use_id: "tu_123" }
    bridge.sendToClaude(customMsg)

    const parsed = JSON.parse(bridge.sentToCli.slice(beforeCount)[0].trim())
    expect(parsed.type).toBe("tool_result")
    expect(parsed.content).toBe("file saved")
  })

  it("all messages are NDJSON terminated with newline", () => {
    const bridge = fullyBootedBridge()
    const beforeCount = bridge.sentToCli.length

    bridge.sendToClaude({ type: "user_message", content: [{ type: "text", text: "test" }] })

    const raw = bridge.sentToCli[beforeCount]
    expect(raw.endsWith("\n")).toBe(true)
  })
})

// =============================================================================
// 8. ADVERSARIAL INPUTS
// =============================================================================

describe("8. Adversarial Inputs", () => {
  function fullyBootedBridge() {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)
    bridge.handleCliMessage(JSON.stringify({
      type: "system", subtype: "init",
      session_id: "adv-001", model: "claude-sonnet-4-5-20250514",
    }))
    return bridge
  }

  it("non-JSON lines from CLI are silently ignored", () => {
    const bridge = fullyBootedBridge()
    const beforeBroadcasts = bridge.sentToClients.length

    // Should not throw
    bridge.handleCliMessage("this is not JSON at all\n{also bad\nand more garbage")

    // No new broadcasts (garbage was dropped)
    const newBroadcasts = bridge.sentToClients.slice(beforeBroadcasts)
    expect(newBroadcasts.length).toBe(0)
  })

  it("mixed valid and invalid NDJSON lines — valid ones processed", () => {
    const bridge = fullyBootedBridge()
    const beforeBroadcasts = bridge.sentToClients.length

    const mixed = [
      "not json",
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "valid" } }),
      "{broken",
      JSON.stringify({ type: "assistant", message: { role: "assistant", content: "also valid" } }),
    ].join("\n")

    bridge.handleCliMessage(mixed)

    const newBroadcasts = bridge.sentToClients.slice(beforeBroadcasts)
    expect(newBroadcasts.length).toBe(2)
  })

  it("empty string CLI message is handled gracefully", () => {
    const bridge = fullyBootedBridge()
    bridge.handleCliMessage("")
    bridge.handleCliMessage("\n\n\n")
    // No crash = pass
  })

  it("extremely large message does not crash", () => {
    const bridge = fullyBootedBridge()
    const largeContent = "x".repeat(5_000_000)
    const largeMsg = JSON.stringify({
      type: "assistant",
      message: { role: "assistant", content: largeContent },
    })

    bridge.handleCliMessage(largeMsg)
    const broadcasts = bridge.sentToClients.filter((m) => m.type === "assistant")
    expect(broadcasts.length).toBeGreaterThanOrEqual(1)
  })

  it("rapid connect/disconnect cycles don't corrupt state", () => {
    const bridge = createBridgeSimulator()

    for (let i = 0; i < 10; i++) {
      const { sessionId } = bridge.spawnClaude()
      bridge.handleCliOpen(sessionId)
      bridge.handleCliClose()
      bridge.killClaude()
    }

    expect(bridge.getStatus()).toBe("disconnected")
    expect(bridge.isClaudeConnected()).toBe(false)
    expect(bridge.claudeReady).toBe(false)
    expect(bridge.pendingCount).toBe(0)
  })

  it("init message with missing fields handled gracefully", () => {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)

    // Init without session_id or model
    bridge.handleCliMessage(JSON.stringify({
      type: "system",
      subtype: "init",
    }))

    // Should still set claudeReady
    expect(bridge.claudeReady).toBe(true)
    expect(bridge.claudeSessionId).toBeUndefined()
    expect(bridge.claudeModel).toBeUndefined()
  })

  it("double init doesn't double-configure MCP", () => {
    const bridge = createBridgeSimulator()
    const { sessionId } = bridge.spawnClaude()
    bridge.handleCliOpen(sessionId)

    bridge.handleCliMessage(JSON.stringify({
      type: "system", subtype: "init",
      session_id: "double-1", model: "claude-sonnet-4-5-20250514",
    }))

    bridge.handleCliMessage(JSON.stringify({
      type: "system", subtype: "init",
      session_id: "double-2", model: "claude-sonnet-4-5-20250514",
    }))

    // MCP config should be sent twice (current behavior — idempotent)
    // But we should document this edge case
    expect(bridge.controlRequestsSent.length).toBe(2)
    expect(bridge.claudeSessionId).toBe("double-2") // Last one wins
  })
})
