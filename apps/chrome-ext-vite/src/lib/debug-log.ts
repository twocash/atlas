import { Storage } from "~src/lib/chrome-storage"

const storage = new Storage({ area: "local" })
const LOG_KEY = "atlas_debug_log"
const MAX_ENTRIES = 500

export interface LogEntry {
  ts: string
  src: "orchestrator" | "content" | "ui" | "tab-mgr"
  msg: string
}

/** Append a log entry to storage. Safe to call from any context. */
export async function debugLog(src: LogEntry["src"], msg: string): Promise<void> {
  try {
    const entry: LogEntry = {
      ts: new Date().toISOString(),
      src,
      msg,
    }
    // Also console.log for DevTools
    console.log(`[Atlas:${src}] ${msg}`)

    const existing = (await storage.get<LogEntry[]>(LOG_KEY)) || []
    // Keep last MAX_ENTRIES
    const trimmed = existing.length >= MAX_ENTRIES ? existing.slice(-MAX_ENTRIES + 1) : existing
    trimmed.push(entry)
    await storage.set(LOG_KEY, trimmed)
  } catch {
    // Never let logging crash the app
  }
}

/** Read all log entries. */
export async function getDebugLog(): Promise<LogEntry[]> {
  try {
    return (await storage.get<LogEntry[]>(LOG_KEY)) || []
  } catch {
    return []
  }
}

/** Clear the log. */
export async function clearDebugLog(): Promise<void> {
  await storage.set(LOG_KEY, [])
}

export { LOG_KEY }
