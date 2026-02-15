# Atlas Bridge: Cognitive Channel Architecture

**Status:** Vision Document (supersedes SDK-URL-INTEGRATION.md)  
**Date:** 2026-02-11  
**Phase:** 3 complete, 4-8 ahead  
**Philosophical Foundation:** [Philosophy of Cognitive Partnership](./philosophy-of-cognitive-partnership.md)

---

## Core Thesis

The Bridge is not a feature. It's the completion of Atlas's cognitive architecture.

Atlas began as external executive function — a system that observes, remembers, and acts so Jim doesn't have to. But until now, all interaction required initiation: open Telegram, type a command, wait for response. This violates a core principle:

> "A feature that requires the user to remember to use it has failed before it started."

The Bridge eliminates initiation. Claude is always there, one click away in the browser Jim already has open. The panel persists. The connection persists. Context persists. There is no "remember to check Atlas" — Atlas is part of the surface Jim works on.

This is the difference between a tool and an extended mind.

---

## What the Bridge Unlocks

### 1. Zero-Initiation Access

**Before:** Open terminal → `cd atlas` → `bun run dev` → type command → wait → parse output  
**After:** Click Claude tab → type thought → receive response

The cognitive cost of initiation drops to near zero. This matters because ADHD task initiation is a scarce neurological resource. Every friction point is a potential failure point.

### 2. Continuous Cognitive Channel

The Telegram bot is transactional: request → response → silence. The Bridge is continuous: streaming responses, persistent context, ongoing dialogue.

This maps to how thinking actually works. You don't "make a request to your memory" — you just remember. You don't "send a query to your judgment" — you just evaluate. The Bridge makes Claude feel like an extension of cognition, not a service to invoke.

### 3. Visual Context Integration

Claude now lives where Jim works: in the browser, beside LinkedIn, beside research, beside content. The side panel sees what Jim sees. Phase 4 (Tool Dispatch) will let Claude act on what it sees.

No more copying URLs into Telegram. No more describing what's on screen. The extended mind operates on the actual environment.

### 4. Cost Visibility

Every response includes `cost_usd`. No surprise bills. No anxiety about "is this costing too much." The cognitive load of cost monitoring is externalized.

Trust requires transparency. Showing the cost of each interaction builds trust that the system isn't hiding anything.

### 5. Foundation for Cognitive Routing

The Bridge handler chain is where Phase 5's triage logic will live. Before a message ever reaches Claude:

- **Tier 0** (instant): Pattern-matched actions execute immediately. No model call.
- **Tier 1** (queued): Actions that need batch approval get queued to Feed 2.0.
- **Tier 2** (explicit): High-risk actions surface for individual approval.
- **Tier 3** (Claude): Only genuinely novel requests reach the model.

This is pattern-based approval at the infrastructure level. One approval enables unlimited future actions of that type — without Claude's involvement.

---

## Architectural Reality

### What We Built (Phase 3)

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

The Bridge spawns Claude as a child process. No separate terminal. No manual startup. Open panel → Bridge starts → Claude spawns → ready.

### Protocol (Verified Live)

**Client → Bridge → Claude:**
```json
{"type":"user","message":{"role":"user","content":"What should I work on next?"}}
```

**Claude → Bridge → Client:**
```json
{"type":"system","subtype":"init","session_id":"uuid","model":"claude-sonnet-4-5-20250929","tools":[99 tools]}
{"type":"assistant","message":{"role":"assistant","content":"Based on your Feed, the P0 item is..."}}
{"type":"result","subtype":"success","duration_ms":1664,"cost_usd":0.42}
```

### What's Available

Claude spawns with **99 tools** including:
- Full MCP toolkit (Notion, file system, web)
- Code execution
- Research dispatch
- All Anthropic-native capabilities

This is not a chat interface. It's a command surface with natural language input.

---

## Risks to Mitigate

### R1: Process Lifecycle Fragility

**Risk:** Bridge crash kills Claude session. Context lost.  
**Mitigation (Phase 4):** Process supervision with automatic restart. Session persistence to disk. Reconnection handshake that recovers state.

