/**
 * Regression Tests — Live Bugs (Feb 8, 2026)
 *
 * Tests 4 production bugs found by atlas-supervisor:
 * BUG 1: WQ Status update uses wrong Notion property type (status vs select)
 * BUG 2: Triage property type mismatches in Feed 2.0
 * BUG 3: Telegram reaction emoji REACTION_INVALID
 * BUG 4: Hot-reload cascade storm (missing debounce)
 *
 * Run: cd apps/telegram && bun test test/live-bugs-feb8.test.ts
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// =============================================================================
// BUG 1: WQ Status update — must use `select`, not `status`
// =============================================================================

// Capture Notion API calls
let notionUpdateCalls: Array<{ page_id: string; properties: Record<string, any> }> = [];

mock.module('@notionhq/client', () => ({
  Client: class {
    pages = {
      create: async (args: any) => ({ id: 'mock-feed-id-123', ...args }),
      update: async (args: any) => {
        notionUpdateCalls.push(args);
        return { id: args.page_id, ...args };
      },
    };
  },
}));

// Must mock features BEFORE importing action-log
mock.module('../src/config/features', () => ({
  isFeatureEnabled: (flag: string) => true,
}));

// Import AFTER mocks are set up
const { updateWorkQueueStatus } = await import('../src/conversation/notion-url');
const { logAction } = await import('../src/skills/action-log');

describe('BUG 1: WQ Status update property type', () => {
  beforeEach(() => {
    notionUpdateCalls = [];
  });

  it('sends select (not status) when updating WQ status to Done', async () => {
    await updateWorkQueueStatus('page-123', 'Done');

    expect(notionUpdateCalls.length).toBe(1);
    const props = notionUpdateCalls[0].properties;

    // MUST be select, NOT status
    expect(props['Status']).toEqual({ select: { name: 'Done' } });
    expect(props['Status']).not.toHaveProperty('status');
  });

  it('sends select (not status) when updating WQ status to Active', async () => {
    await updateWorkQueueStatus('page-456', 'Active');

    expect(notionUpdateCalls.length).toBe(1);
    const props = notionUpdateCalls[0].properties;

    expect(props['Status']).toEqual({ select: { name: 'Active' } });
    expect(props['Status']).not.toHaveProperty('status');
  });

  it('sends select (not status) for every valid WQ status', async () => {
    const statuses = ['Done', 'Shipped', 'Active', 'Captured', 'Blocked', 'Paused'] as const;

    for (const status of statuses) {
      notionUpdateCalls = [];
      await updateWorkQueueStatus('page-test', status);

      expect(notionUpdateCalls.length).toBe(1);
      const props = notionUpdateCalls[0].properties;
      expect(props['Status']).toEqual({ select: { name: status } });
      // The regression: previously sent { status: { name } } instead of { select: { name } }
      expect(props['Status']).not.toHaveProperty('status');
    }
  });
});

// =============================================================================
// BUG 2: Triage property type mismatches in Feed 2.0
// =============================================================================

describe('BUG 2: Triage property types match Notion schema', () => {
  beforeEach(() => {
    notionUpdateCalls = [];
  });

  const baseInput = {
    actionType: 'classify' as const,
    messageText: 'Test triage property types',
    requestType: 'Research' as const,
    pillar: 'The Grove' as const,
    toolsUsed: ['classify'],
    userId: 12345,
    confidence: 0.95,
  };

  it('Triage Complexity sends select with "Tier N" format (not number)', async () => {
    await logAction({
      ...baseInput,
      triageComplexityTier: 2,
    });

    // Second call is the pattern props update
    const patternUpdate = notionUpdateCalls.find(
      c => c.properties['Triage Complexity']
    );
    expect(patternUpdate).toBeDefined();

    const prop = patternUpdate!.properties['Triage Complexity'];
    // MUST be select, NOT number
    expect(prop).toEqual({ select: { name: 'Tier 2' } });
    expect(prop).not.toHaveProperty('number');
  });

  it('Triage Complexity formats all tiers correctly', async () => {
    for (const tier of [0, 1, 2, 3] as const) {
      notionUpdateCalls = [];
      await logAction({ ...baseInput, triageComplexityTier: tier });

      const patternUpdate = notionUpdateCalls.find(
        c => c.properties['Triage Complexity']
      );
      expect(patternUpdate).toBeDefined();
      expect(patternUpdate!.properties['Triage Complexity']).toEqual({
        select: { name: `Tier ${tier}` },
      });
    }
  });

  it('Triage Suggested Pillar sends rich_text (not select)', async () => {
    await logAction({
      ...baseInput,
      triageSuggestedPillar: 'The Grove',
    });

    const patternUpdate = notionUpdateCalls.find(
      c => c.properties['Triage Suggested Pillar']
    );
    expect(patternUpdate).toBeDefined();

    const prop = patternUpdate!.properties['Triage Suggested Pillar'];
    // MUST be rich_text, NOT select
    expect(prop).toEqual({
      rich_text: [{ text: { content: 'The Grove' } }],
    });
    expect(prop).not.toHaveProperty('select');
  });

  it('Triage Pillar Corrected sends rich_text "Yes"/"No" (not checkbox)', async () => {
    // Test true → "Yes"
    await logAction({
      ...baseInput,
      triagePillarCorrected: true,
    });

    let patternUpdate = notionUpdateCalls.find(
      c => c.properties['Triage Pillar Corrected']
    );
    expect(patternUpdate).toBeDefined();
    let prop = patternUpdate!.properties['Triage Pillar Corrected'];
    // MUST be rich_text, NOT checkbox
    expect(prop).toEqual({
      rich_text: [{ text: { content: 'Yes' } }],
    });
    expect(prop).not.toHaveProperty('checkbox');

    // Test false → "No"
    notionUpdateCalls = [];
    await logAction({
      ...baseInput,
      triagePillarCorrected: false,
    });

    patternUpdate = notionUpdateCalls.find(
      c => c.properties['Triage Pillar Corrected']
    );
    expect(patternUpdate).toBeDefined();
    prop = patternUpdate!.properties['Triage Pillar Corrected'];
    expect(prop).toEqual({
      rich_text: [{ text: { content: 'No' } }],
    });
    expect(prop).not.toHaveProperty('checkbox');
  });

  it('already-correct properties remain correct (Triage Intent = select)', async () => {
    await logAction({
      ...baseInput,
      triageIntent: 'capture',
    });

    const patternUpdate = notionUpdateCalls.find(
      c => c.properties['Triage Intent']
    );
    expect(patternUpdate).toBeDefined();
    expect(patternUpdate!.properties['Triage Intent']).toEqual({
      select: { name: 'capture' },
    });
  });

  it('already-correct properties remain correct (Triage Source = select)', async () => {
    await logAction({
      ...baseInput,
      triageSource: 'haiku',
    });

    const patternUpdate = notionUpdateCalls.find(
      c => c.properties['Triage Source']
    );
    expect(patternUpdate).toBeDefined();
    expect(patternUpdate!.properties['Triage Source']).toEqual({
      select: { name: 'haiku' },
    });
  });

  it('already-correct properties remain correct (Triage Title = rich_text)', async () => {
    await logAction({
      ...baseInput,
      triageTitle: 'AI Research Summary',
    });

    const patternUpdate = notionUpdateCalls.find(
      c => c.properties['Triage Title']
    );
    expect(patternUpdate).toBeDefined();
    expect(patternUpdate!.properties['Triage Title']).toEqual({
      rich_text: [{ text: { content: 'AI Research Summary' } }],
    });
  });

  it('full triage payload sends all 6 properties with correct types', async () => {
    await logAction({
      ...baseInput,
      triageIntent: 'command',
      triageComplexityTier: 1,
      triageSource: 'pattern_cache',
      triageSuggestedPillar: 'Consulting',
      triagePillarCorrected: false,
      triageTitle: 'Client follow-up',
    });

    const patternUpdate = notionUpdateCalls.find(
      c => c.properties['Triage Intent'] && c.properties['Triage Complexity']
    );
    expect(patternUpdate).toBeDefined();

    const p = patternUpdate!.properties;
    expect(p['Triage Intent']).toEqual({ select: { name: 'command' } });
    expect(p['Triage Complexity']).toEqual({ select: { name: 'Tier 1' } });
    expect(p['Triage Source']).toEqual({ select: { name: 'pattern_cache' } });
    expect(p['Triage Suggested Pillar']).toEqual({
      rich_text: [{ text: { content: 'Consulting' } }],
    });
    expect(p['Triage Pillar Corrected']).toEqual({
      rich_text: [{ text: { content: 'No' } }],
    });
    expect(p['Triage Title']).toEqual({
      rich_text: [{ text: { content: 'Client follow-up' } }],
    });
  });
});

// =============================================================================
// BUG 3: Telegram reaction emoji must be in supported set
// =============================================================================

describe('BUG 3: Telegram reaction emoji validity', () => {
  // Telegram Bot API supported reaction emoji (subset — the ones that matter)
  // Full list: https://core.telegram.org/bots/api#reactiontype
  const TELEGRAM_SUPPORTED_EMOJI = new Set([
    '👍', '👎', '❤', '🔥', '🥰', '👏', '😁', '🤔', '🤯', '😱',
    '🤬', '😢', '🎉', '🤩', '🤮', '💩', '🙏', '👌', '🕊', '🤡',
    '🥱', '🥴', '😍', '🐳', '❤‍🔥', '🌚', '🌭', '💯', '🤣', '⚡',
    '🍌', '🏆', '💔', '🤨', '😐', '🍓', '🍾', '💋', '🖕', '😈',
    '😴', '😭', '🤓', '👻', '👨‍💻', '👀', '🎃', '🙈', '😇', '😨',
    '🤝', '✍', '🤗', '🫡', '🎅', '🎄', '☃', '💅', '🤪', '🗿',
    '🆒', '💘', '🙉', '🦄', '😘', '💊', '🙊', '😎', '👾', '🤷',
    '🤷‍♂', '🤷‍♀', '😡',
  ]);

  // NOT supported (the ones we were sending before)
  const TELEGRAM_UNSUPPORTED_EMOJI = ['✅', '❌', '✨', '🔔', '📌'];

  it('all REACTIONS use Telegram-supported emoji', async () => {
    // Import handler module to read the REACTIONS constant
    // Since REACTIONS is a const, we read the source file and parse it
    const fs = await import('fs');
    const path = await import('path');
    const handlerSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'conversation', 'handler.ts'),
      'utf-8'
    );

    // Extract emoji from REACTIONS object
    const reactionsBlock = handlerSource.match(
      /const REACTIONS\s*=\s*\{([^}]+)\}/
    );
    expect(reactionsBlock).not.toBeNull();

    // Pull each emoji value
    const emojiMatches = reactionsBlock![1].matchAll(/'([^']+)'/g);
    const emojiUsed: string[] = [];
    for (const m of emojiMatches) {
      emojiUsed.push(m[1]);
    }

    expect(emojiUsed.length).toBeGreaterThanOrEqual(5); // READING, WORKING, DONE, CHAT, ERROR

    for (const emoji of emojiUsed) {
      expect(
        TELEGRAM_SUPPORTED_EMOJI.has(emoji)
      ).toBe(true);
    }
  });

  it('does NOT use known-unsupported emoji (✅ and ❌)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const handlerSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'conversation', 'handler.ts'),
      'utf-8'
    );

    for (const badEmoji of TELEGRAM_UNSUPPORTED_EMOJI) {
      // Should not appear in the REACTIONS definition
      const inReactions = handlerSource.includes(badEmoji);
      // It's OK if it appears in comments, but not as a value
      const reactionsBlock = handlerSource.match(
        /const REACTIONS\s*=\s*\{([^}]+)\}/
      );
      if (reactionsBlock) {
        expect(reactionsBlock[1]).not.toContain(badEmoji);
      }
    }
  });

  it('DONE reaction is 👌 (not ✅)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const handlerSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'conversation', 'handler.ts'),
      'utf-8'
    );

    const reactionsBlock = handlerSource.match(
      /const REACTIONS\s*=\s*\{([^}]+)\}/
    );
    expect(reactionsBlock).not.toBeNull();
    expect(reactionsBlock![1]).toContain("DONE: '👌'");
    expect(reactionsBlock![1]).not.toContain("DONE: '✅'");
  });

  it('ERROR reaction is 💔 (not ❌)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const handlerSource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'conversation', 'handler.ts'),
      'utf-8'
    );

    const reactionsBlock = handlerSource.match(
      /const REACTIONS\s*=\s*\{([^}]+)\}/
    );
    expect(reactionsBlock).not.toBeNull();
    expect(reactionsBlock![1]).toContain("ERROR: '💔'");
    expect(reactionsBlock![1]).not.toContain("ERROR: '❌'");
  });
});

// =============================================================================
// BUG 4: Hot-reload debounce — must coalesce rapid file changes
// =============================================================================

describe('BUG 4: Hot-reload debounce in SkillRegistry', () => {
  it('registry has reloadTimer property for debounce', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const registrySource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'skills', 'registry.ts'),
      'utf-8'
    );

    // Must have a reloadTimer property for debounce state
    expect(registrySource).toContain('reloadTimer');
    // Must use clearTimeout for debounce reset
    expect(registrySource).toContain('clearTimeout(this.reloadTimer)');
  });

  it('debounce timeout is >= 200ms (not 100ms which was too fast)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const registrySource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'skills', 'registry.ts'),
      'utf-8'
    );

    // Extract setTimeout delay from the enableHotReload method
    const hotReloadBlock = registrySource.match(
      /enableHotReload[\s\S]*?setTimeout\([\s\S]*?,\s*(\d+)\)/
    );
    expect(hotReloadBlock).not.toBeNull();

    const delayMs = parseInt(hotReloadBlock![1], 10);
    // Must be >= 200ms to coalesce rapid file events (was 100ms before)
    expect(delayMs).toBeGreaterThanOrEqual(200);
  });

  it('uses trailing-edge debounce pattern (clearTimeout before setTimeout)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const registrySource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'skills', 'registry.ts'),
      'utf-8'
    );

    // The debounce pattern: clearTimeout comes BEFORE setTimeout in the handler
    const watchCallback = registrySource.match(
      /watch\(this\.skillsDir[\s\S]*?\}\);/
    );
    expect(watchCallback).not.toBeNull();
    const callbackBody = watchCallback![0];

    const clearPos = callbackBody.indexOf('clearTimeout');
    const setPos = callbackBody.indexOf('setTimeout');

    // clearTimeout must appear before setTimeout (trailing-edge debounce)
    expect(clearPos).toBeGreaterThan(-1);
    expect(setPos).toBeGreaterThan(-1);
    expect(clearPos).toBeLessThan(setPos);
  });

  it('does NOT have per-event setTimeout (old bug pattern)', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const registrySource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'skills', 'registry.ts'),
      'utf-8'
    );

    // Old pattern had logger.info BEFORE setTimeout — each event logged individually
    // New pattern has NO logging before the debounce timer
    const watchCallback = registrySource.match(
      /watch\(this\.skillsDir[\s\S]*?clearTimeout/
    );
    expect(watchCallback).not.toBeNull();

    // Between the watch callback start and clearTimeout, there should be NO logger.info
    // (old code had: logger.info('Skill file changed, reloading...') before setTimeout)
    expect(watchCallback![0]).not.toContain("logger.info('Skill file changed");
  });

  it('resets timer to null after execution', async () => {
    const fs = await import('fs');
    const path = await import('path');
    const registrySource = fs.readFileSync(
      path.join(process.cwd(), 'src', 'skills', 'registry.ts'),
      'utf-8'
    );

    // Inside the setTimeout callback, timer should be set to null
    expect(registrySource).toContain('this.reloadTimer = null');
  });
});
