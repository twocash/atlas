/**
 * Regression: Self-improvement listener must exclude terminal Action Status values.
 * Bug: https://www.notion.so/30d780a78eef81e3a3bfc5a8531ed15b
 *
 * Without this filter, Dismissed/Actioned/Expired entries re-enter the polling
 * loop on every ~60s cycle — wasting API calls and creating log noise.
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'path';

const LISTENER = join(__dirname, '../src/listeners/self-improvement.ts');

describe('self-improvement listener: terminal status exclusion', () => {
  it('filters out Dismissed entries at query level', async () => {
    const src = await Bun.file(LISTENER).text();
    expect(src).toContain("does_not_equal: 'Dismissed'");
  });

  it('filters out Actioned entries at query level', async () => {
    const src = await Bun.file(LISTENER).text();
    expect(src).toContain("does_not_equal: 'Actioned'");
  });

  it('filters out Expired entries at query level', async () => {
    const src = await Bun.file(LISTENER).text();
    expect(src).toContain("does_not_equal: 'Expired'");
  });

  it('filters on Action Status property (not Status)', async () => {
    const src = await Bun.file(LISTENER).text();
    // Ensure the terminal filters use 'Action Status', not 'Status'
    const dismissedIdx = src.indexOf("does_not_equal: 'Dismissed'");
    const region = src.substring(Math.max(0, dismissedIdx - 100), dismissedIdx);
    expect(region).toContain("'Action Status'");
  });
});
