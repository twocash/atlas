# Atlas Bridge: Cognitive Routing Architecture

## The Central Nervous System for Intelligent Multi-Surface AI

**Author:** Jim Calhoun, with Claude
**Created:** 2026-02-10
**Updated:** 2026-02-10
**Status:** Architecture Vision (supersedes original relay-only proposal)
**Answers:** PRODUCT.md Open Question #3, plus Agent SDK integration strategy

---

## Executive Summary

Atlas Bridge is the **central nervous system** of the Atlas platform. Every client surface — Chrome extension, Telegram bot, future mobile apps, API consumers — connects to it. The cognitive router classifies every incoming message and routes it to the **cheapest capable handler**.

Claude Code via `--sdk-url` is the apex capability tier — powerful, agentic, expensive. But **90% of interactions don't need it.** Skills, cached patterns, and cheap models handle those interactions faster and at a fraction of the cost. The 10% that reaches Claude Code is the 10% that genuinely requires multi-tool reasoning, file system access, and persistent conversation.

**The result: a 10x cost reduction with the same user experience.** The router pays for itself on day one. It gets cheaper every day after that, because recognized patterns become skills that route to lower tiers.

This isn't "let's pipe everything through expensive Claude Code sessions." This is **"let's build an intelligent routing layer that makes the whole system smarter AND cheaper, with Claude Code as the apex capability for when you genuinely need it."**

### The Transport Mechanism

The bridge leverages Claude Code's `--sdk-url ws://localhost:PORT` flag — an undocumented feature that makes Claude Code connect to a local WebSocket server instead of running as a terminal app. External applications can send messages to Claude and receive streaming responses, including full tool use (file access, web search, code execution, MCP integrations). This is the transport for Tier 3 routing. See [Tier 3: The `--sdk-url` Protocol](#tier-3-the---sdk-url-protocol) for technical details.

### Direct Alignment with Existing Roadmap

PRODUCT.md defines three phases for the Browser Extension Unlock:

| Phase | Description | Status |
|-------|-------------|--------|
| Phase 1: Visibility Layer | Surface inbox items, pending decisions, blocked work | **Shipped** |
| Phase 2: Triage Interface | Quick-action buttons, inline assignment, capture from any page | **Shipped** |
| **Phase 3: Conversation Layer** | **Chat interface to Atlas in the side panel. Full context: current page, recent sparks, queue state.** | **This proposal.** |

This proposal answers PRODUCT.md Open Questions:

| Question | Answer |
|----------|--------|
| #1: Extension vs. Telegram — which to prioritize? | Both. Same bridge, different surfaces. Telegram for mobile capture. Extension + Claude Code for desktop intelligence. |
| #3: How deeply should the extension integrate with Claude? | The `--sdk-url` bridge gives the extension access to everything Claude Code can do — but only when the cognitive router determines it's needed. |
| #4: Multi-machine — how to handle Atlas on different machines? | The bridge is a localhost relay. Wherever Claude Code runs, the extension connects. Can be exposed over SSH tunnel for cross-machine use. |

---

## The Economics of Intelligent Routing

### The Cost Problem

Without intelligent routing, every interaction goes through expensive channels:

| Channel | Cost per interaction | Interactions/day | Daily cost |
|---------|---------------------|------------------|-----------|
| Direct API (Sonnet) | ~$0.02-0.05 | 100 | $2-5 |
| Claude Code (Opus + tools) | ~$0.03-0.10+ | 100 | $3-10 |

At 100 interactions/day, that's **$90-300/month** — and most of those interactions are simple captures, quick lookups, or pattern-matched commands that don't need premium reasoning.

### The Routing Solution

The cognitive router classifies each message and routes to the cheapest handler that can deliver a quality result. Real pricing from `MODEL_CATALOG` in `apps/telegram/src/cognitive/models.ts`:

| Tier | Handler | Cost per interaction | Latency | What it handles |
|------|---------|---------------------|---------|-----------------|
| **Tier 0** | Pattern cache, local scripts, templates | **$0.00** (free) | <10ms | Greetings, cached patterns, status lookups, acknowledgments |
| **Tier 1** | Haiku ($0.80/$4.00 per 1M) or GPT-4o-mini ($0.15/$0.60 per 1M) | **$0.0001-0.001** | 200-500ms | Intent classification, simple skills, formatting, quick captures |
| **Tier 2** | Sonnet ($3/$15 per 1M), Gemini Flash ($0.10/$0.40 per 1M), specialized models | **$0.005-0.05** | 1-5s | Research, code review, content drafting, multi-step reasoning |
| **Tier 3** | Claude Code via `--sdk-url` (Opus $15/$75 per 1M + tool use) | **$0.03-0.10+** | 5-60s | Multi-tool reasoning, file operations, MCP chains, persistent conversations |

### The Math

Assume 100 daily interactions with realistic distribution:

| Tier | % of traffic | Cost per | Subtotal |
|------|-------------|----------|----------|
| Tier 0 (cached/local) | 30% | $0.00 | $0.00 |
| Tier 1 (Haiku/Mini) | 40% | $0.0005 avg | $0.02 |
| Tier 2 (Sonnet/Gemini) | 20% | $0.02 avg | $0.40 |
| Tier 3 (Claude Code) | 10% | $0.07 avg | $0.70 |
| **Total** | **100%** | | **$1.12/day** |

