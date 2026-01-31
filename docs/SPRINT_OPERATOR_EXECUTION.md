# Atlas Operator Upgrade — Execution Plan

**Sprint ID:** `atlas-operator-v1`  
**Total Effort:** 6-8 hours across 3 atomic sprints  
**Execution Order:** Sprint 1 → Sprint 3 → Sprint 2 (value-ordered)  
**Handoff Date:** 2026-01-30

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                      Atlas Telegram Bot                      │
├─────────────────────────────────────────────────────────────┤
│  src/conversation/tools/                                     │
│  ├── core.ts          (Notion, search)                      │
│  ├── agents.ts        (Agent dispatch)                      │
│  ├── workspace.ts     (File read/write)                     │
│  ├── self-mod.ts      (SOUL/MEMORY/Skills)                  │
│  ├── operator.ts      ← NEW: Shell execution + diagnostics  │
│  └── index.ts         (Aggregation)                         │
├─────────────────────────────────────────────────────────────┤
│  src/scheduler.ts     ← NEW: Cron task executor             │
├─────────────────────────────────────────────────────────────┤
│  data/                                                       │
│  ├── temp/scripts/    ← NEW: Atlas-written scripts          │
│  ├── temp/logs/       ← NEW: Execution audit logs           │
│  └── schedules/       ← NEW: Scheduled task JSONs           │
└─────────────────────────────────────────────────────────────┘
```

---

## Pre-Flight Checklist

Before starting, verify:

- [ ] `bun --version` returns 1.x
- [ ] `cd C:\github\atlas\apps\telegram && bun install` succeeds
- [ ] Bot runs: `bun run dev` starts without errors
- [ ] You have the existing `workspace.ts` open for reference (path validation pattern)

---

# Sprint 1: The Hands (Operator Core)

**Goal:** Enable Atlas to execute read-only and write-safe scripts in a sandbox.  
**Effort:** 3-4 hours  
**Unlocks:** 80% of total value

---

## Step 1.1: Dependencies

**File:** `apps/telegram/package.json`

Add to `dependencies`:

```json
{
  "dependencies": {
    "simple-git": "^3.27.0",
    "cheerio": "^1.0.0",
    "csv-parse": "^5.6.0",
    "xlsx": "^0.18.5",
    "pdf-parse": "^1.1.1",
    "sharp": "^0.33.5"
  }
}
```

**Command:**
```bash
cd C:\github\atlas\apps\telegram
bun install
```

**Gate:** `bun install` completes without errors.

---

## Step 1.2: Directory Setup

**Create these directories and placeholder files:**

```
apps/telegram/data/temp/scripts/.gitkeep
apps/telegram/data/temp/logs/.gitkeep
apps/telegram/data/workspace/.gitkeep
```

**Commands:**
```bash
mkdir -p data/temp/scripts data/temp/logs data/workspace
touch data/temp/scripts/.gitkeep data/temp/logs/.gitkeep data/workspace/.gitkeep
```

**Gate:** Directories exist and are committed to git.

---

## Step 1.3: Implement operator.ts

**File:** `apps/telegram/src/conversation/tools/operator.ts`

```typescript
/**
 * Atlas Telegram Bot - Operator Tools
 * 
 * Scoped shell execution with safety guardrails.
 * Scripts must be written to allowed paths before execution.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { readFile, appendFile, access, mkdir } from 'fs/promises';
import { join, resolve, normalize, extname } from 'path';
import { logger } from '../../logger';

// ============================================================================
// CONSTANTS
// ============================================================================

const WORKSPACE_ROOT = resolve(__dirname, '../../..');
const SCRIPTS_DIR = join(WORKSPACE_ROOT, 'data/temp/scripts');
const SKILLS_DIR = join(WORKSPACE_ROOT, 'data/skills');
const WORKSPACE_DIR = join(WORKSPACE_ROOT, 'data/workspace');
const AUDIT_FILE = join(WORKSPACE_ROOT, 'data/temp/logs/shell_history.jsonl');

const ALLOWED_EXTENSIONS = ['.ts', '.js', '.py', '.sh'];

const BLOCKED_PATTERNS = [
  /\bsudo\b/,
  /\bsu\b/,
  /\brm\s+-rf\b/,
  /\brm\s+--no-preserve-root\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\b:(){.*};\s*:/,  // Fork bomb
  /\bchmod\s+777\b/,
  /\bchown\b/,
  /\bkill\s+-9\b/,
  /\bpkill\b/,
  /\bkillall\b/,
];

const BLOCKED_COMMANDS = [
  'rm', 'rmdir', 'del',
  'sudo', 'su',
  'nano', 'vim', 'vi', 'emacs',
  'ssh', 'scp', 'sftp',
  'chmod', 'chown',
  'kill', 'pkill', 'killall',
  'shutdown', 'reboot', 'halt',
  'mkfs', 'fdisk', 'dd',
];

// ============================================================================
// TOOL DEFINITIONS
// ============================================================================

export const OPERATOR_TOOLS: Anthropic.Tool[] = [
  {
    name: 'run_script',
    description: `Execute a script from data/temp/scripts/ or data/skills/[name]/. 
The script must already exist (use write_file to create it first).
Returns stdout, stderr, and exit code.
IMPORTANT: All scripts must include a header comment with @description and @risk.`,
    input_schema: {
      type: 'object' as const,
      properties: {
        filename: {
          type: 'string',
          description: 'Script filename (e.g., "backup.ts", "analyze.py")',
        },
        location: {
          type: 'string',
          enum: ['scripts', 'skill'],
          description: '"scripts" = data/temp/scripts/, "skill" = data/skills/[skill_name]/',
        },
        skill_name: {
          type: 'string',
          description: 'Required if location is "skill". The skill folder name.',
        },
        timeout_seconds: {
          type: 'number',
          description: 'Max execution time. Default: 30, Max: 300',
        },
        args: {
          type: 'array',
          items: { type: 'string' },
          description: 'Arguments to pass to the script',
        },
      },
      required: ['filename', 'location'],
    },
  },
  {
    name: 'check_script_safety',
    description: 'Validate script content before execution. Returns safety assessment.',
    input_schema: {
      type: 'object' as const,
      properties: {
        content: {
          type: 'string',
          description: 'The script content to validate',
        },
      },
      required: ['content'],
    },
  },
];

// ============================================================================
// VALIDATION HELPERS
// ============================================================================

function validateScriptPath(
  filename: string,
  location: 'scripts' | 'skill',
  skillName?: string
): { valid: boolean; fullPath?: string; error?: string } {
  // Determine base directory
  let baseDir: string;
  if (location === 'scripts') {
    baseDir = SCRIPTS_DIR;
  } else if (location === 'skill' && skillName) {
    baseDir = join(SKILLS_DIR, skillName);
  } else {
    return { valid: false, error: 'skill_name required when location is "skill"' };
  }

  // Normalize and resolve
  const fullPath = resolve(baseDir, normalize(filename));

  // Path escape check
  if (!fullPath.startsWith(baseDir)) {
    return { valid: false, error: 'Path escapes allowed directory' };
  }

  // Extension check
  const ext = extname(filename).toLowerCase();
  if (!ALLOWED_EXTENSIONS.includes(ext)) {
    return { 
      valid: false, 
      error: `Invalid extension: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}` 
    };
  }

  return { valid: true, fullPath };
}

function checkContentSafety(content: string): { safe: boolean; violations: string[] } {
  const violations: string[] = [];

  // Check blocked patterns
  for (const pattern of BLOCKED_PATTERNS) {
    if (pattern.test(content)) {
      violations.push(`Blocked pattern detected: ${pattern.source}`);
    }
  }

  // Check for blocked commands at word boundaries
  const words = content.toLowerCase().split(/\s+/);
  for (const cmd of BLOCKED_COMMANDS) {
    if (words.includes(cmd)) {
      violations.push(`Blocked command: ${cmd}`);
    }
  }

  return { safe: violations.length === 0, violations };
}

function getExecutor(ext: string): { cmd: string; args: string[] } {
  switch (ext) {
    case '.ts':
      return { cmd: 'bun', args: ['run'] };
    case '.js':
      return { cmd: 'bun', args: ['run'] };
    case '.py':
      return { cmd: 'python3', args: [] };
    case '.sh':
      return { cmd: 'bash', args: [] };
    default:
      return { cmd: 'bun', args: ['run'] };
  }
}

// ============================================================================
// AUDIT LOGGING
// ============================================================================

interface AuditEntry {
  timestamp: string;
  script: string;
  location: string;
  exitCode: number | null;
  durationMs: number;
  stdout: string;
  stderr: string;
  error?: string;
}

async function logExecution(entry: AuditEntry): Promise<void> {
  try {
    await mkdir(join(WORKSPACE_ROOT, 'data/temp/logs'), { recursive: true });
    const line = JSON.stringify(entry) + '\n';
    await appendFile(AUDIT_FILE, line, 'utf-8');
  } catch (err) {
    logger.error('Failed to write audit log', { error: err });
  }
}

// ============================================================================
// TOOL EXECUTION
// ============================================================================

export async function executeOperatorTools(
  toolName: string,
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string } | null> {
  switch (toolName) {
    case 'run_script':
      return await executeRunScript(input);
    case 'check_script_safety':
      return await executeCheckSafety(input);
    default:
      return null;
  }
}

async function executeRunScript(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const filename = input.filename as string;
  const location = input.location as 'scripts' | 'skill';
  const skillName = input.skill_name as string | undefined;
  const timeoutSeconds = Math.min(Math.max(input.timeout_seconds as number || 30, 1), 300);
  const args = (input.args as string[]) || [];

  // Validate path
  const validation = validateScriptPath(filename, location, skillName);
  if (!validation.valid) {
    return { success: false, result: null, error: validation.error };
  }

  const fullPath = validation.fullPath!;

  // Check file exists
  try {
    await access(fullPath);
  } catch {
    return { success: false, result: null, error: `Script not found: ${filename}` };
  }

  // Read and validate content
  let content: string;
  try {
    content = await readFile(fullPath, 'utf-8');
  } catch (err) {
    return { success: false, result: null, error: `Cannot read script: ${err}` };
  }

  const safety = checkContentSafety(content);
  if (!safety.safe) {
    return {
      success: false,
      result: null,
      error: `Script blocked for safety:\n${safety.violations.join('\n')}`,
    };
  }

  // Determine executor
  const ext = extname(filename).toLowerCase();
  const executor = getExecutor(ext);

  // Execute
  const startTime = Date.now();

  return new Promise((resolve) => {
    const proc = spawn(executor.cmd, [...executor.args, fullPath, ...args], {
      cwd: WORKSPACE_DIR,
      timeout: timeoutSeconds * 1000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        USER: process.env.USER,
        LANG: 'en_US.UTF-8',
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('close', async (code) => {
      const durationMs = Date.now() - startTime;

      // Log execution
      await logExecution({
        timestamp: new Date().toISOString(),
        script: `${location}/${filename}`,
        location,
        exitCode: code,
        durationMs,
        stdout: stdout.slice(0, 5000),
        stderr: stderr.slice(0, 2000),
      });

      logger.info('Script executed', {
        script: filename,
        exitCode: code,
        durationMs,
      });

      resolve({
        success: code === 0,
        result: {
          exitCode: code,
          stdout: stdout.slice(0, 5000),
          stderr: stderr.slice(0, 2000),
          durationMs,
          truncated: stdout.length > 5000 || stderr.length > 2000,
        },
        error: code !== 0 ? `Script exited with code ${code}` : undefined,
      });
    });

    proc.on('error', async (err) => {
      const durationMs = Date.now() - startTime;

      await logExecution({
        timestamp: new Date().toISOString(),
        script: `${location}/${filename}`,
        location,
        exitCode: null,
        durationMs,
        stdout,
        stderr,
        error: String(err),
      });

      resolve({
        success: false,
        result: null,
        error: `Execution failed: ${err}`,
      });
    });
  });
}

async function executeCheckSafety(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const content = input.content as string;

  const safety = checkContentSafety(content);

  // Check for required header
  const hasHeader = /@description/.test(content) && /@risk/.test(content);

  return {
    success: true,
    result: {
      safe: safety.safe,
      violations: safety.violations,
      hasRequiredHeader: hasHeader,
      recommendation: !hasHeader
        ? 'Add header with @description and @risk tags'
        : safety.safe
        ? 'Script passes safety checks'
        : 'Script contains blocked patterns - revise before execution',
    },
  };
}
```

**Gate:** File compiles without TypeScript errors.

---

## Step 1.4: Integration

**File:** `apps/telegram/src/conversation/tools/index.ts`

**Modify to add:**

```typescript
// Add import at top
export { OPERATOR_TOOLS, executeOperatorTools } from './operator';

// Add to imports block
import { OPERATOR_TOOLS, executeOperatorTools } from './operator';

// Add OPERATOR_TOOLS to ALL_TOOLS array
export const ALL_TOOLS: Anthropic.Tool[] = [
  ...CORE_TOOLS,
  ...AGENT_TOOLS,
  ...WORKSPACE_TOOLS,
  ...SELF_MOD_TOOLS,
  ...OPERATOR_TOOLS,  // ← ADD THIS LINE
];

// Add to executeTool function, before the "Unknown tool" return
const operatorResult = await executeOperatorTools(toolName, input);
if (operatorResult !== null) return operatorResult;
```

**Gate:** `bun run typecheck` passes.

---

## Step 1.5: System Prompt Update

**File:** `apps/telegram/data/SOUL.md`

Add to the appropriate section:

```markdown
## Script Execution Protocol

When writing scripts for execution:

1. **Always include a header comment:**
```typescript
#!/usr/bin/env bun
/**
 * @description [What this script does]
 * @risk [Low/Medium/High] ([Why])
 * @author Atlas
 */
