/**
 * Atlas Telegram Bot - Operator Tools
 *
 * Scoped shell execution with safety guardrails.
 * Scripts must be written to allowed paths before execution.
 */

import type Anthropic from '@anthropic-ai/sdk';
import { spawn } from 'child_process';
import { readFile, appendFile, access, mkdir, writeFile, unlink, readdir } from 'fs/promises';
import { join, resolve, normalize, extname, dirname } from 'path';
import { fileURLToPath } from 'url';
import { Client } from '@notionhq/client';
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from '../../logger';
import { getScheduledTasks, registerTask, unregisterTask, type ScheduledTask } from '../../scheduler';
import { restartMcp, getMcpStatus, listMcpTools } from '../../mcp';
import { checkNotionAccess, formatHealthCheck } from '../../health/notion-check';

// ESM compatibility
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// ============================================================================
// CONSTANTS
// ============================================================================

const WORKSPACE_ROOT = resolve(__dirname, '../../..');
const SCRIPTS_DIR = join(WORKSPACE_ROOT, 'data/temp/scripts');
const SKILLS_DIR = join(WORKSPACE_ROOT, 'data/skills');
const WORKSPACE_DIR = join(WORKSPACE_ROOT, 'data/workspace');
const AUDIT_FILE = join(WORKSPACE_ROOT, 'data/temp/logs/shell_history.jsonl');
const SCHEDULES_DIR = join(WORKSPACE_ROOT, 'data/schedules');

const ALLOWED_EXTENSIONS = ['.ts', '.js', '.py', '.sh'];

// Work Queue for Bug tracking (from @atlas/shared/config)
const WORK_QUEUE_DB_ID = NOTION_DB.WORK_QUEUE;

// Lazy-loaded Notion client
let _notion: Client | null = null;
function getNotionClient(): Client {
  if (!_notion) {
    _notion = new Client({ auth: process.env.NOTION_API_KEY });
  }
  return _notion;
}

