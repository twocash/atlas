/**
 * Atlas Supervisor - Local Storage Adapter
 *
 * JSON-based storage for heartbeats and pattern registry.
 * Implements abstract PatternStore interface for future swappability.
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { existsSync } from 'fs';
import { dirname, join } from 'path';
import type {
  ErrorPattern,
  HeartbeatStore,
  HeartbeatEntry,
  PatternRegistryStore,
  TelemetrySnapshot,
  DEFAULT_HEARTBEAT_STORE,
  DEFAULT_PATTERN_REGISTRY,
} from './types';

// Re-import defaults
const DEFAULT_HEARTBEAT: HeartbeatStore = {
  version: '1.0.0',
  maxEntries: 96,
  entries: [],
};

const DEFAULT_REGISTRY: PatternRegistryStore = {
  version: '1.0.0',
  patterns: [],
  proposedPatterns: [],
};

// ==========================================
// Abstract Pattern Store Interface
// ==========================================

/**
 * Abstract interface for pattern storage.
 * Sprint 2 can swap in SQLite or Notion without changing consumer code.
 */
export interface PatternStore {
  get(id: string): Promise<ErrorPattern | null>;
  put(pattern: ErrorPattern): Promise<void>;
  list(filter?: { approved?: boolean }): Promise<ErrorPattern[]>;
  incrementCount(id: string): Promise<number>;
  delete(id: string): Promise<void>;
  propose(pattern: ErrorPattern): Promise<void>;
  listProposed(): Promise<ErrorPattern[]>;
  approve(id: string): Promise<void>;
  reject(id: string): Promise<void>;
}

// ==========================================
// JSON File Store Implementation
// ==========================================

export class JsonLocalStore implements PatternStore {
  private basePath: string;
  private heartbeatPath: string;
  private patternPath: string;
  private initialized: boolean = false;

  constructor(basePath: string = './data/supervisor') {
    this.basePath = basePath;
    this.heartbeatPath = join(basePath, 'heartbeats.json');
    this.patternPath = join(basePath, 'pattern-registry.json');
  }