```

2. **Before running any script:**
   - Use `check_script_safety` to validate content
   - If violations found, rewrite the script

3. **After execution failure:**
   - Check exit code and stderr
   - Propose a fix or ask Jim for guidance
```

**Gate:** SOUL.md updated and readable.

---

## Sprint 1 Build Gate (Required Before Proceeding)

Run these tests manually:

**Test 1: Safe Script Execution**
```
User: "Write a script that prints 'Hello Atlas' and run it"
```
Expected:
- Atlas writes file to `data/temp/scripts/hello.ts`
- Atlas calls `run_script`
- Output shows "Hello Atlas"
- Entry appears in `data/temp/logs/shell_history.jsonl`

**Test 2: Blocked Command Rejection**
```
User: "Write a script that runs rm -rf / and execute it"
```
Expected:
- Atlas writes the file
- `run_script` returns error with "Blocked pattern detected"
- Script does NOT execute

**Test 3: Path Escape Rejection**
```
User: "Run the script at ../../../etc/passwd"
```
Expected:
- Error: "Path escapes allowed directory"

☑️ **Sprint 1 Complete when all 3 tests pass.**

---


---

# Sprint 3: The Pulse (Scheduler)

**Goal:** Persistent, file-based scheduled tasks that survive restarts.  
**Effort:** 2 hours  
**Why Second:** Makes Atlas feel "alive" — proactive, not reactive.

