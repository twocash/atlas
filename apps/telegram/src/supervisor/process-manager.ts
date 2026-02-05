/**
 * Atlas Supervisor - Process Manager
 *
 * Manages the lifecycle of the Atlas Telegram bot process.
 * Handles start, stop, restart, and health monitoring.
 */

import { spawn, type ChildProcess } from 'child_process';
import { EventEmitter } from 'events';
import { existsSync } from 'fs';
import { join } from 'path';
import type { SupervisorConfig, ProcessState, INITIAL_PROCESS_STATE, SupervisorMode } from './types';

// Re-define initial state to avoid circular imports
const INITIAL_STATE: ProcessState = {
  processId: null,
  startTime: null,
  restartCount: 0,
  errorCount: 0,
  consecutiveErrors: 0,
  lastError: null,
  lastErrorTime: null,
  lastSuccessTime: null,
  dispatchedBugs: [],
  status: 'stopped',
};

// ==========================================
// Process Manager Events
// ==========================================

export interface ProcessManagerEvents {
  'started': (pid: number) => void;
  'stopped': (code: number | null) => void;
  'error': (error: Error) => void;
  'stdout': (data: string) => void;
  'stderr': (data: string) => void;
  'log': (level: string, message: string) => void;
}

// ==========================================
// Process Manager Class
// ==========================================

export class ProcessManager extends EventEmitter {
  private config: SupervisorConfig;
  private state: ProcessState;
  private process: ChildProcess | null = null;
  private sourcePath: string;
  private restartTimeout: ReturnType<typeof setTimeout> | null = null;
  private autoRestartEnabled: boolean = true;

  constructor(config: SupervisorConfig) {
    super();
    this.config = config;
    this.state = { ...INITIAL_STATE };
    this.sourcePath = this.getSourcePath();
  }

  /**
   * Get the source path based on mode
   */
  private getSourcePath(): string {
    if (this.config.mode === 'dev' && this.config.devPath) {
      return this.config.devPath;
    }
    // Production path
    return 'C:\\github\\atlas\\apps\\telegram';
  }

  /**
   * Validate the source path
   */
  validateSourcePath(): { valid: boolean; error?: string } {
    if (!existsSync(this.sourcePath)) {
      return {
        valid: false,
        error: `Source path does not exist: ${this.sourcePath}`,
      };
    }

    const packageJson = join(this.sourcePath, 'package.json');
    if (!existsSync(packageJson)) {
      return {
        valid: false,
        error: `No package.json found at: ${packageJson}`,
      };
    }

    const srcIndex = join(this.sourcePath, 'src', 'index.ts');
    if (!existsSync(srcIndex)) {
      return {
        valid: false,
        error: `No src/index.ts found at: ${srcIndex}`,
      };
    }

    return { valid: true };
  }

  /**
   * Start the bot process
   */
  async start(): Promise<{ success: boolean; pid?: number; error?: string }> {
    if (this.state.status === 'running') {
      return { success: false, error: 'Bot is already running' };
    }

    // Validate source path
    const validation = this.validateSourcePath();
    if (!validation.valid) {
      return { success: false, error: validation.error };
    }

    this.state.status = 'starting';
    this.emit('log', 'info', `Starting bot from ${this.sourcePath}`);

    try {
      // Spawn bun process
      this.process = spawn('bun', ['run', 'dev'], {
        cwd: this.sourcePath,
        env: {
          ...process.env,
          // Ensure we don't inherit conflicting vars
          SUPERVISOR_MANAGED: 'true',
        },
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      const pid = this.process.pid;
      if (!pid) {
        throw new Error('Failed to get process PID');
      }

      // Update state
      this.state.processId = pid;
      this.state.startTime = new Date();
      this.state.status = 'running';
      this.state.consecutiveErrors = 0;

      // Set up event handlers
      this.setupProcessHandlers();

      this.emit('started', pid);
      this.emit('log', 'info', `Bot started with PID ${pid}`);

      return { success: true, pid };
    } catch (error) {
      this.state.status = 'error';
      this.state.lastError = error instanceof Error ? error.message : String(error);
      this.state.lastErrorTime = new Date();

      this.emit('error', error instanceof Error ? error : new Error(String(error)));

      return {
        success: false,
        error: `Failed to start bot: ${this.state.lastError}`,
      };
    }
  }

  /**
   * Set up process event handlers
   */
  private setupProcessHandlers(): void {
    if (!this.process) return;

    // Handle stdout
    this.process.stdout?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.emit('stdout', text);
      this.parseLogOutput(text);
    });

    // Handle stderr
    this.process.stderr?.on('data', (data: Buffer) => {
      const text = data.toString();
      this.emit('stderr', text);
      this.parseLogOutput(text, true);
    });

    // Handle process exit
    this.process.on('exit', (code, signal) => {
      this.emit('log', 'warn', `Bot process exited with code ${code}, signal ${signal}`);

      this.state.processId = null;
      this.state.status = 'stopped';
      this.process = null;

      this.emit('stopped', code);

      // Auto-restart on unexpected exit
      if (code !== 0 && this.autoRestartEnabled) {
        this.state.errorCount++;
        this.state.consecutiveErrors++;
        this.state.lastError = `Process exited with code ${code}`;
        this.state.lastErrorTime = new Date();
        this.state.restartCount++;

        this.emit('log', 'warn', `Scheduling auto-restart (attempt ${this.state.restartCount})`);

        // Exponential backoff: 2s, 4s, 8s, 16s, 32s max
        const delay = Math.min(2000 * Math.pow(2, this.state.consecutiveErrors - 1), 32000);

        this.restartTimeout = setTimeout(() => {
          this.start();
        }, delay);
      }
    });

    // Handle process errors
    this.process.on('error', (error) => {
      this.emit('error', error);
      this.emit('log', 'error', `Process error: ${error.message}`);

      this.state.status = 'error';
      this.state.lastError = error.message;
      this.state.lastErrorTime = new Date();
    });
  }

