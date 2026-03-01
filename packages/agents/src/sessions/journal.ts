/**
 * Filesystem Journal Writer — crash-resilient session persistence.
 *
 * Writes a markdown file per session to data/sessions/{id}.md.
 * Full rewrite per turn (idempotent). If the process crashes,
 * the journal survives and can be rehydrated on restart.
 *
 * Sprint: SESSION-TELEMETRY P0
 */

import { writeFile, readFile, readdir, mkdir } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { logger } from '../logger';
import type { SessionState, TurnRecord } from './types';

// ── Directory ───────────────────────────────────────────

/** Resolve sessions directory relative to repo root */
function getSessionsDir(): string {
  // Navigate from packages/agents/src/sessions/ up to repo root, then into data/sessions/
  return resolve(__dirname, '..', '..', '..', '..', 'data', 'sessions');
}

export async function ensureSessionDir(): Promise<string> {
  const dir = getSessionsDir();
  if (!existsSync(dir)) {
    await mkdir(dir, { recursive: true });
  }
  return dir;
}

// ── Journal Writing ─────────────────────────────────────

function formatTurn(turn: TurnRecord): string {
  const lines: string[] = [];
  lines.push(`## Turn ${turn.turnNumber} -- ${turn.intent || 'unknown'}`);
  lines.push('');
  lines.push(`**Timestamp:** ${turn.timestamp}`);

  const preview = turn.messageText.length > 200
    ? turn.messageText.substring(0, 200) + '...'
    : turn.messageText;
  lines.push(`**Message:** ${preview}`);

  if (turn.findings) {
    lines.push(`**Findings:** ${turn.findings}`);
  }
  if (turn.thesisHook) {
    lines.push(`**Thesis:** ${turn.thesisHook}`);
  }
  if (turn.responsePreview) {
    lines.push(`**Response:** ${turn.responsePreview}`);
  }
  if (turn.toolsUsed && turn.toolsUsed.length > 0) {
    lines.push(`**Tools:** ${turn.toolsUsed.join(', ')}`);
  }

  lines.push('');
  return lines.join('\n');
}

/**
 * Write (or overwrite) the session journal.
 * Called after each turn — entire file rewritten (idempotent, crash-safe).
 */
export async function writeJournal(state: SessionState): Promise<void> {
  try {
    const dir = await ensureSessionDir();
    const filePath = join(dir, `${state.id}.md`);

    const lines: string[] = [];

    // Header
    lines.push(`# Session: ${state.topic || 'Untitled'}`);
    lines.push('');
    lines.push(`- **Session ID:** ${state.id}`);
    lines.push(`- **Surface:** ${state.surface}`);
    if (state.pillar) {
      lines.push(`- **Pillar:** ${state.pillar}`);
    }
    lines.push(`- **Started:** ${state.createdAt}`);
    lines.push(`- **Turns:** ${state.turnCount}`);
    if (state.intentSequence.length > 0) {
      lines.push(`- **Intent Arc:** ${state.intentSequence.join(' -> ')}`);
    }
    lines.push('');
    lines.push('---');
    lines.push('');

    // Turns
    for (const turn of state.turns) {
      lines.push(formatTurn(turn));
    }

    // Completion marker (only if session is completed)
    if (state.completedAt && state.completionType) {
      lines.push('---');
      lines.push('');
      lines.push('## Session Complete');
      lines.push('');
      lines.push(`- **Type:** ${state.completionType}`);
      lines.push(`- **Completed:** ${state.completedAt}`);
      const durationMs = new Date(state.completedAt).getTime() - new Date(state.createdAt).getTime();
      lines.push(`- **Duration:** ${Math.round(durationMs / 1000)}s`);
      lines.push('');
    }

    await writeFile(filePath, lines.join('\n'), 'utf-8');
  } catch (err) {
    logger.warn('Failed to write session journal', {
      sessionId: state.id,
      error: (err as Error).message,
    });
  }
}

// ── Journal Rehydration ─────────────────────────────────

/**
 * Parse a journal markdown file back into a partial SessionState.
 * Used for crash recovery — rebuilds active sessions from filesystem.
 *
 * Returns null if the journal is completed (has "## Session Complete" marker)
 * or if parsing fails.
 */