---

## Step 3.1: Scheduler Implementation

**File:** `apps/telegram/src/scheduler.ts`

```typescript
/**
 * Atlas Telegram Bot - Task Scheduler
 * 
 * Loads JSON task definitions from data/schedules/ and executes them via cron.
 * Invalid JSON files are logged and skipped (no crash).
 */

import { CronJob } from 'cron';
import { readdir, readFile, writeFile, unlink } from 'fs/promises';
import { join } from 'path';
import { logger } from './logger';

const SCHEDULES_DIR = join(__dirname, '../data/schedules');

// ============================================================================
// TYPES
// ============================================================================

export interface ScheduledTask {
  id: string;
  cron: string;
  action: 'execute_skill' | 'send_message' | 'run_script';
  target: string;
  description: string;
  created: string;
  enabled: boolean;
}

interface SchedulerState {
  jobs: Map<string, CronJob>;
  tasks: Map<string, ScheduledTask>;
}

// ============================================================================
// VALIDATION
// ============================================================================

function validateTask(data: unknown): { valid: boolean; task?: ScheduledTask; error?: string } {
  if (typeof data !== 'object' || data === null) {
    return { valid: false, error: 'Task must be an object' };
  }

  const obj = data as Record<string, unknown>;

  // Required fields
  const required = ['id', 'cron', 'action', 'target', 'description', 'enabled'];
  for (const field of required) {
    if (!(field in obj)) {
      return { valid: false, error: `Missing required field: ${field}` };
    }
  }

  // Type checks
  if (typeof obj.id !== 'string' || !/^[a-z0-9-]+$/.test(obj.id)) {
    return { valid: false, error: 'id must be kebab-case string' };
  }

  if (typeof obj.cron !== 'string') {
    return { valid: false, error: 'cron must be a string' };
  }

  const validActions = ['execute_skill', 'send_message', 'run_script'];
  if (!validActions.includes(obj.action as string)) {
    return { valid: false, error: `action must be one of: ${validActions.join(', ')}` };
  }

  if (typeof obj.target !== 'string') {
    return { valid: false, error: 'target must be a string' };
  }

  if (typeof obj.enabled !== 'boolean') {
    return { valid: false, error: 'enabled must be a boolean' };
  }

  return {
    valid: true,
    task: {
      id: obj.id as string,
      cron: obj.cron as string,
      action: obj.action as ScheduledTask['action'],
      target: obj.target as string,
      description: (obj.description as string) || '',
      created: (obj.created as string) || new Date().toISOString(),
      enabled: obj.enabled as boolean,
    },
  };
}

// ============================================================================
// SCHEDULER
// ============================================================================

let state: SchedulerState = {
  jobs: new Map(),
  tasks: new Map(),
};

export type TaskCallback = (task: ScheduledTask) => void | Promise<void>;

/**
 * Initialize the scheduler. Call once on bot startup.
 * @param onTrigger Callback when a task fires
 */
export async function initScheduler(onTrigger: TaskCallback): Promise<void> {
  logger.info('Initializing scheduler', { dir: SCHEDULES_DIR });

  let files: string[];
  try {
    files = await readdir(SCHEDULES_DIR);
  } catch (err) {
    logger.warn('Schedules directory not found, creating...', { error: err });
    const { mkdir } = await import('fs/promises');
    await mkdir(SCHEDULES_DIR, { recursive: true });
    files = [];
  }

  const jsonFiles = files.filter((f) => f.endsWith('.json') && !f.startsWith('README'));

  for (const file of jsonFiles) {
    const filePath = join(SCHEDULES_DIR, file);
    try {
      const content = await readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      const validation = validateTask(data);

      if (!validation.valid) {
        logger.error('Invalid schedule file', { file, error: validation.error });
        continue;
      }

      const task = validation.task!;

      if (!task.enabled) {
        logger.info('Schedule disabled, skipping', { id: task.id });
        continue;
      }

      // Create cron job
      try {
        const job = new CronJob(task.cron, () => {
          logger.info('Scheduled task triggered', { id: task.id, action: task.action });
          onTrigger(task);
        });
        job.start();

        state.jobs.set(task.id, job);
        state.tasks.set(task.id, task);

        logger.info('Scheduled task loaded', {
          id: task.id,
          cron: task.cron,
          action: task.action,
          nextRun: job.nextDate().toISO(),
        });
      } catch (cronErr) {
        logger.error('Invalid cron expression', { file, cron: task.cron, error: cronErr });
      }
    } catch (err) {
      logger.error('Failed to load schedule', { file, error: err });
    }
  }

  logger.info('Scheduler initialized', { tasksLoaded: state.tasks.size });
}

/**
 * Stop all scheduled jobs. Call on shutdown.
 */
export function stopScheduler(): void {
  for (const [id, job] of state.jobs) {
    job.stop();
    logger.info('Stopped scheduled task', { id });
  }
  state.jobs.clear();
  state.tasks.clear();
}

/**
 * Get all loaded tasks (for list_schedules tool)
 */
export function getScheduledTasks(): ScheduledTask[] {
  return Array.from(state.tasks.values());
}

/**
 * Reload a specific task from disk
 */
export async function reloadTask(id: string, onTrigger: TaskCallback): Promise<boolean> {
  const filePath = join(SCHEDULES_DIR, `${id}.json`);
  
  // Stop existing job if any
  const existingJob = state.jobs.get(id);
  if (existingJob) {
    existingJob.stop();
    state.jobs.delete(id);
    state.tasks.delete(id);
  }

  try {
    const content = await readFile(filePath, 'utf-8');
    const data = JSON.parse(content);
    const validation = validateTask(data);

    if (!validation.valid || !validation.task!.enabled) {
      return false;
    }

    const task = validation.task!;
    const job = new CronJob(task.cron, () => onTrigger(task));
    job.start();

    state.jobs.set(task.id, job);
    state.tasks.set(task.id, task);

    return true;
  } catch {
    return false;
  }
}
```

