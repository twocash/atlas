# ADR-003: Shared RAG via AnythingLLM MCP Server

**Status:** Accepted
**Date:** 2026-03-03
**Updated:** 2026-03-03 (IPv4/IPv6 port proxy fix, Claude Desktop config standardization)
**Context:** Post-incident restoration after accidental deletion in dead-code cleanup

---

## Context

Atlas uses AnythingLLM (Docker, grove-node-1) as a shared RAG layer across all Claude surfaces. Three consumers need access:

1. **Atlas Bot** (Telegram) — queries client workspaces for context enrichment via HTTP client
2. **Claude Desktop** — queries/uploads via MCP server (child process, stdio transport)
3. **Claude Code** — queries/uploads via MCP server (child process, stdio transport)

On 2026-03-01, commit `b9cfeb2` ("delete ~2,934 lines of dead MCP/workspace code") accidentally deleted the custom MCP server (`packages/bridge/src/tools/anythingllm-mcp-server.ts`) along with genuinely dead code in `packages/shared/src/mcp/`. The bot's HTTP client was unaffected, but Claude Desktop and Claude Code lost all RAG access — breaking the shared-context architecture that lets all three surfaces reason over the same document corpus.

## Decision

### Architecture

```
┌─────────────────┐  ┌──────────────────┐  ┌──────────────────┐
│  Atlas Bot      │  │  Claude Desktop  │  │  Claude Code     │
│  (Telegram)     │  │  (MCP client)    │  │  (MCP client)    │
└───────┬─────────┘  └────────┬─────────┘  └────────┬─────────┘
        │                     │                      │
        │ HTTP client         │ stdio (MCP)          │ stdio (MCP)
        │                     │                      │
        ▼                     ▼                      ▼
┌───────────────────────────────────────────────────────────────┐
│              AnythingLLM (Docker, grove-node-1)               │
│                                                               │
│  Internal:  [::1]:3001  (IPv6 loopback - API keys work here) │
│  Port 3001: 0.0.0.0:3001 (Docker NAT - API keys BROKEN)     │
│  Port 3002: netsh portproxy IPv4:3002 -> [::1]:3001 (FIX)    │
│                                                               │
│  grove-node-1:  localhost:3001 (resolves to ::1, works)       │
│  der-tier:      100.80.12.118:3002 (portproxy -> ::1, works)  │
├───────────────────────────────────────────────────────────────┤
│  Workspaces: monarch, take-flight, drumwave, grove-corpus,   │
│  grove-technical, grove-vision, gtm-consulting, atlas-pm     │
│  Embeddings: Ollama snowflake-arctic-embed2 (1024 dims)      │
└───────────────────────────────────────────────────────────────┘
```

### Docker IPv4/IPv6 Auth Bug (CRITICAL TRAP)

**Symptom:** API key returns 403 "No valid api key found" from any IPv4 address (127.0.0.1, Tailscale IP, LAN IP) but works from `localhost` (which resolves to `::1` IPv6 on Windows).

**Root cause:** Docker Desktop for Windows uses a NAT proxy for IPv4 port mappings. This proxy corrupts or mishandles the `Authorization` header before it reaches the Express server inside the container. IPv6 connections bypass Docker's NAT and connect directly to the container's network namespace.

**Evidence (tested 2026-03-03):**

| Address | Protocol | Result |
|---------|----------|--------|
| `localhost:3001` | IPv6 (::1) | **200 OK** |
| `127.0.0.1:3001` | IPv4 | **403 Forbidden** |
| `100.80.12.118:3001` | IPv4 (Tailscale) | **403 Forbidden** |
| `localhost:3002` (portproxy) | IPv4 -> IPv6 | **200 OK** |
| `100.80.12.118:3002` (portproxy) | IPv4 -> IPv6 | **200 OK** |

**Fix:** Windows `netsh interface portproxy` rule on grove-node-1 forwards IPv4 port 3002 to IPv6 `[::1]:3001`:

```
netsh interface portproxy add v4tov6 listenport=3002 listenaddress=0.0.0.0 connectport=3001 connectaddress=::1
```

This rule is **persistent across reboots** (stored in Windows registry). To verify:

```
netsh interface portproxy show all
```

To remove if ever needed:

```
netsh interface portproxy delete v4tov6 listenport=3002 listenaddress=0.0.0.0
```

**NEVER use port 3001 from remote machines.** Always use port 3002.

### MCP Server (v1.1.0)

**File:** `packages/bridge/src/tools/anythingllm-mcp-server.ts`

Self-contained stdio MCP server using `@modelcontextprotocol/sdk`. No imports from Atlas packages — fully independent. Spawned as a child process by Claude Desktop and Claude Code via their respective MCP configs.

**8 tools exposed:**

| Tool | Purpose | Timeout |
|------|---------|---------|
| `anythingllm_list_workspaces` | Discover available knowledge bases | 30s |
| `anythingllm_chat` | RAG chat/query against a workspace | 30s |
| `anythingllm_search` | Vector similarity search | 30s |
| `anythingllm_get_workspace` | Workspace details + settings | 30s |
| `anythingllm_upload_document` | Multipart file upload to doc store | 2 min |
| `anythingllm_embed_document` | Embed uploaded doc into workspace | 15 min |
| `anythingllm_remove_document` | Remove doc from workspace (pre-replace) | 15 min |
| `anythingllm_list_documents` | List docs + locations in a workspace | 30s |

