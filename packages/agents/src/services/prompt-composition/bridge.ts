/**
 * Atlas Identity Composition
 *
 * Surface-agnostic identity resolution from Notion System Prompts DB.
 * All Atlas surfaces (Telegram, Bridge, future) resolve identity through
 * this single composition function.
 *
 * Components resolved:
 *   - atlas.constitution          → Foundational governance (planning, verification, self-improvement)
 *   - atlas.soul                  → Who Atlas is (persona, voice, cognitive approach)
 *   - atlas.user                  → Who Jim is (clients, pillars, projects, preferences)
 *   - atlas.memory                → What Atlas has learned (corrections, patterns, preferences)
 *   - atlas.goals                 → What Jim is working toward (active projects, priorities)
 *   - atlas.operations.jidoka     → Autonomous self-repair protocol (Digital Jidoka)
 *
 * Follows ADR-001 (Notion as source of truth) and ADR-008 (fail fast, fail loud).
 * Identity resolution failure is a hard error — Atlas does not start
 * with a degraded identity.
 *
 * @module
 */

import { getPromptManager } from '../prompt-manager';

/** Prompt IDs in Notion System Prompts DB */
const CONSTITUTION_ID = 'atlas.constitution';
const SOUL_ID = 'atlas.soul';
const MEMORY_ID = 'atlas.memory';
const GOALS_ID = 'atlas.goals';
const USER_ID = 'atlas.user';
const JIDOKA_ID = 'atlas.operations.jidoka';

/** Token budget ceiling for full Slot 0 assembly (CONSTITUTION + SOUL + USER + MEMORY + GOALS) */
const SLOT_0_TOKEN_CEILING = 8000;

/** Rough chars-per-token estimate (conservative) */
const CHARS_PER_TOKEN = 4;

/** Surface-specific context paragraphs */
const SURFACE_CONTEXT: Record<string, string> = {
  telegram: [
    '## Surface Context',
    'You are Atlas on **Telegram** — the mobile-first async triage surface.',
    'Jim shares sparks (links, thoughts, screenshots) here for capture and classification.',
    'Your role: interpret intent, ask one clarifying question if needed, route to the right pillar,',
    'and dispatch work. Responses should be concise — this is a chat interface, not a document editor.',
    'Rich deliverables (research, drafts, analysis) go to the conference table (Notion), not inline.',
    'The 10-Second Rule applies: clarification questions must be answerable in under 10 seconds.',
  ].join('\n'),

  bridge: [
    '## Surface Context',
    'You are Atlas on the **Desktop Bridge** — the deep-work cognitive partner.',
    'You see what Jim sees (browser context, selected text, active pages) and think alongside him.',
    'Your role: proactive context surfacing, strategic analysis, research synthesis, and autonomous',
    'assistance when page observation reveals actionable patterns. You have full access to the',
    'conference table (Notion) and can dispatch work to any pipeline.',
  ].join('\n'),
};

export interface AtlasIdentityResult {
  /** The composed system prompt string */
  prompt: string;
  /** Estimated token count */
  tokenCount: number;
  /** Which surface this was composed for */
  surface: string;
  /** Which components were loaded */
  components: {
    constitution: boolean;
    soul: boolean;
    user: boolean;
    memory: boolean;
    goals: boolean;
    jidoka: boolean;
  };
  /** Warnings (e.g. token budget approached) */
  warnings: string[];
}

/** @deprecated Use AtlasIdentityResult instead */
export type BridgePromptResult = AtlasIdentityResult;

/**
 * Compose Atlas identity prompt from Notion-governed documents.
 *
 * Surface-agnostic — works for Telegram, Bridge, and future surfaces.
 * Resolves CONSTITUTION (required), SOUL (required), USER (optional),
 * MEMORY (optional), and GOALS (optional) from the System Prompts DB via
 * PromptManager.
 *
 * Hard-fails if CONSTITUTION or SOUL cannot be resolved — Atlas does not
 * start without governance or identity (ADR-008).
 *
 * @param surface - The surface identifier ('telegram', 'bridge', or custom)
 * @throws {Error} If atlas.constitution or atlas.soul cannot be resolved from Notion
 */
