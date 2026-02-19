/**
 * Prompt Manager — Slug Sanitization Tests
 *
 * Verifies that sanitizeNotionId() strips Notion's auto-link formatting
 * from rich_text ID values. Notion auto-links TLDs like .consulting, .dev,
 * .studio, .agency, .app, .design, .systems — this corrupts slug IDs.
 *
 * Example corruption:
 *   "drafter.consulting.capture" → "[drafter.consulting](http://drafter.consulting).capture"
 *
 * Without sanitization, PM lookups silently fail (slug not found → null → fallback).
 */

import { describe, it, expect } from 'bun:test';
import { sanitizeNotionId } from '../src/services/prompt-manager';

describe('sanitizeNotionId', () => {
  describe('single-segment auto-link (one TLD)', () => {
    it('strips .consulting auto-link', () => {
      const mangled = '[drafter.consulting](http://drafter.consulting).capture';
      expect(sanitizeNotionId(mangled)).toBe('drafter.consulting.capture');
    });

    it('strips .dev auto-link', () => {
      const mangled = '[voice.dev](http://voice.dev).standard';
      expect(sanitizeNotionId(mangled)).toBe('voice.dev.standard');
    });

    it('strips .studio auto-link', () => {
      const mangled = '[research.studio](http://research.studio).deep';
      expect(sanitizeNotionId(mangled)).toBe('research.studio.deep');
    });

    it('strips .agency auto-link', () => {
      const mangled = '[drafter.agency](http://drafter.agency).draft';
      expect(sanitizeNotionId(mangled)).toBe('drafter.agency.draft');
    });

    it('strips .app auto-link', () => {
      const mangled = '[classifier.app](http://classifier.app).intent';
      expect(sanitizeNotionId(mangled)).toBe('classifier.app.intent');
    });

    it('strips .design auto-link', () => {
      const mangled = '[voice.design](http://voice.design).creative';
      expect(sanitizeNotionId(mangled)).toBe('voice.design.creative');
    });

    it('strips .systems auto-link', () => {
      const mangled = '[drafter.systems](http://drafter.systems).analysis';
      expect(sanitizeNotionId(mangled)).toBe('drafter.systems.analysis');
    });
  });

  describe('multi-segment auto-link (multiple TLDs in one ID)', () => {
    it('strips two auto-linked segments', () => {
      // Hypothetical: "drafter.consulting.dev" → both .consulting and .dev are TLDs
      const mangled =
        '[drafter.consulting](http://drafter.consulting).[research.dev](http://research.dev)';
      expect(sanitizeNotionId(mangled)).toBe('drafter.consulting.research.dev');
    });
  });

  describe('passthrough (no link markup)', () => {
    it('passes clean slugs unchanged', () => {
      expect(sanitizeNotionId('drafter.default.capture')).toBe(
        'drafter.default.capture'
      );
    });

    it('passes voice slugs unchanged', () => {
      expect(sanitizeNotionId('voice.grove-analytical')).toBe(
        'voice.grove-analytical'
      );
    });

    it('passes research-agent slugs unchanged', () => {
      expect(sanitizeNotionId('research-agent.standard')).toBe(
        'research-agent.standard'
      );
    });

    it('passes single-word IDs unchanged', () => {
      expect(sanitizeNotionId('system')).toBe('system');
    });

    it('passes empty string unchanged', () => {
      expect(sanitizeNotionId('')).toBe('');
    });
  });

  describe('https variant links', () => {
    it('strips https:// auto-links', () => {
      const mangled =
        '[drafter.consulting](https://drafter.consulting).capture';
      expect(sanitizeNotionId(mangled)).toBe('drafter.consulting.capture');
    });
  });

  describe('real-world Notion mangled IDs (from wiring audit)', () => {
    // These are the 6 mangled IDs found in the Feb 19, 2026 wiring audit
    it('fixes drafter.consulting.capture', () => {
      const mangled = '[drafter.consulting](http://drafter.consulting).capture';
      expect(sanitizeNotionId(mangled)).toBe('drafter.consulting.capture');
    });

    it('fixes drafter.consulting.draft', () => {
      const mangled = '[drafter.consulting](http://drafter.consulting).draft';
      expect(sanitizeNotionId(mangled)).toBe('drafter.consulting.draft');
    });

    it('fixes drafter.consulting.analysis', () => {
      const mangled =
        '[drafter.consulting](http://drafter.consulting).analysis';
      expect(sanitizeNotionId(mangled)).toBe('drafter.consulting.analysis');
    });

    it('fixes drafter.consulting.summarize', () => {
      const mangled =
        '[drafter.consulting](http://drafter.consulting).summarize';
      expect(sanitizeNotionId(mangled)).toBe('drafter.consulting.summarize');
    });

    it('fixes drafter.consulting.research', () => {
      const mangled =
        '[drafter.consulting](http://drafter.consulting).research';
      expect(sanitizeNotionId(mangled)).toBe('drafter.consulting.research');
    });

    it('fixes voice.consulting', () => {
      // This one is the entire slug, not just a prefix
      const mangled = '[voice.consulting](http://voice.consulting)';
      expect(sanitizeNotionId(mangled)).toBe('voice.consulting');
    });
  });

  describe('edge cases', () => {
    it('handles link with path segments in URL', () => {
      // Notion sometimes adds path segments
      const mangled =
        '[drafter.consulting](http://drafter.consulting/path/to/page).capture';
      expect(sanitizeNotionId(mangled)).toBe('drafter.consulting.capture');
    });

    it('handles link with query params in URL', () => {
      const mangled =
        '[drafter.consulting](http://drafter.consulting?ref=notion).capture';
      expect(sanitizeNotionId(mangled)).toBe('drafter.consulting.capture');
    });

    it('does not strip non-Notion markdown patterns', () => {
      // Regular markdown link should also be stripped (regex is general)
      const regular = '[click here](https://example.com)';
      expect(sanitizeNotionId(regular)).toBe('click here');
    });

    it('handles adjacent text without separator', () => {
      const mangled = 'prefix.[drafter.consulting](http://drafter.consulting)';
      expect(sanitizeNotionId(mangled)).toBe('prefix.drafter.consulting');
    });
  });
});
