/**
 * Swarm Dispatch — Spawns Claude Code sessions for autonomous skill repair.
 *
 * Permission scoping:
 *   data/skills/**     → full read/write
 *   data/pit-crew/**   → full read/write
 *   src/skills/**      → read/write
 *   Everything else    → read only (changes proposed via Telegram, not applied)
 *
 * Only activated for Zone 1 and Zone 2 operations.
 * Zone 3 operations generate a plan but do NOT execute.
 *
 * Sprint: Pit Stop (Autonomous Skill Repair)
 */

import { spawn } from 'child_process';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { logger } from '../logger';
import { getFeatureFlags, getSafetyLimits } from '../config/features';
import { SKILL_SCHEMA_PROMPT, validateSkillFrontmatter } from '../skills/frontmatter';
import type { PitCrewOperation, PermissionZone } from '../skills/zone-classifier';

// ==========================================
// Types
// ==========================================

/**
 * Task descriptor for swarm dispatch
 */
export interface SwarmTask {
  /** Feed 2.0 page ID for the self-improvement entry */
  feedEntryId: string;

  /** Operation descriptor from zone classifier */
  operation: PitCrewOperation;

  /** Classified zone (only Zone 1/2 execute, Zone 3 plans only) */
  zone: PermissionZone;

  /** Error message, stack trace, or improvement description */
  context: string;

  /** Skill name if this is a skill-related fix */
  targetSkill?: string;

  /** Optional: work queue ID for status updates */
  workQueueId?: string;
}

/**
 * Result from swarm execution
 */
export interface SwarmResult {
  /** Whether the fix was successfully applied */
  success: boolean;

  /** Files that were changed */
  filesChanged: string[];

  /** Whether tests passed after the fix */
  testsPassed: boolean;

  /** Git commit hash if committed */
  commitHash?: string;

  /** Error message if failed */
  error?: string;

  /** The generated plan (for Zone 3 or when execution fails) */
  plan?: string;

  /** Time taken in milliseconds */
  durationMs: number;
}

/**
 * Swarm execution mode
 */
export type SwarmMode = 'execute' | 'plan-only';

// ==========================================
// Rate Limiting
// ==========================================

/** Track dispatches per hour for rate limiting */
const dispatchTimestamps: number[] = [];

/**
 * Check if we can dispatch another swarm task
 */
function canDispatch(): boolean {
  const limits = getSafetyLimits();
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  // Clean up old timestamps
  while (dispatchTimestamps.length > 0 && dispatchTimestamps[0] < oneHourAgo) {
    dispatchTimestamps.shift();
  }

  return dispatchTimestamps.length < limits.maxSwarmDispatchesPerHour;
}

/**
 * Record a dispatch
 */
function recordDispatch(): void {
  dispatchTimestamps.push(Date.now());
}

// ==========================================
// Safe Directories
// ==========================================

/**
 * Directories where the swarm has write access
 */
const WRITABLE_DIRECTORIES = [
  'data/skills/',
  'data/pit-crew/',
  'src/skills/',
];

// Note: Files outside WRITABLE_DIRECTORIES are read-only by default
// The swarm will reject writes to any paths not in WRITABLE_DIRECTORIES

/**
 * Core files that should NEVER be modified by swarm
 */
const FORBIDDEN_FILES = [
  'src/index.ts',
  'src/bot.ts',
  'src/handler.ts',
  'src/handlers/chat.ts',
  'src/supervisor/',
  '.env',
  '.env.local',
  '.env.production',
  'package.json',
  'package-lock.json',
  'bun.lockb',
];

// ==========================================
// Prompt Generation
// ==========================================

/**
 * Build the fix prompt for Claude Code
 *
 * IMPORTANT: Keep prompts focused and directive to avoid timeouts.
 * Don't ask for test/commit - just the fix. Validation is separate.
 *
 * @param task - The swarm task
 * @param projectRoot - Absolute path to project root (for absolute file paths)
 */
export function buildFixPrompt(task: SwarmTask, projectRoot?: string): string {
  // Convert to absolute paths if projectRoot provided
  const files = projectRoot
    ? task.operation.targetFiles.map(f => join(projectRoot, f))
    : task.operation.targetFiles;
  const filesStr = files.join(', ');

  // Plan-only mode for Zone 3
  if (task.zone === 'approve') {
    return `You are Atlas Pit Crew. Analyze this issue and output a fix plan (DO NOT execute).

ISSUE: ${task.context}
FILES: ${filesStr}

${SKILL_SCHEMA_PROMPT}

Output format:
1. Root cause (1-2 sentences)
2. Files to change
3. Exact changes needed (code snippets matching the schema above)

DO NOT make any edits. Just output the plan.`.trim();
  }

  // Execute mode for Zone 1/2 - be very directive
  return `You are Atlas Pit Crew. Fix this issue NOW.

ISSUE: ${task.context}

FILE TO FIX: ${filesStr}
${task.targetSkill ? `SKILL: ${task.targetSkill}` : ''}

${SKILL_SCHEMA_PROMPT}

INSTRUCTIONS:
1. Read the file listed above
2. Fix the frontmatter to match the schema above exactly
3. Write the corrected file
4. Output "DONE: <what you fixed>"

CONSTRAINTS:
- Edit ONLY the file listed above
- Frontmatter MUST pass the schema above (singular \`trigger:\`, all required fields, kebab-case name)
- Do NOT read other files
- Do NOT explore the codebase
- Do NOT run tests or validation

START NOW.`.trim();
}