### Configuration

Both Claude Desktop and Claude Code use the **same custom MCP server** (`anythingllm-mcp-server.ts`). The third-party npm package `anythingllm-mcp-server` was abandoned after it broke auth in a silent update.

**grove-node-1 (localhost, IPv6 works natively):**

Claude Code `.mcp.json`:
```json
{
  "mcpServers": {
    "anythingllm": {
      "command": "bun",
      "args": ["run", "packages/bridge/src/tools/anythingllm-mcp-server.ts"],
      "env": {
        "ANYTHINGLLM_URL": "http://localhost:3001",
        "ANYTHINGLLM_API_KEY": "<key>"
      }
    }
  }
}
```

Claude Desktop `claude_desktop_config.json`:
```json
"anythingllm": {
  "command": "C:/Users/jimca/.bun/bin/bun.exe",
  "args": ["run", "C:/github/atlas/packages/bridge/src/tools/anythingllm-mcp-server.ts"],
  "env": {
    "ANYTHINGLLM_URL": "http://localhost:3001",
    "ANYTHINGLLM_API_KEY": "<key>"
  }
}
```

**der-tier (remote via Tailscale, must use port 3002 portproxy):**

Claude Desktop `claude_desktop_config.json`:
```json
"anythingllm": {
  "command": "C:/Users/jim/.bun/bin/bun.exe",
  "args": ["run", "C:/GitHub/atlas/packages/bridge/src/tools/anythingllm-mcp-server.ts"],
  "env": {
    "ANYTHINGLLM_URL": "http://100.80.12.118:3002",
    "ANYTHINGLLM_API_KEY": "<key>"
  }
}
```

Claude Code `.mcp.json` (in `C:\GitHub\atlas\`):
```json
{
  "mcpServers": {
    "anythingllm": {
      "command": "C:/Users/jim/.bun/bin/bun.exe",
      "args": ["run", "C:/GitHub/atlas/packages/bridge/src/tools/anythingllm-mcp-server.ts"],
      "env": {
        "ANYTHINGLLM_URL": "http://100.80.12.118:3002",
        "ANYTHINGLLM_API_KEY": "<key>"
      }
    }
  }
}
```

**Key differences between machines:**
| Setting | grove-node-1 | der-tier |
|---------|-------------|----------|
| `ANYTHINGLLM_URL` | `http://localhost:3001` | `http://100.80.12.118:3002` |
| Bun path | `bun` (in PATH) | `C:/Users/jim/.bun/bin/bun.exe` |
| Atlas repo path | `C:/github/atlas/` | `C:/GitHub/atlas/` |
| Port | 3001 (IPv6 direct) | 3002 (portproxy -> IPv6) |

`.mcp.json` is gitignored (contains API key). Each machine needs its own copy.

### Why the Deletion Was Wrong

The cleanup correctly identified `packages/shared/src/mcp/` as dead code (no active imports). But the AnythingLLM MCP server was **not dead** — it was consumed externally by Claude Desktop/Code configs, not by TypeScript imports. Static analysis couldn't detect external consumers.

### Prevention

1. `.mcp.json` is gitignored (contains API key) — but the server file itself (`anythingllm-mcp-server.ts`) is tracked and must not be deleted without checking Claude Desktop/Code configs
2. `packages/bridge/mcp-config.json` documents the MCP server's existence in the repo
3. This ADR documents the architecture so future cleanup passes know the file is load-bearing

## Consequences

- All three Claude surfaces share the same RAG corpus again
- Upload/embed tools enable document management directly from Claude Code/Desktop sessions
- 15-minute embed timeout accommodates Ollama CPU embedding for large documents
- `.mcp.json` per-machine config allows grove-node-1 (localhost) and der-tier (Tailscale IP) to reach the same AnythingLLM instance
- Port 3002 portproxy rule on grove-node-1 works around Docker's IPv4 auth bug permanently
- The npm package `anythingllm-mcp-server` is no longer used on any machine — replaced by our custom server on both

## Troubleshooting

### "No valid api key found" (403)

1. **Are you using port 3002 from a remote machine?** Port 3001 only works via IPv6 (`localhost`). Remote machines MUST use port 3002.
2. **Is the portproxy rule active?** Run `netsh interface portproxy show all` on grove-node-1. Must show `0.0.0.0:3002 -> ::1:3001`.
3. **Is the key correct?** Verify: `bun -e "const {Database}=require('bun:sqlite'); const db=new Database('C:/anythingllm-storage/anythingllm.db',{readonly:true}); console.log(db.query('SELECT secret FROM api_keys LIMIT 1').get().secret)"`
4. **Is AnythingLLM running?** `curl http://localhost:3001/api/ping` should return `{"online":true}`.
5. **Is Tailscale up?** `ping 100.80.12.118` from der-tier.

### MCP server won't start

1. **Module not found:** Run `bun install` in the atlas repo directory.
2. **Bun not found:** Use full path to bun executable (see config table above).
3. **File not found:** Run `git pull origin master` to get latest.

### Adding the portproxy rule (if lost)

Requires admin. On grove-node-1:
```
netsh interface portproxy add v4tov6 listenport=3002 listenaddress=0.0.0.0 connectport=3001 connectaddress=::1
```
