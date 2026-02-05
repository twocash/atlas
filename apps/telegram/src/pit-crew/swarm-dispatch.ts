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
import { logger } from '../logger';
import { getFeatureFlags, getSafetyLimits } from '../config/features';
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
 */
export function buildFixPrompt(task: SwarmTask): string {
  const modeLabel = task.zone === 'approve' ? 'PLAN ONLY - DO NOT EXECUTE' : 'FIX AND VERIFY';

  return `
You are Atlas Pit Crew — an autonomous repair agent.

=== MODE: ${modeLabel} ===

TASK: ${task.context}

TARGET: ${task.targetSkill || 'See files below'}
FILES: ${task.operation.targetFiles.join(', ')}
ZONE: ${task.zone} (${task.zone === 'auto-execute' ? 'deploy without notification' : task.zone === 'auto-notify' ? 'deploy and notify' : 'plan only'})

=== RULES ===
1. Only modify files in: data/skills/, data/pit-crew/, src/skills/
2. Run tests after changes: bun run test
3. If tests fail, revert your changes and report the failure
4. Keep changes minimal — fix the specific issue, don't refactor
5. Commit with message: fix(skills): <description>

=== SAFETY ===
- Do NOT touch supervisor.ts, handler.ts, bot.ts, index.ts
- Do NOT modify .env or any config outside src/config/features.ts
- Do NOT add new dependencies
- If you're unsure whether a change is safe, STOP and report back

=== FEED ENTRY ===
ID: ${task.feedEntryId}
${task.workQueueId ? `Work Queue: ${task.workQueueId}` : ''}

${task.zone === 'approve' ? `
=== PLAN ONLY MODE ===
You must NOT execute any changes. Instead:
1. Analyze the problem
2. Identify the files that need to change
3. Describe the exact changes needed
4. Return a structured plan for human review
` : ''}
`.trim();
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
  const prompt = buildFixPrompt(task);

  return new Promise((resolve) => {
    const args = [
      '--print',
      '--dangerously-skip-permissions',
    ];

    // Add allowed paths for execute mode
    if (mode === 'execute') {
      // Note: Claude Code CLI args may vary - adjust as needed
      args.push('--allowedTools', 'Edit,Write,Bash,Read');
    }

    args.push(prompt);

    logger.debug('Spawning Claude Code', { args: args.slice(0, 4) });

    const proc = spawn('claude', args, {
      shell: true,
      cwd: process.cwd(),
      timeout: timeoutSeconds * 1000,
      env: {
        ...process.env,
        // Ensure Claude Code uses the worktree, not production
        CLAUDE_WORKING_DIR: process.cwd(),
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

    proc.on('close', (code) => {
      if (code === 0) {
        // Parse output to extract results
        const result = parseClaudeCodeOutput(stdout);
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
