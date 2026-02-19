/**
 * Degraded Context Warning Utility
 *
 * Standard format for signaling when a PromptManager lookup fails
 * and hardcoded fallbacks are used. Two outputs:
 *
 * 1. **Prompt injection** — `degradedWarning()` returns a string
 *    to embed in the prompt so the model output signals degradation.
 *
 * 2. **Structured log** — `logDegradedFallback()` emits a standard
 *    console.error with slug, caller, and remediation steps.
 *
 * ADR-008: Fail Fast, Fail Loud — fallbacks must never be silent.
 *
 * @example
 * ```ts
 * const voiceText = await pm.getPromptById('voice.grove-analytical');
 * if (!voiceText) {
 *   logDegradedFallback('voice.grove-analytical', 'getVoiceInstructionsAsync');
 *   return FALLBACK + '\n' + degradedWarning('voice.grove-analytical');
 * }
 * ```
 */

/**
 * Returns a prompt-injectable warning string.
 * Embed this in the prompt text so model output signals degradation.
 *
 * Format: `[DEGRADED: {slug} unavailable — using hardcoded fallback]`
 */
export function degradedWarning(slug: string): string {
  return `[DEGRADED: ${slug} unavailable — using hardcoded fallback]`;
}

/**
 * Standard remediation steps shown in logs.
 */
const REMEDIATION_STEPS = [
  '1. Check NOTION_PROMPTS_DB_ID env var is set',
  '2. Verify Notion DB has entry with matching ID/slug',
  '3. Run seed migration if DB is empty: bun run apps/telegram/data/migrations/seed-prompts.ts',
  '4. Check network connectivity to Notion API',
] as const;

/**
 * Emit a structured console.error for a degraded PM fallback.
 *
 * @param slug - The PM slug that was not found (e.g., 'voice.grove-analytical')
 * @param caller - The function name where the fallback occurred
 * @param extra - Optional additional context (e.g., { depth: 'deep', pillar: 'the-grove' })
 */
export function logDegradedFallback(
  slug: string,
  caller: string,
  extra?: Record<string, unknown>
): void {
  console.error(`[DEGRADED] ${caller}: "${slug}" not found in PromptManager — using hardcoded fallback`, {
    slug,
    caller,
    ...extra,
    fix: REMEDIATION_STEPS,
  });
}