### R2: Cost Runaway

**Risk:** Easy access makes it easy to burn money. Casual questions become expensive habits.  
**Mitigation:** 
- Per-response cost display (shipped)
- Session cost accumulator (Phase 4)
- Daily budget alerts (Phase 5)
- Cost caps with override (Phase 5)

### R3: Context Window Exhaustion

**Risk:** Long conversations fill the context window. Claude starts forgetting.  
**Mitigation (Phase 5):** Session summarization. Automatic context compaction. "Start fresh but keep learnings" pattern.

### R4: Approval Fatigue

**Risk:** If everything goes through Claude, pattern-based approval becomes "approve this response" which recreates cognitive load.  
**Mitigation (Phase 5):** Triage before Claude. Tier 0/1/2 actions never reach the model. Only genuinely novel requests require Claude's judgment.

### R5: Shame Exposure

**Risk:** Chat history shows abandoned threads, incomplete thoughts, things that didn't work.  
**Mitigation:** 
- No "you didn't finish this" notifications
- Sessions are ephemeral by default (opt-in persistence)
- Failures handled gracefully, not surfaced accusingly
- The system assumes positive intent

### R6: Interruption Temptation

**Risk:** Easy Claude access becomes a distraction. "Let me just ask Claude about this tangent..."  
**Mitigation (Phase 6):** Mode awareness. During focus periods, Claude can defer non-urgent queries. "You're in flow. Want me to save this for later?"

---

## Maximizing the Philosophical Model

### The Extended Mind Checklist

For every Bridge feature, ask:

| Question | If Yes | If No |
|----------|--------|-------|
| Does this require initiation? | Eliminate the requirement | ✓ Good |
| Does this require decision-making? | Batch or make once | ✓ Good |
| Does this require memory? | Externalize completely | ✓ Good |
| Does this surface failure? | Handle without shame | Redesign |
| Does this interrupt? | Is it worth the cost? | Remove or defer |

### The Feel Test

The Bridge should feel like:
- A brilliant colleague who's always available
- A trusted advisor who remembers everything
- An extension of your own thinking

The Bridge should NOT feel like:
- A chatbot you have to prompt carefully
- A service with rate limits and quotas
- A tool you remember to use

### The Lodestar

> Does this reduce cognitive load on the user, or does it add to it?

If Claude asks a clarifying question, that's cognitive load. Can we infer instead?  
If Claude offers options, that's cognitive load. Can we recommend instead?  
If Claude waits for input, that's cognitive load. Can we be proactive instead?

The goal is a better brain, not a better chat interface.

---

## Phase Roadmap

| Phase | Name | What It Adds |
|-------|------|--------------|
| 3 ✅ | MVP Relay | Basic channel — type, receive, stream |
| 4 | Tool Dispatch | Claude can act on the page (click, fill, navigate) |
| 5 | Cognitive Routing | Tier-based triage before Claude, cost tracking, session persistence |
| 6 | Multi-Model | Haiku for quick, Opus for complex — automatic selection |
| 7 | Pattern Learning | Detect repeated requests → propose skills |
| 8 | Agent Orchestration | Research agents, specialist agents, parallel execution |

Each phase makes the Bridge more like extended cognition and less like a chat interface.

---

## Success Metric

The Bridge succeeds when Jim forgets it's there.

Not because it's invisible — but because it's so integrated into how Jim thinks that the boundary between Jim's cognition and Claude's augmentation disappears.

When "ask Claude" becomes as natural as "recall that thing" — when there's no sense of invoking an external service — when it's just part of how thinking happens — then we've built the extended mind.

That's the vision. The Bridge is how we get there.

---

*This document supersedes `docs/SDK-URL-INTEGRATION.md`, which described a protocol that doesn't exist. The stdio-to-WebSocket adapter architecture documented here is what actually shipped.*

**Document Version:** 1.0  
**Author:** Atlas PM  
**Philosophical Grounding:** Philosophy of Cognitive Partnership, Part II-III