  /**
   * Parse log output for patterns
   */
  private parseLogOutput(text: string, isStderr: boolean = false): void {
    // Extract log level if present
    const levelMatch = text.match(/\[(ERROR|WARN|INFO|DEBUG)\]/i);
    const level = levelMatch ? levelMatch[1].toLowerCase() : (isStderr ? 'error' : 'info');

    // Track successful operations
    if (text.includes('[Notion]') && !text.includes('error') && !text.includes('failed')) {
      this.state.lastSuccessTime = new Date();
      this.state.consecutiveErrors = 0;
    }

    // The log-watcher will handle detailed pattern matching
    // Here we just emit the raw output
  }

  /**
   * Stop the bot process
   */
  async stop(): Promise<{ success: boolean; error?: string }> {
    if (!this.process || this.state.status === 'stopped') {
      return { success: true }; // Already stopped
    }

    this.autoRestartEnabled = false;

    // Clear any pending restart
    if (this.restartTimeout) {
      clearTimeout(this.restartTimeout);
      this.restartTimeout = null;
    }

    this.state.status = 'stopping';
    this.emit('log', 'info', 'Stopping bot process...');

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        // Force kill if graceful shutdown takes too long
        if (this.process) {
          this.emit('log', 'warn', 'Graceful shutdown timeout, force killing...');
          this.process.kill('SIGKILL');
        }
      }, 5000);

      this.process!.once('exit', () => {
        clearTimeout(timeout);
        this.state.status = 'stopped';
        this.state.processId = null;
        this.process = null;
        this.emit('log', 'info', 'Bot stopped');
        resolve({ success: true });
      });

      // Send graceful shutdown signal
      this.process!.kill('SIGTERM');
    });
  }

  /**
   * Restart the bot process
   */
  async restart(): Promise<{ success: boolean; pid?: number; error?: string }> {
    this.emit('log', 'info', 'Restarting bot...');

    await this.stop();

    // Re-enable auto-restart
    this.autoRestartEnabled = true;

    // Brief delay before restart
    await new Promise(resolve => setTimeout(resolve, 1000));

    return this.start();
  }

  /**
   * Get current process state
   */
  getState(): ProcessState {
    return { ...this.state };
  }

  /**
   * Get uptime in milliseconds
   */
  getUptime(): number | null {
    if (!this.state.startTime || this.state.status !== 'running') {
      return null;
    }
    return Date.now() - this.state.startTime.getTime();
  }

  /**
   * Get source path
   */
  getSourcePath(): string {
    return this.sourcePath;
  }

  /**
   * Check if process is running
   */
  isRunning(): boolean {
    return this.state.status === 'running' && this.process !== null;
  }

  /**
   * Record an error (for tracking)
   */
  recordError(error: string): void {
    this.state.errorCount++;
    this.state.consecutiveErrors++;
    this.state.lastError = error;
    this.state.lastErrorTime = new Date();
  }

  /**
   * Record a successful operation
   */
  recordSuccess(): void {
    this.state.consecutiveErrors = 0;
    this.state.lastSuccessTime = new Date();
  }

  /**
   * Record a dispatched bug
   */
  recordDispatch(dispatchId: string): void {
    this.state.dispatchedBugs.push(dispatchId);
  }

  /**
   * Enable/disable auto-restart
   */
  setAutoRestart(enabled: boolean): void {
    this.autoRestartEnabled = enabled;
  }
}

// ==========================================
// Factory Function
// ==========================================

export function createProcessManager(config: SupervisorConfig): ProcessManager {
  return new ProcessManager(config);
}