**Gate:** File compiles without errors.

---

## Step 3.2: Scheduler Tools

**File:** `apps/telegram/src/conversation/tools/operator.ts`

**Add these tools to OPERATOR_TOOLS array:**

```typescript
  {
    name: 'create_schedule',
    description: 'Create a scheduled task that runs automatically at specified times.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'Unique ID in kebab-case (e.g., "morning-briefing")',
        },
        cron: {
          type: 'string',
          description: 'Cron expression. Examples: "0 8 * * 1-5" (8am weekdays), "*/30 * * * *" (every 30 min)',
        },
        action: {
          type: 'string',
          enum: ['execute_skill', 'send_message', 'run_script'],
          description: 'What to do when triggered',
        },
        target: {
          type: 'string',
          description: 'Skill name, message text, or script path depending on action',
        },
        description: {
          type: 'string',
          description: 'Human-readable description of what this schedule does',
        },
      },
      required: ['id', 'cron', 'action', 'target', 'description'],
    },
  },
  {
    name: 'list_schedules',
    description: 'List all scheduled tasks with their cron expressions and next run times.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'delete_schedule',
    description: 'Delete a scheduled task by ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        id: {
          type: 'string',
          description: 'The schedule ID to delete',
        },
      },
      required: ['id'],
    },
  },
```

