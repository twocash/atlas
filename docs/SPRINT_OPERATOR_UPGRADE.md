# Sprint: Atlas Operator Upgrade

**Sprint ID:** `atlas-operator-v1`
**Effort:** L (8-12 hours across 4 phases)
**Risk:** Medium (shell execution requires tight guardrails)
**Domain:** Infrastructure / Agent Capabilities
**Notion:** https://www.notion.so/2f8780a78eef813abf28e782f47b335f

---

## Executive Summary

This sprint transforms Atlas from a "smart chatbot" into an "autonomous operator" by adding three critical capabilities:

1. **Scoped Shell Execution** — Atlas can write and run scripts within a sandboxed workspace
2. **Self-Diagnostics** — Atlas can inspect its own health, validate skills, and read error logs
3. **File-Based Scheduling** — Atlas can create scheduled tasks via JSON definitions

The current Atlas has a Brain (Claude/Cognitive Router) and Memory (Notion/Files), but is missing Hands (Shell/Execution). Without shell execution, Atlas is a filing clerk. With shell execution, Atlas becomes an engineer.

---

## Architecture Context

**Current Tool Structure** (`apps/telegram/src/conversation/tools/`):
- `core.ts` — Core tools (Notion, search)
- `agents.ts` — Agent dispatch tools
- `workspace.ts` — File read/write within allowed paths
- `self-mod.ts` — SOUL/MEMORY/USER/Skills modification
- `index.ts` — Tool aggregation and routing

**Existing Security Pattern** (from `workspace.ts`):
```typescript
const ALLOWED_PATHS = {
  skills: join(WORKSPACE_ROOT, 'data/skills'),
  memory: join(WORKSPACE_ROOT, 'data/memory'),
  temp: join(WORKSPACE_ROOT, 'data/temp'),
  exports: join(WORKSPACE_ROOT, 'data/exports'),
  conversations: join(WORKSPACE_ROOT, 'data/conversations'),
};
```

All paths validated against directory escape attacks.

---

## Phase 1: Scoped Shell Execution

**Priority:** Critical Path
**Effort:** 4 hours
**Risk:** Medium (requires tight guardrails)

### The Gap

Atlas can read/write files but cannot execute code. Federico's Clawdbot replaces entire Zapier workflows because it can write AND execute scripts. This is the single feature that distinguishes a "toy" from a "tool."

### Two-Stage Execution Pattern

Instead of a raw `execute_shell_command` tool (which encourages blind one-liners), implement staged execution:

**Stage 1: Write Script**
Atlas must write the script to `data/temp/scripts/script_[id].sh` (or `.ts`/`.py`). This creates a physical artifact of what it's about to do.

**Stage 2: Execute Artifact**
Tool: `run_script(filename)` — only runs files inside `data/temp/scripts/` or `data/skills/*/`. Cannot run arbitrary strings.

### Safety Constraints

**The Sandbox:**
- `cwd` locked to `apps/telegram/data/workspace/`
- Clean environment (no inherited env vars except explicit allowlist)
- Timeout: 30 seconds default, 5 minutes max

**Command Blocklist** (hardcoded in `operator.ts`):
- `rm` (force use of trash-bin tool instead)
- `sudo` / `su`
- `nano` / `vim` / `vi` (interactive commands hang)
- `ssh` (unless using specific allowed key/config)
- Any command touching paths outside workspace
- `curl` / `wget` to non-allowlisted domains

**Audit Trail:**
Every execution logged to `data/temp/shell_history.md`:
```markdown
## 2026-01-30 14:32:15
**Script:** scripts/backup-notion.sh
**Trigger:** User request "backup my inbox"
**Exit Code:** 0
**Duration:** 2.3s
**Output:** [truncated to 500 chars]
```

### Implementation

**File:** `apps/telegram/src/conversation/tools/operator.ts`

