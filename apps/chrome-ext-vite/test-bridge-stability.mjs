/**
 * Playwright test — Bridge connection stability across view switches.
 *
 * Tests the exact bug reported: WebSocket disconnects when navigating
 * between side panel views, then fails to send messages on return.
 *
 * Requires:
 *   - Extension built: bun run build (in apps/chrome-ext-vite/)
 *   - Bridge NOT running (test manages its own bridge subprocess)
 *
 * Usage:
 *   node test-bridge-stability.mjs
 *
 * The test spins up a mock bridge server internally to avoid needing
 * a real Claude Code connection.
 */

import { chromium } from 'playwright'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'
import { WebSocketServer, WebSocket } from 'ws'
import http from 'http'

const __dirname = dirname(fileURLToPath(import.meta.url))
const extensionPath = resolve(__dirname, 'dist')
const userDataDir = resolve(__dirname, '.test-profile-bridge')

// ─── Test Results Tracking ───────────────────────────────────

let passed = 0
let failed = 0
const results = []

function assert(condition, label) {
  if (condition) {
    passed++
    results.push({ pass: true, label })
    console.log(`  \x1b[32mPASS\x1b[0m ${label}`)
  } else {
    failed++
    results.push({ pass: false, label })
    console.log(`  \x1b[31mFAIL\x1b[0m ${label}`)
  }
}

// ─── Mock Bridge Server ──────────────────────────────────────
// Mimics the real bridge on port 3848 but without Claude Code.
// Tracks connections and echoes messages for testing.

const PORT = 3848
const clientConnections = new Set()
let claudeConnected = false
let messageLog = []

const httpServer = http.createServer((req, res) => {
  if (req.url === '/status' && req.method === 'GET') {
    res.writeHead(200, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
    })
    res.end(JSON.stringify({
      status: 'ok',
      claude: claudeConnected ? 'connected' : 'disconnected',
      clients: clientConnections.size,
    }))
    return
  }
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    })
    res.end()
    return
  }
  res.writeHead(404)
  res.end('Not Found')
})

// WebSocket for /client endpoint
const wss = new WebSocketServer({ noServer: true })

httpServer.on('upgrade', (req, socket, head) => {
  if (req.url === '/client') {
    wss.handleUpgrade(req, socket, head, (ws) => {
      wss.emit('connection', ws, req)
    })
  } else {
    socket.destroy()
  }
})

let totalConnectionsEver = 0

wss.on('connection', (ws) => {
  const id = `client-${Date.now()}`
  clientConnections.add(id)
  totalConnectionsEver++
  console.log(`  [mock-bridge] Client connected (active: ${clientConnections.size}, total ever: ${totalConnectionsEver})`)

  ws.on('message', (data) => {
    const msg = JSON.parse(data.toString())
    messageLog.push({ from: id, msg, at: Date.now() })
    console.log(`  [mock-bridge] Received: ${JSON.stringify(msg).slice(0, 100)}`)

    // Echo back as a mock assistant response (simulates claude → client)
    if (msg.type === 'user_message') {
      const text = msg.content?.[0]?.text || ''
      // Send a stream_event with message_start
      ws.send(JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'message_start',
          message: { id: `resp-${Date.now()}`, type: 'message', role: 'assistant', content: [] },
        },
      }))
      // Send text delta
      ws.send(JSON.stringify({
        type: 'stream_event',
        event: {
          type: 'content_block_delta',
          index: 0,
          delta: { type: 'text_delta', text: `Echo: ${text}` },
        },
      }))
      // Send message_stop
      ws.send(JSON.stringify({
        type: 'stream_event',
        event: { type: 'message_stop' },
      }))
    }
  })

  ws.on('close', () => {
    clientConnections.delete(id)
    console.log(`  [mock-bridge] Client disconnected (${clientConnections.size} total)`)
  })

  // Send claude_connected event so the UI shows "ready"
  ws.send(JSON.stringify({ type: 'system', event: 'claude_connected' }))
})

// ─── Helpers ─────────────────────────────────────────────────

async function findSidePanelPage(context, timeout = 15000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    for (const page of context.pages()) {
      const url = page.url()
      if (url.includes('sidepanel') || url.includes('side_panel') || url.includes('panel.html')) {
        return page
      }
    }
    await new Promise(r => setTimeout(r, 500))
  }
  return null
}

async function clickNavButton(page, label) {
  // NavRail buttons have title={label}
  const btn = await page.$(`button[title="${label}"]`)
  if (btn) {
    await btn.click()
    await page.waitForTimeout(300) // let React render
    return true
  }
  return false
}

async function getConnectionCount() {
  return clientConnections.size
}

// ─── Main Test ───────────────────────────────────────────────

