/**
 * Bridge Claude — Identity Composition
 *
 * Resolves Bridge Claude's identity from Notion System Prompts DB:
 *   - bridge.soul  → Who Bridge Claude is (persona, principles, voice)
 *   - user         → Who Jim is (clients, pillars, projects)
 *   - bridge.memory → What Bridge Claude has learned (corrections, patterns)
 *   - bridge.goals  → What Jim is working toward (active projects, priorities)
 *
 * Follows ADR-001 (Notion as source of truth) and ADR-008 (fail fast, fail loud).
 * Identity resolution failure is a hard error — Bridge Claude does not start
 * with a degraded identity.
 *
 * @module
 */

import { getPromptManager } from '../prompt-manager';

/** Prompt IDs in Notion System Prompts DB */
const BRIDGE_SOUL_ID = 'bridge.soul';
const BRIDGE_MEMORY_ID = 'bridge.memory';
const BRIDGE_GOALS_ID = 'bridge.goals';
const USER_ID = 'system.general';  // Existing user/system context entry

/** Token budget ceiling for full Slot 0 assembly (SOUL + USER + MEMORY + GOALS) */
const SLOT_0_TOKEN_CEILING = 6000;

/** Rough chars-per-token estimate (conservative) */
const CHARS_PER_TOKEN = 4;

export interface BridgePromptResult {
  /** The composed system prompt string */
  prompt: string;
  /** Estimated token count */
  tokenCount: number;
  /** Which components were loaded */
  components: {
    soul: boolean;
    user: boolean;
    memory: boolean;
    goals: boolean;
  };
  /** Warnings (e.g. token budget approached) */
  warnings: string[];
}

/**
 * Compose Bridge Claude's identity prompt from Notion-governed documents.
 *
 * Resolves BRIDGE-SOUL (required), USER (optional), MEMORY (optional),
 * and GOALS (optional) from the System Prompts DB via PromptManager.
 *
 * Hard-fails if BRIDGE-SOUL cannot be resolved — Bridge Claude does not
 * start with a degraded identity (ADR-008).
 *
 * GOALS is optional — if unavailable, Bridge operates in degraded mode
 * with explicit awareness that goal context is missing (ADR-008).
 *
 * @throws {Error} If bridge.soul cannot be resolved from Notion
 */
export async function composeBridgePrompt(): Promise<BridgePromptResult> {
  const pm = getPromptManager();
  const warnings: string[] = [];

  // Resolve all four identity documents in parallel
  const [soul, user, memory, goals] = await Promise.all([
    pm.getPromptById(BRIDGE_SOUL_ID),
    pm.getPromptById(USER_ID),
    pm.getPromptById(BRIDGE_MEMORY_ID),
    pm.getPromptById(BRIDGE_GOALS_ID),
  ]);

  // ADR-008: Hard-fail if identity resolution returns null
  if (!soul) {
    throw new Error(
      `[Bridge Identity] FATAL: bridge.soul not found in System Prompts DB. ` +
      `Bridge Claude cannot start without identity. ` +
      `Check Notion entry with ID="${BRIDGE_SOUL_ID}" exists and is Active. ` +
      `DB: 2fc780a78eef8196b29bdb4a6adfdc27`
    );
  }

  // Assemble the prompt
  const sections: string[] = [soul];

  if (user) {
    sections.push(`---\n\n## System Context\n${user}`);
  } else {
    warnings.push('USER context unavailable — Bridge Claude operating without system context');
  }

  if (memory) {
    sections.push(`---\n\n## Persistent Memory\n${memory}`);
  } else {
    warnings.push('MEMORY unavailable — Bridge Claude has no cross-session learnings loaded');
  }

  if (goals) {
    sections.push(`---\n\n## Active Goals & Projects\n${goals}`);
  } else {
    // ADR-008: Explicit degraded mode — not silent omission
    warnings.push(
      'GOALS unavailable — Bridge Claude operating without project awareness. ' +
      'Goal context will not inform page observation or proactive assistance. ' +
      'Check Notion entry with ID="bridge.goals" exists and is Active.'
    );
  }

  // Append canonical database reference
  sections.push(`---\n\n## Canonical Database IDs\n` +
    `| Database | SDK ID |\n` +
    `|----------|--------|\n` +
    `| Feed 2.0 | 90b2b33f-4b44-4b42-870f-8d62fb8cbf18 |\n` +
    `| Work Queue 2.0 | 3d679030-b76b-43bd-92d8-1ac51abb4a28 |\n` +
    `| System Prompts | 2fc780a78eef8196b29bdb4a6adfdc27 |`
  );

  const prompt = sections.join('\n\n');
  const tokenCount = Math.ceil(prompt.length / CHARS_PER_TOKEN);

  // Check token budget
  if (tokenCount > SLOT_0_TOKEN_CEILING) {
    warnings.push(
      `Slot 0 token count (${tokenCount}) exceeds ceiling (${SLOT_0_TOKEN_CEILING}). ` +
      `Consider pruning MEMORY or GOALS entries.`
    );
  }

  return {
    prompt,
    tokenCount,
    components: {
      soul: true,
      user: !!user,
      memory: !!memory,
      goals: !!goals,
    },
    warnings,
  };
}
