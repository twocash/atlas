# Sprint: Fix RAG Access on Der-Tier

**Status:** Ready to execute
**Machine:** Der-Tier (jim's second machine)
**Objective:** Make all AnythingLLM RAG workspaces queryable from Claude Desktop and Claude Code on Der-Tier

---

## Context

AnythingLLM runs on grove-node-1 (Docker, always-on). It hosts 7+ workspaces of embedded documents — Grove vision/strategy, GTM consulting research, client docs, Atlas PM notes. Der-Tier needs to query these workspaces reliably via both Claude Desktop and Claude Code.

### Network Architecture

```
Der-Tier                              grove-node-1
  Claude Desktop / Claude Code          AnythingLLM (Docker, port 3001)
       |                                     |
       | Tailscale: 100.80.12.118:3002       | netsh portproxy: 3002 → [::1]:3001
       |------------------------------------>|
       |                                     | Ollama (snowflake-arctic-embed2)
       | Custom MCP server runs LOCALLY      | LanceDB vector storage
       | on Der-Tier (bun process)           |
```

### Critical Details

- **AnythingLLM Tailscale IP:** `100.80.12.118`
- **Port:** `3002` (NEVER 3001 — port 3001 on IPv4 returns 403 due to Docker's Windows NAT bug that corrupts Authorization headers. Port 3002 is a netsh portproxy rule on grove-node-1 that forwards IPv4 → IPv6 loopback, which fixes the auth issue. This rule survives reboots.)
- **API Key:** `C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM`
- **MCP Server Script:** `packages/bridge/src/tools/anythingllm-mcp-server.ts` in the atlas repo
- **The MCP server is a local bun process** — Claude Desktop/Code spawns it as a child process via stdio. It makes HTTP requests to grove-node-1's AnythingLLM. Der-Tier needs the atlas repo checked out and `bun install` run so dependencies are available.
- **Env var name:** `ANYTHINGLLM_URL` (NOT `ANYTHINGLLM_BASE_URL` — that's the broken npm package's var name)
- **DO NOT use the npm package `anythingllm-mcp-server`** — it broke auth silently in an update. We replaced it with our custom server months ago.

### The Timeout Fix

The custom MCP server at `packages/bridge/src/tools/anythingllm-mcp-server.ts` has `TIMEOUT_MS = 120_000` (120 seconds). This was recently bumped from 30s because AnythingLLM's "query" mode actually calls Claude Sonnet via Anthropic API for every query (there is no pure vector search endpoint). Larger workspaces (grove-vision: 54 docs, gtm-consulting: 13 docs) take 35-45 seconds to respond. The old 30s timeout was killing them.

**Der-Tier must pull the latest atlas repo to get this timeout fix.**

### Available Workspaces (all should be queryable when done)

| Workspace | Docs | Content |
|-----------|------|---------|
| grove-vision | 54 | GTM strategy, Ratchet thesis, competitive benchmarks |
| grove-technical | 28 | Technical architecture, specs |
| gtm-consulting | 13 | B2B activation research, channel marketing |
| atlas-pm | 7 | Atlas project management notes |
| monarch | ~10 | Monarch client docs |
| take-flight | ~5 | Take Flight client docs |
| drumwave | ~5 | DrumWave client docs |
| grove-corpus | varies | Grove blog/content corpus |

---

## Requirements

### 1. Atlas Repo on Der-Tier

The atlas repo must be cloned/pulled on Der-Tier. The MCP server script lives at `packages/bridge/src/tools/anythingllm-mcp-server.ts`. It needs `bun install` run from the repo root so `@modelcontextprotocol/sdk` is available.

- Find or clone the repo (it may already be at `C:\GitHub\atlas` — check)
- `git pull origin master` to get the latest (specifically the 90s timeout fix)
- `bun install` from repo root

### 2. Bun Installed

The MCP server runs via `bun`. Bun should already be installed on Der-Tier (previously at `C:\Users\jim\.bun\bin\bun.exe`). Verify it exists and is in PATH or use the full path in configs.

### 3. Tailscale Connected

`ping 100.80.12.118` must succeed. If not, Tailscale is disconnected.

### 4. API Connectivity Test

Before configuring anything, verify the HTTP path works:

```
curl -s http://100.80.12.118:3002/api/v1/workspaces -H "Authorization: Bearer C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM" --connect-timeout 10
```

This must return JSON with a workspace list. If it returns:
- **Timeout:** Tailscale is down
- **403:** Portproxy rule is missing on grove-node-1 (not a Der-Tier problem)
- **Connection refused:** AnythingLLM Docker container is down on grove-node-1

### 5. Claude Desktop Configuration

File location: `C:\Users\<username>\AppData\Roaming\Claude\claude_desktop_config.json`

The `"anythingllm"` entry in `"mcpServers"` must be:

```json
"anythingllm": {
  "command": "<full-path-to-bun>",
  "args": ["run", "<full-path-to-atlas-repo>/packages/bridge/src/tools/anythingllm-mcp-server.ts"],
  "env": {
    "ANYTHINGLLM_URL": "http://100.80.12.118:3002",
    "ANYTHINGLLM_API_KEY": "C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM"
  }
}
```

Replace `<full-path-to-bun>` with the actual bun executable path on Der-Tier.
Replace `<full-path-to-atlas-repo>` with the actual atlas repo path on Der-Tier.
Use forward slashes in paths (e.g., `C:/GitHub/atlas/...`).

If there's an existing `"anythingllm"` entry using `npx anythingllm-mcp-server`, **replace it entirely**. That npm package is broken.

After editing, fully quit Claude Desktop (tray icon → Quit, not just close window) and relaunch.

### 6. Claude Code Configuration

File location: `<atlas-repo-root>/.mcp.json`

This file is `.gitignore`d (it contains the API key). Create or update it:

```json
{
  "mcpServers": {
    "anythingllm": {
      "command": "<full-path-to-bun>",
      "args": ["run", "packages/bridge/src/tools/anythingllm-mcp-server.ts"],
      "env": {
        "ANYTHINGLLM_URL": "http://100.80.12.118:3002",
        "ANYTHINGLLM_API_KEY": "C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM"
      }
    }
  }
}
```

Note: Claude Code's `.mcp.json` can use relative paths in `args` (relative to repo root). But the `command` must be an absolute path to bun.

Restart Claude Code after creating/updating this file.

---

## Verification

### Test 1: List workspaces

Ask Claude to use `anythingllm_list_workspaces`. Should return 7+ workspaces with document counts.

### Test 2: Fast workspace (should respond in <25s)

```
anythingllm_search workspace:"grove-technical" query:"what is grove" topN:3
```

### Test 3: Slow workspace (previously timed out, should now work with 90s timeout)

```
anythingllm_search workspace:"grove-vision" query:"what is the ratchet thesis" topN:3
```

This will take 35-45 seconds. That's expected — AnythingLLM calls Claude Sonnet via API for every query, even in "search" mode. A future sprint (RAG-SIMPLIFICATION) will fix this by querying LanceDB directly and bypassing the LLM call.

### Test 4: Second slow workspace

```
anythingllm_search workspace:"gtm-consulting" query:"activation benchmarks" topN:3
```

Also 35-45 seconds. Same reason.

---

## Known Limitations (Accepted for Now)

1. **Every query costs Anthropic API credits** — AnythingLLM has no pure vector search endpoint. "query" mode still calls Claude Sonnet. This will be fixed in the RAG-SIMPLIFICATION sprint.
2. **35-45 second response time on large workspaces** — the LLM synthesis is the bottleneck, not the network or vectors.
3. **120 second timeout** — accounts for worst case: Ollama cold-start (20-30s) + embedding + LanceDB search + Anthropic API (45s) + Tailscale network hop.

---

## Troubleshooting

| Symptom | Cause | Fix |
|---------|-------|-----|
| MCP server won't start | Missing dependencies | `cd <atlas-repo> && bun install` |
| `ANYTHINGLLM_API_KEY not set` | Wrong env var name in config | Use `ANYTHINGLLM_URL` not `ANYTHINGLLM_BASE_URL` |
| 403 error | Using port 3001, or npm package | Use port 3002, use custom MCP server (not npm) |
| Timeout on all workspaces | Tailscale down, or AnythingLLM down | `ping 100.80.12.118`, then test curl command above |
| Timeout only on grove-vision/gtm-consulting | Old 30s timeout | `git pull origin master` to get 120s timeout fix, restart MCP |
| `Cannot find module @modelcontextprotocol/sdk` | Dependencies not installed | `bun install` in atlas repo root |
| Works in Claude Code but not Claude Desktop | Different configs | Check both config files independently |
