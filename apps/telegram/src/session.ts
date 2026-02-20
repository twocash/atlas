/**
 * Session State Management
 *
 * Per-user session settings including model override
 */

import type { ModelId } from "./cognitive/models";

export interface UserSession {
  modelOverride: ModelId | "auto";
  lastActivity: Date;
}

// In-memory session store (per user)
const sessions = new Map<number, UserSession>();

/**
 * Get or create session for user
 */
export function getSession(userId: number): UserSession {
  let session = sessions.get(userId);
  if (!session) {
    session = {
      modelOverride: "auto",
      lastActivity: new Date(),
    };
    sessions.set(userId, session);
  }
  session.lastActivity = new Date();
  return session;
}

/**
 * Set model override for session
 */
export function setModelOverride(userId: number, model: ModelId | "auto"): void {
  const session = getSession(userId);
  session.modelOverride = model;
}

/**
 * Get current model override
 */
export function getModelOverride(userId: number): ModelId | "auto" {
  return getSession(userId).modelOverride;
}

/**
 * Clear session
 */
export function clearSession(userId: number): void {
  sessions.delete(userId);
}

/**
 * Model shorthand names for user-friendly commands
 */
export const MODEL_SHORTCUTS: Record<string, ModelId | "auto"> = {
  "auto": "auto",
  "opus": "claude-opus-4-20250514",
  "haiku": "claude-haiku-4-5-20251001",
  "sonnet": "claude-sonnet-4-20250514",
  "gpt4o": "gpt-4o",
  "gpt4o-mini": "gpt-4o-mini",
  "mini": "gpt-4o-mini",
  "gemini": "gemini-2.0-flash",
  "gemini-flash": "gemini-2.0-flash",
  "gemini-pro": "gemini-2.0-pro",
};

/**
 * Get display name for model
 */
export function getModelDisplayName(model: ModelId | "auto"): string {
  const names: Record<ModelId | "auto", string> = {
    "auto": "Auto (router decides)",
    "claude-opus-4-20250514": "Opus (most powerful)",
    "claude-haiku-4-5-20251001": "Haiku (fast, cheap)",
    "claude-sonnet-4-20250514": "Sonnet (powerful)",
    "gpt-4o": "GPT-4o (structured)",
    "gpt-4o-mini": "GPT-4o-mini (JSON)",
    "gemini-2.0-flash": "Gemini 2.0 Flash (fast)",
    "gemini-2.0-pro": "Gemini 2.0 Pro (powerful)",
    "local": "Local (no API)",
  };
  return names[model] || model;
}