// ==========================================
// Swarm Execution
// ==========================================

/**
 * Check if Claude Code CLI is available
 */
async function isClaudeCodeAvailable(): Promise<boolean> {
  return new Promise((resolve) => {
    const proc = spawn('claude', ['--version'], {
      shell: true,
      timeout: 5000,
    });

    proc.on('error', () => resolve(false));
    proc.on('close', (code) => resolve(code === 0));
  });
}

/**
 * Execute a swarm fix task
 *
 * For Zone 1/2: Attempts to execute the fix
 * For Zone 3: Generates a plan only
 */
export async function executeSwarmFix(task: SwarmTask): Promise<SwarmResult> {
  const startTime = Date.now();
  const flags = getFeatureFlags();
  const limits = getSafetyLimits();

  // Check feature flag
  if (!flags.swarmDispatch) {
    return {
      success: false,
      filesChanged: [],
      testsPassed: false,
      error: 'Swarm dispatch is disabled (ATLAS_SWARM_DISPATCH=false)',
      durationMs: Date.now() - startTime,
    };
  }

  // Determine execution mode
  const mode: SwarmMode = task.zone === 'approve' ? 'plan-only' : 'execute';

  // Rate limiting (only for execute mode)
  if (mode === 'execute' && !canDispatch()) {
    return {
      success: false,
      filesChanged: [],
      testsPassed: false,
      error: `Rate limit exceeded (max ${limits.maxSwarmDispatchesPerHour}/hour)`,
      durationMs: Date.now() - startTime,
    };
  }

  logger.info('Swarm dispatch starting', {
    task: task.feedEntryId,
    zone: task.zone,
    mode,
    targetSkill: task.targetSkill,
  });

  // Check if Claude Code CLI is available
  const claudeAvailable = await isClaudeCodeAvailable();

  if (!claudeAvailable) {
    // Fallback: Generate plan and create work queue item
    logger.info('Claude Code CLI not available, using stub mode');

    const plan = buildFixPrompt(task);

    return {
      success: false,
      filesChanged: [],
      testsPassed: false,
      plan,
      error: 'Claude Code CLI not available - plan generated for manual execution',
      durationMs: Date.now() - startTime,
    };
  }

  // Execute with Claude Code CLI
  if (mode === 'execute') {
    recordDispatch();
  }

  try {
    const result = await executeWithClaudeCode(task, mode, limits.swarmTimeoutSeconds);
    return {
      ...result,
      durationMs: Date.now() - startTime,
    };
  } catch (error) {
    logger.error('Swarm execution failed', { error, task: task.feedEntryId });

    return {
      success: false,
      filesChanged: [],
      testsPassed: false,
      error: error instanceof Error ? error.message : String(error),
      plan: buildFixPrompt(task),
      durationMs: Date.now() - startTime,
    };
  }
}

/**
 * Execute fix using Claude Code CLI
 */