**Without routing:** $5.00/day (everything at ~$0.05 avg)
**With routing:** $1.12/day (blended ~$0.011 avg)

**That's a 4.5x cost reduction on day one.** And it improves over time — as the pattern cache learns, more interactions shift from Tier 1-2 down to Tier 0, bending the cost curve further.

At maturity (50%+ Tier 0 hit rate, projected by the Spotter Sprint):

| Tier | % of traffic | Cost per | Subtotal |
|------|-------------|----------|----------|
| Tier 0 | 50% | $0.00 | $0.00 |
| Tier 1 | 25% | $0.0005 | $0.0125 |
| Tier 2 | 15% | $0.02 | $0.30 |
| Tier 3 | 10% | $0.07 | $0.70 |
| **Total** | **100%** | | **$1.01/day** |

**Mature system: ~$0.01/interaction.** That's a **5x reduction** from day-one routing and a **10x reduction** from no routing at all. The system literally gets cheaper the more you use it.

---

## Architecture: The Cognitive Router

```
                    ┌──────────────────────────────────────────────────────────┐
                    │                    CLIENT SURFACES                        │
                    │  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐ │
                    │  │  Chrome  │  │ Telegram │  │  Mobile  │  │   API   │ │
                    │  │Extension │  │   Bot    │  │  (future)│  │Consumers│ │
                    │  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘ │
                    └───────┼─────────────┼─────────────┼──────────────┼──────┘
                            │             │             │              │
                            └─────────────┴──────┬──────┴──────────────┘
                                                 │
                    ┌────────────────────────────────────────────────────────┐
                    │              ATLAS BRIDGE  (Cognitive Router)           │
                    │                                                        │
                    │  ┌─────────────────────────────────────────────┐      │
                    │  │         1. Triage / Classification           │      │
                    │  │    Intent + Complexity + Audience + Source   │      │
                    │  │    getCachedTriage() → triageMessage()      │      │
                    │  └──────────────────┬──────────────────────────┘      │
                    │                     │                                  │
                    │  ┌──────────────────┴──────────────────────────┐      │
                    │  │         2. Profile + Model Selection         │      │
                    │  │    profileTask() → selectModel()            │      │
                    │  │    canSkipLLM() → getQuickResponse()        │      │
                    │  └──────────────────┬──────────────────────────┘      │
                    │                     │                                  │
                    │         ┌───────────┼───────────┐                     │
                    │         ▼           ▼           ▼                     │
                    │  ┌───────────┐ ┌──────────┐ ┌──────────────┐         │
                    │  │  TIER 0   │ │ TIER 1   │ │   TIER 2     │         │
                    │  │  Local    │ │ Haiku    │ │   Sonnet     │         │
                    │  │  Cache    │ │ Mini     │ │   Gemini     │         │
                    │  │  Scripts  │ │ Flash    │ │   GPT-4o     │         │
                    │  │  FREE     │ │ $0.0001  │ │   $0.01-0.05 │         │
                    │  └───────────┘ └──────────┘ └──────────────┘         │
                    │                                                        │
                    │  ┌─────────────────────────────────────────────┐      │
                    │  │           3. Pattern Learning Cache          │      │
                    │  │    recordTriageFeedback() — learns from      │      │
                    │  │    every interaction. Promotes patterns to    │      │
                    │  │    Tier 0 after 5+ confirmations.            │      │
                    │  └─────────────────────────────────────────────┘      │
                    └───────────────────────┬────────────────────────────────┘
                                            │ Only when complex (≤10%)
                                            ▼
                    ┌────────────────────────────────────────────────────────┐
                    │            TIER 3: Claude Code via --sdk-url            │
                    │                                                        │
                    │  Full agentic capabilities:                             │
                    │  • File system access        • MCP servers             │
                    │  • Web search                • Code execution          │
                    │  • Multi-turn reasoning       • Tool chaining          │
                    │  • Persistent conversation    • Git operations         │
                    └────────────────────────────────────────────────────────┘
```

### The Routing Decision Flow

Every message follows this path through existing code in `apps/telegram/src/cognitive/`:

1. **Pattern cache check** — `getCachedTriage()` in `triage-patterns.ts`: If the normalized input matches a pattern with 5+ confirmations and <10% correction rate, return the cached triage result immediately. **Cost: $0. Latency: <10ms.** This is Tier 0.

2. **Triage classification** — `triageMessage()` in `triage-skill.ts`: A single Haiku call that returns intent (`command`/`capture`/`query`/`clarify`), title, pillar, request type, and complexity tier (0-3). **Cost: ~$0.0002. Latency: ~300ms.**

3. **Task profiling** — `profileTask()` in `profiler.ts`: Heuristic analysis detects complexity (`trivial`/`simple`/`moderate`/`complex`), capability requirements (`requiresReasoning`, `requiresCode`, `requiresStructuredOutput`, `requiresCreativity`, `requiresLongContext`), risk indicators, and required tools. **Cost: $0. Latency: <1ms.**

