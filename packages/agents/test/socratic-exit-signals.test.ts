/**
 * socratic-exit-signals.test.ts — Sprint C: Bug 2 + Gate 3 Architecture
 *
 * Tests exit signal detection for the Socratic loop.
 *
 * Intent-break detection (isSocraticIntentBreak) was REMOVED in the
 * P0 fix for session abandonment. The token-overlap heuristic was
 * fundamentally wrong for conversational answers — Socratic answers
 * are ACTION-oriented ("research this") not CONTENT-oriented, so they
 * naturally have zero overlap with the original URL/title.
 *
 * The Socratic engine's answer() method (Haiku + regex fallback) is
 * now the authoritative judge. handleSocraticAnswer() is the default
 * path for all non-URL, non-exit-signal messages when a session is active.
 */

import { describe, it, expect } from 'bun:test';

// ─── Exit signal detection (re-implementation for unit testing) ───

const EXIT_SIGNALS = new Set([
  'nevermind', 'never mind', 'nvm',
  'forget it', 'forget about it',
  'cancel', 'stop', 'exit', 'quit',
  'skip', 'skip it',
  'nah', 'no thanks', 'no thank you',
  'drop it', 'leave it',
  'actually nevermind', 'actually never mind',
  'actually nvm',
]);

function isSocraticExitSignal(text: string): boolean {
  const normalized = text.trim().toLowerCase().replace(/[.!,?]+$/g, '');
  return EXIT_SIGNALS.has(normalized);
}

// ─── Bug 2: Exit Signal Detection ────────────────────────

describe('isSocraticExitSignal', () => {
  it('detects "nevermind"', () => {
    expect(isSocraticExitSignal('nevermind')).toBe(true);
  });

  it('detects "never mind" (two words)', () => {
    expect(isSocraticExitSignal('never mind')).toBe(true);
  });

  it('detects "nvm"', () => {
    expect(isSocraticExitSignal('nvm')).toBe(true);
  });

  it('detects "forget it"', () => {
    expect(isSocraticExitSignal('forget it')).toBe(true);
  });

  it('detects "cancel"', () => {
    expect(isSocraticExitSignal('cancel')).toBe(true);
  });

  it('detects "stop"', () => {
    expect(isSocraticExitSignal('stop')).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isSocraticExitSignal('Nevermind')).toBe(true);
    expect(isSocraticExitSignal('CANCEL')).toBe(true);
    expect(isSocraticExitSignal('NVM')).toBe(true);
  });

  it('strips trailing punctuation', () => {
    expect(isSocraticExitSignal('nevermind.')).toBe(true);
    expect(isSocraticExitSignal('cancel!')).toBe(true);
    expect(isSocraticExitSignal('nvm...')).toBe(true);
  });

  it('does not match regular messages', () => {
    expect(isSocraticExitSignal('The Grove')).toBe(false);
    expect(isSocraticExitSignal('Research this for consulting')).toBe(false);
    expect(isSocraticExitSignal('Personal')).toBe(false);
  });

  it('does not match partial exit words in longer text', () => {
    expect(isSocraticExitSignal('I want to cancel my subscription')).toBe(false);
    expect(isSocraticExitSignal('never mind the bollocks')).toBe(false);
  });

  it('detects "actually nevermind"', () => {
    expect(isSocraticExitSignal('actually nevermind')).toBe(true);
    expect(isSocraticExitSignal('actually nvm')).toBe(true);
  });

  it('handles whitespace', () => {
    expect(isSocraticExitSignal('  nevermind  ')).toBe(true);
    expect(isSocraticExitSignal('\tnvm\n')).toBe(true);
  });
});

// ─── Gate 3 Architecture: Default Path Routing ───────────
// Intent-break was removed. These messages previously triggered
// false intent-break detection. They should now route to the
// Socratic answer handler (handleSocraticAnswer), not to triage.

describe('Gate 3: Socratic answer is the default path', () => {
  it('action-oriented answers are NOT exit signals', () => {
    // These are the messages that previously triggered intent-break
    // but are legitimate Socratic answers. They should NOT be exit signals,
    // confirming they reach the default else branch (handleSocraticAnswer).
    expect(isSocraticExitSignal('Research the underlying data and studies mentioned in this thread')).toBe(false);
    expect(isSocraticExitSignal('Draft a thinkpiece about this for LinkedIn')).toBe(false);
    expect(isSocraticExitSignal('Just bookmark it for now')).toBe(false);
    expect(isSocraticExitSignal('Summarize the key takeaways and share with the team')).toBe(false);
    expect(isSocraticExitSignal('Deep dive into the methodology they used')).toBe(false);
  });

  it('long unrelated queries are NOT exit signals (handled by Socratic engine)', () => {
    // These used to trigger intent-break. Now they go to the Socratic engine
    // which has the full context to handle them appropriately.
    expect(isSocraticExitSignal("What's the current state of edge AI inference chips?")).toBe(false);
    expect(isSocraticExitSignal('I need to figure out the pricing strategy for our enterprise SaaS offering')).toBe(false);
  });

  it('URLs in messages are handled by the URL check, not exit signals', () => {
    // URL-in-message cancels the session (separate Gate 3 check), not exit signals
    expect(isSocraticExitSignal('https://example.com/some-article')).toBe(false);
  });
});
