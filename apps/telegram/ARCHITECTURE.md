# Atlas Telegram Architecture

**Technical architecture for the clarification layer.**

---

## System Components

### 1. Telegram Bot Service

**Responsibility:** Receive messages from Jim, relay to Claude, return responses

**Technology:**
- Bun runtime (fast, modern, TypeScript-native)
- `grammy` or `node-telegram-bot-api` for Telegram API
- Long-polling for message receipt (webhooks optional for production)

**Security:**
- `TELEGRAM_ALLOWED_USERS` — Only Jim's Telegram ID can interact
- All other messages ignored/rejected
- Audit logging of all interactions

### 2. Claude Agent Runtime

**Responsibility:** Process messages, classify sparks, generate clarifications, decide actions

**Technology:**
- Claude Agent SDK (`@anthropic-ai/claude-agent-sdk`)
- Loads workspace from `CLAUDE_WORKING_DIR`
- MCP servers for tool access (Notion, Web Fetch, Ask User)

**Context Files:**
- `CLAUDE.md` — Atlas identity, personality, rules
- `SPARKS.md` — Classification framework (copied from parent repo)
- `MEMORY.md` — Persistent context (optional)

### 3. MCP Servers

**Built-in:**
- `ask_user` — Presents inline keyboard buttons for A/B/C choices

**Required:**
- `notion` — Create items, add comments, update properties
- `web-fetch` — Retrieve URL content for classification

**Configuration:** `mcp-config.local.ts`

### 4. Notion Integration

**Architecture:** Feed 2.0 (activity log) + Work Queue 2.0 (task ledger)
**NO INBOX** — Telegram IS the inbox.

### 5. Autonomous Repair System (Pit Stop Sprint)

**Responsibility:** Detect, classify, and repair skill-related issues autonomously

**Technology:**
- Zone Classifier (`src/skills/zone-classifier.ts`)
- Swarm Dispatch (`src/pit-crew/swarm-dispatch.ts`)
- Self-Improvement Listener (`src/listeners/self-improvement.ts`)