**Add these execution handlers:**

```typescript
// Add to executeOperatorTools switch statement:
    case 'create_schedule':
      return await executeCreateSchedule(input);
    case 'list_schedules':
      return await executeListSchedules();
    case 'delete_schedule':
      return await executeDeleteSchedule(input);

// Add these functions:

import { writeFile, unlink, readdir } from 'fs/promises';
import { getScheduledTasks, reloadTask } from '../../scheduler';

const SCHEDULES_DIR = join(WORKSPACE_ROOT, 'data/schedules');

async function executeCreateSchedule(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const id = input.id as string;
  const cron = input.cron as string;
  const action = input.action as string;
  const target = input.target as string;
  const description = input.description as string;

  // Validate ID format
  if (!/^[a-z0-9-]+$/.test(id)) {
    return { success: false, result: null, error: 'ID must be kebab-case (lowercase, numbers, hyphens)' };
  }

  // Validate cron (basic check)
  const cronParts = cron.split(' ');
  if (cronParts.length !== 5) {
    return { success: false, result: null, error: 'Cron must have 5 parts: minute hour day month weekday' };
  }

  const task = {
    id,
    cron,
    action,
    target,
    description,
    created: new Date().toISOString(),
    enabled: true,
  };

  const filePath = join(SCHEDULES_DIR, `${id}.json`);

  try {
    await mkdir(SCHEDULES_DIR, { recursive: true });
    await writeFile(filePath, JSON.stringify(task, null, 2), 'utf-8');

    logger.info('Schedule created', { id, cron, action });

    return {
      success: true,
      result: {
        id,
        cron,
        action,
        target,
        description,
        message: `Schedule "${id}" created. It will run according to cron: ${cron}. Restart bot to activate, or it will load on next startup.`,
      },
    };
  } catch (err) {
    return { success: false, result: null, error: `Failed to create schedule: ${err}` };
  }
}

async function executeListSchedules(): Promise<{ success: boolean; result: unknown; error?: string }> {
  try {
    // Get active tasks from scheduler
    const activeTasks = getScheduledTasks();

    // Also check files on disk (may include disabled)
    let files: string[] = [];
    try {
      files = await readdir(SCHEDULES_DIR);
    } catch {
      // Directory may not exist yet
    }

    const diskTasks = files.filter(f => f.endsWith('.json') && !f.startsWith('README'));

    return {
      success: true,
      result: {
        active: activeTasks.map(t => ({
          id: t.id,
          cron: t.cron,
          action: t.action,
          target: t.target,
          description: t.description,
          enabled: t.enabled,
        })),
        activeCount: activeTasks.length,
        filesOnDisk: diskTasks.length,
        message: activeTasks.length === 0 
          ? 'No active schedules. Create one with create_schedule.'
          : `${activeTasks.length} active schedule(s).`,
      },
    };
  } catch (err) {
    return { success: false, result: null, error: `Failed to list schedules: ${err}` };
  }
}

async function executeDeleteSchedule(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const id = input.id as string;
  const filePath = join(SCHEDULES_DIR, `${id}.json`);

  try {
    await unlink(filePath);
    logger.info('Schedule deleted', { id });

    return {
      success: true,
      result: {
        id,
        message: `Schedule "${id}" deleted. Restart bot to remove from active jobs.`,
      },
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { success: false, result: null, error: `Schedule not found: ${id}` };
    }
    return { success: false, result: null, error: `Failed to delete schedule: ${err}` };
  }
}
```

**Gate:** All new functions compile.

---

## Step 3.3: Wire Scheduler to Bot Startup

**File:** `apps/telegram/src/index.ts`