```typescript
import type Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { readFile, writeFile, mkdir } from 'fs/promises';
import { join, resolve } from 'path';
import { logger } from '../../logger';

const WORKSPACE_ROOT = resolve(__dirname, '../../..');
const SCRIPTS_DIR = join(WORKSPACE_ROOT, 'data/temp/scripts');
const SKILLS_DIR = join(WORKSPACE_ROOT, 'data/skills');
const AUDIT_FILE = join(WORKSPACE_ROOT, 'data/temp/shell_history.md');

// Commands that will NEVER be executed
const BLOCKED_COMMANDS = [
  'rm', 'rmdir', 'del',    // Use trash tool instead
  'sudo', 'su',            // No privilege escalation
  'nano', 'vim', 'vi',     // Interactive editors hang
  'ssh', 'scp',            // Network access controlled
  'curl', 'wget',          // Use fetch tool instead
  'chmod', 'chown',        // No permission changes
  'kill', 'pkill',         // Process management separate
];

export const OPERATOR_TOOLS: Anthropic.Tool[] = [
  {
    name: 'run_script',
    description: 'Execute a script from data/temp/scripts/ or data/skills/. Script must exist first (use write_file to create it). Returns stdout, stderr, and exit code.',
    input_schema: {
      type: 'object' as const,
      properties: {
        filename: {
          type: 'string',
          description: 'Script filename (e.g., "backup.sh", "analyze.ts", "process.py")',
        },
        location: {
          type: 'string',
          enum: ['scripts', 'skill'],
          description: 'Where the script lives: "scripts" = data/temp/scripts/, "skill" = data/skills/[name]/',
        },
        skill_name: {
          type: 'string',
          description: 'If location is "skill", which skill folder',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Max execution time (default 30, max 300)',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Command line arguments to pass to script',
        },
      },
      required: ['filename', 'location'],
    },
  },
  {
    name: 'check_script_safety',
    description: 'Validate a script before running. Returns warnings about blocked commands or suspicious patterns.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'Script content to validate',
        },
      },
      required: ['content'],
    },
  },
];
```

### Gate Criteria

- [ ] `run_script` tool executes `.sh`, `.ts`, `.py` files
- [ ] Scripts outside allowed directories rejected
- [ ] Blocked commands detected and rejected
- [ ] Execution logged to `shell_history.md`
- [ ] Timeout kills runaway processes
- [ ] Exit code, stdout, stderr returned to Claude

---

## Phase 2: Self-Diagnostics

**Priority:** High (reduces Jim Tax for debugging)
**Effort:** 2 hours
**Risk:** Low (read-only operations)

### The Gap

Federico describes Clawdbot "assessing the state of its features" by scanning its own directory. When something breaks, it can diagnose and fix. Atlas currently has no visibility into its own health.

### Tools

**`read_system_logs`** — Atlas reads `apps/telegram/logs/error.log`

Flow: User: "Why did the timesheet skill fail?" → Atlas reads log → "It seems the API key env var is undefined."

**`validate_skill_syntax`** — Runs `bun run typecheck` or `tsc --noEmit` on a skill file

Flow: Atlas writes code → Runs check → "Syntax error on line 42. Fixing..." → Rewrites code.

**`health_check`** — Returns system state:
- Bot uptime
- Last successful Notion sync
- Claude API status (recent errors?)
- Disk space in workspace
- Pending scheduled tasks

### Implementation

**File:** `apps/telegram/src/conversation/tools/operator.ts` (extend)

```typescript
export const DIAGNOSTIC_TOOLS: Anthropic.Tool[] = [
  {
    name: 'read_error_logs',
    description: 'Read recent error logs. Use when diagnosing why something failed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lines: {
          type: 'number',
          description: 'Number of recent lines to read (default 50, max 500)',
        },
        filter: {
          type: 'string',
          description: 'Optional: filter to specific component (e.g., "notion", "claude", "skill")',
        },
      },
      required: [],
    },
  },
  {
    name: 'validate_typescript',
    description: 'Type-check a TypeScript file without executing. Returns errors or "OK".',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspace: {
          type: 'string',
          enum: ['skills', 'temp'],
        },
        path: {
          type: 'string',
          description: 'Relative path to .ts file',
        },
      },
      required: ['workspace', 'path'],
    },
  },
  {
    name: 'health_check',
    description: 'Get Atlas system health: uptime, last sync, API status, disk space.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
];
```

