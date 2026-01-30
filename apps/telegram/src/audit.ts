/**
 * Atlas Telegram Bot - Audit Logger
 * 
 * Logs all interactions for accountability and debugging.
 * 
 * @see IMPLEMENTATION.md Sprint 1.4 for requirements
 */

import { appendFileSync, existsSync, mkdirSync } from "fs";
import { join } from "path";
import type { AuditEntry } from "./types";

const AUDIT_LOG_PATH = process.env.AUDIT_LOG_PATH || "./logs";
const AUDIT_FILE = join(AUDIT_LOG_PATH, "audit.log");

// Ensure log directory exists
if (!existsSync(AUDIT_LOG_PATH)) {
  mkdirSync(AUDIT_LOG_PATH, { recursive: true });
}

/**
 * Format an audit entry as a log line
 */
function formatEntry(entry: AuditEntry): string {
  return JSON.stringify({
    ...entry,
    timestamp: entry.timestamp.toISOString(),
  }) + "\n";
}

/**
 * Audit logging interface
 */
export const audit = {
  /**
   * Log an interaction
   */
  log(entry: AuditEntry): void {
    const line = formatEntry(entry);
    
    // Write to file
    try {
      appendFileSync(AUDIT_FILE, line);
    } catch (error) {
      console.error("Failed to write audit log", error);
    }

    // Also log to console in debug mode
    if (process.env.LOG_LEVEL === "debug") {
      console.log("[AUDIT]", entry);
    }
  },

  /**
   * Log a response to a previous message
   */
  logResponse(userId: number, response: string, notionItemId?: string): void {
    this.log({
      userId,
      messageType: "response",
      content: response,
      timestamp: new Date(),
      response,
      notionItemId,
    });
  },

  /**
   * Log an error
   */
  logError(userId: number, error: string, _context?: object): void {
    this.log({
      userId,
      messageType: "error",
      content: error,
      timestamp: new Date(),
    });
  },
};
