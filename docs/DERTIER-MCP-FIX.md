# Fix AnythingLLM MCP on der-tier

**Problem:** Claude Desktop/Code on der-tier can't talk to AnythingLLM on grove-node-1.
**Root cause (resolved):** Two issues stacked:
1. The npm package `anythingllm-mcp-server` broke auth silently in an update - replaced with our custom server
2. Docker Desktop for Windows corrupts Authorization headers on IPv4 connections - fixed with netsh portproxy

**Status:** FIXED as of 2026-03-03. See ADR-003 for full architecture.

---

## How it works now

```
der-tier                         grove-node-1
  Claude Desktop/Code              AnythingLLM (Docker)
       |                                |
       | http://100.80.12.118:3002      | [::1]:3001 (IPv6 loopback)
       |-------- Tailscale ------------>| netsh portproxy: 3002 -> ::1:3001
       |                                |
       | Custom MCP server (bun)        | API key validated (IPv6 path works)
```

**Port 3001** = Docker's native port. IPv4 connections get 403 (Docker NAT bug).
**Port 3002** = Windows portproxy. Forwards IPv4 to IPv6 loopback. API keys work.

---

## Prerequisites

- [x] AnythingLLM running on grove-node-1 (Docker, port 3001)
- [x] API key: `C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM`
- [x] Tailscale connects der-tier to grove-node-1 at `100.80.12.118`
- [x] Atlas repo on der-tier at `C:\GitHub\atlas`
- [x] Bun on der-tier at `C:\Users\jim\.bun\bin\bun.exe`
- [x] netsh portproxy rule on grove-node-1 (port 3002 -> ::1:3001) - survives reboots

---

## Step 1: Pull latest atlas repo

```powershell
cd C:\GitHub\atlas
git pull origin master
```

Verify:
```powershell
Test-Path "C:\GitHub\atlas\packages\bridge\src\tools\anythingllm-mcp-server.ts"
# Must say True
```

---

## Step 2: Install dependencies

```powershell
cd C:\GitHub\atlas
bun install
```

Verify:
```powershell
Test-Path "C:\GitHub\atlas\node_modules\@modelcontextprotocol\sdk"
# Must say True
```

---

## Step 3: Test API connectivity (port 3002, NOT 3001)

```powershell
curl -s http://100.80.12.118:3002/api/v1/workspaces -H "Authorization: Bearer C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM" --connect-timeout 5
```

Must return JSON with workspace list.
- If timeout: Tailscale is down (`ping 100.80.12.118`)
- If 403: portproxy rule is missing on grove-node-1 (see Troubleshooting)
- If connection refused on 3002: portproxy rule is missing on grove-node-1

**NEVER use port 3001 from der-tier.** It will always 403 due to Docker's IPv4 auth bug.

---

## Step 4: Claude Desktop config

File: `C:\Users\jim\AppData\Roaming\Claude\claude_desktop_config.json`

The `"anythingllm"` section should be:

```json
"anythingllm": {
  "command": "C:/Users/jim/.bun/bin/bun.exe",
  "args": ["run", "C:/GitHub/atlas/packages/bridge/src/tools/anythingllm-mcp-server.ts"],
  "env": {
    "ANYTHINGLLM_URL": "http://100.80.12.118:3002",
    "ANYTHINGLLM_API_KEY": "C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM"
  }
}
```

**Critical details:**
- Port is **3002** (not 3001)
- Env var is `ANYTHINGLLM_URL` (not `_BASE_URL`)
- Command is full path to bun (not `npx`)
- Do NOT use the npm package `anythingllm-mcp-server` - it's broken

---

## Step 5: Restart Claude Desktop

1. Fully quit (right-click tray icon -> Quit, not just close window)
2. Reopen Claude Desktop
3. Start new conversation
4. Ask it to list AnythingLLM workspaces

Should return 9 workspaces: my-workspace, grove-technical, grove-vision, monarch, take-flight, gtm-consulting, drumwave, grove-corpus, atlas-pm.

---

## Step 6 (optional): Claude Code on der-tier

Create `C:\GitHub\atlas\.mcp.json`:

```json
{
  "mcpServers": {
    "anythingllm": {
      "command": "C:/Users/jim/.bun/bin/bun.exe",
      "args": ["run", "C:/GitHub/atlas/packages/bridge/src/tools/anythingllm-mcp-server.ts"],
      "env": {
        "ANYTHINGLLM_URL": "http://100.80.12.118:3002",
        "ANYTHINGLLM_API_KEY": "C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM"
      }
    }
  }
}
```

This file is gitignored.

---

## Troubleshooting

### 403 from port 3002
The portproxy rule is missing on grove-node-1. Run (as admin):
```
netsh interface portproxy add v4tov6 listenport=3002 listenaddress=0.0.0.0 connectport=3001 connectaddress=::1
```
Verify: `netsh interface portproxy show all`

### 403 from port 3001
Expected. Port 3001 on IPv4 will ALWAYS 403. Use port 3002.

### Connection refused on 3002
AnythingLLM Docker container is down on grove-node-1. Start it: `docker start anythingllm`

### MCP server won't start
Run `bun install` in the atlas repo directory. If bun not found, use full path: `C:\Users\jim\.bun\bin\bun.exe`

### API key verification
On grove-node-1:
```
bun -e "const {Database}=require('bun:sqlite'); const db=new Database('C:/anythingllm-storage/anythingllm.db',{readonly:true}); console.log(db.query('SELECT secret FROM api_keys LIMIT 1').get().secret)"
```
