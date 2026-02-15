/**
 * Tool Dispatch E2E Test — validates the bridge tool dispatch pipeline.
 *
 * Tests the flow:
 *   1. Connect as WebSocket client (simulating extension)
 *   2. POST to /tool-dispatch (simulating MCP server)
 *   3. Client receives tool_request via WebSocket
 *   4. Client sends tool_response via WebSocket
 *   5. POST returns with the result
 *
 * Also tests:
 *   - Timeout behavior (no response from client)
 *   - Missing client (no WebSocket connection)
 *   - Invalid request bodies
 *
 * Usage: node packages/bridge/test-tool-dispatch.mjs
 *
 * Prerequisites:
 *   Bridge running: bun run packages/bridge/src/server.ts
 *   (Claude Code connection NOT required — tool dispatch is independent)
 */

const BRIDGE_URL = 'http://localhost:3848'
const WS_URL = 'ws://localhost:3848/client'

let passed = 0
let failed = 0

function assert(condition, message) {
  if (condition) {
    passed++
    console.log(`  ✓ ${message}`)
  } else {
    failed++
    console.log(`  ✗ ${message}`)
  }
}

// ─── Test 1: No client connected → 503 ─────────────────────

async function testNoClient() {
  console.log('\n=== Test 1: No client connected ===')

  // Check if there are existing clients (e.g. from Claude Code's MCP server)
  const statusRes = await fetch(`${BRIDGE_URL}/status`)
  const status = await statusRes.json()

  if (status.clients > 0) {
    console.log(`  ⚠ Skipping — ${status.clients} client(s) already connected (Claude Code MCP?)`)
    console.log(`  This test requires no clients. Run without Claude Code spawned.`)
    return
  }

  const res = await fetch(`${BRIDGE_URL}/tool-dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'test-1', name: 'atlas_get_extension_state', input: {} }),
  })

  assert(res.status === 503, `Status 503 (got ${res.status})`)
  const body = await res.json()
  assert(body.error?.includes('No browser extension'), `Error mentions extension: ${body.error}`)
}

// ─── Test 2: Invalid body → 400 ────────────────────────────

async function testInvalidBody() {
  console.log('\n=== Test 2: Invalid request body ===')

  // Missing name
  const res = await fetch(`${BRIDGE_URL}/tool-dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ id: 'test-2' }),
  })

  assert(res.status === 400, `Status 400 (got ${res.status})`)
  const body = await res.json()
  assert(body.error?.includes('Missing'), `Error mentions missing field: ${body.error}`)
}

// ─── Test 3: Happy path — client responds ───────────────────

async function testHappyPath() {
  console.log('\n=== Test 3: Happy path (client responds) ===')

  // Connect as WebSocket client
  const ws = new WebSocket(WS_URL)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
    setTimeout(() => reject(new Error('WS connect timeout')), 3000)
  })

  assert(true, 'WebSocket connected')

  // Set up listener for tool_request
  const toolRequestPromise = new Promise((resolve) => {
    ws.onmessage = (event) => {
      const msg = JSON.parse(event.data)
      if (msg.type === 'tool_request') {
        resolve(msg)
      }
    }
  })

  // POST tool dispatch
  const dispatchPromise = fetch(`${BRIDGE_URL}/tool-dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'test-3',
      name: 'atlas_get_extension_state',
      input: {},
    }),
  })

  // Wait for tool_request on WebSocket
  const toolRequest = await Promise.race([
    toolRequestPromise,
    new Promise((_, reject) => setTimeout(() => reject(new Error('Tool request timeout')), 3000)),
  ])

  assert(toolRequest.type === 'tool_request', `Received tool_request type`)
  assert(toolRequest.id === 'test-3', `ID matches: ${toolRequest.id}`)
  assert(toolRequest.name === 'atlas_get_extension_state', `Name matches: ${toolRequest.name}`)
  assert(typeof toolRequest.timestamp === 'number', `Has timestamp`)

  // Send tool_response back
  const response = {
    type: 'tool_response',
    id: 'test-3',
    result: {
      currentView: 'sidepanel',
      bridgeStatus: 'connected',
      claudeStatus: 'connected',
      tabUrl: 'https://example.com',
      tabTitle: 'Test Page',
    },
  }
  ws.send(JSON.stringify(response))

  // Wait for HTTP response
  const res = await dispatchPromise
  assert(res.status === 200, `HTTP status 200 (got ${res.status})`)

  const body = await res.json()
  assert(body.id === 'test-3', `Response ID matches: ${body.id}`)
  assert(!body.error, `No error in response`)
  assert(body.result?.currentView === 'sidepanel', `Result has currentView: ${body.result?.currentView}`)
  assert(body.result?.tabUrl === 'https://example.com', `Result has tabUrl`)

  ws.close()
}

// ─── Test 4: Timeout — client doesn't respond ──────────────

async function testTimeout() {
  console.log('\n=== Test 4: Timeout (client silent) ===')

  // Connect but never respond to tool_request
  const ws = new WebSocket(WS_URL)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
    setTimeout(() => reject(new Error('WS connect timeout')), 3000)
  })

  const start = Date.now()

  const res = await fetch(`${BRIDGE_URL}/tool-dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'test-4-timeout',
      name: 'atlas_read_current_page',
      input: {},
    }),
  })

  const elapsed = Date.now() - start
  const body = await res.json()

  assert(res.status === 200, `HTTP status 200 (timeout is returned in body, not status)`)
  assert(body.error?.includes('timed out'), `Error mentions timeout: ${body.error}`)
  assert(elapsed >= 4000, `Took at least 4s (took ${elapsed}ms)`)
  assert(elapsed < 10000, `Took less than 10s (took ${elapsed}ms)`)

  ws.close()
}

// ─── Test 5: Error response from client ─────────────────────

async function testErrorResponse() {
  console.log('\n=== Test 5: Error response from client ===')

  const ws = new WebSocket(WS_URL)
  await new Promise((resolve, reject) => {
    ws.onopen = resolve
    ws.onerror = reject
    setTimeout(() => reject(new Error('WS connect timeout')), 3000)
  })

  // Listen for tool_request and respond with error
  ws.onmessage = (event) => {
    const msg = JSON.parse(event.data)
    if (msg.type === 'tool_request') {
      ws.send(JSON.stringify({
        type: 'tool_response',
        id: msg.id,
        error: 'Current tab is not a LinkedIn page',
      }))
    }
  }

  const res = await fetch(`${BRIDGE_URL}/tool-dispatch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      id: 'test-5',
      name: 'atlas_get_linkedin_context',
      input: {},
    }),
  })

  const body = await res.json()

  assert(res.status === 200, `HTTP status 200`)
  assert(body.error === 'Current tab is not a LinkedIn page', `Error propagated: ${body.error}`)
  assert(!body.result, `No result when error`)

  ws.close()
}

// ─── Run ────────────────────────────────────────────────────

async function main() {
  console.log('\n=== Atlas Bridge Tool Dispatch E2E Tests ===')

  // Check bridge is running
  try {
    const status = await fetch(`${BRIDGE_URL}/status`)
    const data = await status.json()
    console.log(`Bridge status: ${data.status} (clients: ${data.clients})`)
  } catch {
    console.log('Bridge not reachable at', BRIDGE_URL)
    console.log('Start it with: bun run packages/bridge/src/server.ts')
    process.exit(1)
  }

  await testNoClient()
  await testInvalidBody()
  await testHappyPath()
  await testTimeout()
  await testErrorResponse()

  console.log(`\n=== Results: ${passed} passed, ${failed} failed ===\n`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((err) => {
  console.error('Test runner error:', err)
  process.exit(1)
})
