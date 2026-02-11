# DEC-008: Atlas Bridge Architecture

**Status:** Accepted
**Date:** 2026-02-10
**Phase:** 3 (MVP Relay)

## Context

Atlas needs to connect the Chrome extension side panel to a running Claude Code instance. Claude Code supports an undocumented `--sdk-url` flag that makes it connect to a WebSocket server and exchange NDJSON messages instead of running as a terminal app.

The Chrome extension's MV3 service worker cannot hold persistent WebSocket connections (killed after 30s of inactivity). The side panel, however, stays alive as long as it's open.

## Decision

Build a local Bun WebSocket relay server (`packages/bridge/`) that:

1. **Listens on port 3848** with two endpoints:
   - `/claude` — Claude Code connects here (single connection)
   - `/client` — Chrome extension side panel connects here (multiple)

2. **Uses a middleware handler chain** (envelope → handler → next pattern):
   - Phase 3: single `relayHandler` that passes messages through
   - Phase 5+: `triageHandler` inserted before relay for cognitive routing

3. **Wraps messages in BridgeEnvelope** with metadata (surface, sessionId, timestamp, direction) that future phases will need for routing decisions

4. **Lives in a feature branch** (`feature/bridge-phase3-mvp`) so if `--sdk-url` disappears from Claude Code, we delete the branch with zero production impact

## Architecture

```
Chrome Extension (Side Panel)
  └─ WebSocket ──► ws://localhost:3848/client
                        │
                   Atlas Bridge (Bun)
                        │
  Claude Code ◄── WebSocket ──► ws://localhost:3848/claude
  (--sdk-url)
```

### Message Flow

```
User types in ClaudeCodePanel
  → useClaudeCode() sends { type: "user_message", content: [...] }
  → Bridge wraps in BridgeEnvelope
  → relayHandler forwards to Claude Code
  → Claude Code streams back stream_event messages
  → Bridge wraps each in BridgeEnvelope
  → relayHandler broadcasts to all clients
  → useClaudeCode() accumulates text_delta events
  → ClaudeCodePanel renders streaming text
```

## Alternatives Considered

### Direct WebSocket from extension to Claude Code
Rejected — no middleware insertion point for Phase 5 triage. Also, Chrome MV3 service workers can't hold WebSocket connections.

### HTTP polling instead of WebSocket
Rejected — streaming requires real-time delivery. Polling would add latency and complexity for streaming text deltas.

### Shared process (embed bridge in Telegram bot)
Rejected — different lifecycle, different machine. Bridge runs on desktop alongside Chrome; Telegram bot may run on a server.

## Consequences

- **Positive:** Clean separation of concerns. Bridge handles transport, handlers handle logic. Phase 5 triage inserts without rearchitecting.
- **Positive:** Feature branch isolation means zero risk to production.
- **Negative:** Dependency on undocumented `--sdk-url` protocol. Mitigated by branch isolation.
- **Negative:** Extra process to start. Mitigated by clear startup instructions in the UI.

## File Map

```
packages/bridge/
├── package.json
├── tsconfig.json
└── src/
    ├── server.ts           # Bun WebSocket server (port 3848)
    ├── connections.ts       # Connection tracking + health checks
    ├── handlers/
    │   ├── index.ts         # Handler chain composition
    │   └── relay.ts         # Phase 3 passthrough handler
    └── types/
        ├── sdk-protocol.ts  # Claude Code NDJSON message types
        └── bridge.ts        # Envelope, connection, handler types

apps/chrome-ext-vite/
├── src/
│   ├── types/claude-sdk.ts  # Client-side SDK types
│   └── lib/claude-code-hooks.ts  # useClaudeCode() React hook
└── sidepanel/
    └── components/
        └── ClaudeCodePanel.tsx    # Streaming chat UI
```
