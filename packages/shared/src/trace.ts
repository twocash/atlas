/**
 * Pipeline Trace Infrastructure
 *
 * UUID-fingerprinted traces for every message through the Telegram pipeline.
 * Each trace records steps with timing and metadata, enabling:
 * - End-to-end latency analysis
 * - Pipeline failure diagnostics
 * - Auto-bug reporting with full context
 *
 * @module @atlas/shared/trace
 */

// ─── Types ───────────────────────────────────────────────

export interface TraceStep {
  name: string;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  metadata?: Record<string, unknown>;
}

export interface TraceContext {
  traceId: string;
  startedAt: number;
  steps: TraceStep[];
  status: 'active' | 'complete' | 'failed';
  totalDurationMs?: number;
  error?: string;
}

// ─── UUID v4 ─────────────────────────────────────────────

function uuidv4(): string {
  // crypto.randomUUID() available in Bun/Node 19+
  if (typeof crypto !== 'undefined' && crypto.randomUUID) {
    return crypto.randomUUID();
  }
  // Fallback: manual UUID v4
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// ─── Public API ──────────────────────────────────────────

/**
 * Create a new trace context with a UUID v4 identifier.
 */
export function createTrace(): TraceContext {
  return {
    traceId: uuidv4(),
    startedAt: Date.now(),
    steps: [],
    status: 'active',
  };
}

/**
 * Add a named step to the trace and return a reference to it.
 * The step starts immediately; call `completeStep()` when done.
 */
export function addStep(
  trace: TraceContext,
  name: string,
  metadata?: Record<string, unknown>
): TraceStep {
  const step: TraceStep = {
    name,
    startedAt: Date.now(),
    metadata,
  };
  trace.steps.push(step);
  return step;
}

/**
 * Mark a step as completed with timing data.
 */
export function completeStep(step: TraceStep): void {
  step.completedAt = Date.now();
  step.durationMs = step.completedAt - step.startedAt;
}

/**
 * Mark the trace as successfully completed.
 */
export function completeTrace(trace: TraceContext): void {
  trace.status = 'complete';
  trace.totalDurationMs = Date.now() - trace.startedAt;
}

/**
 * Mark the trace as failed with an error message.
 */
export function failTrace(trace: TraceContext, error: string | Error): void {
  trace.status = 'failed';
  trace.error = error instanceof Error ? error.message : error;
  trace.totalDurationMs = Date.now() - trace.startedAt;
}

/**
 * Format a trace as a human-readable summary for bug reports.
 */
export function formatTrace(trace: TraceContext): string {
  const lines: string[] = [];
  const statusIcon = trace.status === 'complete' ? '✓' : trace.status === 'failed' ? '✗' : '…';

  lines.push(`Trace ${trace.traceId} [${statusIcon} ${trace.status}]`);
  lines.push(`Started: ${new Date(trace.startedAt).toISOString()}`);
  if (trace.totalDurationMs !== undefined) {
    lines.push(`Total: ${trace.totalDurationMs}ms`);
  }
  if (trace.error) {
    lines.push(`Error: ${trace.error}`);
  }

  lines.push('');
  lines.push('Steps:');

  for (let i = 0; i < trace.steps.length; i++) {
    const step = trace.steps[i];
    const duration = step.durationMs !== undefined ? `${step.durationMs}ms` : 'pending';
    const stepIcon = step.completedAt ? '✓' : '…';
    lines.push(`  ${i + 1}. [${stepIcon}] ${step.name} (${duration})`);

    if (step.metadata && Object.keys(step.metadata).length > 0) {
      for (const [key, value] of Object.entries(step.metadata)) {
        const display = typeof value === 'object' ? JSON.stringify(value) : String(value);
        lines.push(`       ${key}: ${display}`);
      }
    }
  }

  return lines.join('\n');
}
