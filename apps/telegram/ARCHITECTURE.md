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

**Databases:**
- Atlas Inbox 2.0 (`collection://04c04ac3-b974-4b7a-9651-e024ee484630`)
- Atlas Work Queue 2.0 (`collection://6a8d9c43-b084-47b5-bc83-bc363640f2cd`)

**Operations:**
- Create inbox items with full classification
- Add comments capturing Telegram exchange
- Update status as items progress
- Create work queue items when routing

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

7. CLAUDE creates Notion item
   - Inbox 2.0 entry with all properties
   - Comment with full Telegram exchange
   - Routes to Work Queue if decision = "Route to Work"

8. BOT confirms
   "✓ Captured to Inbox → routing for evaluation."
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
atlas-telegram/
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

### Atlas Inbox 2.0

| Property | Type | Purpose |
|----------|------|---------|
| Spark | title | Spark summary |
| Source | url | Original link |
| Source Type | select | Telegram, Browser, Manual |
| Pillar | select | Personal, Grove, Consulting, Home |
| Confidence | number (%) | Classification confidence |
| Intent | select | Research, Catalog, Build, Content, Reference, Task, Question |
| Decision | select | Route to Work, Archive, Defer, Dismiss |
| Atlas Status | select | New, Clarifying, Classified, Routed, Archived, Dismissed |
| Atlas Notes | rich_text | Classification reasoning |
| Tags | multi_select | ai-tools, research, code, etc. |
| Routed To | relation | → Work Queue 2.0 |
| Spark Date | date | When captured |
| Decision Date | date | When classified |

### Atlas Work Queue 2.0

| Property | Type | Purpose |
|----------|------|---------|
| Task | title | Task name |
| Type | select | Research, Draft, Build, Schedule, Answer, Process |
| Status | select | Queued, In Progress, Blocked, Review, Done |
| Disposition | select | Completed, Published, Dismissed, Deferred, Needs Rework |
| Priority | select | P0, P1, P2, P3 |
| Inbox Source | relation | ← Inbox 2.0 |
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
