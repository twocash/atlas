# Skill: Atlas MCP Hunter

## Purpose
Autonomously expand capabilities by finding and installing Model Context Protocol (MCP) servers.
This transforms Atlas from a tool user into a **tool builder**.

## When to Use
- User requests a capability Atlas doesn't have
- User explicitly asks to find/install an MCP server
- During capability expansion discussions

---

## Workflow

### Phase 1: Scouting (Find)

1. **Search** for MCP servers:
   - GitHub: `mcp-server`, `model-context-protocol`
   - NPM: `@modelcontextprotocol/*`, `mcp-server-*`
   - Anthropic's official registry (if available)

2. **Audit** each candidate:
   | Check | Requirement |
   |-------|-------------|
   | Transport | Must support `stdio` |
   | Security | Note if API keys required |
   | Quality | Last update < 6 months, Stars > 10 |
   | License | MIT, Apache, or similar permissive |

3. **Document findings:**
   ```
   Found: [Package Name]
   Source: [GitHub/NPM URL]
   Transport: stdio ✓
   API Keys: [None / Required: KEY_NAME]
   Last Update: [Date]
   Stars: [Count]
   Tools Provided: [List]
   ```

### Phase 2: Planning (Verify)

**NEVER install without explicit approval.**

Present to Jim:
```
MCP Server Candidate:
- Name: [name]
- Source: [url]
- Capabilities: [tools it provides]
- Requirements: [API keys, dependencies]
- Installation: [command]
- Config snippet:
  ```yaml
  server_name:
    command: "npx"
    args: ["-y", "package-name"]
    env:
      API_KEY: "${ENV_VAR_NAME}"
  ```

Approve installation? (Yes/No)
```

**Wait for explicit "Yes" or "Go" before proceeding.**

### Phase 3: Installation (Execute)

1. **Install Package:**
   - Prefer sandboxed: `npx -y [package]` (no global install)
   - If source available: `bun add [package]` in packages/
   - Last resort: `npm install -g [package]`

2. **Handle Secrets:**
   - **NEVER** write API keys directly into `mcp.yaml`
   - Use `${ENV_VAR_NAME}` syntax
   - Tell Jim: "Please add [KEY_NAME] to your .env file"

3. **Update Configuration:**
   - Read `apps/telegram/config/mcp.yaml`
   - Append the new server entry
   - Preserve existing servers

4. **Activate:**
   - Call `mcp_management({ action: 'restart' })`
   - Verify tools appear via `mcp_management({ action: 'status' })`

5. **Confirm:**
   ```
   Installation Complete:
   - Server: [name] ✓
   - Tools added: [list]
   - Status: Active
   ```

---

## Safety Rules

### Sandboxing
- Prefer `npx -y` to avoid permanent global installs
- Prefer running from packages/ directory if building from source
- Avoid system-wide changes when possible

### Secrets
- Never hardcode API keys
- Always use `${ENV_VAR}` substitution
- Remind Jim to set environment variables

### Verification
- Always verify the server connects after installation
- Always list tools to confirm they're available
- If connection fails, provide troubleshooting steps

### Rollback
If installation fails:
1. Remove the entry from `mcp.yaml`
2. Call `mcp_management({ action: 'restart' })`
3. Report the failure with error details

---

## Example Interaction

**Jim:** "Atlas, I need to search the web but I don't want to use your internal tool. Find me a Brave Search MCP server."

**Atlas (Phase 1 - Scout):**
```
Searching for Brave Search MCP servers...

Found: @modelcontextprotocol/server-brave-search
Source: https://github.com/modelcontextprotocol/servers
Transport: stdio ✓
API Keys: Required (BRAVE_API_KEY)
Last Update: 2025-12-15
Stars: 2.4k (monorepo)
Tools: brave_web_search, brave_local_search
```

**Atlas (Phase 2 - Plan):**
```
MCP Server Candidate:
- Name: Brave Search
- Source: Official Anthropic/MCP repository
- Capabilities: Web search, local search
- Requirements: BRAVE_API_KEY (get from brave.com/api)
- Installation: npx -y @modelcontextprotocol/server-brave-search

Config to add:
```yaml
brave:
  command: "npx"
  args: ["-y", "@modelcontextprotocol/server-brave-search"]
  env:
    BRAVE_API_KEY: "${BRAVE_API_KEY}"
```

Approve installation?
```

**Jim:** "Yes, my key is in .env already as BRAVE_API_KEY"

**Atlas (Phase 3 - Execute):**
1. Updates `config/mcp.yaml`
2. Calls `mcp_management({ action: 'restart' })`
3. Verifies connection

```
Installation Complete:
- Server: brave ✓
- Tools added: mcp__brave__brave_web_search, mcp__brave__brave_local_search
- Status: Active

You can now use: "Search Brave for [query]"
```

---

## Forbidden Actions

- Installing servers without approval
- Writing API keys directly to config files
- Installing from untrusted sources (no README, no stars, suspicious code)
- Modifying system files outside the Atlas repository
- Running arbitrary code from MCP server READMEs without review
