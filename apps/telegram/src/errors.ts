/**
 * Atlas Error Infrastructure — Fail-Fast Foundation
 *
 * Centralized error classes with auto-logging to Dev Pipeline.
 * Every thrown AtlasError auto-logs to Notion (if AUTO_LOG_ERRORS enabled).
 * P0/P1 errors also notify via Telegram.
 *
 * Usage:
 *   throw new HallucinationError('Fabricated URL', { url });
 *   // ^ auto-logs to Dev Pipeline + notifies Telegram
 */

import { Client } from "@notionhq/client";
import { NOTION_DB } from '@atlas/shared/config';
import { logger } from "./logger";

// Atlas Dev Pipeline database (for error logging)
const DEV_PIPELINE_DB = NOTION_DB.DEV_PIPELINE;

// Lazy Notion client for error logging (separate from main bot client)
let _errorNotionClient: Client | null = null;
function getErrorNotionClient(): Client | null {
  if (!_errorNotionClient) {
    const apiKey = process.env.NOTION_API_KEY;
    if (!apiKey) return null;
    _errorNotionClient = new Client({ auth: apiKey });
  }
  return _errorNotionClient;
}

/**
 * Base error class for all Atlas errors.
 * Auto-logs to Dev Pipeline when thrown.
 */
export class AtlasError extends Error {
  severity: 'P0' | 'P1' | 'P2';
  context: Record<string, unknown>;
  timestamp: Date;

  constructor(message: string, severity: 'P0' | 'P1' | 'P2', context: Record<string, unknown> = {}) {
    super(message);
    this.name = this.constructor.name;
    this.severity = severity;
    this.context = context;
    this.timestamp = new Date();

    // Auto-log if enabled (fire-and-forget, never blocks)
    if (process.env.AUTO_LOG_ERRORS !== 'false') {
      this.logToDevPipeline().catch(() => {
        // Logging failure must never propagate
      });
    }
  }

  async logToDevPipeline(): Promise<void> {
    const notion = getErrorNotionClient();
    if (!notion) {
      logger.warn('Cannot log error to Dev Pipeline: no Notion client', { error: this.message });
      return;
    }

    try {
      await notion.pages.create({
        parent: { database_id: DEV_PIPELINE_DB },
        properties: {
          Discussion: { title: [{ text: { content: `BUG: ${this.message}`.substring(0, 100) } }] },
          Type: { select: { name: 'Bug' } },
          Priority: { select: { name: this.severity } },
          Status: { select: { name: 'Dispatched' } },
          Handler: { select: { name: 'Pit Crew' } },
          Thread: {
            rich_text: [{
              text: {
                content: JSON.stringify({
                  errorClass: this.name,
                  severity: this.severity,
                  context: this.context,
                  timestamp: this.timestamp.toISOString(),
                  stack: this.stack?.substring(0, 500),
                }, null, 2).substring(0, 2000),
              },
            }],
          },
        },
      });

      logger.info('Error logged to Dev Pipeline', {
        error: this.message,
        severity: this.severity,
      });
    } catch (logError) {
      logger.error('Failed to log error to Dev Pipeline', { logError, originalError: this.message });
    }
  }
}

/**
 * Research agent returned results without executing tools,
 * or fabricated Notion URLs not found in tool output.
 */
export class HallucinationError extends AtlasError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'P0', { ...context, errorType: 'hallucination' });
  }
}

/**
 * Research agent failed to complete its task.
 */
export class ResearchAgentError extends AtlasError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'P1', { ...context, errorType: 'research-agent' });
  }
}

/**
 * Classification failed or fell below confidence threshold.
 */
export class ClassificationError extends AtlasError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'P1', { ...context, errorType: 'classification' });
  }
}

/**
 * Notion write failed or read-after-write verification failed.
 */
export class NotionSyncError extends AtlasError {
  constructor(message: string, context: Record<string, unknown> = {}) {
    super(message, 'P1', { ...context, errorType: 'notion-sync' });
  }
}
