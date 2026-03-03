# Fix AnythingLLM MCP on der-tier

**Problem:** Claude Desktop on der-tier can't talk to AnythingLLM on grove-node-1. 403 auth errors.
**Root cause:** The npm package `anythingllm-mcp-server` is broken. We have a working custom replacement in the atlas repo.

---

## Prerequisites (already done)

- [x] AnythingLLM running on grove-node-1 (Docker, port 3001)
- [x] API key verified working: `C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM`
- [x] Tailscale connects der-tier to grove-node-1 at `100.80.12.118`
- [x] Atlas repo exists on der-tier at `C:\GitHub\atlas`
- [x] Bun exists on der-tier at `C:\Users\jim\.bun\bin\bun.exe`

---

## Step 1: Pull latest atlas repo

Open a terminal on der-tier and run:

```powershell
cd C:\GitHub\atlas
git pull origin master
```

Verify the file exists:

```powershell
Test-Path "C:\GitHub\atlas\packages\bridge\src\tools\anythingllm-mcp-server.ts"
```

Must say `True`. If not, something went wrong with the pull.

---

## Step 2: Install dependencies

```powershell
cd C:\GitHub\atlas
bun install
```

Verify the MCP SDK installed:

```powershell
Test-Path "C:\GitHub\atlas\node_modules\@modelcontextprotocol\sdk"
```

Must say `True`.

---

## Step 3: Test the MCP server runs

```powershell
$env:ANYTHINGLLM_URL = "http://100.80.12.118:3001"
$env:ANYTHINGLLM_API_KEY = "C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM"
cd C:\GitHub\atlas
bun run packages/bridge/src/tools/anythingllm-mcp-server.ts
```

It should hang (waiting for stdio input). That means it started. Press Ctrl+C to kill it.

If it crashes with an import error, `bun install` didn't work. Re-run it.

---

## Step 4: Test API connectivity from der-tier

```powershell
curl -s http://100.80.12.118:3001/api/v1/workspaces -H "Authorization: Bearer C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM" --connect-timeout 5
```

Must return JSON with workspace list. If it times out, Tailscale is down. If 403, the API key is wrong (check AnythingLLM admin panel on grove-node-1).

---

## Step 5: Edit Claude Desktop config

Open this file in any editor:

```
C:\Users\jim\AppData\Roaming\Claude\claude_desktop_config.json
```

Find the `"anythingllm"` section. It currently looks like this:

```json
"anythingllm": {
  "command": "npx",
  "args": ["-y", "anythingllm-mcp-server"],
  "env": {
    "ANYTHINGLLM_BASE_URL": "http://100.80.12.118:3001",
    "ANYTHINGLLM_API_KEY": "C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM"
  }
}
```

**Replace it with exactly this:**

```json
"anythingllm": {
  "command": "C:/Users/jim/.bun/bin/bun.exe",
  "args": ["run", "C:/GitHub/atlas/packages/bridge/src/tools/anythingllm-mcp-server.ts"],
  "env": {
    "ANYTHINGLLM_URL": "http://100.80.12.118:3001",
    "ANYTHINGLLM_API_KEY": "C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM"
  }
}
```

**Three things changed:**
1. `"command"` — was `"npx"`, now full path to bun
2. `"args"` — was `["-y", "anythingllm-mcp-server"]`, now `["run", "<path to our server>"]`
3. `"env"` key name — was `ANYTHINGLLM_BASE_URL`, now `ANYTHINGLLM_URL` (our server reads `_URL`)

**Everything else in the file stays the same.** Don't touch `filesystem` or `preferences`.

Save the file.

---

## Step 6: Restart Claude Desktop

1. Fully quit Claude Desktop (right-click tray icon, Quit — not just close the window)
2. Reopen Claude Desktop
3. Start a new conversation
4. Ask it to list AnythingLLM workspaces

It should return 9 workspaces: my-workspace, grove-technical, grove-vision, monarch, take-flight, gtm-consulting, drumwave, grove-corpus, atlas-pm.

---

## Step 7 (optional): Fix Claude Code on der-tier too

If you want Claude Code on der-tier to also have AnythingLLM access, create this file:

```
C:\GitHub\atlas\.mcp.json
```

With this content:

```json
{
  "mcpServers": {
    "anythingllm": {
      "command": "C:/Users/jim/.bun/bin/bun.exe",
      "args": ["run", "C:/GitHub/atlas/packages/bridge/src/tools/anythingllm-mcp-server.ts"],
      "env": {
        "ANYTHINGLLM_URL": "http://100.80.12.118:3001",
        "ANYTHINGLLM_API_KEY": "C0P0TQA-2XY4HFJ-HWNV5E7-ZXBCHHM"
      }
    }
  }
}
```

This file is gitignored so it won't be committed.

---

## If it still doesn't work

1. Check Tailscale: `ping 100.80.12.118` — if this fails, Tailscale is disconnected
2. Check AnythingLLM: `curl http://100.80.12.118:3001/api/ping` — should return `{"online":true}`
3. Check the key: on grove-node-1, run `bun -e "const {Database}=require('bun:sqlite'); const db=new Database('C:/anythingllm-storage/anythingllm.db',{readonly:true}); console.log(db.query('SELECT secret FROM api_keys LIMIT 1').get().secret)"` — must match the key above
4. Check Claude Desktop logs: `C:\Users\jim\AppData\Roaming\Claude\logs\` — look for MCP server startup errors
