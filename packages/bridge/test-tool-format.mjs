/**
 * Step 3 — Live test: What does Claude Code's tool_use output look like?
 *
 * Spawns Claude Code with stream-json, sends a prompt that triggers
 * a built-in tool (Read), and captures ALL NDJSON lines to see the
 * exact format of tool_use blocks in the output.
 *
 * Usage: node packages/bridge/test-tool-format.mjs
 */

import { spawn } from 'child_process'

const CLAUDE_CMD = process.env.CLAUDE_PATH || 'claude'
const prompt = 'Read the file package.json in the current directory and tell me just the "name" field value. Be very brief — one line answer.'

console.log('\n=== Tool Format Discovery Test ===\n')
console.log(`Prompt: "${prompt}"`)
console.log(`Claude: ${CLAUDE_CMD}`)
console.log()

const proc = spawn(CLAUDE_CMD, [
  '-p',
  '--input-format', 'stream-json',
  '--output-format', 'stream-json',
  '--verbose',
], {
  cwd: process.cwd(),
  stdio: ['pipe', 'pipe', 'pipe'],
})

let allLines = []
let buffer = ''
let lineCount = 0

proc.stdout.on('data', (chunk) => {
  buffer += chunk.toString()

  let idx
  while ((idx = buffer.indexOf('\n')) !== -1) {
    const line = buffer.slice(0, idx).trim()
    buffer = buffer.slice(idx + 1)

    if (!line) continue
    lineCount++

    let parsed
    try {
      parsed = JSON.parse(line)
    } catch {
      console.log(`[${lineCount}] RAW: ${line.slice(0, 200)}`)
      allLines.push({ raw: line })
      continue
    }

    allLines.push(parsed)

    // Pretty-print each message with type highlighting
    const type = parsed.type || '?'
    const subtype = parsed.subtype || ''

    if (type === 'system') {
      console.log(`[${lineCount}] SYSTEM ${subtype}  model=${parsed.model || '?'}  tools=${parsed.tools?.length || 0}`)
    } else if (type === 'assistant') {
      const content = parsed.message?.content || []
      console.log(`[${lineCount}] ASSISTANT  blocks=${content.length}`)
      for (const block of content) {
        if (block.type === 'text') {
          console.log(`       TEXT: "${block.text.slice(0, 200)}"`)
        } else if (block.type === 'tool_use') {
          console.log(`       TOOL_USE: id=${block.id} name=${block.name}`)
          console.log(`       INPUT: ${JSON.stringify(block.input).slice(0, 300)}`)
        } else {
          console.log(`       ${block.type}: ${JSON.stringify(block).slice(0, 200)}`)
        }
      }
    } else if (type === 'result') {
      console.log(`[${lineCount}] RESULT  subtype=${parsed.subtype}  cost=$${parsed.total_cost_usd}  duration=${parsed.duration_ms}ms`)
      if (parsed.result) console.log(`       RESULT TEXT: "${parsed.result.slice(0, 200)}"`)
    } else {
      console.log(`[${lineCount}] ${type}: ${JSON.stringify(parsed).slice(0, 300)}`)
    }
  }
})

proc.stderr.on('data', (chunk) => {
  const text = chunk.toString().trim()
  if (text) console.log(`[stderr] ${text}`)
})

// Send the prompt
const msg = JSON.stringify({
  type: 'user',
  message: { role: 'user', content: prompt },
}) + '\n'

proc.stdin.write(msg)
proc.stdin.end()

// Timeout
const timeout = setTimeout(() => {
  console.log('\n[TIMEOUT 90s]')
  proc.kill()
}, 90000)

proc.on('close', (code) => {
  clearTimeout(timeout)
  console.log(`\nProcess exited: code=${code}`)
  console.log(`Total NDJSON lines: ${lineCount}`)

  // Dump full raw output for analysis
  console.log('\n=== Full JSON dump ===')
  console.log(JSON.stringify(allLines, null, 2))
})
