/**
 * Live end-to-end test for the Atlas Bridge.
 *
 * Prerequisites:
 *   Bridge running: bun run packages/bridge/src/server.ts
 *   (Bridge auto-spawns Claude Code as a child process)
 *
 * This script connects as a client, sends a message, and captures
 * the response from Claude via the stdio-to-WebSocket bridge.
 *
 * Usage: node packages/bridge/test-e2e.mjs [message]
 */

const BRIDGE_URL = 'ws://localhost:3848/client'
const STATUS_URL = 'http://localhost:3848/status'

const userMessage = process.argv[2] || 'What is 2 + 2? Reply in one word.'

// ─── Pre-flight: check bridge status ─────────────────────────

console.log('\n=== Atlas Bridge E2E Test ===\n')

try {
  const res = await fetch(STATUS_URL)
  const status = await res.json()
  console.log('Bridge status:', JSON.stringify(status, null, 2))

  if (status.claude !== 'connected') {
    console.log('\n  Claude Code is not connected.')
    console.log('  The bridge auto-spawns Claude — it may still be starting.')
    console.log('  Wait a moment and try again, or check bridge logs.\n')
    process.exit(1)
  }
} catch (err) {
  console.log('Bridge not reachable at', STATUS_URL)
  console.log('  Start it with: bun run packages/bridge/src/server.ts\n')
  process.exit(1)
}

// ─── Connect as client ───────────────────────────────────────

console.log(`\nConnecting to ${BRIDGE_URL}...`)

const ws = new WebSocket(BRIDGE_URL)
let responseText = ''
let receivedAssistant = false
let receivedResult = false
let receivedInit = false
let toolCalls = []
let costUsd = null
let durationMs = null
const startTime = Date.now()

ws.onopen = () => {
  console.log('Connected as client.\n')

  // Wait a beat for any init messages, then send
  setTimeout(() => {
    const payload = {
      type: 'user_message',
      content: [{ type: 'text', text: userMessage }],
    }
    console.log(`>>> Sending: "${userMessage}"`)
    console.log()
    ws.send(JSON.stringify(payload))
  }, 500)
}

ws.onmessage = (event) => {
  const lines = event.data.split('\n').filter(l => l.trim())

  for (const line of lines) {
    let msg
    try {
      msg = JSON.parse(line)
    } catch {
      console.log('[!] Invalid JSON:', line.slice(0, 100))
      continue
    }

    // ─── System events ───────────────────────────────────
    if (msg.type === 'system') {
      if (msg.subtype === 'init') {
        // Claude Code CLI init
        receivedInit = true
        console.log(`[system:init] session: ${msg.session_id}`)
        console.log(`[system:init] model: ${msg.model}`)
        if (msg.tools) {
          console.log(`[system:init] tools: ${msg.tools.length} available`)
        }
      } else if (msg.event) {
        // Bridge-originated event
        console.log(`[system] ${msg.event}`, msg.data ? JSON.stringify(msg.data).slice(0, 150) : '')
      }
      continue
    }

    // ─── Assistant message (complete turn) ────────────────
    if (msg.type === 'assistant') {
      receivedAssistant = true
      const content = msg.message?.content || []
      for (const block of content) {
        if (block.type === 'text') {
          responseText += block.text
          process.stdout.write(block.text)
        } else if (block.type === 'tool_use') {
          toolCalls.push(block.name)
          console.log(`[tool_use] ${block.name}`)
        }
      }
      const model = msg.message?.model || 'unknown'
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      console.log(`\n\n[assistant] model: ${model} (${elapsed}s)`)
      continue
    }

    // ─── Result message (final) ──────────────────────────
    if (msg.type === 'result') {
      receivedResult = true
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(1)
      costUsd = msg.total_cost_usd
      durationMs = msg.duration_ms
      console.log(`[result] subtype: ${msg.subtype} (${elapsed}s)`)
      if (msg.result) console.log(`[result] text: ${msg.result.slice(0, 200)}`)
      if (msg.duration_ms) console.log(`[result] duration: ${msg.duration_ms}ms`)
      if (msg.total_cost_usd != null) console.log(`[result] cost: $${msg.total_cost_usd}`)
      if (msg.subtype === 'error') {
        console.log(`[result] ERROR: ${msg.error}`)
      }
      continue
    }

    // ─── Legacy stream events (fallback) ─────────────────
    if (msg.type === 'stream_event') {
      const ev = msg.event
      console.log(`[stream_event] ${ev?.type}`)
      if (ev?.type === 'content_block_delta' && ev?.delta?.type === 'text_delta') {
        process.stdout.write(ev.delta.text)
        responseText += ev.delta.text
      }
      continue
    }

    // Unknown
    console.log(`[???] Unknown type: ${msg.type}`, JSON.stringify(msg).slice(0, 100))
  }
}

ws.onerror = (err) => {
  console.error('WebSocket error:', err.message || err)
}

ws.onclose = (event) => {
  console.log(`\nWebSocket closed: code=${event.code} reason="${event.reason}"`)
  printSummary()
  process.exit(receivedResult ? 0 : 1)
}

// Timeout after 60 seconds
setTimeout(() => {
  console.log('\n  Timeout (60s) — closing.')
  printSummary()
  ws.close()
  process.exit(responseText.length > 0 ? 0 : 1)
}, 60000)

// Wait for result then close cleanly after a brief pause
const checkDone = setInterval(() => {
  if (receivedResult) {
    clearInterval(checkDone)
    setTimeout(() => {
      printSummary()
      ws.close()
      process.exit(0)
    }, 1000)
  }
}, 500)

function printSummary() {
  console.log('\n=== Summary ===')
  console.log(`  system init:   ${receivedInit ? 'YES' : 'no'}`)
  console.log(`  assistant msg: ${receivedAssistant ? 'YES' : 'no'}`)
  console.log(`  result msg:    ${receivedResult ? 'YES' : 'no'}`)
  console.log(`  response:      ${responseText.length} chars`)
  console.log(`  tool calls:    ${toolCalls.length > 0 ? toolCalls.join(', ') : 'none'}`)
  if (costUsd != null) console.log(`  cost:          $${costUsd}`)
  if (durationMs != null) console.log(`  duration:      ${durationMs}ms`)
  console.log(`  elapsed:       ${((Date.now() - startTime) / 1000).toFixed(1)}s`)
  console.log()
}