const BLOCKED_PATTERNS = [
  /\bsudo\b/,
  /\bsu\b/,
  /\brm\s+-rf\b/,
  /\brm\s+--no-preserve-root\b/,
  /\bmkfs\b/,
  /\bdd\s+if=/,
  /\b:(){.*};\s*:/, // Fork bomb
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
    name: 'system_status',
    description: 'Get Atlas system status including active agents, recent executions, and health metrics. Use this to diagnose issues or report on system state.',
    input_schema: {
      type: 'object' as const,
      properties: {
        include_logs: {
          type: 'boolean',
          description: 'Include recent log entries (last 20)',
        },
        include_agents: {
          type: 'boolean',
          description: 'Include active agent status',
        },
      },
      required: [],
    },
  },
  {
    name: 'read_logs',
    description: 'Read recent execution logs for debugging. Returns shell history and any errors.',
    input_schema: {
      type: 'object' as const,
      properties: {
        log_type: {
          type: 'string',
          enum: ['shell', 'errors', 'all'],
          description: 'Type of logs to retrieve',
        },
        limit: {
          type: 'number',
          description: 'Number of entries (default: 20, max: 100)',
        },
      },
      required: [],
    },
  },
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
  {
    name: 'validate_typescript',
    description: 'Type-check a TypeScript file without executing. Returns errors or "OK". Use before running scripts to catch issues early.',
    input_schema: {
      type: 'object' as const,
      properties: {
        workspace: {
          type: 'string',
          enum: ['skills', 'temp'],
          description: '"skills" = data/skills/, "temp" = data/temp/',
        },
        path: {
          type: 'string',
          description: 'Relative path to .ts file within the workspace',
        },
      },
      required: ['workspace', 'path'],
    },
  },
  {
    name: 'mcp_management',
    description: 'Manage the MCP subsystem. Use to reload config after installing a new server, check status, or list available tools.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['restart', 'status', 'list_tools'],
          description: 'restart = reload mcp.yaml and reconnect, status = show server states, list_tools = show all available MCP tools',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'notion_health_check',
    description: 'Verify Notion integration access to all critical databases (Work Queue, Feed, Dev Pipeline). Run on startup or when experiencing Notion issues. Returns which databases are accessible and which are not.',
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'update_self',
    description: 'Check for and apply updates to Atlas. Use when Pit Crew has shipped new features or fixes. Can check-only or apply updates and trigger restart.',
    input_schema: {
      type: 'object' as const,
      properties: {
        action: {
          type: 'string',
          enum: ['check', 'apply'],
          description: 'check = see if updates available, apply = pull updates and restart',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'get_skill_status',
    description: 'Check health status of a specific installed skill. Validates frontmatter, file existence, and parser compatibility. Use to diagnose skill issues.',
    input_schema: {
      type: 'object' as const,
      properties: {
        name: {
          type: 'string',
          description: 'Skill name (directory name, e.g., "research-prompt-builder")',
        },
      },
      required: ['name'],
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
      error: `Invalid extension: ${ext}. Allowed: ${ALLOWED_EXTENSIONS.join(', ')}`,
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
      return { cmd: 'python', args: [] };
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
// BUG QUEUE INTEGRATION
// ============================================================================

interface BugContext {
  script: string;
  location: string;
  exitCode: number | null;
  stderr: string;
  errorMessage: string;
}

/**
 * Create a bug entry in Work Queue when script execution fails.
 * Returns the Notion page URL for reference.
 */
async function createBugEntry(context: BugContext): Promise<string | null> {
  try {
    const notion = getNotionClient();

    const title = `Script failed: ${context.script}`;
    const notes = [
      `**Location:** ${context.location}`,
      `**Exit Code:** ${context.exitCode ?? 'N/A'}`,
      `**Error:** ${context.errorMessage}`,
      '',
      '**Stderr (truncated):**',
      '```',
      context.stderr.slice(0, 500),
      '```',
    ].join('\n');

    const response = await notion.pages.create({
      parent: { database_id: WORK_QUEUE_DB_ID },
      properties: {
        Task: {
          title: [{ text: { content: title.slice(0, 100) } }],
        },
        Type: {
          select: { name: 'Build' }, // Using Build since Bug may not exist
        },
        Status: {
          select: { name: 'Captured' },
        },
        Priority: {
          select: { name: 'P2' },
        },
        Pillar: {
          select: { name: 'The Grove' },
        },
        Notes: {
          rich_text: [{ text: { content: notes.slice(0, 2000) } }],
        },
        Queued: {
          date: { start: new Date().toISOString().split('T')[0] },
        },
      },
    });

    // Use URL from Notion API response (includes workspace context)
    const url = (response as { url?: string }).url || '';

    logger.info('Bug entry created in Work Queue', { script: context.script, url });
    return url;
  } catch (err) {
    logger.error('Failed to create bug entry', { error: err });
    return null;
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
    case 'system_status':
      return await executeSystemStatus(input);
    case 'read_logs':
      return await executeReadLogs(input);
    case 'run_script':
      return await executeRunScript(input);
    case 'check_script_safety':
      return await executeCheckSafety(input);
    case 'create_schedule':
      return await executeCreateSchedule(input);
    case 'list_schedules':
      return await executeListSchedules();
    case 'delete_schedule':
      return await executeDeleteSchedule(input);
    case 'validate_typescript':
      return await executeValidateTypeScript(input);
    case 'mcp_management':
      return await executeMcpManagement(input);
    case 'notion_health_check':
      return await executeNotionHealthCheck();
    case 'update_self':
      return await executeUpdateSelf(input);
    case 'get_skill_status':
      return await executeGetSkillStatus(input);
    default:
      return null;
  }
}

// ============================================================================
// SYSTEM INTROSPECTION
// ============================================================================

async function executeSystemStatus(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const includeLogs = input.include_logs as boolean || false;
  const includeAgents = input.include_agents as boolean || true;

  const status: Record<string, unknown> = {
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    memoryUsage: process.memoryUsage(),
    nodeVersion: process.version,
  };

  // Check schedules
  try {
    const tasks = getScheduledTasks();
    status.scheduledTasks = {
      count: tasks.length,
      tasks: tasks.map(t => ({ id: t.id, cron: t.cron, action: t.action })),
    };
  } catch {
    status.scheduledTasks = { error: 'Could not load schedules' };
  }

  // Check recent shell executions
  if (includeLogs) {
    try {
      const logContent = await readFile(AUDIT_FILE, 'utf-8');
      const lines = logContent.trim().split('\n').slice(-20);
      status.recentExecutions = lines.map(line => {
        try { return JSON.parse(line); } catch { return line; }
      });
    } catch {
      status.recentExecutions = [];
    }
  }

  // Directory status
  try {
    const scriptsExist = await access(SCRIPTS_DIR).then(() => true).catch(() => false);
    const schedulesExist = await access(SCHEDULES_DIR).then(() => true).catch(() => false);
    status.directories = {
      scripts: scriptsExist ? 'OK' : 'MISSING',
      schedules: schedulesExist ? 'OK' : 'MISSING',
    };
  } catch {
    status.directories = { error: 'Could not check directories' };
  }

  return { success: true, result: status };
}

async function executeReadLogs(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const logType = (input.log_type as string) || 'all';
  const limit = Math.min(Math.max((input.limit as number) || 20, 1), 100);

  const logs: Record<string, unknown> = {};

  // Shell history
  if (logType === 'shell' || logType === 'all') {
    try {
      const content = await readFile(AUDIT_FILE, 'utf-8');
      const lines = content.trim().split('\n').slice(-limit);
      logs.shellHistory = lines.map(line => {
        try { return JSON.parse(line); } catch { return line; }
      });
    } catch {
      logs.shellHistory = [];
    }
  }

  // Error logs (from stderr in shell history)
  if (logType === 'errors' || logType === 'all') {
    try {
      const content = await readFile(AUDIT_FILE, 'utf-8');
      const lines = content.trim().split('\n');
      const errors = lines
        .map(line => { try { return JSON.parse(line); } catch { return null; } })
        .filter(entry => entry && (entry.exitCode !== 0 || entry.error || entry.stderr))
        .slice(-limit);
      logs.errors = errors;
    } catch {
      logs.errors = [];
    }
  }

  return { success: true, result: logs };
}

async function executeRunScript(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const filename = input.filename as string;
  const location = input.location as 'scripts' | 'skill';
  const skillName = input.skill_name as string | undefined;
  const timeoutSeconds = Math.min(Math.max((input.timeout_seconds as number) || 30, 1), 300);
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
        HOME: process.env.HOME || process.env.USERPROFILE,
        USER: process.env.USER || process.env.USERNAME,
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

      // On failure, create bug entry in Work Queue
      let bugUrl: string | null = null;
      if (code !== 0) {
        bugUrl = await createBugEntry({
          script: filename,
          location: `${location}/${filename}`,
          exitCode: code,
          stderr: stderr.slice(0, 500),
          errorMessage: `Script exited with code ${code}`,
        });
      }

      resolve({
        success: code === 0,
        result: {
          exitCode: code,
          stdout: stdout.slice(0, 5000),
          stderr: stderr.slice(0, 2000),
          durationMs,
          truncated: stdout.length > 5000 || stderr.length > 2000,
          bugTicket: bugUrl,
        },
        error: code !== 0
          ? `Script exited with code ${code}${bugUrl ? `. Bug logged: ${bugUrl}` : ''}`
          : undefined,
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

      // Create bug entry for execution errors
      const bugUrl = await createBugEntry({
        script: filename,
        location: `${location}/${filename}`,
        exitCode: null,
        stderr: stderr || String(err),
        errorMessage: `Execution failed: ${err}`,
      });

      resolve({
        success: false,
        result: {
          bugTicket: bugUrl,
        },
        error: `Execution failed: ${err}${bugUrl ? `. Bug logged: ${bugUrl}` : ''}`,
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

// ============================================================================
// SCHEDULER TOOLS
// ============================================================================

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

  const task: ScheduledTask = {
    id,
    cron,
    action: action as ScheduledTask['action'],
    target,
    description,
    created: new Date().toISOString(),
    enabled: true,
  };

  const filePath = join(SCHEDULES_DIR, `${id}.json`);

  try {
    await mkdir(SCHEDULES_DIR, { recursive: true });
    await writeFile(filePath, JSON.stringify(task, null, 2), 'utf-8');

    // Hot-register the task (no restart needed)
    const registration = registerTask(task);

    logger.info('Schedule created', { id, cron, action, hotLoaded: registration.success });

    return {
      success: true,
      result: {
        id,
        cron,
        action,
        target,
        description,
        nextRun: registration.nextRun,
        message: registration.success
          ? `Schedule "${id}" created and activated. Next run: ${registration.nextRun}`
          : `Schedule "${id}" created but requires restart to activate: ${registration.error}`,
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

    // Hot-unregister the task (no restart needed)
    const wasActive = unregisterTask(id);

    logger.info('Schedule deleted', { id, wasActive });

    return {
      success: true,
      result: {
        id,
        wasActive,
        message: wasActive
          ? `Schedule "${id}" deleted and stopped immediately.`
          : `Schedule "${id}" deleted (was not running).`,
      },
    };
  } catch (err: unknown) {
    const error = err as NodeJS.ErrnoException;
    if (error.code === 'ENOENT') {
      return { success: false, result: null, error: `Schedule not found: ${id}` };
    }
    return { success: false, result: null, error: `Failed to delete schedule: ${err}` };
  }
}

// ============================================================================
// TYPESCRIPT VALIDATION
// ============================================================================

async function executeValidateTypeScript(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const workspace = input.workspace as 'skills' | 'temp';
  const filePath = input.path as string;

  // Determine base directory
  const baseDir = workspace === 'skills' ? SKILLS_DIR : join(WORKSPACE_ROOT, 'data/temp');

  // Normalize and resolve
  const fullPath = resolve(baseDir, normalize(filePath));

  // Path escape check
  if (!fullPath.startsWith(baseDir)) {
    return { success: false, result: null, error: 'Path escapes allowed directory' };
  }

  // Extension check
  if (!fullPath.endsWith('.ts')) {
    return { success: false, result: null, error: 'Only .ts files can be validated' };
  }

  // Check file exists
  try {
    await access(fullPath);
  } catch {
    return { success: false, result: null, error: `File not found: ${filePath}` };
  }

  // Run tsc --noEmit on the file
  return new Promise((resolvePromise) => {
    const proc = spawn('bun', ['run', 'tsc', '--noEmit', fullPath], {
      cwd: WORKSPACE_ROOT,
      timeout: 30000,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME || process.env.USERPROFILE,
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

    proc.on('close', (code) => {
      logger.info('TypeScript validation complete', { file: filePath, exitCode: code });

      if (code === 0) {
        resolvePromise({
          success: true,
          result: {
            file: filePath,
            valid: true,
            message: 'TypeScript validation passed - no errors',
          },
        });
      } else {
        // Parse tsc output for errors
        const errors = (stdout + stderr)
          .split('\n')
          .filter(line => line.includes('error TS') || line.includes(': error'))
          .slice(0, 10); // Limit to first 10 errors

        resolvePromise({
          success: true, // Tool succeeded, but file has errors
          result: {
            file: filePath,
            valid: false,
            errorCount: errors.length,
            errors,
            rawOutput: (stdout + stderr).slice(0, 2000),
            message: `TypeScript validation failed with ${errors.length} error(s)`,
          },
        });
      }
    });

    proc.on('error', (err) => {
      resolvePromise({
        success: false,
        result: null,
        error: `Failed to run TypeScript validator: ${err}`,
      });
    });
  });
}

// ============================================================================
// MCP MANAGEMENT
// ============================================================================

async function executeMcpManagement(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const action = input.action as 'restart' | 'status' | 'list_tools';

  switch (action) {
    case 'restart': {
      try {
        const result = await restartMcp();
        return {
          success: true,
          result: {
            message: `MCP subsystem restarted successfully`,
            servers: result.servers,
            toolCount: result.toolCount,
          },
        };
      } catch (err) {
        return {
          success: false,
          result: null,
          error: `Failed to restart MCP: ${err}`,
        };
      }
    }

    case 'status': {
      const status = getMcpStatus();
      const serverCount = Object.keys(status).length;
      const connectedCount = Object.values(status).filter(s => s.status === 'connected').length;
      const totalTools = Object.values(status).reduce((sum, s) => sum + s.toolCount, 0);

      return {
        success: true,
        result: {
          summary: `${connectedCount}/${serverCount} servers connected, ${totalTools} tools available`,
          servers: status,
        },
      };
    }

    case 'list_tools': {
      const tools = listMcpTools();
      const byServer: Record<string, string[]> = {};

      for (const tool of tools) {
        if (!byServer[tool.server]) {
          byServer[tool.server] = [];
        }
        byServer[tool.server].push(`${tool.tool}: ${tool.description.slice(0, 100)}`);
      }

      return {
        success: true,
        result: {
          totalTools: tools.length,
          byServer,
        },
      };
    }

    default:
      return {
        success: false,
        result: null,
        error: `Unknown action: ${action}. Use 'restart', 'status', or 'list_tools'.`,
      };
  }
}

// ============================================================================
// NOTION HEALTH CHECK
// ============================================================================

async function executeNotionHealthCheck(): Promise<{ success: boolean; result: unknown; error?: string }> {
  try {
    const result = await checkNotionAccess();

    return {
      success: result.success,
      result: {
        integration: result.integration,
        overall: result.success ? 'HEALTHY' : 'ISSUES DETECTED',
        databases: result.databases,
        formattedOutput: formatHealthCheck(result),
        timestamp: result.timestamp,
      },
      error: result.success ? undefined : 'One or more databases are not accessible',
    };
  } catch (err) {
    return {
      success: false,
      result: null,
      error: `Failed to run Notion health check: ${err}`,
    };
  }
}

// ============================================================================
// SELF-UPDATE
// ============================================================================

async function executeUpdateSelf(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const action = input.action as 'check' | 'apply';

  try {
    const { execSync } = await import('child_process');
    const rootDir = resolve(__dirname, '../../../..');

    const run = (cmd: string) => execSync(cmd, {
      cwd: rootDir,
      encoding: 'utf-8',
      timeout: 30000,
    }).trim();

    // Get current state
    const currentCommit = run('git rev-parse --short HEAD');
    const currentBranch = run('git rev-parse --abbrev-ref HEAD');

    // Fetch latest
    run('git fetch origin');

    // Check if behind
    const behindCount = parseInt(run(`git rev-list HEAD..origin/${currentBranch} --count`), 10);

    if (behindCount === 0) {
      return {
        success: true,
        result: {
          hasUpdates: false,
          currentCommit,
          message: `Already up to date at ${currentCommit}`,
        },
      };
    }

    // Get pending commits
    const latestCommit = run(`git rev-parse --short origin/${currentBranch}`);
    const commitLog = run(`git log --oneline HEAD..origin/${currentBranch}`);
    const commits = commitLog.split('\n').filter(Boolean);

    if (action === 'check') {
      return {
        success: true,
        result: {
          hasUpdates: true,
          currentCommit,
          latestCommit,
          commitsBehind: behindCount,
          commits,
          message: `${behindCount} update(s) available. Use action='apply' to update.`,
        },
      };
    }

    // Apply update
    logger.info('Self-update: Pulling latest code...');
    run('git pull origin');

    const newCommit = run('git rev-parse --short HEAD');

    // Touch entry point to trigger bun --watch reload
    const entryPoint = resolve(__dirname, '../../index.ts');
    const { readFile: rf, writeFile: wf } = await import('fs/promises');
    const content = await rf(entryPoint, 'utf-8');
    await wf(entryPoint, content);

    logger.info('Self-update: Update applied, restart triggered', { oldCommit: currentCommit, newCommit });

    return {
      success: true,
      result: {
        hasUpdates: true,
        previousCommit: currentCommit,
        newCommit,
        commits,
        message: `Updated ${currentCommit} → ${newCommit}. Restart triggered. I'll be back in a moment!`,
      },
    };
  } catch (err: any) {
    logger.error('Self-update failed', { error: err.message });
    return {
      success: false,
      result: null,
      error: `Self-update failed: ${err.message}`,
    };
  }
}

// ============================================================================
// SKILL HEALTH CHECK
// ============================================================================

async function executeGetSkillStatus(
  input: Record<string, unknown>
): Promise<{ success: boolean; result: unknown; error?: string }> {
  const name = input.name as string;
  const skillDir = join(SKILLS_DIR, name);
  const skillPath = join(skillDir, 'SKILL.md');

  try {
    await access(skillDir);
  } catch {
    return { success: false, result: null, error: `Skill directory not found: ${name}` };
  }

  try {
    const content = await readFile(skillPath, 'utf-8');

    // Parse frontmatter (tolerate \r\n on Windows)
    const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fmMatch) {
      return {
        success: true,
        result: {
          name,
          status: 'degraded',
          issues: ['Missing YAML frontmatter (---...---)'],
          path: `data/skills/${name}/SKILL.md`,
        },
      };
    }

    const frontmatter = fmMatch[1];
    const issues: string[] = [];

    const nameMatch = frontmatter.match(/name:\s*(.+)/);
    const descMatch = frontmatter.match(/description:\s*(.+)/);
    const triggerMatch = frontmatter.match(/trigger:\s*(.+)/);
    const createdMatch = frontmatter.match(/created:\s*(.+)/);

    if (!nameMatch) issues.push('Missing "name" field in frontmatter');
    if (!descMatch) issues.push('Missing "description" field in frontmatter');
    if (!triggerMatch) issues.push('Missing "trigger" field (singular string) in frontmatter');
    if (!createdMatch) issues.push('Missing "created" timestamp in frontmatter');

    // Check for common format issues
    if (frontmatter.includes('triggers:')) {
      issues.push('"triggers:" (plural array) found — parser expects "trigger:" (singular string)');
    }

    // List other files in skill directory
    const files = await readdir(skillDir);

    return {
      success: true,
      result: {
        name: nameMatch?.[1]?.trim() || name,
        description: descMatch?.[1]?.trim() || 'No description',
        trigger: triggerMatch?.[1]?.trim() || '',
        created: createdMatch?.[1]?.trim() || '',
        status: issues.length === 0 ? 'healthy' : 'degraded',
        issues,
        files,
        path: `data/skills/${name}/SKILL.md`,
      },
    };
  } catch {
    return {
      success: true,
      result: {
        name,
        status: 'missing',
        issues: ['SKILL.md file not found in skill directory'],
        path: `data/skills/${name}/SKILL.md`,
      },
    };
  }
}
