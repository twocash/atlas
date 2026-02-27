/**
 * RAG Artifact Writer — structured JSON for Tier 3.3 AnythingLLM ingestion.
 *
 * Writes data/sessions/{id}.artifact.json on session completion.
 * Data contract: SessionArtifact schema, version '1.0'.
 *
 * Sprint: SESSION-TELEMETRY P0
 */

import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { logger } from '../logger';
import type { SessionState, SessionArtifact } from './types';
import { ensureSessionDir } from './journal';

/**
 * Write a RAG-ready artifact JSON file for a completed session.
 * Called on session completion only (not per-turn).
 */
export async function writeArtifact(state: SessionState): Promise<void> {
  try {
    const dir = await ensureSessionDir();
    const filePath = join(dir, `${state.id}.artifact.json`);

    const completedAt = state.completedAt || new Date().toISOString();
    const startMs = new Date(state.createdAt).getTime();
    const endMs = new Date(completedAt).getTime();

    const artifact: SessionArtifact = {
      version: '1.0',
      sessionId: state.id,
      topic: state.topic,
      pillar: state.pillar,
      surface: state.surface,
      intentSequence: state.intentSequence,
      thesisHook: state.thesisHook,
      turns: state.turns,
      startedAt: state.createdAt,
      completedAt,
      completionType: state.completionType || 'natural',
      totalDurationMs: endMs - startMs,
    };

    await writeFile(filePath, JSON.stringify(artifact, null, 2), 'utf-8');

    logger.info('Session artifact written', {
      sessionId: state.id,
      turns: state.turnCount,
      durationMs: artifact.totalDurationMs,
    });
  } catch (err) {
    logger.warn('Failed to write session artifact', {
      sessionId: state.id,
      error: (err as Error).message,
    });
  }
}
