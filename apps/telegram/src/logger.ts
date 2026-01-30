/**
 * Atlas Telegram Bot - Logger
 * 
 * Simple logging utility with levels.
 */

type LogLevel = "debug" | "info" | "warn" | "error";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

const currentLevel = (process.env.LOG_LEVEL as LogLevel) || "info";

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: LogLevel, message: string, data?: object): string {
  const timestamp = new Date().toISOString();
  const dataStr = data ? ` ${JSON.stringify(data)}` : "";
  return `[${timestamp}] [${level.toUpperCase()}] ${message}${dataStr}`;
}

export const logger = {
  debug(message: string, data?: object): void {
    if (shouldLog("debug")) {
      console.log(formatMessage("debug", message, data));
    }
  },

  info(message: string, data?: object): void {
    if (shouldLog("info")) {
      console.log(formatMessage("info", message, data));
    }
  },

  warn(message: string, data?: object): void {
    if (shouldLog("warn")) {
      console.warn(formatMessage("warn", message, data));
    }
  },

  error(message: string, data?: object): void {
    if (shouldLog("error")) {
      console.error(formatMessage("error", message, data));
    }
  },
};
