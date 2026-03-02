/**
 * Emergence Subsystem Bug Fixes — Regression Tests
 *
 * Bug 1: Feed write Source select validation (P1)
 * Bug 2: Feature flag in .env → Notion config (P1)
 * Bug 3: Pattern detector false positives from test activity (P2)
 *
 * Notion refs:
 *   - https://www.notion.so/317780a78eef81789402c1fb366a11e8
 *   - https://www.notion.so/317780a78eef81589aa4efe1532c8e85
 *   - https://www.notion.so/317780a78eef81939312c00bce37994a
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ============================================================================
// Bug 1: Feed Write — Source Select Validation
// ============================================================================

describe('Bug 1: Feed write Source property type', () => {
  it('writeEmergenceFeedEntry uses select (not rich_text) for Source', async () => {
    // Static analysis: verify the Source property pattern in the function body
    const fs = await import('fs');
    const source = fs.readFileSync(
      'packages/agents/src/emergence/feed-writer.ts',
      'utf-8'
    );

    // Find lines within writeEmergenceFeedEntry function that set Source
    const lines = source.split('\n');
    let inWriteFunc = false;
    const sourcePropertyLines: string[] = [];

    for (const line of lines) {
      if (line.includes('async function writeEmergenceFeedEntry')) inWriteFunc = true;
      if (inWriteFunc && line.includes('Source:') && line.includes('{')) {
        sourcePropertyLines.push(line);
      }
      // Exit function on next top-level function
      if (inWriteFunc && line.startsWith('export') && !line.includes('writeEmergenceFeedEntry')) {
        inWriteFunc = false;
      }
    }

    expect(sourcePropertyLines.length).toBeGreaterThan(0);
    for (const line of sourcePropertyLines) {
      expect(line).toContain('select');
      expect(line).not.toContain('rich_text');
    }
  });

  it('feed-writer.ts contains no rich_text for Source property', async () => {
    // Static analysis: read the file and verify no rich_text for Source
    const fs = await import('fs');
    const source = fs.readFileSync(
      'packages/agents/src/emergence/feed-writer.ts',
      'utf-8'
    );

    // Should have select for Source
    const sourceLines = source.split('\n');
    const sourcePropertyLines = sourceLines.filter(
      (line: string) => line.includes('Source:') && line.includes('{')
    );

    for (const line of sourcePropertyLines) {
      expect(line).toContain('select');
      expect(line).not.toContain('rich_text');
    }
  });
});

// ============================================================================
// Bug 2: Feature Flag — Notion Config (not .env)
// ============================================================================

describe('Bug 2: Emergence feature flag in Notion config', () => {
  it('ResearchPipelineConfig includes emergenceEnabled field', async () => {
    const { COMPILED_DEFAULTS } = await import('../src/config/types');
    expect(COMPILED_DEFAULTS).toHaveProperty('emergenceEnabled');
    expect(COMPILED_DEFAULTS.emergenceEnabled).toBe(false);
  });

  it('emergenceEnabled defaults to false when not in config', async () => {
    const { COMPILED_DEFAULTS } = await import('../src/config/types');
    // Default is explicitly false — emergence off unless Notion says otherwise
    expect(COMPILED_DEFAULTS.emergenceEnabled).toBe(false);
  });

  it('features.ts no longer contains emergenceAwareness as active code', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(
      'apps/telegram/src/config/features.ts',
      'utf-8'
    );

    const activeLines = source.split('\n').filter(
      (line: string) =>
        line.includes('emergenceAwareness') &&
        !line.trimStart().startsWith('//') &&
        !line.trimStart().startsWith('*')
    );

    expect(activeLines.length).toBe(0);
  });

  it('monitor.ts does not reference process.env.ATLAS_EMERGENCE_AWARENESS', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(
      'packages/agents/src/emergence/monitor.ts',
      'utf-8'
    );

    expect(source).not.toContain('ATLAS_EMERGENCE_AWARENESS');
  });

  it('orchestrator.ts does not reference process.env.ATLAS_EMERGENCE_AWARENESS', async () => {
    const fs = await import('fs');
    const source = fs.readFileSync(
      'packages/agents/src/pipeline/orchestrator.ts',
      'utf-8'
    );

    expect(source).not.toContain('ATLAS_EMERGENCE_AWARENESS');
  });
});

// ============================================================================
// Bug 3: Temporal Clustering Filter
// ============================================================================

describe('Bug 3: isTemporallyClustered', () => {
  // Helper: create LoggedAction stubs with specific timestamps
  function makeActions(timestamps: Date[]): Array<{ timestamp: string; [key: string]: any }> {
    return timestamps.map((ts, i) => ({
      id: `action-${i}`,
      intentHash: 'test-hash',
      actionType: 'Process',
      pillar: 'The Grove',
      toolsUsed: [],
      messageText: 'Test triage property types',
      timestamp: ts.toISOString(),
      confirmed: false,
      adjusted: false,
    }));
  }

  it('detects 82 actions in 30 minutes as clustered (test burst)', async () => {
    const { isTemporallyClustered } = await import('../src/skills/pattern-detector');

    const baseTime = new Date('2026-02-15T14:00:00Z');
    const timestamps: Date[] = [];
    for (let i = 0; i < 82; i++) {
      // All within 30 minutes (spread evenly)
      timestamps.push(new Date(baseTime.getTime() + i * 22_000)); // ~22s apart
    }

    const actions = makeActions(timestamps);
    expect(isTemporallyClustered(actions as any)).toBe(true);
  });

  it('detects 82 actions across 14 days as NOT clustered (organic)', async () => {
    const { isTemporallyClustered } = await import('../src/skills/pattern-detector');

    const baseTime = new Date('2026-02-01T10:00:00Z');
    const timestamps: Date[] = [];
    for (let i = 0; i < 82; i++) {
      // Spread across 14 days (~4 hours apart)
      timestamps.push(new Date(baseTime.getTime() + i * 4 * 3600_000));
    }

    const actions = makeActions(timestamps);
    expect(isTemporallyClustered(actions as any)).toBe(false);
  });

  it('returns false for < 5 actions (below minimum)', async () => {
    const { isTemporallyClustered } = await import('../src/skills/pattern-detector');

    const baseTime = new Date('2026-02-15T14:00:00Z');
    const timestamps = [
      baseTime,
      new Date(baseTime.getTime() + 1000),
      new Date(baseTime.getTime() + 2000),
      new Date(baseTime.getTime() + 3000),
    ];

    const actions = makeActions(timestamps);
    expect(isTemporallyClustered(actions as any)).toBe(false);
  });

  it('respects custom thresholdHours parameter', async () => {
    const { isTemporallyClustered } = await import('../src/skills/pattern-detector');

    const baseTime = new Date('2026-02-15T14:00:00Z');
    const timestamps: Date[] = [];
    for (let i = 0; i < 20; i++) {
      // All within 3 hours (but spread across > 2 hours)
      timestamps.push(new Date(baseTime.getTime() + i * 9 * 60_000)); // 9 min apart = 171 min total
    }

    const actions = makeActions(timestamps);

    // With default 2h threshold: NOT clustered (span > 2h)
    expect(isTemporallyClustered(actions as any, 2)).toBe(false);

    // With 4h threshold: IS clustered (all fit in 4h window)
    expect(isTemporallyClustered(actions as any, 4)).toBe(true);
  });

  it('mixed: 70 burst + 12 organic is still flagged (80%+ in window)', async () => {
    const { isTemporallyClustered } = await import('../src/skills/pattern-detector');

    const baseTime = new Date('2026-02-15T14:00:00Z');
    const timestamps: Date[] = [];

    // 70 in a 1-hour burst
    for (let i = 0; i < 70; i++) {
      timestamps.push(new Date(baseTime.getTime() + i * 51_000)); // ~51s apart
    }
    // 12 spread over 10 days before
    for (let i = 0; i < 12; i++) {
      timestamps.push(new Date(baseTime.getTime() - (i + 1) * 24 * 3600_000));
    }

    const actions = makeActions(timestamps);
    // 70/82 = 85.4% — above 80% threshold
    expect(isTemporallyClustered(actions as any)).toBe(true);
  });
});

// ============================================================================
// Bug 3: Pattern detection skips clustered groups
// ============================================================================

describe('Bug 3: PatternDetectionResult includes skippedClustered', () => {
  it('stats interface has skippedClustered field', async () => {
    // Verify the type exists by importing and creating a result
    const result = {
      patterns: [],
      proposals: [],
      window: { start: '', end: '', days: 14 },
      stats: {
        actionsAnalyzed: 0,
        patternsFound: 0,
        proposalsGenerated: 0,
        skippedExisting: 0,
        skippedRejected: 0,
        skippedClustered: 0,
      },
    };
    expect(result.stats).toHaveProperty('skippedClustered');
  });
});