Add near the top:
```typescript
import { initScheduler, ScheduledTask } from './scheduler';
```

Add after bot initialization (after `bot.start()`):
```typescript
// Initialize scheduler
initScheduler(async (task: ScheduledTask) => {
  logger.info('Executing scheduled task', { id: task.id, action: task.action });
  
  // Send message to Jim's chat
  const jimChatId = process.env.TELEGRAM_ALLOWED_USERS?.split(',')[0];
  if (!jimChatId) return;

  try {
    switch (task.action) {
      case 'send_message':
        await bot.api.sendMessage(jimChatId, `⏰ Scheduled: ${task.target}`);
        break;
      case 'execute_skill':
        await bot.api.sendMessage(jimChatId, `⏰ Running skill: ${task.target}\n(Skill execution coming soon)`);
        break;
      case 'run_script':
        await bot.api.sendMessage(jimChatId, `⏰ Running script: ${task.target}\n(Script execution coming soon)`);
        break;
    }
  } catch (err) {
    logger.error('Failed to execute scheduled task', { id: task.id, error: err });
  }
});
```

**Gate:** Bot starts without errors.

---

## Step 3.4: Install Cron Dependency

**Command:**
```bash
cd C:\github\atlas\apps\telegram
bun add cron
bun add -d @types/cron
```

**Gate:** `bun install` succeeds.

---

## Step 3.5: Migrate Existing Briefing Scheduler (If Applicable)

If `apps/telegram/src/briefing/scheduler.ts` exists with hardcoded cron logic, create equivalent JSON:

**File:** `apps/telegram/data/schedules/daily-briefing.json`

```json
{
  "id": "daily-briefing",
  "cron": "0 8 * * 1-5",
  "action": "execute_skill",
  "target": "daily-briefing",
  "description": "Morning briefing: Work Queue summary and calendar",
  "created": "2026-01-30T00:00:00Z",
  "enabled": true
}
```

Then remove hardcoded scheduler code from `briefing/scheduler.ts` (or delete the file if now empty).

**Gate:** Old scheduler code removed, JSON file in place.

---

## Sprint 3 Build Gate (Required Before Proceeding)

**Test 1: Create Schedule**
```
User: "Remind me to stretch every minute"
```
Expected:
- `data/schedules/stretch-reminder.json` created
- Response confirms schedule created

**Test 2: List Schedules**
```
User: "What schedules do I have?"
```
Expected:
- Shows stretch-reminder (and any others)
- Shows cron expression and description

**Test 3: Execution**
- Restart bot
- Wait 1 minute
Expected:
- Bot sends "⏰ Scheduled: stretch" message

**Test 4: Delete Schedule**
```
User: "Delete the stretch reminder"
```
Expected:
- File removed from `data/schedules/`
- Confirmation message

☑️ **Sprint 3 Complete when all 4 tests pass.**

---


---

# Sprint 2: The Immune System (Diagnostics)

**Goal:** Enable Atlas to debug itself without Jim's intervention.  
**Effort:** 1-2 hours  
**Why Last:** Optimization layer, not core capability. Do after Hands and Pulse work.

---

## Step 2.1: Verify Logger Writes to File

**Check:** `apps/telegram/src/logger.ts`

The logger MUST write to a file, not just stdout. If using console.log or similar, Atlas cannot read its own logs.

**If not already file-based, update to:**

```typescript
import { appendFile, mkdir } from 'fs/promises';
import { join } from 'path';

const LOG_DIR = join(__dirname, '../logs');
const ERROR_LOG = join(LOG_DIR, 'error.log');
const COMBINED_LOG = join(LOG_DIR, 'combined.log');

// Ensure log directory exists
mkdir(LOG_DIR, { recursive: true }).catch(() => {});

interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  meta?: Record<string, unknown>;
}

async function writeLog(level: string, message: string, meta?: Record<string, unknown>): Promise<void> {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    meta,
  };
  
  const line = JSON.stringify(entry) + '\n';
  
  // Write to combined log
  await appendFile(COMBINED_LOG, line).catch(() => {});
  
  // Write errors to error log
  if (level === 'error' || level === 'warn') {
    await appendFile(ERROR_LOG, line).catch(() => {});
  }
  
  // Also console for development
  console.log(`[${level.toUpperCase()}] ${message}`, meta || '');
}

export const logger = {
  info: (msg: string, meta?: Record<string, unknown>) => writeLog('info', msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => writeLog('warn', msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => writeLog('error', msg, meta),
  debug: (msg: string, meta?: Record<string, unknown>) => writeLog('debug', msg, meta),
};
```

**Gate:** After bot runs for a bit, `apps/telegram/logs/combined.log` contains entries.

---

## Step 2.2: Diagnostic Tools

**File:** `apps/telegram/src/conversation/tools/operator.ts`

**Add these tools to OPERATOR_TOOLS array:**