### Gate Criteria

- [ ] `read_error_logs` returns filtered log content
- [ ] `validate_typescript` catches syntax errors before execution
- [ ] `health_check` returns structured health report
- [ ] All read-only (no mutations)

---

## Phase 3: File-Based Scheduling

**Priority:** Medium (the "alive" factor)
**Effort:** 2 hours
**Risk:** Low (file-based, external executor)

### The Gap

Federico sets up automated jobs via conversation that run without him. Atlas has Notion comment polling but not general scheduled tasks. This is how Atlas surprises Jim with initiative.

### Watch Folder Pattern

Don't write a complex scheduler. Use a simple pattern:

**Directory:** `apps/telegram/data/schedules/`

**File Schema:** `morning-briefing.json`
```json
{
  "id": "morning-briefing",
  "cron": "0 8 * * 1-5",
  "action": "execute_skill",
  "target": "morning-briefing",
  "description": "Summarize Work Queue and Calendar",
  "created": "2026-01-30T14:00:00Z",
  "enabled": true
}
```

**The Watcher:** A simple ~50-line `scheduler.ts` that:
1. Loads JSON files from `data/schedules/`
2. Registers them with `node-cron`
3. On trigger, sends message to bot's own chat

**Why:** If Atlas messes up the JSON, the scheduler just logs an error and skips it. Doesn't crash the bot or server.

### Implementation

**File:** `apps/telegram/src/conversation/tools/operator.ts` (extend)

```typescript
export const SCHEDULER_TOOLS: Anthropic.Tool[] = [
  {
    name: 'create_schedule',
    description: 'Create a scheduled task. The task runs automatically at the specified time.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Unique ID (kebab-case)',
        },
        cron: {
          type: 'string',
          description: 'Cron expression (e.g., "0 8 * * 1-5" for 8am weekdays)',
        },
        action: {
          type: 'string',
          enum: ['execute_skill', 'send_message', 'run_script'],
        },
        target: {
          type: 'string',
          description: 'What to execute: skill name, message text, or script path',
        },
        description: {
          type: 'string',
          description: 'Human-readable description',
        },
      },
      required: ['id', 'cron', 'action', 'target', 'description'],
    },
  },
  {
    name: 'list_schedules',
    description: 'List all scheduled tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'delete_schedule',
    description: 'Remove a scheduled task.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: { type: 'string' },
      },
      required: ['id'],
    },
  },
];
```

**File:** `apps/telegram/src/scheduler.ts`

```typescript
import { CronJob } from 'cron';
import { readdir, readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from './logger';

const SCHEDULES_DIR = join(__dirname, '../data/schedules');

interface ScheduledTask {
  id: string;
  cron: string;
  action: 'execute_skill' | 'send_message' | 'run_script';
  target: string;
  description: string;
  created: string;
  enabled: boolean;
}

export async function initScheduler(triggerCallback: (task: ScheduledTask) => void) {
  const files = await readdir(SCHEDULES_DIR);
  const jobs: CronJob[] = [];

  for (const file of files.filter(f => f.endsWith('.json'))) {
    try {
      const content = await readFile(join(SCHEDULES_DIR, file), 'utf-8');
      const task = JSON.parse(content) as ScheduledTask;
      
      if (!task.enabled) continue;
      
      const job = new CronJob(task.cron, () => triggerCallback(task));
      job.start();
      jobs.push(job);
      
      logger.info('Scheduled task loaded', { id: task.id, cron: task.cron });
    } catch (err) {
      logger.error('Failed to load schedule', { file, error: err });
    }
  }
  
  return jobs;
}
```

### Gate Criteria

