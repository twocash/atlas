/**
 * Intent → Composition Type Config
 *
 * ADR-010 fix: Maps triage intents to composition types via Notion config,
 * replacing the hardcoded TypeScript map in assembler.ts.
 *
 * Resolution: PromptManager (System Prompts DB, 5-min cache) → compiled defaults (ADR-008).
 *
 * Config entries in System Prompts DB:
 *   ID = "intent.command.composition"  → body = "analyze"
 *   ID = "intent.capture.composition"  → body = "capture"
 *   ID = "intent.query.composition"    → body = "research"
 *   ID = "intent.clarify.composition"  → body = "capture"
 *   ID = "intent.action.composition"   → body = "execute"
 *
 * Sprint: ACTION-INTENT (Slice 2)
 */

import { getPromptManager } from '../services/prompt-manager';
import { reportFailure } from '@atlas/shared/error-escalation';
import { logger } from '../logger';

// ─── Compiled defaults (ADR-008 fallback) ──────────────────
// These MUST match the Notion config rows. They exist only as a
// degraded fallback when Notion is unreachable — not as a feature surface.

const COMPILED_DEFAULTS: Record<string, string> = {
  command: 'analyze',
  capture: 'capture',
  query: 'research',
  clarify: 'capture',
  action: 'execute',
};

/**
 * Resolve the composition type for a triage intent.
 *
 * Resolution chain: System Prompts DB → compiled default → 'research' fallback.
 * Every degraded resolution triggers reportFailure() per ADR-008.
 */
export async function resolveIntentComposition(intent: string): Promise<string> {
  const configId = `intent.${intent}.composition`;

  try {
    const pm = getPromptManager();
    const value = await pm.getPromptById(configId);

    if (value) {
      const trimmed = value.trim();
      if (trimmed.length > 0) {
        return trimmed;
      }
    }

    // Config row exists but empty, or doesn't exist — use compiled default
    const compiled = COMPILED_DEFAULTS[intent];
    if (compiled) {
      logger.warn('[intent-composition] No Notion config for intent, using compiled default', {
        intent,
        configId,
        compiledDefault: compiled,
      });
      return compiled;
    }

    // Unknown intent — no compiled default either
    reportFailure('intent-composition-lookup', new Error(`No config for intent "${intent}"`), {
      intent,
      configId,
      suggestedFix: `Add System Prompt entry with ID="${configId}" containing the composition type.`,
    });
    return 'research';
  } catch (err) {
    // Notion unreachable — compiled fallback, marked degraded
    const compiled = COMPILED_DEFAULTS[intent];
    if (compiled) {
      logger.warn('[intent-composition] Notion unreachable, using compiled default', {
        intent,
        error: (err as Error).message,
      });
      return compiled;
    }

    reportFailure('intent-composition-lookup', err, {
      intent,
      configId,
      suggestedFix: 'Check Notion connectivity and System Prompts DB access.',
    });
    return 'research';
  }
}

/**
 * Resolve intent composition synchronously using compiled defaults only.
 * Used in contexts where async is not available (e.g., socratic-adapter's
 * signal builder). The async path is authoritative; this is convenience.
 */
export function resolveIntentCompositionSync(intent: string): string {
  return COMPILED_DEFAULTS[intent] ?? 'research';
}
