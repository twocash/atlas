/**
 * LocalModelBackend — Seam for Future Local Model Execution
 *
 * Currently a stub that always falls back to ClaudeAPIBackend.
 * When local models (Ollama, llama.cpp, etc.) are available,
 * this backend routes Tier 0-1 tasks to them.
 *
 * The Grove Ratchet: as local models improve, the router can
 * assign more tiers to this backend without changing any other code.
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import { logger } from '../../logger';
import type {
  ExecutionBackend,
  ExecutionRequest,
  ExecutionChunk,
} from '../system';

// ─── Backend Implementation ─────────────────────────────

export class LocalModelBackend implements ExecutionBackend {
  readonly backendId = 'local-model';
  readonly supportsToolUse = false;
  readonly supportsStreaming = false;

  async *execute(_request: ExecutionRequest): AsyncIterable<ExecutionChunk> {
    // Seam: when local models are available, execute here.
    // For now, signal that this backend can't handle the request.
    logger.warn('LocalModelBackend invoked but no local model available');

    yield {
      type: 'error',
      content: 'Local model backend not yet implemented. Route to Claude API instead.',
    };
  }
}