  /**
   * Ensure storage directory exists
   */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    try {
      if (!existsSync(this.basePath)) {
        await mkdir(this.basePath, { recursive: true });
      }

      // Initialize heartbeat file if missing
      if (!existsSync(this.heartbeatPath)) {
        await writeFile(this.heartbeatPath, JSON.stringify(DEFAULT_HEARTBEAT, null, 2));
      }

      // Initialize pattern registry if missing
      if (!existsSync(this.patternPath)) {
        await writeFile(this.patternPath, JSON.stringify(DEFAULT_REGISTRY, null, 2));
      }

      this.initialized = true;
    } catch (error) {
      console.error('[LocalStore] Initialization failed:', error);
      throw error;
    }
  }

  // ==========================================
  // Heartbeat Methods
  // ==========================================

  /**
   * Read heartbeat store
   */
  async readHeartbeats(): Promise<HeartbeatStore> {
    await this.ensureInitialized();

    try {
      const content = await readFile(this.heartbeatPath, 'utf-8');
      return JSON.parse(content) as HeartbeatStore;
    } catch {
      return { ...DEFAULT_HEARTBEAT };
    }
  }

  /**
   * Append a heartbeat entry (maintains max size)
   */
  async appendHeartbeat(snapshot: TelemetrySnapshot): Promise<void> {
    await this.ensureInitialized();

    const store = await this.readHeartbeats();

    const entry: HeartbeatEntry = {
      timestamp: snapshot.timestamp.toISOString(),
      snapshot,
    };

    store.entries.push(entry);

    // Trim to max size (FIFO)
    while (store.entries.length > store.maxEntries) {
      store.entries.shift();
    }

    await writeFile(this.heartbeatPath, JSON.stringify(store, null, 2));
  }

  /**
   * Get the latest heartbeat
   */
  async getLatestHeartbeat(): Promise<TelemetrySnapshot | null> {
    const store = await this.readHeartbeats();

    if (store.entries.length === 0) return null;

    const latest = store.entries[store.entries.length - 1];

    // Reconstruct Date objects
    return {
      ...latest.snapshot,
      timestamp: new Date(latest.snapshot.timestamp),
    };
  }

  /**
   * Get heartbeats from the last N hours
   */
  async getRecentHeartbeats(hours: number): Promise<TelemetrySnapshot[]> {
    const store = await this.readHeartbeats();
    const cutoff = Date.now() - hours * 60 * 60 * 1000;

    return store.entries
      .filter(e => new Date(e.timestamp).getTime() > cutoff)
      .map(e => ({
        ...e.snapshot,
        timestamp: new Date(e.snapshot.timestamp),
      }));
  }

  /**
   * Get heartbeat count
   */
  async getHeartbeatCount(): Promise<number> {
    const store = await this.readHeartbeats();
    return store.entries.length;
  }

  // ==========================================
  // Pattern Registry Methods (PatternStore interface)
  // ==========================================

  /**
   * Read pattern registry
   */
  private async readRegistry(): Promise<PatternRegistryStore> {
    await this.ensureInitialized();

    try {
      const content = await readFile(this.patternPath, 'utf-8');
      return JSON.parse(content) as PatternRegistryStore;
    } catch {
      return { ...DEFAULT_REGISTRY };
    }
  }

  /**
   * Write pattern registry
   */
  private async writeRegistry(store: PatternRegistryStore): Promise<void> {
    await writeFile(this.patternPath, JSON.stringify(store, null, 2));
  }

  /**
   * Get a pattern by ID
   */
  async get(id: string): Promise<ErrorPattern | null> {
    const store = await this.readRegistry();

    const pattern = store.patterns.find(p => p.id === id);
    if (pattern) return this.deserializePattern(pattern);

    const proposed = store.proposedPatterns.find(p => p.id === id);
    if (proposed) return this.deserializePattern(proposed);

    return null;
  }

  /**
   * Put (upsert) a pattern
   */
  async put(pattern: ErrorPattern): Promise<void> {
    const store = await this.readRegistry();

    const index = store.patterns.findIndex(p => p.id === pattern.id);
    if (index >= 0) {
      store.patterns[index] = this.serializePattern(pattern);
    } else {
      store.patterns.push(this.serializePattern(pattern));
    }

    await this.writeRegistry(store);
  }

  /**
   * List patterns with optional filter
   */
  async list(filter?: { approved?: boolean }): Promise<ErrorPattern[]> {
    const store = await this.readRegistry();

    let patterns = store.patterns.map(p => this.deserializePattern(p));

    if (filter?.approved !== undefined) {
      patterns = patterns.filter(p => p.approved === filter.approved);
    }

    return patterns;
  }

  /**
   * Increment occurrence count and return new value
   */
  async incrementCount(id: string): Promise<number> {
    const store = await this.readRegistry();

    // Check active patterns
    const activeIndex = store.patterns.findIndex(p => p.id === id);
    if (activeIndex >= 0) {
      store.patterns[activeIndex].occurrenceCount++;
      store.patterns[activeIndex].lastSeen = new Date().toISOString() as any;
      await this.writeRegistry(store);
      return store.patterns[activeIndex].occurrenceCount;
    }

    // Check proposed patterns
    const proposedIndex = store.proposedPatterns.findIndex(p => p.id === id);
    if (proposedIndex >= 0) {
      store.proposedPatterns[proposedIndex].occurrenceCount++;
      store.proposedPatterns[proposedIndex].lastSeen = new Date().toISOString() as any;
      await this.writeRegistry(store);
      return store.proposedPatterns[proposedIndex].occurrenceCount;
    }

    return 0;
  }

  /**
   * Delete a pattern
   */
  async delete(id: string): Promise<void> {
    const store = await this.readRegistry();

    store.patterns = store.patterns.filter(p => p.id !== id);
    store.proposedPatterns = store.proposedPatterns.filter(p => p.id !== id);

    await this.writeRegistry(store);
  }

  /**
   * Propose a new pattern (awaiting approval)
   */
  async propose(pattern: ErrorPattern): Promise<void> {
    const store = await this.readRegistry();

    // Check if already proposed
    const existing = store.proposedPatterns.find(p => p.pattern === pattern.pattern);
    if (existing) {
      existing.occurrenceCount++;
      existing.lastSeen = new Date().toISOString() as any;
      if (existing.contexts.length < 5) {
        existing.contexts.push(...pattern.contexts.slice(0, 5 - existing.contexts.length));
      }
    } else {
      store.proposedPatterns.push(this.serializePattern(pattern));
    }

    await this.writeRegistry(store);
  }

  /**
   * List proposed patterns
   */
  async listProposed(): Promise<ErrorPattern[]> {
    const store = await this.readRegistry();
    return store.proposedPatterns.map(p => this.deserializePattern(p));
  }

  /**
   * Approve a proposed pattern (move to active)
   */
  async approve(id: string): Promise<void> {
    const store = await this.readRegistry();

    const index = store.proposedPatterns.findIndex(p => p.id === id);
    if (index < 0) return;

    const pattern = store.proposedPatterns[index];
    pattern.approved = true;

    store.patterns.push(pattern);
    store.proposedPatterns.splice(index, 1);

    await this.writeRegistry(store);
  }

  /**
   * Reject a proposed pattern (delete it)
   */
  async reject(id: string): Promise<void> {
    const store = await this.readRegistry();
    store.proposedPatterns = store.proposedPatterns.filter(p => p.id !== id);
    await this.writeRegistry(store);
  }

  // ==========================================
  // Serialization Helpers
  // ==========================================

  private serializePattern(pattern: ErrorPattern): any {
    return {
      ...pattern,
      firstSeen: pattern.firstSeen instanceof Date ? pattern.firstSeen.toISOString() : pattern.firstSeen,
      lastSeen: pattern.lastSeen instanceof Date ? pattern.lastSeen.toISOString() : pattern.lastSeen,
    };
  }

  private deserializePattern(data: any): ErrorPattern {
    return {
      ...data,
      firstSeen: new Date(data.firstSeen),
      lastSeen: new Date(data.lastSeen),
    };
  }
}

// ==========================================
// Singleton Instance
// ==========================================

let _store: JsonLocalStore | null = null;

export function getLocalStore(basePath?: string): JsonLocalStore {
  if (!_store) {
    _store = new JsonLocalStore(basePath);
  }
  return _store;
}

export function resetLocalStore(): void {
  _store = null;
}
