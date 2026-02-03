# SPRINT: Atlas MCP Client Enablement

**Sprint ID:** ATLAS-MCP-001  
**Status:** Specification Complete  
**Priority:** P0 — Foundational Capability  
**Pillar:** Atlas 2.0  
**Created:** 2026-01-31  
**Author:** Jim Calhoun + Claude

---

## Executive Summary

This sprint enables Atlas to act as an MCP client, allowing it to connect to and use tools from any authorized MCP server. This is a **key enabling capability** that transforms Atlas from a closed system into an extensible agent that can leverage the growing MCP ecosystem.

**First use case:** Pit Crew MCP server for agent-to-agent development coordination.

**Future use cases:** Any MCP server — file systems, databases, APIs, other agents, browser automation, and tools not yet invented.

---

## Why This Matters

### Current State
Atlas has hardcoded tools defined in `src/conversation/tools/`. Adding new capabilities requires code changes, redeployment, and careful integration work.

### Future State
Atlas can connect to any MCP server at runtime. New capabilities are added by:
1. Deploying/authorizing an MCP server
2. Adding it to Atlas's MCP config
3. Atlas immediately has access to new tools

### Strategic Value

| Benefit | Impact |
|---------|--------|
| **Extensibility** | Add capabilities without code changes to Atlas core |
| **Ecosystem access** | Use any MCP-compatible tool (Anthropic's, community, custom) |
| **Agent-to-agent** | Atlas can dispatch to specialized agents (Pit Crew, Research, etc.) |
| **Separation of concerns** | Tool implementations live outside Atlas, easier to maintain |
| **Future-proofing** | As MCP ecosystem grows, Atlas automatically benefits |

---

## Architecture

### Critical Engineering Decisions

Before implementation, three production realities must be addressed:

**1. The "Stdio Trap" (Protocol Fragility)**

MCP over stdio is extremely fragile. The JSON-RPC protocol uses stdout for messages. If ANY code (Notion client, debug logging, etc.) prints to stdout via `console.log()`, it corrupts the protocol stream and crashes the connection.

**Solution:** All logging MUST use `console.error()`. This is non-negotiable.

```typescript
// ❌ WRONG - Will break MCP protocol
console.log('Debug:', data);

// ✅ CORRECT - Goes to stderr, protocol safe
console.error('[PitCrew] Debug:', data);
```

**2. Performance (Tool Caching)**

Fetching tool definitions from spawned processes on every chat turn adds 200-500ms latency. For conversational UX, this is unacceptable.

**Solution:** Cache tool definitions on connect. Zero per-turn latency.

```typescript
// ❌ WRONG - Fetches every turn
const tools = await client.listTools(); // 200-500ms

// ✅ CORRECT - Returns from cache
const tools = mcpHub.getTools(); // <1ms
```

**3. Resilience (Process Supervision)**

MCP servers crash. Notion API timeouts, unhandled exceptions, OOM kills. Atlas must handle this gracefully, not hang indefinitely.

**Solution:** 
- Auto-reconnect with exponential backoff (5s, 10s, 20s...)
- Strict timeouts on all tool calls (60s default)
- Graceful degradation (server offline = tools unavailable, not error)

### Current Atlas Tool Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      ATLAS (Telegram Bot)                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Conversation Handler                   ││
│  │  ┌─────────┐ ┌─────────┐ ┌─────────┐ ┌───────────────┐ ││
│  │  │ core.ts │ │agents.ts│ │workspace│ │ (hardcoded)   │ ││
│  │  │ tools   │ │ tools   │ │ tools   │ │               │ ││
│  │  └─────────┘ └─────────┘ └─────────┘ └───────────────┘ ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
```

### Target Architecture (Post-Sprint)

```
┌─────────────────────────────────────────────────────────────┐
│                      ATLAS (Telegram Bot)                    │
│  ┌─────────────────────────────────────────────────────────┐│
│  │                   Conversation Handler                   ││
│  │  ┌─────────────────────┐  ┌───────────────────────────┐ ││
│  │  │   Native Tools      │  │     MCP Client Manager    │ ││
│  │  │   (core, agents,    │  │  ┌─────────────────────┐  │ ││
│  │  │    workspace)       │  │  │ Connected Servers:  │  │ ││
│  │  │                     │  │  │ • pit-crew-mcp      │  │ ││
│  │  │                     │  │  │ • filesystem-mcp    │  │ ││
│  │  │                     │  │  │ • browser-mcp       │  │ ││
│  │  │                     │  │  │ • (any future MCP)  │  │ ││
│  │  │                     │  │  └─────────────────────┘  │ ││
│  │  └─────────────────────┘  └───────────────────────────┘ ││
│  └─────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────┘
                                        │
                    ┌───────────────────┼───────────────────┐
                    │                   │                   │
                    ▼                   ▼                   ▼
            ┌─────────────┐     ┌─────────────┐     ┌─────────────┐
            │ pit-crew-mcp│     │filesystem-mcp│    │ browser-mcp │
            │             │     │             │     │             │
            │ Tools:      │     │ Tools:      │     │ Tools:      │
            │ • dispatch  │     │ • read_file │     │ • navigate  │
            │ • post_msg  │     │ • write_file│     │ • click     │
            │ • status    │     │ • list_dir  │     │ • screenshot│
            └─────────────┘     └─────────────┘     └─────────────┘
```

### MCP Client Flow

```
1. Atlas starts → loads MCP config → connects to authorized servers
2. User sends message → cognitive router processes
3. Router sees available tools (native + all MCP tools)
4. Claude selects appropriate tool (could be MCP tool)
5. Atlas MCP client executes tool call on appropriate server
6. Result returns → conversation continues
```

---

## Deliverables

### D1: MCP Client Manager (`packages/shared/src/mcp-client/`)

A reusable MCP client that Atlas (and future agents) can use to connect to MCP servers.

```typescript
// Usage in Atlas
import { MCPClientManager } from '@atlas/shared/mcp-client';

const mcp = new MCPClientManager();
await mcp.connect('pit-crew', { command: 'node', args: ['path/to/pit-crew-mcp'] });
await mcp.connect('filesystem', { command: 'npx', args: ['@anthropic/filesystem-mcp'] });

// Get all available tools (for Claude's tool list)
const tools = await mcp.listAllTools();

// Execute a tool call
const result = await mcp.callTool('pit-crew', 'dispatch_work', { ... });
```

**Files:**
- `packages/shared/src/mcp-client/index.ts` — Main export
- `packages/shared/src/mcp-client/manager.ts` — MCPClientManager class
- `packages/shared/src/mcp-client/types.ts` — TypeScript types
- `packages/shared/src/mcp-client/config.ts` — Config loading

### D2: Atlas MCP Integration (`apps/telegram/src/mcp/`)

Integration layer that wires MCP client into Atlas's conversation handler.

**Files:**
- `apps/telegram/src/mcp/index.ts` — Initialize MCP on bot startup
- `apps/telegram/src/mcp/tools.ts` — Convert MCP tools to Claude tool format
- `apps/telegram/src/mcp/config.ts` — Load from environment/config file

### D3: MCP Configuration (`apps/telegram/config/`)

Configuration file specifying which MCP servers Atlas is authorized to use.

```yaml
# apps/telegram/config/mcp-servers.yaml
servers:
  pit-crew:
    command: node
    args: 
      - ../../../packages/mcp-pit-crew/dist/index.js
    env:
      NOTION_API_KEY: ${NOTION_API_KEY}
      NOTION_PIPELINE_DB: ${NOTION_PIPELINE_DB}
    enabled: true
    
  # Future servers (disabled until needed)
  filesystem:
    command: npx
    args: ["@anthropic/filesystem-mcp", "/allowed/path"]
    enabled: false
```

### D4: Pit Crew MCP Server (`packages/mcp-pit-crew/`)

First MCP server — enables Atlas ↔ Pit Crew agent coordination.

**Already scaffolded.** See `/home/claude/pit-crew-mcp/`

**Tools provided:**
- `dispatch_work` — Atlas dispatches dev request to Pit Crew
- `post_message` — Either agent posts to discussion thread
- `update_status` — Update workflow status
- `get_discussion` — Read full discussion
- `list_active` — List active discussions

### D5: Atlas Dev Pipeline (Notion Database)

Kanban view of all Atlas development work. Synced from pit-crew-mcp.

**Properties:**
| Property | Type | Purpose |
|----------|------|---------|
| Discussion | title | Request title |
| Status | select | Captured → Active → Needs Review → Approved → Shipped |
| Type | select | Bug, Feature, Question, Hotfix |
| Priority | select | P0, P1, P2 |
| Requestor | select | Atlas, Jim |
| Handler | select | Pit Crew |
| Thread | rich_text | Full conversation (md) |
| Resolution | rich_text | What was done |
| Output | url | Commit/PR link |
| Work Queue | relation | Link to WQ 2.0 item |
| Created | date | When dispatched |
| Resolved | date | When shipped |

### D6: Documentation Updates

- `SOUL.md` — Add MCP capability description
- `MEMORY.md` — Add Pit Crew dispatch protocol
- `docs/MCP_ARCHITECTURE.md` — New doc explaining MCP setup
- `CLAUDE.md` — Pit Crew persona for Claude Code

### D7: System Tool — `refresh_mcp_tools`

Since tools are cached, hot-reloading requires a manual refresh command:

```typescript
// Native tool definition
{
  name: "refresh_mcp_tools",
  description: "Reloads tool definitions from all MCP servers. Use after updating an external agent's capabilities.",
  input_schema: { type: "object", properties: {} }
}

// Implementation
case 'refresh_mcp_tools':
  await mcpHub.refreshTools();
  return { success: true, status: mcpHub.getStatus() };
```

---

## Implementation Plan

### Phase 1: MCP Client Infrastructure (Day 1)

**Key File:** `packages/shared/src/mcp/manager.ts` — The `McpHub` class

| Task | File | Description |
|------|------|-------------|
| 1.1 | `packages/shared/src/mcp/types.ts` | TypeScript interfaces for config |
| 1.2 | `packages/shared/src/mcp/manager.ts` | **McpHub class** (bulletproof) |
| 1.3 | `packages/shared/src/mcp/index.ts` | Package exports |
| 1.4 | `packages/shared/package.json` | Add @modelcontextprotocol/sdk dependency |

**McpHub Class API:**
```typescript
class McpHub {
  constructor(config: McpHubConfig)
  
  // Connect to all configured servers (non-blocking)
  async connectAll(): Promise<void>
  
  // Get all tools from cache (ZERO LATENCY - critical!)
  getTools(): Tool[]
  
  // Call a namespaced tool with timeout protection
  async callTool(name: string, args: object): Promise<unknown>
  
  // Check if tool name is MCP (contains "__")
  isMcpTool(name: string): boolean
  
  // Get connection status for monitoring
  getStatus(): Record<string, ServerStatus>
  
  // Manual refresh after server updates
  async refreshTools(): Promise<void>
  
  // Clean shutdown
  async disconnectAll(): Promise<void>
}
```

**Auto-Reconnect Logic:**
- On disconnect: Wait 5s, attempt reconnect
- Exponential backoff: 5s → 10s → 20s → 40s → 80s
- Max 5 attempts before giving up
- Successful reconnect resets counter

**Acceptance Criteria:**
- [ ] McpHub can connect to stdio-based MCP servers
- [ ] Tools cached on connect (verified: getTools() < 1ms)
- [ ] Tool calls have 60s timeout (configurable per-server)
- [ ] Auto-reconnect triggers on server crash
- [ ] **ALL logging uses console.error (NOT console.log)**
- [ ] Namespacing works: "dispatch_work" → "pit-crew__dispatch_work"

### Phase 2: Atlas Integration (Day 1-2)

| Task | File | Description |
|------|------|-------------|
| 2.1 | `apps/telegram/config/mcp-servers.yaml` | MCP server configuration |
| 2.2 | `apps/telegram/src/mcp/config.ts` | Load and validate MCP config |
| 2.3 | `apps/telegram/src/mcp/tools.ts` | Convert MCP tools to Claude format |
| 2.4 | `apps/telegram/src/mcp/index.ts` | Initialize MCP on startup |
| 2.5 | `apps/telegram/src/conversation/handler.ts` | Wire MCP tools into conversation |
| 2.6 | `apps/telegram/src/index.ts` | Initialize MCP before bot starts |

**Acceptance Criteria:**
- [ ] Atlas loads MCP config on startup
- [ ] Atlas connects to configured MCP servers
- [ ] MCP tools appear in Claude's available tools
- [ ] Claude can select and execute MCP tools
- [ ] Results flow back into conversation

### Phase 3: Pit Crew MCP Server (Day 2)

| Task | File | Description |
|------|------|-------------|
| 3.1 | `packages/mcp-pit-crew/src/index.ts` | Main server (already drafted) |
| 3.2 | `packages/mcp-pit-crew/src/store.ts` | JSON file operations |
| 3.3 | `packages/mcp-pit-crew/src/notion-sync.ts` | Sync to Notion |
| 3.4 | `packages/mcp-pit-crew/package.json` | Dependencies |
| 3.5 | Build and test standalone | Verify server works |

**Acceptance Criteria:**
- [ ] Server starts and responds to MCP protocol
- [ ] dispatch_work creates discussion file
- [ ] post_message appends to thread
- [ ] update_status changes workflow state
- [ ] Notion sync creates/updates pages

### Phase 4: Notion Pipeline Database (Day 2)

| Task | Description |
|------|-------------|
| 4.1 | Create "Atlas Dev Pipeline" database in Notion |
| 4.2 | Configure properties per schema |
| 4.3 | Create Kanban view by Status |
| 4.4 | Add relation to Work Queue 2.0 |
| 4.5 | Get database ID, add to pit-crew-mcp config |

**Acceptance Criteria:**
- [ ] Database exists with correct schema
- [ ] Kanban view shows pipeline stages
- [ ] pit-crew-mcp successfully syncs to database

### Phase 5: Integration Testing (Day 3)

| Test | Description |
|------|-------------|
| 5.1 | Atlas startup with MCP enabled |
| 5.2 | Atlas lists tools (should include pit-crew tools) |
| 5.3 | Atlas dispatches work via Telegram command |
| 5.4 | Discussion appears in Notion pipeline |
| 5.5 | Manual status update via MCP |
| 5.6 | Full round-trip: dispatch → work → approval → ship |

### Phase 6: Documentation (Day 3)

| Task | File | Description |
|------|------|-------------|
| 6.1 | `docs/MCP_ARCHITECTURE.md` | How MCP works in Atlas |
| 6.2 | `SOUL.md` | Add MCP capability |
| 6.3 | `MEMORY.md` | Add Pit Crew protocol |
| 6.4 | `apps/telegram/config/mcp-servers.example.yaml` | Example config |

---

## Configuration

### Environment Variables (New)

```bash
# .env additions
NOTION_PIPELINE_DB=1460539c-7002-447a-a8b7-17bba06c6559
MCP_SERVERS_CONFIG=./config/mcp-servers.yaml
```

### Key Database IDs (Reference)

| Database | Database ID | Data Source ID |
|----------|-------------|----------------|
| Feed 2.0 | `a7493abb-804a-4759-b6ac-aeca62ae23b8` | `a7493abb-804a-4759-b6ac-aeca62ae23b8` |
| Work Queue 2.0 | `3d679030-b76b-43bd-92d8-1ac51abb4a28` | `6a8d9c43-b084-47b5-bc83-bc363640f2cd` |
| Atlas Dev Pipeline | `ce6fbf1bee30433da9e6b338552de7c9` | `1460539c-7002-447a-a8b7-17bba06c6559` |

### MCP Servers Config Schema

```yaml
# mcp-servers.yaml
servers:
  <server-name>:
    command: string          # Executable (node, npx, python, etc.)
    args: string[]           # Command arguments
    env:                     # Environment variables (optional)
      KEY: value
      KEY: ${ENV_VAR}        # Reference existing env var
    cwd: string              # Working directory (optional)
    enabled: boolean         # Whether to connect on startup
    timeout: number          # Connection timeout in ms (default: 5000)
```

---

## Rollback Plan

If MCP integration causes issues:

1. **Quick disable:** Set all servers to `enabled: false` in config
2. **Full rollback:** Remove MCP initialization from `apps/telegram/src/index.ts`
3. **Native tools unaffected:** All existing hardcoded tools continue working

MCP is additive — it doesn't modify existing tool implementations.

---

## Success Metrics

| Metric | Target |
|--------|--------|
| Atlas successfully connects to pit-crew-mcp | ✓ |
| pit-crew tools appear in Claude's tool list | ✓ |
| dispatch_work creates Notion pipeline item | ✓ |
| Round-trip latency (tool call → result) | < 500ms |
| Zero regression in existing Atlas functionality | ✓ |

---

## Future MCP Servers (Enabled by This Sprint)

Once Atlas has MCP client support, these become easy additions:

| Server | Purpose | Complexity |
|--------|---------|------------|
| `@anthropic/filesystem-mcp` | Broader file access | Config only |
| `@anthropic/browser-mcp` | Browser automation | Config only |
| Custom research MCP | Specialized research agent | Build |
| Calendar MCP | Google Calendar integration | Build |
| Slack MCP | Slack channel monitoring | Build |

---

## Dependencies

- `@modelcontextprotocol/sdk` — Official MCP SDK
- `@notionhq/client` — Notion API (already in use)
- `yaml` — Config file parsing
- Node.js child_process — Spawning MCP servers

---

## Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|------------|--------|------------|
| MCP SDK breaking changes | Low | Medium | Pin version, test before upgrade |
| MCP server crashes | Medium | Low | Graceful error handling, auto-reconnect |
| Tool name collisions | Low | Low | Namespace tools by server name |
| Performance overhead | Low | Medium | Lazy-load servers, connection pooling |

---

## Appendix: MCP Protocol Overview

MCP (Model Context Protocol) is Anthropic's standard for connecting AI models to external tools and data sources.

**Key concepts:**
- **Server:** Exposes tools and resources via stdio or HTTP
- **Client:** Connects to servers and calls tools
- **Tools:** Functions the model can call (with JSON schema inputs)
- **Resources:** Data the model can read (files, databases, etc.)

**Protocol flow:**
```
Client                          Server
   │                               │
   │──── initialize ──────────────▶│
   │◀─── capabilities ─────────────│
   │                               │
   │──── tools/list ──────────────▶│
   │◀─── tool definitions ─────────│
   │                               │
   │──── tools/call ──────────────▶│
   │◀─── result ───────────────────│
```

---

## Changelog

| Date | Change |
|------|--------|
| 2026-01-31 | Initial specification |

