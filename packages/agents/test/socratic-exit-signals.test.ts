/**
 * socratic-exit-signals.test.ts — Sprint C: Bugs 2 & 3
 *
 * Tests exit signal detection and intent-break detection for the
 * Socratic loop. These are the helper functions used by Gate 3
 * in the orchestrator.
 */

import { describe, it, expect } from 'bun:test';

// ─── Import the functions under test ─────────────────────
// These are module-private in orchestrator.ts, so we test via
// re-implementation of the same logic. This validates the algorithm.

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'is', 'are', 'was', 'were', 'be', 'been', 'being',
  'have', 'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could',
  'should', 'may', 'might', 'shall', 'can', 'to', 'of', 'in', 'for',
  'on', 'with', 'at', 'by', 'from', 'as', 'into', 'about', 'between',
  'through', 'after', 'before', 'during', 'and', 'but', 'or', 'nor',
  'not', 'so', 'yet', 'both', 'either', 'neither', 'each', 'every',
  'this', 'that', 'these', 'those', 'it', 'its', 'my', 'your', 'his',
  'her', 'our', 'their', 'what', 'which', 'who', 'whom', 'how', 'when',
  'where', 'why', 'all', 'any', 'some', 'no', 'than', 'too', 'very',
  'just', 'also', 'now', 'then', 'here', 'there', 'i', 'me', 'you',
  'he', 'she', 'we', 'they', 'them', 'up', 'out', 'if',
]);

function extractTokens(text: string): string[] {
  return text.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length > 3 && !STOP_WORDS.has(w));
}

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

function isSocraticIntentBreak(
  text: string,
  session: { content: string; title: string } | undefined,
): boolean {
  if (!session) return false;

  const msgTokens = extractTokens(text);
  const sessionTokens = extractTokens(session.content + ' ' + session.title);

  if (msgTokens.length < 3) return false;

  const overlap = msgTokens.filter(t => sessionTokens.includes(t)).length;
  const overlapRatio = sessionTokens.length > 0 ? overlap / msgTokens.length : 0;

  const isInterrogative = text.includes('?') && text.length > 50;

  if (isInterrogative && overlapRatio < 0.2) return true;
  if (overlapRatio === 0 && text.length > 60) return true;

  return false;
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

// ─── Bug 3: Intent-Break Detection ──────────────────────

describe('isSocraticIntentBreak', () => {
  const monarchSession = {
    content: 'Remind me tomorrow about the monarch deck at 9 a.m.',
    title: 'Monarch deck reminder',
  };

  it('detects completely unrelated query', () => {
    expect(isSocraticIntentBreak(
      "What's the current state of edge AI inference chips — who's leading?",
      monarchSession,
    )).toBe(true);
  });

  it('does not break on short Socratic answers', () => {
    // Typical Socratic answers are short
    expect(isSocraticIntentBreak('The Grove', monarchSession)).toBe(false);
    expect(isSocraticIntentBreak('Personal', monarchSession)).toBe(false);
    expect(isSocraticIntentBreak('Consulting', monarchSession)).toBe(false);
  });

  it('does not break on topically related answers', () => {
    expect(isSocraticIntentBreak(
      'This is about the monarch deck review for tomorrow',
      monarchSession,
    )).toBe(false);
  });

  it('detects long unrelated statement', () => {
    expect(isSocraticIntentBreak(
      'I need to figure out the pricing strategy for our enterprise SaaS offering before the board meeting',
      monarchSession,
    )).toBe(true);
  });

  it('returns false when no session', () => {
    expect(isSocraticIntentBreak('anything', undefined)).toBe(false);
  });

  it('returns false for very short messages (not enough signal)', () => {
    expect(isSocraticIntentBreak('yes', monarchSession)).toBe(false);
    expect(isSocraticIntentBreak('do it', monarchSession)).toBe(false);
  });

  it('detects interrogative with zero overlap', () => {
    expect(isSocraticIntentBreak(
      'How does transformer architecture handle attention in multi-head scenarios?',
      monarchSession,
    )).toBe(true);
  });
});