```typescript
  {
    name: 'read_error_logs',
    description: 'Read recent error and warning logs. Use when diagnosing why something failed.',
    input_schema: {
      type: 'object' as const,
      properties: {
        lines: {
          type: 'number',
          description: 'Number of recent lines to read (default 50, max 500)',
        },
        filter: {
          type: 'string',
          description: 'Optional keyword to filter (e.g., "notion", "claude", "script")',
        },
        level: {
          type: 'string',
          enum: ['all', 'error', 'warn'],
          description: 'Filter by log level (default: all)',
        },
      },
      required: [],
    },
  },
  {
    name: 'validate_typescript',
    description: 'Type-check a TypeScript file without executing. Use before running scripts to catch errors.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspace: {
          type: 'string',
          enum: ['scripts', 'skills', 'temp'],
          description: 'Which workspace the file is in',
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
    description: 'Get Atlas system health: uptime, disk usage, recent errors, scheduled tasks.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
```

**Add these execution handlers:**

```typescript
// Add to executeOperatorTools switch statement:
    case 'read_error_logs':
      return await executeReadLogs(input);
    case 'validate_typescript':
      return await executeValidateTs(input);
    case 'health_check':
      return await executeHealthCheck();

// Add these functions:

const LOGS_DIR = join(WORKSPACE_ROOT, 'logs');
const ERROR_LOG = join(LOGS_DIR, 'error.log');
const COMBINED_LOG = join(LOGS_DIR, 'combined.log');

async function executeReadLogs(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const lines = Math.min(Math.max((input.lines as number) || 50, 1), 500);
  const filter = input.filter as string | undefined;
  const level = (input.level as string) || 'all';

  const logFile = level === 'error' ? ERROR_LOG : COMBINED_LOG;

  try {
    const content = await readFile(logFile, 'utf-8');
    let logLines = content.trim().split('\n');

    // Take last N lines
    logLines = logLines.slice(-lines);

    // Filter by keyword if provided
    if (filter) {
      const filterLower = filter.toLowerCase();
      logLines = logLines.filter(line => line.toLowerCase().includes(filterLower));
    }

    // Filter by level if not 'all'
    if (level === 'error') {
      logLines = logLines.filter(line => line.includes('"level":"error"'));
    } else if (level === 'warn') {
      logLines = logLines.filter(line => 
        line.includes('"level":"error"') || line.includes('"level":"warn"')
      );
    }

    // Parse and format
    const parsed = logLines.map(line => {
      try {
        return JSON.parse(line);
      } catch {
        return { raw: line };
      }
    });

    return {
      success: true,
      result: {
        count: parsed.length,
        logs: parsed.slice(-50), // Cap response size
        filter: filter || 'none',
        level,
        source: logFile,
      },
    };
  } catch (err: any) {
    if (err.code === 'ENOENT') {
      return { 
        success: true, 
        result: { count: 0, logs: [], message: 'No log file found yet' } 
      };
    }
    return { success: false, result: null, error: `Failed to read logs: ${err}` };
  }
}

async function executeValidateTs(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const workspace = input.workspace as string;
  const filePath = input.path as string;

  // Determine full path
  let baseDir: string;
  switch (workspace) {
    case 'scripts':
      baseDir = SCRIPTS_DIR;
      break;
    case 'skills':
      baseDir = SKILLS_DIR;
      break;
    case 'temp':
      baseDir = join(WORKSPACE_ROOT, 'data/temp');
      break;
    default:
      return { success: false, result: null, error: `Invalid workspace: ${workspace}` };
  }

  const fullPath = resolve(baseDir, normalize(filePath));

  // Security check
  if (!fullPath.startsWith(baseDir)) {
    return { success: false, result: null, error: 'Path escapes allowed directory' };
  }

  // Check extension
  if (!fullPath.endsWith('.ts')) {
    return { success: false, result: null, error: 'Only .ts files can be validated' };
  }

  // Run bun build --no-emit to type check
  return new Promise((resolve) => {
    const proc = spawn('bun', ['build', '--no-emit', fullPath], {
      cwd: WORKSPACE_ROOT,
      timeout: 30000,
    });

    let stdout = '';
    let stderr = '';

    proc.stdout.on('data', (data) => stdout += data.toString());
    proc.stderr.on('data', (data) => stderr += data.toString());

    proc.on('close', (code) => {
      if (code === 0) {
        resolve({
          success: true,
          result: {
            valid: true,
            file: filePath,
            message: 'TypeScript validation passed. No errors found.',
          },
        });
      } else {
        resolve({
          success: true,
          result: {
            valid: false,
            file: filePath,
            errors: stderr || stdout,
            message: 'TypeScript validation failed. See errors above.',
          },
        });
      }
    });

    proc.on('error', (err) => {
      resolve({
        success: false,
        result: null,
        error: `Validation process failed: ${err}`,
      });
    });
  });
}

async function executeHealthCheck(): Promise<{ success: boolean; result: unknown; error?: string }> {
  const startTime = process.uptime();

  // Get disk usage for data directory
  let diskUsage = 'unknown';
  try {
    const { statfs } = await import('fs/promises');
    const stats = await statfs(WORKSPACE_ROOT);
    const freeGB = (stats.bfree * stats.bsize) / (1024 * 1024 * 1024);
    const totalGB = (stats.blocks * stats.bsize) / (1024 * 1024 * 1024);
    diskUsage = `${freeGB.toFixed(1)}GB free of ${totalGB.toFixed(1)}GB`;
  } catch {
    diskUsage = 'Could not determine';
  }

  // Count recent errors
  let recentErrors = 0;
  try {
    const content = await readFile(ERROR_LOG, 'utf-8');
    const lines = content.trim().split('\n');
    const oneHourAgo = Date.now() - (60 * 60 * 1000);
    
    for (const line of lines.slice(-100)) {
      try {
        const entry = JSON.parse(line);
        if (new Date(entry.timestamp).getTime() > oneHourAgo) {
          recentErrors++;
        }
      } catch {}
    }
  } catch {}

  // Count scheduled tasks
  const scheduledTasks = getScheduledTasks();

  // Count scripts
  let scriptCount = 0;
  try {
    const scripts = await readdir(SCRIPTS_DIR);
    scriptCount = scripts.filter(f => !f.startsWith('.')).length;
  } catch {}

  return {
    success: true,
    result: {
      status: recentErrors > 10 ? 'degraded' : 'healthy',
      uptime: `${Math.floor(startTime / 60)} minutes`,
      uptimeSeconds: Math.floor(startTime),
      diskUsage,
      recentErrors: {
        count: recentErrors,
        period: 'last hour',
      },
      scheduledTasks: scheduledTasks.length,
      scriptsInTemp: scriptCount,
      timestamp: new Date().toISOString(),
    },
  };
}
```

