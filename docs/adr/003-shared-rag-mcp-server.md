# ADR-003: Shared RAG via AnythingLLM MCP Server

**Status:** Accepted
**Date:** 2026-03-03
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
│              AnythingLLM (Docker, port 3001)                  │
│              grove-node-1 / 100.80.12.118 (Tailscale)        │
├───────────────────────────────────────────────────────────────┤
│  Workspaces: monarch, take-flight, drumwave, grove-corpus,   │
│  grove-technical, grove-vision, gtm-consulting, atlas-pm     │
│  Embeddings: Ollama snowflake-arctic-embed2 (1024 dims)      │
└───────────────────────────────────────────────────────────────┘
```

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

**Claude Code** (project-level, gitignored):
```json
// .mcp.json
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

**Claude Desktop** (`claude_desktop_config.json`):
Uses the npm package `anythingllm-mcp-server` with same env var pattern.

**Multi-machine:** `ANYTHINGLLM_URL` is `http://localhost:3001` on grove-node-1, `http://100.80.12.118:3001` on der-tier (Tailscale).

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
