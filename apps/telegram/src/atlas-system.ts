/**
 * Atlas System Directory Management
 *
 * Manages .atlas/ directory for persistent state, tasks, and memory.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync, appendFileSync } from "fs";
import { join } from "path";
import { logger } from "./logger";

const ATLAS_DIR = process.env.ATLAS_SYSTEM_DIR || "./.atlas";

// Ensure directory structure exists
export function initAtlasSystem(): void {
  const dirs = [ATLAS_DIR, join(ATLAS_DIR, "memory"), join(ATLAS_DIR, "memory/sessions")];

  for (const dir of dirs) {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
      logger.info(`Created Atlas system directory: ${dir}`);
    }
  }

  // Initialize files if missing
  if (!existsSync(join(ATLAS_DIR, "state.json"))) {
    writeState(getDefaultState());
  }
  if (!existsSync(join(ATLAS_DIR, "heartbeat.json"))) {
    writeHeartbeat({ status: "starting", lastHeartbeat: new Date().toISOString() });
  }
  if (!existsSync(join(ATLAS_DIR, "tasks.json"))) {
    writeTasks({ queue: [], completed: [] });
  }
}

// State management
export interface AtlasState {
  version: string;
  lastActive: string;
  currentMode: "idle" | "processing" | "waiting";
  activeTasks: string[];
  pendingClarifications: string[];
  stats: {
    messagesHandled: number;
    sparksCaptured: number;
    queriesAnswered: number;
    sessionStart: string;
  };
}

export function getState(): AtlasState {
  try {
    return JSON.parse(readFileSync(join(ATLAS_DIR, "state.json"), "utf-8"));
  } catch {
    return getDefaultState();
  }
}

export function writeState(state: AtlasState): void {
  writeFileSync(join(ATLAS_DIR, "state.json"), JSON.stringify(state, null, 2));
}

export function updateState(updates: Partial<AtlasState>): void {
  const state = getState();
  writeState({ ...state, ...updates, lastActive: new Date().toISOString() });
}

function getDefaultState(): AtlasState {
  return {
    version: "1.0",
    lastActive: new Date().toISOString(),
    currentMode: "idle",
    activeTasks: [],
    pendingClarifications: [],
    stats: {
      messagesHandled: 0,
      sparksCaptured: 0,
      queriesAnswered: 0,
      sessionStart: new Date().toISOString(),
    },
  };
}

// Heartbeat
export interface Heartbeat {
  status: "healthy" | "degraded" | "error" | "starting";
  lastHeartbeat: string;
  uptime?: string;
  telegramConnected?: boolean;
  notionConnected?: boolean;
  claudeConnected?: boolean;
  lastError?: string | null;
  pendingWork?: number;
}

export function getHeartbeat(): Heartbeat {
  try {
    return JSON.parse(readFileSync(join(ATLAS_DIR, "heartbeat.json"), "utf-8"));
  } catch {
    return { status: "starting", lastHeartbeat: new Date().toISOString() };
  }
}

export function writeHeartbeat(heartbeat: Heartbeat): void {
  writeFileSync(join(ATLAS_DIR, "heartbeat.json"), JSON.stringify(heartbeat, null, 2));
}

export function updateHeartbeat(updates: Partial<Heartbeat>): void {
  const hb = getHeartbeat();
  writeHeartbeat({ ...hb, ...updates, lastHeartbeat: new Date().toISOString() });
}

// Task queue
export interface AtlasTask {
  id: string;
  type: "followup" | "reminder" | "check" | "report";
  description: string;
  created: string;
  triggerAt?: string;
  status: "pending" | "active" | "completed" | "dismissed";
  metadata?: Record<string, unknown>;
}

export interface TaskQueue {
  queue: AtlasTask[];
  completed: AtlasTask[];
}

export function getTasks(): TaskQueue {
  try {
    return JSON.parse(readFileSync(join(ATLAS_DIR, "tasks.json"), "utf-8"));
  } catch {
    return { queue: [], completed: [] };
  }
}

export function writeTasks(tasks: TaskQueue): void {
  writeFileSync(join(ATLAS_DIR, "tasks.json"), JSON.stringify(tasks, null, 2));
}

export function addTask(task: Omit<AtlasTask, "id" | "created" | "status">): AtlasTask {
  const tasks = getTasks();
  const newTask: AtlasTask = {
    ...task,
    id: `task_${Date.now()}`,
    created: new Date().toISOString(),
    status: "pending",
  };
  tasks.queue.push(newTask);
  writeTasks(tasks);
  return newTask;
}

export function completeTask(taskId: string): void {
  const tasks = getTasks();
  const idx = tasks.queue.findIndex(t => t.id === taskId);
  if (idx >= 0) {
    const task = tasks.queue.splice(idx, 1)[0];
    task.status = "completed";
    tasks.completed.push(task);
    writeTasks(tasks);
  }
}

// Updates log
export function logUpdate(message: string): void {
  const timestamp = new Date().toISOString();
  const entry = `[${timestamp}] ${message}\n`;
  appendFileSync(join(ATLAS_DIR, "updates.log"), entry);
}

// Memory
export function getContext(): Record<string, unknown> {
  try {
    return JSON.parse(readFileSync(join(ATLAS_DIR, "memory/context.json"), "utf-8"));
  } catch {
    return { preferences: {}, facts: {}, patterns: {} };
  }
}

export function updateContext(updates: Record<string, unknown>): void {
  const context = getContext();
  writeFileSync(
    join(ATLAS_DIR, "memory/context.json"),
    JSON.stringify({ ...context, ...updates }, null, 2)
  );
}

export function saveSessionSummary(summary: {
  date: string;
  summary: string;
  sparks: number;
  queries: number;
  topics: string[];
  notableItems: string[];
}): void {
  const filename = join(ATLAS_DIR, `memory/sessions/${summary.date}.json`);
  writeFileSync(filename, JSON.stringify(summary, null, 2));
}