console.log('\n\x1b[1m═══ Bridge Stability Test Suite ═══\x1b[0m\n')

// Start mock bridge
await new Promise((resolve) => httpServer.listen(PORT, resolve))
console.log(`Mock bridge listening on port ${PORT}\n`)

// Simulate Claude being connected
claudeConnected = true

let context, page, sidePanel

try {
  // ── Setup ──

  console.log('Launching Chrome with extension...')
  context = await chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
      '--no-first-run',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1400, height: 900 },
    ignoreHTTPSErrors: true,
  })

  page = context.pages()[0] || await context.newPage()

  // Navigate to LinkedIn (uses persistent profile for login)
  console.log('Navigating to LinkedIn...')
  await page.goto('https://www.linkedin.com/feed/', {
    waitUntil: 'domcontentloaded',
    timeout: 30000,
  })
  await page.waitForTimeout(3000)

  // Check login status
  const isLoggedIn = await page.evaluate(() => {
    return !window.location.href.includes('/login') && !window.location.href.includes('/authwall')
  })

  if (!isLoggedIn) {
    console.log('\n  WARNING: Not logged in to LinkedIn. Some tests may behave differently.')
    console.log('  Run test-selectors.mjs first to set up the persistent profile.\n')
  }

  // Try to open side panel via extension icon
  // Note: Playwright can't directly click the extension icon, so we try
  // opening the side panel URL directly
  console.log('Looking for side panel...')

  // Find extension ID from service worker
  let extensionId = null
  for (const sw of context.serviceWorkers()) {
    const url = sw.url()
    if (url.includes('chrome-extension://')) {
      const match = url.match(/chrome-extension:\/\/([^/]+)/)
      if (match) extensionId = match[1]
    }
  }

  if (!extensionId) {
    // Try to find from pages
    await page.waitForTimeout(2000)
    for (const p of context.pages()) {
      const url = p.url()
      const match = url.match(/chrome-extension:\/\/([^/]+)/)
      if (match) {
        extensionId = match[1]
        break
      }
    }
  }

  if (extensionId) {
    console.log(`Extension ID: ${extensionId}`)
    // Open side panel page directly (manifest says "sidepanel.html")
    sidePanel = await context.newPage()
    await sidePanel.goto(`chrome-extension://${extensionId}/sidepanel.html`, {
      waitUntil: 'domcontentloaded',
      timeout: 10000,
    })
  } else {
    // Try to find side panel from existing pages
    sidePanel = await findSidePanelPage(context)
  }

  if (!sidePanel) {
    console.log('\x1b[31mCould not open side panel. Trying fallback...\x1b[0m')
    // Last resort: enumerate pages
    console.log('Open pages:')
    for (const p of context.pages()) {
      console.log(`  ${p.url()}`)
    }
    throw new Error('Side panel not found')
  }

  console.log(`Side panel URL: ${sidePanel.url()}`)
  await sidePanel.waitForTimeout(2000) // Let hooks initialize

  // ── TEST 1: Initial Connection ──
  console.log('\n\x1b[1mTest Group 1: Initial Connection\x1b[0m')

  // Wait for WebSocket to connect
  await sidePanel.waitForTimeout(3000)
  assert(clientConnections.size >= 1, 'Client WebSocket connects on load')

  const initialCount = clientConnections.size

  // ── TEST 2: Navigate to Claude Tab ──
  console.log('\n\x1b[1mTest Group 2: Claude Tab Navigation\x1b[0m')

  const clickedClaude = await clickNavButton(sidePanel, 'Claude')
  assert(clickedClaude, 'Claude nav button exists and is clickable')
  await sidePanel.waitForTimeout(1000)

  // Should see the Claude panel content
  const hasStatusBar = await sidePanel.$('.flex.items-center.gap-3')
  assert(!!hasStatusBar, 'Status bar renders in Claude view')

  // Check that Bridge shows connected
  const bridgeDots = await sidePanel.$$eval('.w-2.h-2.rounded-full', (dots) =>
    dots.map(d => d.className)
  )
  const hasGreenDot = bridgeDots.some(c => c.includes('bg-green-500'))
  assert(hasGreenDot, 'Bridge status shows green (connected)')

  // Connection count should be unchanged (no new connections)
  assert(clientConnections.size === initialCount, 'No extra connections created when switching to Claude tab')

  // ── TEST 3: View Switching Stability (THE BUG) ──
  console.log('\n\x1b[1mTest Group 3: View Switching Stability\x1b[0m')

  // Wait for any pending reconnects to settle
  await sidePanel.waitForTimeout(2000)
  const preNavConnections = totalConnectionsEver
  const preNavActive = clientConnections.size

  // Switch through all views and back to Claude — log connection count at each step
  const viewCycle = ['Outreach', 'Inbox', 'Studio', 'Data', 'Atlas', 'Settings', 'Claude']
  for (const v of viewCycle) {
    await clickNavButton(sidePanel, v)
    await sidePanel.waitForTimeout(500)
    if (totalConnectionsEver > preNavConnections) {
      console.log(`  [!] New connection appeared after switching to: ${v} (total: ${totalConnectionsEver})`)
    }
  }

  // Wait for any async reconnect attempts
  await sidePanel.waitForTimeout(2000)

  // Key assertions: no NEW connections were created during view switching
  assert(
    totalConnectionsEver === preNavConnections,
    `No new connections during view cycle (before: ${preNavConnections}, after: ${totalConnectionsEver})`
  )
  assert(
    clientConnections.size >= 1,
    `At least one active connection after view cycle (active: ${clientConnections.size})`
  )
  assert(
    clientConnections.size <= preNavActive,
    `No connection leak after view cycle (before: ${preNavActive}, after: ${clientConnections.size})`
  )

  // ── TEST 4: Send Message After View Switch ──
  console.log('\n\x1b[1mTest Group 4: Message Send After View Switch\x1b[0m')

  messageLog = [] // clear

  // Type and send a message
  const textarea = await sidePanel.$('textarea')
  assert(!!textarea, 'Textarea input exists')

  if (textarea) {
    const isDisabled = await textarea.evaluate((el) => el.disabled)
    assert(!isDisabled, 'Textarea is enabled (not disabled)')

    await textarea.fill('Hello from Playwright test')
    const sendBtn = await sidePanel.$('button:has-text("Send")')
    assert(!!sendBtn, 'Send button exists')

    if (sendBtn) {
      const sendDisabled = await sendBtn.evaluate((el) => el.disabled)
      assert(!sendDisabled, 'Send button is enabled')

      if (!sendDisabled) {
        await sendBtn.click()
        await sidePanel.waitForTimeout(2000)

        // Check that message was received by mock bridge
        assert(messageLog.length > 0, 'Mock bridge received the message')

        if (messageLog.length > 0) {
          const lastMsg = messageLog[messageLog.length - 1].msg
          assert(
            lastMsg.type === 'user_message' && lastMsg.content?.[0]?.text === 'Hello from Playwright test',
            'Message content matches what was typed'
          )
        }

        // Check that echo response appeared in UI
        const bubbles = await sidePanel.$$('.whitespace-pre-wrap.break-words')
        assert(bubbles.length >= 2, 'Both user and assistant message bubbles rendered')
      }
    }
  }

  // ── TEST 5: Rapid View Switching (Stress) ──
  console.log('\n\x1b[1mTest Group 5: Rapid View Switching Stress Test\x1b[0m')

  const preStressTotal = totalConnectionsEver
  const views = ['Outreach', 'Claude', 'Inbox', 'Claude', 'Studio', 'Claude', 'Data', 'Claude', 'Atlas', 'Claude']

  for (const v of views) {
    await clickNavButton(sidePanel, v)
    await sidePanel.waitForTimeout(200) // rapid switching
  }

  await sidePanel.waitForTimeout(2000) // settle
  assert(
    totalConnectionsEver === preStressTotal,
    `No new connections during rapid switching (before: ${preStressTotal}, after: ${totalConnectionsEver})`
  )
  assert(
    clientConnections.size >= 1,
    `Connection still active after rapid switching (active: ${clientConnections.size})`
  )

  // ── TEST 6: Messages persist across view switches ──
  console.log('\n\x1b[1mTest Group 6: Message Persistence\x1b[0m')

  // We should still be on Claude tab from the rapid switching
  // Check that previous messages are still there
  const persistedBubbles = await sidePanel.$$('.whitespace-pre-wrap.break-words')
  assert(persistedBubbles.length >= 2, 'Previous messages persisted across view switches')

} catch (err) {
  console.error('\n\x1b[31mTest error:\x1b[0m', err.message)
  failed++
  results.push({ pass: false, label: `CRASH: ${err.message}` })
} finally {
  // ── Summary ──
  console.log(`\n\x1b[1m═══ Results: ${passed} passed, ${failed} failed (${passed + failed} total) ═══\x1b[0m`)

  if (failed > 0) {
    console.log('\nFailed tests:')
    for (const r of results) {
      if (!r.pass) console.log(`  \x1b[31m✗\x1b[0m ${r.label}`)
    }
  }

  console.log()

  // Cleanup
  if (context) {
    try { await context.close() } catch {}
  }
  httpServer.close()
  wss.close()

  process.exit(failed > 0 ? 1 : 0)
}