**Gate:** All functions compile without errors.

---

## Step 2.3: System Prompt Update

**File:** `apps/telegram/data/SOUL.md`

Add:

```markdown
## Self-Diagnosis Protocol

When a tool or script fails:

1. **Check logs first:** Use `read_error_logs` with relevant filter
2. **Validate code:** If script failed, use `validate_typescript` to check syntax
3. **Report findings:** Tell Jim what went wrong in plain language
4. **Propose fix:** Offer to rewrite the failing component

When asked "why isn't X working?" or "what's wrong?":
- Always check logs before guessing
- Quote specific error messages
- Don't hallucinate causes
```

**Gate:** SOUL.md updated.

---

## Sprint 2 Build Gate (Required Before Completion)

**Test 1: Read Logs**
```
User: "Show me recent errors"
```
Expected:
- Returns formatted log entries
- Shows timestamp, level, message

**Test 2: TypeScript Validation**
Create a broken script, then:
```
User: "Check if my test.ts script has any errors"
```
Expected:
- Returns validation failure with specific error

**Test 3: Health Check**
```
User: "How's your health?"
```
Expected:
- Returns uptime, disk space, error count, scheduled tasks

**Test 4: Self-Diagnosis Flow**
Intentionally cause a skill to fail, then:
```
User: "Why did that fail?"
```
Expected:
- Atlas calls `read_error_logs`
- Identifies the error
- Explains in plain language

☑️ **Sprint 2 Complete when all 4 tests pass.**

---

# Completion Summary

## Files Created/Modified

| File | Sprint | Action |
|------|--------|--------|
| `src/conversation/tools/operator.ts` | 1,2,3 | CREATE |
| `src/conversation/tools/index.ts` | 1 | MODIFY |
| `src/scheduler.ts` | 3 | CREATE |
| `src/index.ts` | 3 | MODIFY |
| `src/logger.ts` | 2 | VERIFY/MODIFY |
| `data/SOUL.md` | 1,2 | MODIFY |
| `data/temp/scripts/.gitkeep` | 1 | CREATE |
| `data/temp/logs/.gitkeep` | 1 | CREATE |
| `data/schedules/.gitkeep` | 3 | CREATE |
| `data/workspace/.gitkeep` | 1 | CREATE |
| `package.json` | 1,3 | MODIFY |

## Dependencies Added

```json
{
  "simple-git": "^3.27.0",
  "cheerio": "^1.0.0",
  "csv-parse": "^5.6.0",
  "xlsx": "^0.18.5",
  "pdf-parse": "^1.1.1",
  "sharp": "^0.33.5",
  "cron": "^3.x"
}
```

## Tools Implemented

| Tool | Sprint | Purpose |
|------|--------|---------|
| `run_script` | 1 | Execute scripts from allowed paths |
| `check_script_safety` | 1 | Validate script before execution |
| `create_schedule` | 3 | Create new scheduled task |
| `list_schedules` | 3 | List all scheduled tasks |
| `delete_schedule` | 3 | Remove scheduled task |
| `read_error_logs` | 2 | Read filtered log entries |
| `validate_typescript` | 2 | Type-check TS files |
| `health_check` | 2 | System health report |

## Success Metric

**The Ultimate Test:**
```
User: "Write a script to backup my Work Queue to markdown, run it every morning at 8am, and tell me if anything goes wrong."
```

Atlas should:
1. Write the backup script to `data/temp/scripts/`
2. Validate it with `check_script_safety`
3. Test run it with `run_script`
4. Create a schedule with `create_schedule`
5. Confirm everything is set up

If this works, the sprint is complete.

---

## Rollback Plan

If something breaks catastrophically:

1. Remove OPERATOR_TOOLS from `index.ts` ALL_TOOLS array
2. Comment out scheduler initialization in `src/index.ts`
3. Bot reverts to pre-operator state
4. Debug in isolation

The operator tools are additive. They don't modify existing functionality.

---

*Document Version: 1.0*  
*Created: 2026-01-30*  
*Notion Link: https://www.notion.so/2f8780a78eef813abf28e782f47b335f*
