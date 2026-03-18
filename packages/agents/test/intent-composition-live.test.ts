/**
 * Intent Composition Config — Live Notion Verification
 *
 * Proves the ADR-010 fix is actually live: config values come from
 * Notion System Prompts DB, not compiled defaults.
 *
 * Requires:
 *   - NOTION_API_KEY set (API access)
 *   - NOTION_PROMPTS_DB_ID=2fc780a78eef8196b29bdb4a6adfdc27 (System Prompts DB)
 *   - Five intent.*.composition entries Active in the DB
 *
 * Sprint: ACTION-INTENT (merge gate)
 */

import { describe, it, expect, beforeAll } from 'bun:test';
import { getPromptManager } from '../src/services/prompt-manager';

const EXPECTED: Record<string, string> = {
  'intent.command.composition': 'analyze',
  'intent.capture.composition': 'capture',
  'intent.query.composition': 'research',
  'intent.clarify.composition': 'capture',
  'intent.action.composition': 'execute',
};

describe('Intent composition config (live Notion)', () => {
  beforeAll(() => {
    // Gate: skip entire suite if env vars aren't set
    if (!process.env.NOTION_API_KEY || !process.env.NOTION_PROMPTS_DB_ID) {
      console.warn(
        '[SKIP] Intent composition live test requires NOTION_API_KEY and NOTION_PROMPTS_DB_ID.\n' +
        'Add NOTION_PROMPTS_DB_ID=2fc780a78eef8196b29bdb4a6adfdc27 to apps/telegram/.env'
      );
    }
  });

  for (const [configId, expectedValue] of Object.entries(EXPECTED)) {
    it(`${configId} → "${expectedValue}" from Notion (not compiled default)`, async () => {
      if (!process.env.NOTION_API_KEY || !process.env.NOTION_PROMPTS_DB_ID) {
        console.warn(`  [SKIP] ${configId} — env vars not set`);
        return; // soft skip, don't fail CI
      }

      const pm = getPromptManager();
      const value = await pm.getPromptById(configId);

      // Must be non-null (found in Notion, not fallback)
      expect(value).not.toBeNull();

      // Must match expected value
      const trimmed = value!.trim();
      expect(trimmed).toBe(expectedValue);
    });
  }

  it('resolveIntentComposition("action") returns "execute" from Notion', async () => {
    if (!process.env.NOTION_API_KEY || !process.env.NOTION_PROMPTS_DB_ID) {
      console.warn('  [SKIP] — env vars not set');
      return;
    }

    const { resolveIntentComposition } = await import('../src/config/intent-composition');
    const result = await resolveIntentComposition('action');
    expect(result).toBe('execute');
  });
});