async function executeWithClaudeCode(
  task: SwarmTask,
  mode: SwarmMode,
  timeoutSeconds: number
): Promise<Omit<SwarmResult, 'durationMs'>> {
  // Use data/pit-crew as cwd so Claude reads minimal CLAUDE.md (not the massive root one)
  // Pass absolute paths in the prompt so file operations still work
  const projectRoot = process.cwd();
  const swarmCwd = join(projectRoot, 'data', 'pit-crew');
  const prompt = buildFixPrompt(task, projectRoot);

  // Haiku for simple fixes (frontmatter, typos), Sonnet for complex refactors
  // Override with ATLAS_SWARM_MODEL=sonnet for harder tasks
  const model = process.env.ATLAS_SWARM_MODEL || 'haiku';

  return new Promise((resolve) => {
    // IMPORTANT: Prompt must come immediately after -p flag, not at end
    const args = [
      '-p', prompt,  // Prompt MUST be right after -p
      '--model', model,
      '--dangerously-skip-permissions',
      '--max-turns', '3',  // Frontmatter fix: read → write → done
      // Disable MCP servers (Serena, browser, etc.) to reduce startup time
      '--strict-mcp-config',
      '--mcp-config', './swarm-mcp.json',
    ];

    // Add allowed tools for execute mode (Read, Edit, Write only - no Bash)
    if (mode === 'execute') {
      args.push('--allowedTools', 'Read,Edit,Write');
    }

    logger.debug('Spawning Claude Code', { args: args.slice(2) }); // Exclude prompt (first 2 args)

    const proc = spawn('claude', args, {
      shell: false,  // Don't use shell - avoids escaping issues with newlines in prompt
      cwd: swarmCwd,  // Reads minimal CLAUDE.md from data/pit-crew/
      timeout: timeoutSeconds * 1000,
      env: {
        ...process.env,
        MCP_TIMEOUT: '1000',  // 1s timeout for any MCP that somehow loads
        PATH: process.env.PATH,  // Ensure claude is findable without shell
      },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (data) => {
      stdout += data.toString();
    });

    proc.stderr?.on('data', (data) => {
      stderr += data.toString();
    });

    proc.on('error', (error) => {
      logger.error('Claude Code process error', { error });
      resolve({
        success: false,
        filesChanged: [],
        testsPassed: false,
        error: `Process error: ${error.message}`,
        plan: prompt,
      });
    });

    proc.on('close', async (code) => {
      if (code === 0) {
        // Parse output to extract results
        const result = parseClaudeCodeOutput(stdout);

        // Post-execution validation: verify SKILL.md files match canonical schema
        if (result.success) {
          const skillFiles = task.operation.targetFiles.filter(f => f.endsWith('SKILL.md'));
          for (const relPath of skillFiles) {
            try {
              const absPath = join(projectRoot, relPath);
              const content = await readFile(absPath, 'utf-8');
              const validation = validateSkillFrontmatter(content);
              if (!validation.valid) {
                logger.warn('Swarm output failed schema validation', {
                  file: relPath,
                  errors: validation.errors.slice(0, 3),
                });
                result.success = false;
                result.error = `Schema validation failed for ${relPath}: ${validation.errors[0]}`;
              }
            } catch {
              // File not readable — swarm may not have written it
            }
          }
        }

        resolve(result);
      } else {
        resolve({
          success: false,
          filesChanged: [],
          testsPassed: false,
          error: `Claude Code exited with code ${code}: ${stderr || stdout}`,
          plan: prompt,
        });
      }
    });

    // Timeout handling
    setTimeout(() => {
      proc.kill('SIGTERM');
      resolve({
        success: false,
        filesChanged: [],
        testsPassed: false,
        error: `Timeout after ${timeoutSeconds} seconds`,
        plan: prompt,
      });
    }, timeoutSeconds * 1000);
  });
}

/**
 * Parse Claude Code output to extract results
 */
function parseClaudeCodeOutput(output: string): Omit<SwarmResult, 'durationMs'> {
  // Look for common patterns in output
  const filesChanged: string[] = [];
  let testsPassed = false;
  let commitHash: string | undefined;

  // Extract file changes (pattern: "Edited: <file>" or "Created: <file>")
  const filePattern = /(?:Edited|Created|Modified):\s*([^\n]+)/gi;
  let match;
  while ((match = filePattern.exec(output)) !== null) {
    filesChanged.push(match[1].trim());
  }

  // Check for test results
  if (output.includes('pass') && !output.includes('fail')) {
    testsPassed = true;
  }

  // Extract commit hash if present
  const commitPattern = /commit\s+([a-f0-9]{7,40})/i;
  const commitMatch = commitPattern.exec(output);
  if (commitMatch) {
    commitHash = commitMatch[1];
  }

  // Determine success
  const success = filesChanged.length > 0 || output.includes('✓') || output.includes('success');

  return {
    success,
    filesChanged,
    testsPassed,
    commitHash,
  };
}

// ==========================================
// Status & Monitoring
// ==========================================

/**
 * Get current swarm dispatch stats
 */
export function getSwarmStats(): {
  dispatchesThisHour: number;
  maxPerHour: number;
  canDispatch: boolean;
} {
  const limits = getSafetyLimits();
  const oneHourAgo = Date.now() - 60 * 60 * 1000;

  // Clean up old timestamps
  while (dispatchTimestamps.length > 0 && dispatchTimestamps[0] < oneHourAgo) {
    dispatchTimestamps.shift();
  }

  return {
    dispatchesThisHour: dispatchTimestamps.length,
    maxPerHour: limits.maxSwarmDispatchesPerHour,
    canDispatch: canDispatch(),
  };
}

/**
 * Check if a file path is writable by the swarm
 */
export function isWritableBySwarm(filePath: string): boolean {
  const normalized = filePath.replace(/\\/g, '/').toLowerCase();

  // Check forbidden files first
  for (const forbidden of FORBIDDEN_FILES) {
    if (normalized.includes(forbidden.toLowerCase())) {
      return false;
    }
  }

  // Check writable directories
  for (const dir of WRITABLE_DIRECTORIES) {
    if (normalized.startsWith(dir.toLowerCase())) {
      return true;
    }
  }

  return false;
}

/**
 * Validate that all target files are writable
 */
export function validateSwarmScope(targetFiles: string[]): {
  valid: boolean;
  invalidFiles: string[];
} {
  const invalidFiles = targetFiles.filter(f => !isWritableBySwarm(f));

  return {
    valid: invalidFiles.length === 0,
    invalidFiles,
  };
}
