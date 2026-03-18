/**
 * Action Dispatch — sends browser actions to the Bridge for execution.
 *
 * Thin wrapper around the Bridge `/tool-dispatch` endpoint, reusing the
 * same HTTP pattern as `extractWithBridge()` in `bridge-extractor.ts`.
 *
 * Sprint: ACTION-INTENT Slice 4
 */

import { logger } from '../logger';

// ─── Config ──────────────────────────────────────────────

const BRIDGE_PORT = parseInt(process.env.BRIDGE_PORT || '3848', 10);
const BRIDGE_URL = `http://localhost:${BRIDGE_PORT}`;
const BRIDGE_TOOL_TIMEOUT_MS = 30_000;

// ─── Types ───────────────────────────────────────────────

interface BridgeToolResponse {
  id: string;
  result?: {
    url: string;
    title: string;
    content: string;
    contentLength: number;
    truncated: boolean;
    tabClosed: boolean;
  };
  error?: string;
}

export interface ActionDispatchResult {
  success: boolean;
  content: string;
  title?: string;
  error?: string;
  executionTimeMs?: number;
}

// ─── Helpers ─────────────────────────────────────────────

/** Prepend https:// if no protocol is present. */
export function ensureProtocol(destination: string): string {
  if (/^https?:\/\//i.test(destination)) return destination;
  return `https://${destination}`;
}

// ─── Dispatch ────────────────────────────────────────────

export async function dispatchActionToBridge(
  destination: string,
  task: string,
): Promise<ActionDispatchResult> {
  const url = ensureProtocol(destination);
  const id = `action-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const start = Date.now();

  const body = {
    id,
    name: 'atlas_browser_open_and_read',
    input: {
      url,
      extractionMode: 'full',
      closeAfter: true,
    },
  };

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), BRIDGE_TOOL_TIMEOUT_MS);

  try {
    const res = await fetch(`${BRIDGE_URL}/tool-dispatch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeout);

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      logger.error('[ActionDispatch] Bridge returned error', {
        url, status: res.status, body: text.substring(0, 200),
      });
      return { success: false, content: '', error: `Bridge returned ${res.status}: ${text}` };
    }

    const data = (await res.json()) as BridgeToolResponse;

    if (data.error) {
      logger.error('[ActionDispatch] Tool execution error', { url, error: data.error });
      return { success: false, content: '', error: data.error };
    }

    if (!data.result) {
      return { success: false, content: '', error: 'Bridge returned empty result' };
    }

    return {
      success: true,
      content: data.result.content || '',
      title: data.result.title,
      executionTimeMs: Date.now() - start,
    };
  } catch (err: unknown) {
    clearTimeout(timeout);
    const message = err instanceof Error ? err.message : String(err);

    if (message.includes('abort')) {
      logger.warn('[ActionDispatch] Timed out', { url, timeoutMs: BRIDGE_TOOL_TIMEOUT_MS });
      return { success: false, content: '', error: 'Browser action timed out after 30s.' };
    }

    logger.warn('[ActionDispatch] Bridge unreachable', { url, error: message });
    return {
      success: false,
      content: '',
      error: "Bridge isn't connected — make sure the Bridge and Chrome Extension are running.",
    };
  }
}
