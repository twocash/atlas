# Skill: Atlas Patterns

## Purpose
Enforce architectural consistency. These are the laws of physics for this codebase.
Deviations require explicit approval from Jim.

## Hierarchy Rule

**This file is the constitution.** If you encounter conflicts:

| Source | Priority | Action |
|--------|----------|--------|
| `atlas-patterns.md` | **HIGHEST** | Always follow |
| `MEMORY.md` | High | Follow unless conflicts with patterns |
| `SOUL.md` | High | Identity guidance |
| Other docs | Normal | Reference only |

**If MEMORY.md conflicts with atlas-patterns.md:**
1. Follow atlas-patterns.md
2. Flag the conflict to Jim: "MEMORY.md says X, but atlas-patterns.md says Y. Following patterns."
3. Do NOT silently resolve the conflict

---

## 1. Database Constants

**NEVER GUESS THESE. NEVER INVENT NEW ONES.**

| Database | Page ID | Purpose |
|----------|---------|---------|
| Feed 2.0 | `90b2b33f-4b44-4b42-870f-8d62fb8cbf18` | Activity log |
| Work Queue 2.0 | `3d679030-b76b-43bd-92d8-1ac51abb4a28` | Task ledger |
| Atlas Dev Pipeline | `ce6fbf1bee30433da9e6b338552de7c9` | Pit Crew discussions |

**Data Source IDs (MCP Notion plugin only):**
| Database | Data Source ID |
|----------|----------------|
| Feed 2.0 | `a7493abb-804a-4759-b6ac-aeca62ae23b8` |
| Work Queue 2.0 | `6a8d9c43-b084-47b5-bc83-bc363640f2cd` |

If you need a database ID not listed here: **ASK**. Do not search for it, do not guess.

---

## 2. Technology Stack

| Tool | Correct | FORBIDDEN |
|------|---------|-----------|
| Runtime | `bun` | `node`, `npm`, `npx` |
| Package manager | `bun install` | `npm install`, `yarn` |
| Test runner | `bun test` | `jest`, `mocha`, `vitest` |
| Type check | `bun run typecheck` | `tsc` directly |
| Dev mode | `bun run dev` | `nodemon`, `ts-node` |

---

## 3. Logging Standards

### Applications (Telegram bot, Chrome extension)
```typescript
import { logger } from './logger';

logger.info('Message', { context });
logger.warn('Warning', { context });
logger.error('Error', { error });
```

### MCP Servers (CRITICAL)
```typescript
// CORRECT - stderr only
console.error('[ServerName] Message');

// FORBIDDEN - kills JSON-RPC connection
console.log('anything');  // NEVER IN MCP SERVERS
```

**Why:** MCP uses stdio. stdout is reserved for JSON-RPC messages. Any console.log breaks the protocol.

---

## 4. MCP Tool Namespacing

Tools are namespaced to prevent collisions:

| Tool Type | Format | Example |
|-----------|--------|---------|
| Native Atlas | `toolName` | `create_work_queue_item` |
| MCP tools | `mcp__{serverId}__{toolName}` | `mcp__pit_crew__dispatch_work` |

The `isMcpTool()` function checks for `mcp__` prefix to route correctly.

---

## 5. Error Handling

### Pattern: Structured Returns
```typescript
return {
  success: boolean,
  result: unknown,
  error?: string
};
```

### Rules
- Never catch and swallow errors silently
- Log full error details (message, stack, context)
- In MCP servers, always return structured response even on error

---

## 6. File Organization

```
apps/telegram/
├── src/
│   ├── conversation/    # Conversation handling (handler, tools, prompt)
│   ├── mcp/            # MCP client manager
│   └── ...
├── config/
│   └── mcp.yaml        # MCP server configuration
└── data/
    ├── SOUL.md         # Atlas identity
    ├── USER.md         # Jim's profile
    └── MEMORY.md       # Persistent learnings

packages/
├── mcp-pit-crew/       # Pit Crew MCP server
└── skills/
    └── superpowers/    # This directory
```

---

## 7. The Four Pillars

All content routes to one of four life domains:

| Pillar | Scope |
|--------|-------|
| Personal | Health, relationships, growth, finances |
| The Grove | AI venture, architecture, research |
| Consulting | Client work (DrumWave, Take Flight) |
| Home/Garage | Physical space, house, vehicles |

**Routing Rules:**
- Permits → always Home/Garage
- Client mentions → always Consulting
- AI/LLM research → always The Grove

---

## Forbidden Actions

These require explicit approval from Jim:

1. Creating new database IDs
2. Using npm/node instead of bun
3. Adding new dependencies without justification
4. Changing SOUL.md without discussion
5. Writing console.log in MCP servers
6. Skipping tests for logic changes