export async function parseJournal(filePath: string): Promise<SessionState | null> {
  try {
    const content = await readFile(filePath, 'utf-8');

    // Skip completed sessions
    if (content.includes('## Session Complete')) {
      return null;
    }

    // Parse header
    const idMatch = content.match(/\*\*Session ID:\*\*\s*(.+)/);
    const surfaceMatch = content.match(/\*\*Surface:\*\*\s*(.+)/);
    const pillarMatch = content.match(/\*\*Pillar:\*\*\s*(.+)/);
    const startedMatch = content.match(/\*\*Started:\*\*\s*(.+)/);
    const topicMatch = content.match(/^# Session:\s*(.+)/m);
    const intentArcMatch = content.match(/\*\*Intent Arc:\*\*\s*(.+)/);

    if (!idMatch || !surfaceMatch || !startedMatch) {
      return null;
    }

    const id = idMatch[1].trim();
    const surface = surfaceMatch[1].trim();
    const pillar = pillarMatch?.[1].trim();
    const createdAt = startedMatch[1].trim();
    const topic = topicMatch?.[1].trim();
    const intentSequence = intentArcMatch
      ? intentArcMatch[1].split('->').map(s => s.trim())
      : [];

    // Parse turns
    const turns: TurnRecord[] = [];
    const turnBlocks = content.split(/^## Turn \d+/m).slice(1);

    for (let i = 0; i < turnBlocks.length; i++) {
      const block = turnBlocks[i];
      const intentMatch = block.match(/^\s*--\s*(.+)/);
      const timestampMatch = block.match(/\*\*Timestamp:\*\*\s*(.+)/);
      const messageMatch = block.match(/\*\*Message:\*\*\s*(.+)/);
      const findingsMatch = block.match(/\*\*Findings:\*\*\s*(.+)/);
      const thesisMatch = block.match(/\*\*Thesis:\*\*\s*(.+)/);
      const responseMatch = block.match(/\*\*Response:\*\*\s*(.+)/);
      const toolsMatch = block.match(/\*\*Tools:\*\*\s*(.+)/);

      turns.push({
        turnNumber: i + 1,
        timestamp: timestampMatch?.[1]?.trim() || createdAt,
        messageText: messageMatch?.[1]?.replace(/\.\.\.$/,'') || '',
        intent: intentMatch?.[1]?.trim(),
        findings: findingsMatch?.[1],
        thesisHook: thesisMatch?.[1],
        responsePreview: responseMatch?.[1],
        toolsUsed: toolsMatch?.[1]?.split(', '),
      });
    }

    // Reconstruct state
    const lastTurn = turns[turns.length - 1];
    return {
      id,
      topic: topic === 'Untitled' ? undefined : topic,
      pillar,
      surface,
      intentSequence,
      turns,
      turnCount: turns.length,
      priorFindings: lastTurn?.findings,
      thesisHook: lastTurn?.thesisHook,
      createdAt,
      lastActivity: Date.now(), // Reset TTL on rehydration
    };
  } catch (err) {
    logger.warn('Failed to parse session journal for rehydration', {
      filePath,
      error: (err as Error).message,
    });
    return null;
  }
}

/**
 * Scan data/sessions/ for incomplete journals and return rehydrated states.
 * Called on SessionManager construction for crash resilience.
 */
export async function scanForIncompleteJournals(): Promise<SessionState[]> {
  const states: SessionState[] = [];

  try {
    const dir = getSessionsDir();
    if (!existsSync(dir)) return states;

    const files = await readdir(dir);
    const journals = files.filter(f => f.endsWith('.md'));

    for (const file of journals) {
      const state = await parseJournal(join(dir, file));
      if (state) {
        states.push(state);
      }
    }

    if (states.length > 0) {
      logger.info('Rehydrated sessions from journals', {
        count: states.length,
        sessionIds: states.map(s => s.id),
      });
    }
  } catch (err) {
    logger.warn('Failed to scan for incomplete journals', {
      error: (err as Error).message,
    });
  }

  return states;
}