**Three-Zone Permission Model:**
```
┌─────────────────────────────────────────────────────────────────┐
│                    ZONE CLASSIFICATION                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Feed 2.0 Entry                                                 │
│  (tagged: self-improvement)                                     │
│         │                                                       │
│         ▼                                                       │
│  ┌─────────────┐                                                │
│  │ Zone        │                                                │
│  │ Classifier  │                                                │
│  └──────┬──────┘                                                │
│         │                                                       │
│    ┌────┼────────────────┐                                      │
│    ▼    ▼                ▼                                      │
│ ┌──────┐ ┌──────┐ ┌────────────┐                               │
│ │Zone 1│ │Zone 2│ │  Zone 3    │                               │
│ │Silent│ │Notify│ │  Approve   │                               │
│ └──┬───┘ └──┬───┘ └─────┬──────┘                               │
│    │        │           │                                       │
│    ▼        ▼           ▼                                       │
│ ┌──────────────┐  ┌────────────┐                               │
│ │Swarm Dispatch│  │Work Queue  │                               │
│ │(Claude Code) │  │(Manual Fix)│                               │
│ └──────────────┘  └────────────┘                               │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

**Writable Directories (Swarm can modify):**
- `data/skills/**` - Full read/write
- `data/pit-crew/**` - Full read/write
- `src/skills/**` - Read/write

**Forbidden Files (Never modified):**
- `src/index.ts`, `src/bot.ts`, `src/handler.ts`
- `src/supervisor/**`
- `.env*`, `package.json`, `bun.lockb`

**Safety:** Rate limiting, rollback window, auto-disable on errors

See `docs/AUTONOMY.md` for complete documentation.

**Databases (Canonical IDs for Notion SDK - DO NOT CHANGE):**
- Feed 2.0: `90b2b33f-4b44-4b42-870f-8d62fb8cbf18`
- Work Queue 2.0: `3d679030-b76b-43bd-92d8-1ac51abb4a28`

**Operations:**
- Every message → Feed entry (with Pillar classification)
- Every Feed entry → Work Queue item (bidirectional relation)
- Track classification confidence
- Comments capture Telegram exchange
- Status updates as items progress

---

## Data Flow

### Happy Path: Link Capture

```
1. JIM → Telegram: "https://github.com/cool/tool"

2. BOT receives message
   - Verify sender is in ALLOWED_USERS
   - Extract URL from message
   - Log to audit trail

3. CLAUDE processes
   - Fetch URL content via web-fetch MCP
   - Apply SPARKS.md classification
   - Calculate confidence score

4. IF confidence >= 70%:
   - Present classification + single confirm
   "GitHub repo: cool/tool — Grove tool evaluation? [Confirm] [Change]"

5. IF confidence < 70%:
   - Present clarification with options
   "GitHub repo: cool/tool — what's the intent?
   [A] Evaluate for Atlas infrastructure
   [B] Grove research corpus only
   [C] Just save as reference
   [D] Dismiss"

6. JIM taps button (< 10 seconds)

7. CLAUDE creates Notion items
   - Feed 2.0 entry with classification metadata
   - Work Queue 2.0 item (bidirectional relation)
   - Comment with full Telegram exchange

8. BOT confirms
   "✓ Captured to Feed (Pillar / Intent) → routing to Work Queue"
```

### Edge Cases

**No URL in message:**
```
Jim: "Research verbalized sampling paper"

Atlas: "I don't see a URL. Is this:
[A] A task I should research and find sources for
[B] Something you'll share the link to separately
[C] Just a note to capture as-is"
```

**URL fetch fails:**
```
Atlas: "Couldn't fetch that URL (403 forbidden). 
Want me to capture it anyway with just the link?
[Yes] [No]"
```

**Ambiguous pillar:**
```
Atlas: "Financial planning article — which pillar?
[A] Personal (your finances)
[B] Consulting (client context)
[C] The Grove (content seed)"
```

---

## File Structure

```
apps/telegram/
├── README.md              # Project overview
├── ARCHITECTURE.md        # This file
├── IMPLEMENTATION.md      # Sprint plan for dev
├── HANDOFF.md             # Design session notes
├── CLAUDE.md              # Claude Code instructions
│
├── .env.example           # Environment template
├── .env                   # Local config (gitignored)
├── package.json           # Dependencies
├── tsconfig.json          # TypeScript config
├── bun.lock               # Bun lockfile
│
├── src/
│   ├── index.ts           # Entry point
│   ├── bot.ts             # Telegram bot setup
│   ├── classifier.ts      # SPARKS-based classification
│   ├── clarify.ts         # Clarification question generator
│   ├── notion.ts          # Notion API operations
│   └── types.ts           # TypeScript types
│
├── workspace/             # CLAUDE_WORKING_DIR
│   ├── CLAUDE.md          # Atlas personality for agent
│   ├── SPARKS.md          # Classification guide (copied)
│   └── MEMORY.md          # Persistent context
│
├── mcp-config.local.ts    # MCP server configuration
└── logs/                  # Audit logs
```

---

## Environment Variables

```bash
# Required
TELEGRAM_BOT_TOKEN=xxx          # From @BotFather
TELEGRAM_ALLOWED_USERS=xxx      # Jim's Telegram user ID

# Claude
CLAUDE_WORKING_DIR=./workspace  # Path to workspace folder
ANTHROPIC_API_KEY=xxx           # Or use CLI auth

# Notion
NOTION_API_KEY=xxx              # Notion integration token

# Optional
OPENAI_API_KEY=xxx              # For voice transcription
LOG_LEVEL=info                  # debug, info, warn, error
AUDIT_LOG_PATH=./logs           # Where to write audit logs
```

---

## Security Model

### Authentication
- Single-user bot: Only `TELEGRAM_ALLOWED_USERS` can interact
- All other messages are ignored (no error response to avoid enumeration)

### Path Validation
- `ALLOWED_PATHS` restricts file system access
- Default: workspace folder only

### Audit Trail
- Every interaction logged with timestamp, user ID, message content
- Stored in `./logs/audit.log`
- Rotated daily (configurable)

### Rate Limiting
- Configurable requests per minute
- Prevents runaway API usage

---

## Notion Schema Reference

### Feed 2.0 (Activity Log)

| Property | Type | Purpose |
|----------|------|---------|
| Entry | title | Human-readable summary |
| Pillar | select | Personal, The Grove, Consulting, Home/Garage |
| Request Type | select | Research, Draft, Build, Schedule, Answer, Process, Quick, Triage |
| Source | select | Telegram, Notion Comment, Scheduled, Claude Code, CLI |
| Author | select | Jim, Atlas [laptop], Atlas [Telegram], Atlas [grove-node-1] |
| Work Queue | relation | → Links to Work Queue item |
| Confidence | number | Classification confidence (0-1) |
| Keywords | multi_select | Extracted keywords for pattern matching |
| Status | select | Open, Processing, Routed, Done |
| Date | date | Timestamp |

### Work Queue 2.0 (Task Ledger)

| Property | Type | Purpose |
|----------|------|---------|
| Task | title | Task name |
| Type | select | Research, Draft, Build, Schedule, Answer, Process |
| Status | select | Captured, Active, Paused, Blocked, Done, Shipped |
| Priority | select | P0, P1, P2, P3 |
| Pillar | select | Personal, The Grove, Consulting, Home/Garage |
| Feed Source | relation | ← Links back to originating Feed entry |
| Was Reclassified | checkbox | Jim corrected the classification? |
| Original Pillar | select | What Atlas initially guessed (if reclassified) |
| Resolution Notes | text | How it was resolved |
| Cycle Time | formula | Completed - Queued (computed) |
| Output | url | Deliverable link |
| Queued | date | When created |
| Started | date | When work began |
| Completed | date | When finished |

---

## Integration Points

### With Parent Atlas System

- `SPARKS.md` copied from `../SPARKS.md` (or symlinked)
- Notion databases shared with main Atlas components
- Feed logging compatible with existing `atlas_startup.py`

### With grove-node-1 (Future)

- Work Queue items picked up by persistent agent
- Telegram notifications when tasks complete
- Two-way communication channel

### With Browser Extension (Future)

- Shared Notion state
- Extension can show items captured via Telegram
- Desktop equivalent of clarification loop

### With Autonomous Repair System

- Self-improvement listener polls Feed 2.0 for tagged entries
- Zone classifier routes operations to appropriate permission zone
- Swarm dispatch spawns Claude Code sessions for Zone 1/2 operations
- Zone 3 operations create Work Queue items for manual handling
- Rollback via `/rollback` command for auto-deployed changes
