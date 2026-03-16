# Sprint: RAG Simplification — Always-Available Vector Search

**Status:** Planned
**Goal:** Replace the current AnythingLLM-mediated RAG with a direct, fast, local vector search that works reliably across the Tailscale network for all Claude surfaces.

---

## Problem Statement

The current RAG stack has accumulated layers of indirection that make it unreliable:

1. **AnythingLLM's "query" mode calls the LLM** — There is no pure vector-search endpoint. Every query, even "search," routes through Anthropic's API (Claude Sonnet). A simple vector lookup takes 20-45 seconds and costs API credits.
2. **Timeout cascade** — From Der-Tier via Tailscale, the network hop + Ollama embedding + LanceDB search + Anthropic API round-trip exceeds MCP timeouts for larger workspaces (grove-vision: 43s, gtm-consulting: 35s).
3. **No vector-only API** — AnythingLLM's `/search` endpoint doesn't exist in the current version. The only path is `/chat` which always invokes the LLM.
4. **Three tools that do the same thing** — `anythingllm_search`, `anythingllm_chat` (query mode), and `anythingllm_chat` (chat mode) all hit the same `/chat` endpoint. The user believes they have a fast vector search option. They don't.
5. **Config drift** — Claude Desktop was still running the npm `anythingllm-mcp-server` package (replaced months ago). MCP configs diverge across machines.

### What We Have

| Component | Location | Role |
|-----------|----------|------|
| AnythingLLM | Docker on grove-node-1, port 3001 | Document ingestion, embedding, storage, chat |
| Ollama | grove-node-1 service | Embedding model host (snowflake-arctic-embed2, 1024-dim) |
| LanceDB | Inside Docker at `/app/server/storage/lancedb/` | Vector storage (on-disk) |
| Custom MCP Server | `packages/bridge/src/tools/anythingllm-mcp-server.ts` | Wraps AnythingLLM REST API for Claude Code/Desktop |
| Portproxy | grove-node-1 netsh rule | 0.0.0.0:3002 → [::1]:3001 (IPv4→IPv6 workaround) |

### What We Want

- **Sub-5-second vector search** from any machine on the Tailscale network
- **No LLM in the search path** — embedding + cosine similarity + return chunks. That's it.
- **Available to:** Atlas bot, Claude Code (grove-node-1 + der-tier), Claude Desktop (both machines)
- **Keep AnythingLLM for ingestion only** — it's fine at uploading/chunking/embedding docs. Just don't query through it.

---

## Architecture Options

### Option A: Direct LanceDB MCP Server (Recommended)

**Concept:** Build a lightweight MCP server that reads LanceDB tables directly, uses Ollama for query embedding, and returns raw chunks. AnythingLLM stays for document management only.

```
Claude (any surface) → MCP server (Bun, stdio) → Ollama embed query → LanceDB search → chunks
```

**Pros:**
- Sub-second vector search (no LLM, no HTTP to AnythingLLM)
- Zero API cost per query
- Uses existing LanceDB data and Ollama embeddings — no migration
- Single MCP server binary, same on both machines

**Cons:**
- LanceDB files are inside Docker. Need to either mount them to host or query from inside container.
- Tied to LanceDB format (if AnythingLLM changes schema, we break)
- Still need AnythingLLM running for ingestion

**Implementation:**
1. Mount LanceDB storage to host: `-v C:\anythingllm-storage\lancedb:/lancedb:ro`
2. Build `packages/bridge/src/tools/rag-search-server.ts`:
   - Opens LanceDB tables directly via `@lancedb/lancedb` npm package
   - Embeds query via Ollama HTTP API (`POST /api/embeddings`)
   - Cosine similarity search, return top-N chunks with metadata
   - Tools: `rag_search(workspace, query, topN)`, `rag_list_workspaces()`
3. Deploy as MCP server on both machines via `.mcp.json`
4. Keep AnythingLLM MCP server for admin (upload, embed, remove docs)

**Risk:** LanceDB internal schema. Need to verify the table format AnythingLLM uses.

---

### Option B: ChromaDB Migration

**Concept:** Replace AnythingLLM's vector storage with ChromaDB. Standalone vector DB with a proper REST API and pure search endpoint.

```
Ingestion: docs → Ollama embed → ChromaDB (Docker, port 8000)
Search:    Claude → MCP server → ChromaDB REST API → chunks
```

**Pros:**
- Purpose-built vector DB with real search API
- REST API works from any machine, no portproxy needed
- Well-documented, stable API
- Lightweight Docker container

