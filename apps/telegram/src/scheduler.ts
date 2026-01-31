/**
 * Atlas Telegram Bot - Task Scheduler
 *
 * Loads JSON task definitions from data/schedules/ and executes them via cron.
 * Invalid JSON files are logged and skipped (no crash).
 */

import { CronJob } from 'cron';
import { readdir, readFile, mkdir } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { logger } from './logger';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

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

const state: SchedulerState = {
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

  // Store callback for hot-loading
  setSchedulerCallback(onTrigger);

  let files: string[];
  try {
    files = await readdir(SCHEDULES_DIR);
  } catch (err) {
    logger.warn('Schedules directory not found, creating...', { error: err });
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

// Store the callback for hot-loading new tasks
let schedulerCallback: TaskCallback | null = null;

/**
 * Register a new task at runtime (hot-load without restart)
 */
export function registerTask(task: ScheduledTask): { success: boolean; nextRun?: string; error?: string } {
  if (!schedulerCallback) {
    return { success: false, error: 'Scheduler not initialized' };
  }

  // Stop existing job if any
  const existingJob = state.jobs.get(task.id);
  if (existingJob) {
    existingJob.stop();
    state.jobs.delete(task.id);
    state.tasks.delete(task.id);
  }

  if (!task.enabled) {
    return { success: true, nextRun: 'disabled' };
  }

  try {
    const job = new CronJob(task.cron, () => {
      logger.info('Scheduled task triggered', { id: task.id, action: task.action });
      schedulerCallback!(task);
    });
    job.start();

    state.jobs.set(task.id, job);
    state.tasks.set(task.id, task);

    const nextRun = job.nextDate().toISO() || 'unknown';
    logger.info('Task registered at runtime', { id: task.id, cron: task.cron, nextRun });

    return { success: true, nextRun };
  } catch (err) {
    return { success: false, error: `Invalid cron expression: ${err}` };
  }
}

/**
 * Unregister a task at runtime (remove without restart)
 */
export function unregisterTask(id: string): boolean {
  const job = state.jobs.get(id);
  if (job) {
    job.stop();
    state.jobs.delete(id);
    state.tasks.delete(id);
    logger.info('Task unregistered at runtime', { id });
    return true;
  }
  return false;
}

/**
 * Set the scheduler callback (called by initScheduler)
 */
export function setSchedulerCallback(callback: TaskCallback): void {
  schedulerCallback = callback;
}