export async function composeAtlasIdentity(surface: string = 'bridge'): Promise<AtlasIdentityResult> {
  const pm = getPromptManager();
  const warnings: string[] = [];

  // Resolve all identity documents in parallel
  const [constitution, soul, user, memory, goals, jidoka] = await Promise.all([
    pm.getPromptById(CONSTITUTION_ID),
    pm.getPromptById(SOUL_ID),
    pm.getPromptById(USER_ID),
    pm.getPromptById(MEMORY_ID),
    pm.getPromptById(GOALS_ID),
    pm.getPromptById(JIDOKA_ID),
  ]);

  // ADR-008: Hard-fail if constitution resolution returns null
  if (!constitution) {
    throw new Error(
      `[Atlas Identity] FATAL: atlas.constitution not found in System Prompts DB. ` +
      `Atlas cannot start without governance. ` +
      `Check Notion entry with ID="${CONSTITUTION_ID}" exists and is Active. ` +
      `DB: 2fc780a78eef8196b29bdb4a6adfdc27`
    );
  }

  // ADR-008: Hard-fail if identity resolution returns null
  if (!soul) {
    throw new Error(
      `[Atlas Identity] FATAL: atlas.soul not found in System Prompts DB. ` +
      `Atlas cannot start without identity. ` +
      `Check Notion entry with ID="${SOUL_ID}" exists and is Active. ` +
      `DB: 2fc780a78eef8196b29bdb4a6adfdc27`
    );
  }

  // Assemble the prompt — constitution FIRST (foundational governance layer)
  const sections: string[] = [
    `## Atlas Constitution\n${constitution}`,
    `---\n\n${soul}`,
  ];

  // Surface-specific context (injected after SOUL, before USER)
  const surfaceCtx = SURFACE_CONTEXT[surface];
  if (surfaceCtx) {
    sections.push(`---\n\n${surfaceCtx}`);
  } else if (surface !== 'bridge') {
    // Unknown surface — add generic context
    sections.push(`---\n\n## Surface Context\nYou are Atlas on the **${surface}** surface.`);
  }

  if (user) {
    sections.push(`---\n\n## System Context\n${user}`);
  } else {
    warnings.push(`USER context unavailable — Atlas [${surface}] operating without system context`);
  }

  if (memory) {
    sections.push(`---\n\n## Persistent Memory\n${memory}`);
  } else {
    warnings.push(`MEMORY unavailable — Atlas [${surface}] has no cross-session learnings loaded`);
  }

  if (goals) {
    sections.push(`---\n\n## Active Goals & Projects\n${goals}`);
  } else {
    // ADR-008: Explicit degraded mode — not silent omission
    warnings.push(
      `GOALS unavailable — Atlas [${surface}] operating without project awareness. ` +
      `Goal context will not inform assistance. ` +
      `Check Notion entry with ID="${GOALS_ID}" exists and is Active.`
    );
  }

  // Jidoka (Digital Jidoka — autonomous self-repair protocol)
  if (jidoka) {
    sections.push(`---\n\n${jidoka}`);
  } else {
    warnings.push(`JIDOKA unavailable — Atlas [${surface}] operating without autonomous self-repair directive`);
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
    surface,
    components: {
      constitution: true,
      soul: true,
      user: !!user,
      memory: !!memory,
      goals: !!goals,
      jidoka: !!jidoka,
    },
    warnings,
  };
}

/**
 * Compose Bridge Claude's identity prompt.
 * @deprecated Use composeAtlasIdentity('bridge') instead.
 * Kept for backward compatibility with existing Bridge callers.
 */
export async function composeBridgePrompt(): Promise<AtlasIdentityResult> {
  return composeAtlasIdentity('bridge');
}