4. **Skip check** — `canSkipLLM()` + `getQuickResponse()` in `profiler.ts`: Trivial tasks (greetings, acknowledgments) get instant template responses. **Cost: $0. Latency: <1ms.** This is also Tier 0.

5. **Model selection** — `selectModel()` in `selector.ts`: Maps the task profile to the cheapest model with the required capabilities. Trivial → `local` (free). Simple → Haiku ($0.80/1M). Code/reasoning → Sonnet ($3/1M). Each selection includes a fallback model via `getNextFallback()` chain.

6. **Provider routing** — `routeProvider()` in `router.ts`: Routes to the best endpoint for the selected model — direct API preferred, OpenRouter as fallback. Handles API key selection, availability checks, and health monitoring.

7. **Execution** — `executeWorker()` in `worker.ts`: Sends the request, streams the response, records token usage via `recordTokens()` in `ledger.ts`.

8. **Feedback** — `recordTriageFeedback()` in `triage-patterns.ts`: Confirmations and corrections update the pattern cache, making future routing cheaper.

**Steps 1-6 already exist.** The bridge unifies them behind a single entry point that any surface can connect to, and adds Tier 3 routing to Claude Code via `--sdk-url` for the messages that exhaust Tiers 0-2.

### Why a Bridge Process?

Chrome MV3 service workers are killed after 30 seconds of inactivity. They cannot hold WebSocket connections. The side panel can hold a WebSocket while open, but Claude Code connects *to* a server (it's a client), not from one. So we need a relay in between — a process that both sides connect to.

But the bridge is **not** just a relay. It's the process where the cognitive pipeline runs. Surfaces send messages in; the bridge classifies, routes, and responds. Only Tier 3 messages get forwarded to Claude Code. Everything else is handled within the bridge itself.

### Both Channels Coexist

The extension already has direct Anthropic API calls for simple tasks. That doesn't go away. It's Tier 1-2 within the bridge, and also available as a direct path for surfaces that don't need the full routing pipeline.

| Capability | Direct API (existing) | Bridge Tiers 0-2 | Bridge Tier 3 (Claude Code) |
|------------|----------------------|-------------------|----------------------------|
| Simple prompt/response | Yes | Yes | Yes |
| Streaming responses | No (extension uses sync) | Yes | Yes (real-time) |
| Tool use | No | Via skills | Yes (all Claude Code tools) |
| File system access | No | No | Yes |
| Web search | No | Via Gemini grounding | Yes |
| MCP integrations | No | No | Yes (Notion, Supabase, etc.) |
| Multi-turn conversation | No (stateless) | Limited | Yes (session persists) |
| Code execution | No | No | Yes |
| Cost per simple task | Low (Haiku: $0.80/MTok) | Lower (cached: free) | Higher (Opus + tools) |
| Requires running process | No | Yes (bridge) | Yes (bridge + Claude Code) |

---

## What Each Tier Handles

### Tier 0: Pattern Cache + Local Intelligence (Free, <10ms)

**Handler:** `getCachedTriage()` in `triage-patterns.ts`, `canSkipLLM()` + `getQuickResponse()` in `profiler.ts`

Handles without any API call:
- **Greetings** — "hey", "hi", "hello" → instant template response
- **Acknowledgments** — "ok", "thanks", "cool" → instant template response
- **Cached patterns** — Messages that match patterns confirmed 5+ times in the pattern cache. The `generatePatternKey()` function normalizes messages into categories: URL domain patterns, command verb patterns, query starters, freeform text patterns.
- **Status lookups** — Cached state from last fetch (no API roundtrip needed)

**How it grows:** Every triage result feeds the pattern cache. After 5 confirmations with <10% correction rate, a pattern becomes Tier 0. The more Atlas is used, the more patterns get cached, the more traffic stays at Tier 0.

### Tier 1: Cheap Cognition ($0.0001-0.001, 200-500ms)

**Handler:** Haiku (`$0.80`/`$4.00` per 1M tokens), GPT-4o-mini (`$0.15`/`$0.60` per 1M), Gemini Flash (`$0.10`/`$0.40` per 1M)

Handles with a single fast model call:
- **Intent classification** — What is this message? (command, capture, query, clarify)
- **Quick captures** — "Save this link" → triage + Notion create
- **Simple formatting** — Structured output, JSON extraction
- **Skill execution** — Atomic skills that need minimal reasoning

**Mapping to existing scenarios:**
- *"Who should I reply to first?"* — intent classification + simple Notion query. Tier 1 handles the classification. A Tier 1 skill queries the Engagements database and returns a sorted list. **No Claude Code needed.**
- *"Draft a connection request for this person"* — If a recipe exists for this pattern, it's Tier 1 with voice profile injection. Otherwise escalates to Tier 2.

### Tier 2: Premium Cognition ($0.005-0.05, 1-5s)

**Handler:** Sonnet (`$3`/`$15` per 1M), GPT-4o (`$2.50`/`$10` per 1M), Gemini Pro (`$1.25`/`$5` per 1M)

Handles complex single-model tasks:
- **Content drafting** — LinkedIn posts, client briefs, blog drafts with voice/audience awareness
- **Research summaries** — Gemini Flash with Google Search grounding for factual research
- **Code review** — Sonnet analyzing code snippets with structured feedback
- **Multi-step reasoning** — Tasks requiring analysis but not tool chaining

**Mapping to existing scenarios:**
- *"Draft a connection request for this person"* — Full voice profile, context assembly, quality output. Sonnet with audience-aware prompt composition. **No Claude Code needed.**

### Tier 3: Claude Code via `--sdk-url` ($0.03-0.10+, 5-60s)

**Handler:** Full Claude Code agent with tools, MCP servers, file access, persistent conversation

Reserved for tasks that **require tool chaining or multi-step agentic execution**:
- **Cross-database synthesis** — "What's my outreach pipeline looking like?" → queries Work Queue, Contacts, Engagements databases via MCP, cross-references with post performance, delivers narrative summary. Requires multiple Notion MCP calls chained with reasoning.
- **Debugging and repair** — "Something's broken with the sync" → reads logs, checks API status, reads code, diagnoses, potentially fixes. Requires file system access + code execution.
- **Strategic thinking partner** — "Help me think through this outreach strategy" → multi-turn conversation with access to Notion databases, past engagement data, strategic docs. Requires persistent context and MCP integration.
- **Autonomous task execution** — "Fix the auth bug in grove-foundation" → reads files, runs tests, makes commits, creates PRs. Requires the full Claude Code toolchain.

**Key insight:** Only scenarios 3, 4, and 5 from the original vision genuinely need Tier 3. Scenarios 1 and 2 are Tier 1-2. This is where the 90/10 split comes from.

---

## The Learning Loop: How the System Gets Cheaper

The cognitive router isn't static. Three mechanisms drive continuous cost reduction:

### 1. Pattern Cache (Already Built)

`triage-patterns.ts` implements a learning loop that's been running since the triage skill shipped:

```
Message arrives → getCachedTriage() checks cache
                         │
            ┌─── HIT ────┤──── MISS ────┐
            │             │              │
            ▼             │              ▼
    Return cached         │      triageMessage() via Haiku
    triage (Tier 0)       │              │
            │             │              ▼
            │             │      recordTriageFeedback()
            │             │              │
            │             │    ┌── confirm ──┬── correct ──┐
            │             │    ▼             │             ▼
            │             │  Strengthen      │      Weaken pattern
            │             │  pattern         │      (may reset)
            │             │    │             │
            │             │    ▼             │
            │             │  5+ confirmations?
            │             │    │
            │             │    ▼ YES
            │             │  Pattern promoted
            │             │  to Tier 0 cache
            └─────────────┘
```

The `generatePatternKey()` function normalizes messages into pattern categories:
- **URL patterns** — Domain extraction (e.g., `github.com` URLs always map to a specific skill)
- **Command patterns** — Verb detection ("log", "create", "dispatch" → specific command handlers)
- **Query patterns** — Query starters ("what's", "how", "show me" → query intents)
- **Freeform** — Text normalization for recurring freeform messages

**Every interaction is a data point.** The cache grows organically from real usage. No manual programming required.

### 2. Skill Flywheel (From Atlas Philosophy)

The pattern cache handles exact matches. The Skill Flywheel handles the broader pattern-to-automation pipeline:

**OBSERVE** → Atlas logs every interaction: triage result, model used, cost, quality rating
**DETECT** → Repeated intent patterns surface as potential skills (3+ similar intents in 14 days)
**PROPOSE** → Atlas drafts a skill specification: "I noticed you always deep-dive GitHub repos for yourself. Want me to skip the questions next time?"
**APPROVE** → User blesses the skill once via Telegram keyboard or settings UI
**EXECUTE** → Skill runs automatically on matching future intents
**REFINE** → Usage data and corrections improve the skill over time

This is described in detail in the [Skill-Centric Architecture](../Downloads/atlas-skill-centric-architecture.md) spec. The bridge is where this pipeline lives — it sees every interaction and drives the propose/approve/execute loop.

### 3. Model Fitness Matrix (From Spotter Sprint)

Beyond routing to the right *tier*, the system learns the optimal *model* within each tier:

- **Quality ratings** per `model + task_type` combination accumulate in Feed 2.0
- **Fitness score** = quality × (1/cost) × success_rate
- **Result:** The system discovers that Gemini Flash handles research tasks at 4.3/5 quality for $0.006 — better value than Sonnet at 4.4/5 quality for $0.042
- **Over time:** Expensive models get replaced by cheaper ones that prove equally capable for specific task types

This is specified in detail in the [Spotter Sprint](https://www.notion.so/2fd780a78eef81708f76e7c9edecfd08) spec (Phase 4: Model Fitness Matrix).

### The Cost Curve

```
Cost per interaction
    |
$0.05 ────────── No routing (everything at Sonnet/Opus)
    |
    |     ╲
    |      ╲   Day 1: Cognitive routing active
    |       ╲
$0.01 ─ ─ ─ ╲─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
    |         ╲
    |          ╲───────────────────── Mature: patterns + skills + fitness
$0.005 ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─ ─
    |
    └────────────────────────────────────── Time / Interactions
```

**Every Tier 3 interaction is a learning opportunity.** The pattern it represents may become a Tier 1 skill that handles it next time for 100x less.

---

## Cross-Surface Protocol

The bridge serves ALL client surfaces through a unified protocol. Every surface sends a structured message; the bridge classifies, routes, and responds. The surface never needs to know which tier handled the request.

### Current Surfaces

**Telegram Bot** — Already connected. Uses the same cognitive pipeline (`triage-skill.ts`, `supervisor.ts`, etc.). The bridge consolidates this pipeline into a single process that Telegram connects to.

**Chrome Extension** — Side panel connects via WebSocket. New "Claude" tab for Tier 3 conversations. Existing direct API calls for Tier 1-2 tasks. Progressive migration to bridge-mediated routing.

### Future Surfaces

**Mobile App** — Same WebSocket protocol, same routing logic. React Native or Flutter client connects to the bridge.

**CLI Tool** — Direct bridge connection for developer workflows. `atlas "fix the tests"` from terminal.

**API Consumers** — REST/WebSocket endpoints for programmatic access. Other tools and services connect to Atlas capabilities through the bridge.

**Agent-to-Agent** — Other Atlas agents connecting to the bridge for orchestration. Sub-agents spawned by the bridge for parallel task execution (from the [Agent SDK Vision](https://www.notion.so/2f8780a78eef81a58d5fed4397f51476)).

### The Protocol Contract

Every surface sends the structured context object defined by the [Intent-First Architecture ADR](https://www.notion.so/303780a78eef8107981ecb25835e18a9):

```javascript
{
  // User-expressed or system-detected
  intent: "research",           // what the user wants to do
  depth: "deep",                // how thorough (quick / standard / deep)
  audience: "self",             // who sees the output (self / client / public)
  source_type: "github_repo",   // what was shared (URL type, file, text)
  format: null,                 // output format if specified

  // Bridge-added metadata
  surface: "chrome_extension",  // which client sent this
  session_id: "...",            // for multi-turn conversation state
  timestamp: "..."              // for pattern detection
}
```

The bridge returns a structured response:

```javascript
{
  content: "...",               // the response text
  tier_used: 1,                 // which tier handled this (for transparency)
  model_used: "claude-haiku-4-5-20251001",
  cost: 0.0003,                // actual cost
  latency_ms: 287,             // actual latency
  cached: false,               // whether pattern cache was used
  task_id: "..."               // for feedback/learning
}
```

Surfaces can display cost/tier information for transparency, or hide it entirely. The routing is invisible to the user by default.

---

## Tier 3: The `--sdk-url` Protocol

*This section documents the transport mechanism for Tier 3 routing. Most interactions never reach this layer.*

### How It Works

When Claude Code starts with `claude --sdk-url ws://localhost:3848/claude`, it:

1. Connects to the specified WebSocket endpoint as a client
2. Begins a session (UUID-based)
3. Waits for `user_message` messages
4. Responds with `stream_event` messages (streaming) and `sdk_message` messages (complete responses)
5. Can request tool use via `tool_use` content blocks
6. Expects `tool_result` responses before continuing

### Message Flow

```
Bridge sends (on behalf of surface):
  { type: "user_message", sessionId: "...", content: [{ type: "text", text: "..." }] }

Claude Code streams back:
  { type: "stream_event", event: { type: "message_start", ... } }
  { type: "stream_event", event: { type: "content_block_start", ... } }
  { type: "stream_event", event: { type: "content_block_delta", delta: { text: "Here" } } }
  { type: "stream_event", event: { type: "content_block_delta", delta: { text: " is" } } }
  { type: "stream_event", event: { type: "content_block_delta", delta: { text: " my" } } }
  ...
  { type: "stream_event", event: { type: "message_stop" } }
```

### When Tier 3 is Triggered

The cognitive router escalates to Claude Code when the task profile meets any of these conditions:

- **Complexity = "complex"** as determined by `profileTask()` — token count >500, 3+ capability requirements, or long context needed
- **Requires tool chaining** — Multiple MCP calls, file reads, or web searches needed in sequence
- **Multi-turn conversation** — User is in an ongoing dialogue that requires persistent context
- **Agentic execution** — Task requires file system writes, git operations, code execution, or deployment
- **Explicit request** — User routes to Tier 3 directly (e.g., via the Claude tab in the extension)

### Tool Use Flow (Phase 4)

When Claude needs to use an extension-provided tool:
```
Claude sends: tool_use block (e.g., "atlas_read_current_page")
  → Bridge relays to extension
  → Extension dispatches via chrome.runtime.sendMessage
  → Background/content script executes
  → Extension sends tool_result back through bridge
  → Claude continues reasoning with the result
```

### Startup Flow

```bash
# Terminal 1: Start the bridge
cd packages/bridge && bun run dev
# → "Atlas Bridge running on ws://localhost:3848"

# Terminal 2: Start Claude Code (for Tier 3 capability)
claude --sdk-url ws://localhost:3848/claude
# → Claude Code connects to bridge

# Browser: Open Atlas side panel → Claude tab
# → Green "Connected" indicator → start chatting
```

Note: Tiers 0-2 work even without Claude Code running. Only Tier 3 requires the Claude Code process. The Claude tab gracefully degrades with clear startup instructions when Claude Code isn't connected.

### Community Implementations

The `--sdk-url` protocol has been reverse-engineered and used in production by several projects:

- **The-Vibe-Company/companion** — Full web UI with complete protocol documentation
- **dzhng/claude-agent-server** — WebSocket server wrapper for Claude Agent SDK
- **vultuk/claude-code-web** — Web-based interface with multi-session support
- **jmckinley/claude_code_companion** — Session watching and sharing

The protocol uses NDJSON (newline-delimited JSON), supports streaming via Anthropic's standard event format, and handles tool use through `tool_use`/`tool_result` content blocks.

---

## Phased Roadmap

Each phase delivers standalone value. Phase 3 is useful even if we never build Phase 7. No big bang. No flag day.

### Phase 3: MVP Relay (Week 3 — Current Sprint)

**Ship the simplest thing that works.** A dumb relay. Prove the WebSocket transport, validate the UX.

| Component | Description | Location |
|-----------|-------------|----------|
| Bridge server | Bun WebSocket relay (~100 lines) | `packages/bridge/` |
| SDK types | TypeScript types for the protocol | `apps/chrome-ext/src/types/claude-sdk.ts` |
| React hook | `useClaudeCode()` — WS client with reconnection | `apps/chrome-ext/src/lib/claude-code-hooks.ts` |
| Claude tab | Chat UI with streaming and status indicators | `apps/chrome-ext/sidepanel/components/ClaudeCodePanel.tsx` |
| NavRail update | Add "Claude" as a 7th view | `apps/chrome-ext/sidepanel/components/NavRail.tsx` |

**Exit criteria:** Jim opens side panel → Claude tab → types a question → gets streaming response from Claude Code with full tool use.

### Phase 4: Tool Dispatch

Claude Code can reach *into* the extension — reading the current LinkedIn page, querying extension state, triggering UI actions. The conversation becomes bidirectional.

| Component | Description |
|-----------|-------------|
| Tool registry | Extension registers tools (atlas_read_current_page, atlas_get_contacts, etc.) |
| Dispatch handler | Bridge relays tool_use requests to extension, returns tool_result |
| Permission model | User approves tool categories, not individual calls |

**Exit criteria:** Claude can read the current LinkedIn page via extension content script and use that context in its response.

### Phase 5: Cognitive Routing Integration

**The bridge transforms from relay to router.** This is where the economics kick in.

| Component | Description |
|-----------|-------------|
| Triage integration | Bridge incorporates `triage-skill.ts` classification |
| Tier routing | Messages triaged before forwarding — Tier 0-2 handled in-process |
| Cost tracking | Per-interaction cost recording via `ledger.ts` |
| Graceful degradation | Tier 3 unavailable → route to best available Tier 2 handler |

**Exit criteria:** Simple messages handled without Claude Code. Cost per interaction drops measurably. `bridge/status` endpoint shows tier distribution.

### Phase 6: Multi-Model Routing (Spotter Integration)

The Spotter MCP connects to the bridge. Model selection becomes data-driven instead of rule-based.

| Component | Description |
|-----------|-------------|
| Spotter MCP | `packages/mcp-spotter/` — skill lookup, model routing, context optimization |
| Model Fitness Matrix | Learn optimal model→task mappings from Feed 2.0 quality data |
| Quality feedback | Capture user ratings (explicit + implicit signals) |
| External models | OpenRouter integration for Kimi-K2, DeepSeek, Qwen |

**Exit criteria:** Model selection uses fitness data. 5+ models in active rotation. Routine task cost reduced by 4x from Phase 5 baseline.

### Phase 7: Self-Improving Skills (Pattern → Skill Pipeline)

Pattern detection graduates from cache hits to full skill proposals.

| Component | Description |
|-----------|-------------|
| Pattern detector | Surface repeated intent patterns from Feed 2.0 structured context |
| Recipe proposals | "I noticed you always deep-dive GitHub repos. Auto-research next time?" |
| Skill registry extension | Approved recipes become executable skills |
| Recipe editor | Modify recipes via conversation or settings UI (no YAML needed) |

**Exit criteria:** Atlas has proposed and Jim has approved 5+ recipes. Tier 0 hit rate exceeds 40%.

### Phase 8: Multi-Agent Orchestration

The bridge becomes the hub for an agent ecosystem.

| Component | Description |
|-----------|-------------|
| Agent SDK integration | Spawn specialized sub-agents (research, code, Notion) |
| Background workers | Agents that run unattended ("monitor CI, fix failures") |
| Cross-agent communication | Agents coordinate through the bridge |
| Session management | Per-user, per-surface, per-agent session state |

**Exit criteria:** Jim can spawn a background research agent from Telegram that delivers results hours later.

### Dependencies

```
Phase 3: MVP Relay ─────────────────────────────────────────────────┐
    │                                                                │
    ├─── Phase 4: Tool Dispatch                                      │
    │       │                                                        │
    │       └─── Phase 5: Cognitive Routing ◄─── Existing cognitive   │
    │               │                            pipeline merges in   │
    │               │                                                │
    │               ├─── Phase 6: Multi-Model ◄─── Spotter Sprint    │
    │               │       │                                        │
    │               │       └─── Phase 7: Self-Improving Skills      │
    │               │               │                                │
    │               │               └─── Phase 8: Multi-Agent        │
    │               │                                                │
    │               └─── Intent-First Phase 2+ feeds structured      │
    │                    context into routing decisions               │
    │                                                                │
    └── LinkedIn Phase A (Week 2) makes Phase 3 launch more useful   │
         because DOM extraction gives the Claude tab real data       │
```

**Key insight:** Phase 3 (relay) ships fast and validates the transport. Phase 5 (routing) is where the economics transform. Phases 6-8 compound the gains. Each phase delivers value independently.

---

## What This Means for the Product

### The PM Pitch

We are not building a pipe to send everything through expensive Claude Code sessions. We are building an **intelligent routing layer that makes the whole system smarter AND cheaper**, with Claude Code as the apex capability for when you genuinely need it.

The router pays for itself on day one. It gets cheaper every day after that. And it positions Atlas as the proof point for a product pattern — intelligent cognitive routing — that applies far beyond a personal assistant.

### For Jim (The User)

- **Same experience** — Ask a question, get an answer. The routing is invisible.
- **Faster for simple things** — Tier 0/1 responds in milliseconds, not seconds.
- **Equally powerful for complex things** — Tier 3 still has full Claude Code with tools, files, MCP.
- **System learns your patterns** — The more you use it, the more responsive it gets.
- **Works from any surface** — Browser, phone, terminal, future devices. Same bridge, same intelligence.

### For The Grove (The Venture)

- **Proof of concept** — Intelligent routing is a viable, measurable product pattern.
- **Economics data** — Real usage data from Atlas informs product decisions for Eidetica and other ventures.
- **Reusable architecture** — The bridge pattern applies to any multi-model, multi-surface AI system.
- **Vendor independence** — Multi-model routing demonstrates that the intelligence is in the routing, not in any single model.

### Alignment with Atlas Philosophy

From PHILOSOPHY.md:

> "Atlas is not a tool Jim uses. Atlas is part of how Jim thinks."

The cognitive router makes this literal. The bridge is embedded in every surface Jim uses — browser, phone, terminal. It's present in the work context, aware of patterns, capable of acting. The routing intelligence becomes part of Jim's extended cognition.

> Principle 1: Zero Initiation Cost

The routing is invisible. Jim never picks a tier. He never thinks about which model handles his request. The bridge handles all of that.

> Principle 2: Decisions Become Defaults

The pattern cache IS this principle in code. Every triage result is a potential default. After enough confirmations, it becomes automatic. Jim's decisions compound into a system that increasingly reflects his preferences.

> "The ultimate success metric: the user forgets the system is there."

A system that responds in <10ms (Tier 0) is closer to invisible than one that takes 5 seconds (everything via API). Speed is a feature of intelligence, not just infrastructure.

---

## Existing Infrastructure: What's Built vs. What's Needed

The cognitive routing intelligence is **80% built.** The gap is the bridge process that unifies it and the learning system that optimizes it.

| Component | Status | Location |
|-----------|--------|----------|
| Triage Skill (intent + complexity classification) | **Shipped** | `apps/telegram/src/cognitive/triage-skill.ts` |
| Pattern Cache (learning loop, 5+ confirmation threshold) | **Shipped** | `apps/telegram/src/cognitive/triage-patterns.ts` |
| Task Profiler (complexity detection, skip-LLM, quick responses) | **Shipped** | `apps/telegram/src/cognitive/profiler.ts` |
| Model Selector (cheapest capable model, fallback chains) | **Shipped** | `apps/telegram/src/cognitive/selector.ts` |
| Provider Router (Anthropic/OpenAI/Google/OpenRouter/Local) | **Shipped** | `apps/telegram/src/cognitive/router.ts` |
| Supervisor (orchestration, circuit breaker, progressive upgrade) | **Shipped** | `apps/telegram/src/cognitive/supervisor.ts` |
| Model Catalog (8 models, 4 providers, real pricing) | **Shipped** | `apps/telegram/src/cognitive/models.ts` |
| Token Ledger (cost tracking per interaction) | **Shipped** | `apps/telegram/src/cognitive/ledger.ts` |
| Intent-First Schema (5 structured context fields in Feed 2.0) | **Shipped** | Phase 0+1 branch |
| Intent-First Keyboards (Telegram progressive capture) | **Shipped** | Phase 0+1 branch |
| WebSocket Bridge | **Not started** | `packages/bridge/` (Phase 3) |
| Spotter MCP (skill lookup, routing advice, context optimization) | **Specced** | `packages/mcp-spotter/` |
| Model Fitness Matrix (quality-driven model selection) | **Specced** | Spotter Sprint Phase 4 |
| Quality Feedback System (explicit + implicit signals) | **Specced** | Spotter Sprint Phase 2 |
| Skill Seeker (auto-generate skills from docs/repos) | **Specced** | Spotter Sprint Phase 7 |

**What's missing is the unification layer** — the bridge process that sits between all surfaces and all handlers, and the Spotter that learns from the data the bridge produces.

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Claude Code must be running for Tier 3 | Certain | Medium | Tiers 0-2 work without it. Claude tab shows clear startup instructions. Graceful degradation. |
| `--sdk-url` is undocumented protocol | High | Medium | Bridge isolates the protocol. If Anthropic changes it, only Tier 3 transport needs updating. All other tiers unaffected. |
| Bridge adds a process to manage | Certain | Low | Single command (`bun run dev`). Can be auto-started by extension or added to dev script. |
| Triage misclassifies complexity | Medium | Medium | Conservative routing: when in doubt, route UP a tier. Pattern corrections refine over time. Progressive upgrade in supervisor.ts handles initial misclassification. |
| Token costs higher than estimated | Medium | Low | Ledger tracks actual costs. Cost checkpoint in supervisor.ts triggers review for expensive requests. |
| Bridge becomes a bottleneck | Low | High | Keep bridge stateless where possible. Bridge is lightweight Bun process. Horizontal scaling via multiple instances if needed. |
| Pattern cache grows unbounded | Low | Low | Periodic pruning. Relevance decay. Max pattern count configurable. |
| Multi-surface protocol drift | Medium | Medium | Shared types package (`packages/shared/`). Protocol versioning. TypeScript enforces contract at compile time. |
| Side panel must be open for extension | Certain | Low | Already true for all extension features. The Claude tab doesn't change this requirement. |

---

## Appendix A: Relation to Other Architecture Documents

This document is the unifying vision. It doesn't duplicate the specialized specs — it shows how they fit together.

| Document | Relationship | Link |
|----------|-------------|------|
| **Intent-First Architecture ADR** | Provides the structured context object the router uses for classification. Phase 0+1 shipped. Phase 2+ feeds richer context into routing decisions. | [Notion](https://www.notion.so/303780a78eef8107981ecb25835e18a9) |
| **Spotter Sprint** | Provides the three-tier intelligence model, Model Fitness Matrix, quality feedback system, and Skill Seeker. Phases 2-7 of this spec map to Phases 5-7 of the bridge roadmap. | [Notion](https://www.notion.so/2fd780a78eef81708f76e7c9edecfd08) |
| **Agent SDK Vision** | Provides the multi-agent orchestration model. Phase 8 of the bridge roadmap implements this through the bridge as agent hub. | [Notion](https://www.notion.so/2f8780a78eef81a58d5fed4397f51476) |
| **Skill-Centric Architecture** | Provides the Skill Flywheel pattern and tiered autonomy model (Tier 0 auto, Tier 1 batch-approve, Tier 2 explicit). The bridge's pattern→skill pipeline implements this. | `Downloads/atlas-skill-centric-architecture.md` |
| **Atlas Philosophy** | Provides the Extended Mind thesis and design principles that govern all routing decisions. | `Downloads/atlas-philosophy-of-cognitive-partnership.md` |
| **Strategic Roadmap** | Sequences this work as EPIC 4 (Week 3) in the Q1 2026 execution plan. | [Notion](https://www.notion.so/303780a78eef81f99f23cb78a33f78e9) |
| **PRODUCT.md** | Defines Phase 3: Conversation Layer. This document is the architectural answer to that phase. | `docs/PRODUCT.md` |

## Appendix B: Glossary

| Term | Definition |
|------|-----------|
| **Tier 0** | Local intelligence layer. Pattern cache, template responses, cached state. Free, <10ms. |
| **Tier 1** | Cheap cognition layer. Haiku, GPT-4o-mini, Gemini Flash. $0.0001-0.001/interaction. |
| **Tier 2** | Premium cognition layer. Sonnet, GPT-4o, Gemini Pro. $0.005-0.05/interaction. |
| **Tier 3** | Apex cognition layer. Claude Code via `--sdk-url`. Full agentic capabilities. $0.03-0.10+/interaction. |
| **Pattern Cache** | Learning system in `triage-patterns.ts`. Stores triage results keyed by normalized input. After 5+ confirmations, patterns bypass triage entirely (Tier 0). |
| **Skill Flywheel** | OBSERVE → DETECT → PROPOSE → APPROVE → EXECUTE → REFINE. The loop by which recognized patterns become automated skills. |
| **Model Fitness Matrix** | Quality/cost/latency data per model+task_type. Drives data-informed model selection. |
| **Cognitive Router** | The classification + routing pipeline in `apps/telegram/src/cognitive/`. Determines which tier and model handles each message. |
| **Bridge** | The Bun WebSocket server (`packages/bridge/`) that all surfaces connect to. Runs the cognitive router and relays Tier 3 messages to Claude Code. |
| **Recipe** | A named intent pattern that fires automatically on matching context. Created by the Skill Flywheel. Stored in the Skills database. |
| **Structured Context Object** | The `{intent, depth, audience, source_type, format}` object from the Intent-First ADR. The primary input to the cognitive router. |

---

*This document is a living architecture vision. It should be updated as implementation progresses and as the roadmap evolves. The vision is the north star; the phased roadmap is how we get there incrementally.*
