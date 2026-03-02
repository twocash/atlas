/**
 * Structured Error Reporting for User-Facing Crashes
 *
 * Produces a concise bug report the user can read, act on, or forward.
 * Classifies errors into categories and advises on retry viability.
 *
 * @module apps/telegram/src/utils/error-report
 */

// ─── Error Classification ────────────────────────────────

type ErrorCategory = 'code-bug' | 'transient' | 'external-service' | 'config' | 'unknown';

interface ErrorClassification {
  category: ErrorCategory;
  retryable: boolean;
  label: string;
}

function classifyError(error: unknown): ErrorClassification {
  const msg = error instanceof Error ? error.message : String(error);
  const name = error instanceof Error ? error.constructor.name : '';

  // Code bugs — deterministic, retry won't help
  if (name === 'ReferenceError' || name === 'TypeError' || name === 'SyntaxError') {
    return { category: 'code-bug', retryable: false, label: 'Code error (bug)' };
  }
  if (msg.includes('before initialization') || msg.includes('is not a function') || msg.includes('Cannot read properties of')) {
    return { category: 'code-bug', retryable: false, label: 'Code error (bug)' };
  }

  // External service failures — may be transient
  if (msg.includes('notion') || msg.includes('object_not_found') || msg.includes('validation_error')) {
    return { category: 'external-service', retryable: true, label: 'Notion API error' };
  }
  if (msg.includes('anthropic') || msg.includes('claude') || msg.includes('overloaded')) {
    return { category: 'external-service', retryable: true, label: 'Claude API error' };
  }
  if (msg.includes('gemini') || msg.includes('google')) {
    return { category: 'external-service', retryable: true, label: 'Gemini API error' };
  }

  // Network / timeout — transient
  if (msg.includes('ECONNREFUSED') || msg.includes('ETIMEDOUT') || msg.includes('fetch failed') || msg.includes('timeout')) {
    return { category: 'transient', retryable: true, label: 'Network/timeout error' };
  }

  // Config / env
  if (msg.includes('env') || msg.includes('API_KEY') || msg.includes('not configured')) {
    return { category: 'config', retryable: false, label: 'Configuration error' };
  }

  return { category: 'unknown', retryable: true, label: 'Unexpected error' };
}

// ─── Report Formatting ───────────────────────────────────

export interface ErrorReportInput {
  subsystem: string;
  error: unknown;
  userInput?: string;
  traceId?: string;
  inputType?: string;  // 'text' | 'photo' | 'document' | 'voice' | 'video' | 'callback'
}

/**
 * Build a structured, user-facing error report.
 * Returns HTML-formatted string for Telegram (parse_mode: "HTML").
 */
export function buildErrorReport(input: ErrorReportInput): string {
  const { subsystem, error, userInput, traceId, inputType } = input;
  const classification = classifyError(error);
  const errMsg = error instanceof Error ? error.message : String(error);
  const errName = error instanceof Error ? error.constructor.name : 'Error';

  const lines: string[] = [];

  // Header
  lines.push('<b>Error Report</b>');
  lines.push('');

  // What failed
  lines.push(`<b>What failed:</b> ${subsystem}`);
  lines.push(`<b>Category:</b> ${classification.label}`);

  // Error detail (truncated, no stack traces)
  const briefError = errMsg.length > 120 ? errMsg.substring(0, 120) + '...' : errMsg;
  lines.push(`<b>Error:</b> <code>${escapeHtml(errName)}: ${escapeHtml(briefError)}</code>`);

  // Repro context
  if (userInput) {
    const truncInput = userInput.length > 100 ? userInput.substring(0, 100) + '...' : userInput;
    lines.push(`<b>Input:</b> "${escapeHtml(truncInput)}"`);
  }
  if (inputType && inputType !== 'text') {
    lines.push(`<b>Input type:</b> ${inputType}`);
  }

  // Trace ID for cross-referencing logs
  if (traceId) {
    lines.push(`<b>Trace:</b> <code>${traceId}</code>`);
  }

  // Retry guidance
  lines.push('');
  if (classification.retryable) {
    lines.push('This may be transient — retry might work.');
  } else {
    lines.push('This is a code bug — retry won\'t help. Logged for fix.');
  }

  // Andon status
  lines.push('Andon cord pulled. Logged to escalation system.');

  return lines.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
