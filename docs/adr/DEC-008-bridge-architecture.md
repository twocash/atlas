# DEC-008: Atlas Bridge Architecture

**Status:** Accepted (Revised)  
**Date:** 2026-02-10  
**Revised:** 2026-02-11  
**Phase:** 3 (MVP Relay)

## Context

Atlas needs to connect the Chrome extension side panel to Claude Code. Initial research suggested Claude Code supported an undocumented `--sdk-url` flag for WebSocket connections. **This was incorrect.**

Live testing revealed the actual Claude Code CLI protocol: NDJSON over stdin/stdout using the flags `-p --input-format stream-json --output-format stream-json --verbose`. The bridge must spawn Claude Code as a child process and adapt stdio to WebSocket for the browser client.

## Decision

Build a local Bun **stdio-to-WebSocket adapter** (`packages/bridge/`) that:

1. **Spawns Claude Code as child process** with streaming JSON flags:
   ```
   claude -p --input-format stream-json --output-format stream-json --verbose
   ```

2. **Listens on port 3848** with two endpoints:
   - `/client` — Chrome extension side panel connects here
   - `/status` — Health check endpoint (HTTP GET)

3. **Bridges stdio ↔ WebSocket:**
   - Client WebSocket messages → write to Claude stdin
   - Claude stdout lines → broadcast to all WebSocket clients

4. **Handles three message types from Claude:**
   - `system` (subtype: `init`) — session ID, model, available tools
   - `assistant` — streaming response content
   - `result` — completion with duration and cost

## Architecture

```
Chrome Extension (Side Panel)
  └─ WebSocket ──► ws://localhost:3848/client
                        │
                   Atlas Bridge (Bun)
                        │
                   ┌────┴────┐
                stdin      stdout
                   │         │
                   ▼         ▼
              Claude Code (child process)
              claude -p --input-format stream-json
                        --output-format stream-json
                        --verbose
```

### Message Flow

```
User types in ClaudeCodePanel
  → useClaudeCode() sends { type: "user", message: {...} }
  → Bridge writes JSON line to Claude stdin
  → Claude processes, streams to stdout
  → Bridge reads stdout lines (NDJSON)
  → Bridge broadcasts to all WebSocket clients
  → useClaudeCode() handles by message type:
      - system:init → store session, model, tools
      - assistant → accumulate response text
      - result → display cost, mark complete
  → ClaudeCodePanel renders streaming text
```

### Protocol Format (Actual)

**Client → Bridge → Claude stdin:**
```json
{"type":"user","message":{"role":"user","content":"What is 2+2?"}}
```

**Claude stdout → Bridge → Client:**
```json
{"type":"system","subtype":"init","session_id":"uuid","model":"claude-sonnet-4-5-20250929","tools":[...]}
{"type":"assistant","message":{"role":"assistant","content":"Four."}}
{"type":"result","subtype":"success","duration_ms":1664,"cost_usd":0.42,"session_id":"uuid"}
```

## Alternatives Considered

### WebSocket relay using `--sdk-url`
**Rejected** — Protocol doesn't exist. Initial research was based on third-party implementations that wrapped stdio themselves. Claude Code CLI has no native WebSocket mode.

### Direct WebSocket from extension to Claude Code
**Rejected** — Claude Code has no WebSocket server. Also, Chrome MV3 service workers can't hold persistent connections.

### HTTP polling instead of WebSocket
**Rejected** — Streaming requires real-time delivery. Polling adds latency for text deltas.

## Consequences

- **Positive:** Clean separation of concerns. Bridge handles process lifecycle and transport.
- **Positive:** Real protocol verified with live testing — no undocumented API risk.
- **Positive:** Cost visibility built-in (`result.cost_usd` in every response).
- **Negative:** Extra process to start. Mitigated by clear startup instructions in UI.
- **Negative:** Claude process lifecycle tied to bridge — bridge crash kills Claude session.

## Risk Update

| Original Risk | Status | Notes |
|---------------|--------|-------|
| `--sdk-url` protocol changes/removed | **Eliminated** | Protocol doesn't exist; we use documented CLI flags |
| MV3 service worker kills WebSocket | **Unchanged** | Side panel holds connection, not service worker |
| Claude Code must be running | **Changed** | Bridge spawns Claude — single process start |

## File Map

```
packages/bridge/
├── package.json
├── tsconfig.json
├── test-e2e.mjs            # Live E2E test (real Claude)
└── src/
    ├── server.ts           # Bun stdio-to-WebSocket adapter
    ├── connections.ts       # Client connection tracking
    ├── handlers/
    │   ├── index.ts         # Handler chain composition
    │   └── relay.ts         # Message routing
    └── types/
        ├── sdk-protocol.ts  # Claude CLI NDJSON types (revised)
        └── bridge.ts        # Envelope, connection types

apps/chrome-ext-vite/
├── src/
│   ├── types/claude-sdk.ts  # Client types (system, assistant, result)
│   └── lib/claude-code-hooks.ts  # useClaudeCode() React hook
└── sidepanel/
    └── components/
        └── ClaudeCodePanel.tsx    # Streaming chat UI
```

## Lessons Learned

1. **Third-party implementations are not protocol documentation.** Community repos (companion, claude-agent-server) implemented their own stdio wrappers — they weren't using an undocumented `--sdk-url` flag.

2. **Live testing beats research.** The protocol pivot happened during verification, not planning. Spec said one thing; live testing revealed reality.

3. **Stdio is simpler.** No connection management between bridge and Claude. Spawn, write, read, done.