- [ ] `create_schedule` writes valid JSON to `data/schedules/`
- [ ] `list_schedules` returns all scheduled tasks
- [ ] `delete_schedule` removes task file
- [ ] Scheduler process loads and executes tasks
- [ ] Invalid JSON skipped with error log (no crash)

---

## Phase 4: "Batteries Included" Dependencies

**Priority:** Low (defer unless real need)
**Effort:** 1 hour
**Risk:** Low

### The Gap

Clawdbot installs npm packages dynamically. This is a nightmare for stability (version conflicts, disk bloat).

### Better Approach: Pre-install the "God Stack"

Add these to `apps/telegram/package.json` now. Atlas has tools without needing to run `npm install`:

```json
{
  "dependencies": {
    // Already have
    "@anthropic-ai/sdk": "...",
    "grammy": "...",
    "@notionhq/client": "...",
    
    // Add: Data Processing
    "csv-parse": "^5.x",
    "xlsx": "^0.18.x",
    
    // Add: Web/API
    "cheerio": "^1.x",
    
    // Add: Media
    "sharp": "^0.33.x",
    
    // Add: PDF
    "pdf-parse": "^1.x",
    
    // Add: Git
    "simple-git": "^3.x",
    
    // Add: Scheduling
    "cron": "^3.x"
  }
}
```

### Gate Criteria

- [ ] Dependencies added to package.json
- [ ] `bun install` succeeds
- [ ] No version conflicts

---

## Safety Architecture Summary

| Layer | Protection |
|-------|------------|
| **Path Validation** | Scripts only run from `data/temp/scripts/` or `data/skills/*/` |
| **Command Blocklist** | rm, sudo, ssh, curl blocked at parse time |
| **Execution Sandbox** | cwd locked, clean env, timeout enforced |
| **Audit Trail** | Every execution logged to `shell_history.md` |
| **Destructive Actions** | Require confirmation (skill changes show diff) |
| **Diagnostics** | Read-only access to logs and health |
| **Scheduling** | File-based, external executor, invalid JSON skipped |

---

## Bug Queue Integration

When Atlas fails a task (shell command error), it should:

1. Catch the error
2. Create a Work Queue item (Type: Bug, Priority: P2)
3. Link it to the conversation context
4. Ask: "I failed to execute the script. I've logged a bug. Want me to try to fix the script now?"

This closes the loop. Atlas fails gracefully and visibly.

---

## Success Criteria

**Phase 1 Complete When:**
- Atlas can write a script and execute it
- Blocked commands rejected with clear error
- Execution history visible in `shell_history.md`

**Phase 2 Complete When:**
- Atlas can read its own error logs
- Atlas can type-check TypeScript before running
- `/health` returns structured system status

**Phase 3 Complete When:**
- Atlas can create a scheduled task via conversation
- Tasks persist across bot restarts
- Scheduler executes tasks at correct times

**Sprint Complete When:**
- All gates pass
- Jim can say "write a script to backup my inbox and run it every morning" and Atlas does it

---

## File Manifest

| File | Action | Purpose |
|------|--------|----------|
| `src/conversation/tools/operator.ts` | CREATE | Shell execution + diagnostics + scheduling tools |
| `src/conversation/tools/index.ts` | MODIFY | Import and export OPERATOR_TOOLS |
| `src/scheduler.ts` | CREATE | Cron job loader and executor |
| `src/index.ts` | MODIFY | Initialize scheduler on startup |
| `data/temp/scripts/` | CREATE | Directory for user scripts |
| `data/schedules/` | CREATE | Directory for scheduled task JSONs |
| `package.json` | MODIFY | Add cron, csv-parse, xlsx, cheerio, sharp |

---

## References

- **Clawdbot Analysis:** Document in chat (source patterns)
- **Existing Tools:** `apps/telegram/src/conversation/tools/workspace.ts`
- **Security Model:** `validatePath()` function in workspace.ts
- **CLAUDE.md:** `apps/telegram/CLAUDE.md` (project context)
- **Work Queue Schema:** Notion database `6a8d9c43-b084-47b5-bc83-bc363640f2cd`