**Cons:**
- Migration effort — re-embed all 100+ docs
- Lose AnythingLLM's chunking/preprocessing
- Another Docker container to manage
- Need to build ingestion pipeline from scratch

---

### Option C: Pinecone (Cloud)

**Concept:** Move vectors to Pinecone. Already configured as MCP plugin.

**Pros:**
- Always available, no self-hosting
- Built-in MCP tools already in Claude
- Professional-grade vector search

**Cons:**
- All queries go to cloud (latency, cost, dependency)
- Re-embed everything
- Violates the Ratchet thesis (ironic for Grove's own infra)
- Monthly cost for storage

---

### Option D: Fix AnythingLLM In Place

**Concept:** Find or build a pure vector search endpoint within AnythingLLM.

**Pros:**
- No migration
- Keeps existing setup

**Cons:**
- AnythingLLM's API is janky (documented extensively)
- No guarantee a vector-only endpoint exists or can be added cleanly
- Still dependent on Docker + portproxy chain
- Doesn't solve the fundamental: AnythingLLM is a chat app, not a vector DB

---

## Recommendation: Option A (Direct LanceDB)

**Why:** Minimum migration (zero — reads existing data), maximum speed improvement, keeps the pieces that work (Ollama embeddings, AnythingLLM for ingestion), removes the piece that doesn't (AnythingLLM as query intermediary).

---

## Execution Plan

### Phase 1: Verify LanceDB Access (1 hour)

- [ ] Mount LanceDB directory read-only to host filesystem
- [ ] Install `@lancedb/lancedb` in bridge package
- [ ] Write spike script: open a table, read schema, run a raw vector query
- [ ] Verify embedding dimensions match (1024-dim snowflake-arctic-embed2)
- [ ] Time it: should be <100ms for the search itself

### Phase 2: Build RAG Search MCP Server (2-3 hours)

- [ ] `packages/bridge/src/tools/rag-search-server.ts`
- [ ] Tool: `rag_search` — embed query via Ollama, search LanceDB, return top-N chunks
- [ ] Tool: `rag_list_workspaces` — list available LanceDB tables with doc counts
- [ ] Tool: `rag_workspace_info` — return doc list and total chunk count for a workspace
- [ ] Handle Ollama cold-start gracefully (pre-warm or retry once)
- [ ] Timeout: 15s total (generous — should take <2s)

### Phase 3: Network Deployment (1 hour)

- [ ] Test from grove-node-1: Claude Code + Claude Desktop
- [ ] Test from Der-Tier: Claude Code + Claude Desktop via Tailscale
- [ ] Update `.mcp.json` on both machines
- [ ] Update `claude_desktop_config.json` on both machines
- [ ] Verify all 7 workspaces searchable from both machines

### Phase 4: Cleanup (30 min)

- [ ] Demote AnythingLLM MCP tools to admin-only (upload/embed/remove)
- [ ] Update CLAUDE.md with new RAG architecture
- [ ] Update memory files
- [ ] Remove/deprecate `anythingllm_search` and `anythingllm_chat` query-mode descriptions

### Phase 5: Stretch — LLM Synthesis On-Demand

- [ ] Optional `rag_ask` tool: search + pass chunks to local Ollama LLM for synthesis
- [ ] Or: let the calling Claude instance do synthesis from raw chunks (zero extra cost)

---

## Success Criteria

| Metric | Current | Target |
|--------|---------|--------|
| Vector search latency (localhost) | 21-43 seconds | <2 seconds |
| Vector search latency (Der-Tier via Tailscale) | timeout (>30s) | <5 seconds |
| API cost per search | ~$0.02-0.05 (Sonnet tokens) | $0.00 |
| Reliability | 4/7 workspaces work | 7/7 workspaces work |
| LLM in search path | Always (mandatory) | Never (optional) |

---

## Dependencies

- `@lancedb/lancedb` npm package (Node/Bun compatible)
- Ollama running on grove-node-1 with snowflake-arctic-embed2
- LanceDB files accessible from host (Docker volume mount)
- Tailscale network connectivity between machines

## Open Questions

1. Can `@lancedb/lancedb` read the tables AnythingLLM created? (LanceDB format versions)
2. Does the Docker volume mount work read-only without breaking AnythingLLM's writes?
3. Should Der-Tier embed queries locally (needs Ollama) or hit grove-node-1's Ollama? Latency tradeoff.
4. Do we keep AnythingLLM long-term or eventually replace ingestion too?
