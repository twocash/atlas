/**
 * claim-detector.test.ts — Sprint C: Sensitive Claims Detection
 *
 * Tests pattern-based detection of financial/medical/legal claims
 * in research output. Deterministic (no LLM), fast.
 */

import { describe, it, expect } from 'bun:test';
import { detectSensitiveClaims } from '../src/services/claim-detector';

// ─── Financial Claims ────────────────────────────────────

describe('financial claims', () => {
  it('detects investment recommendations', () => {
    const result = detectSensitiveClaims(
      'You should buy NVIDIA stock as it will reach $500 by Q3 2026.'
    );
    expect(result.flags).toContain('financial');
    expect(result.matchedPatterns.length).toBeGreaterThan(0);
  });

  it('detects price predictions', () => {
    const result = detectSensitiveClaims(
      'Bitcoin will reach $150,000 by end of year.'
    );
    expect(result.flags).toContain('financial');
  });

  it('detects guaranteed return claims', () => {
    const result = detectSensitiveClaims(
      'This investment guarantees a 20% annual return.'
    );
    expect(result.flags).toContain('financial');
  });

  it('detects tax advice', () => {
    const result = detectSensitiveClaims(
      'You should claim this as a tax deduction on your business income.'
    );
    expect(result.flags).toContain('financial');
  });
});

// ─── Medical Claims ──────────────────────────────────────

describe('medical claims', () => {
  it('detects dosage recommendations', () => {
    const result = detectSensitiveClaims(
      'You should take 200mg of aspirin daily for heart health.'
    );
    expect(result.flags).toContain('medical');
    expect(result.matchedPatterns.length).toBeGreaterThan(0);
  });

  it('detects diagnostic language', () => {
    const result = detectSensitiveClaims(
      'Your symptoms indicate you have type 2 diabetes.'
    );
    expect(result.flags).toContain('medical');
  });

  it('detects cure/prevention claims', () => {
    const result = detectSensitiveClaims(
      'Vitamin C can cure the common cold and prevent cancer.'
    );
    expect(result.flags).toContain('medical');
  });
});

// ─── Legal Claims ────────────────────────────────────────

describe('legal claims', () => {
  it('detects litigation advice', () => {
    const result = detectSensitiveClaims(
      'You have grounds to sue for breach of contract.'
    );
    expect(result.flags).toContain('legal');
    expect(result.matchedPatterns.length).toBeGreaterThan(0);
  });

  it('detects rights interpretation', () => {
    const result = detectSensitiveClaims(
      'Under the GDPR, you have the right to demand deletion of all your data.'
    );
    expect(result.flags).toContain('legal');
  });

  it('detects legal obligation claims', () => {
    const result = detectSensitiveClaims(
      'Your employer is legally required to provide 12 weeks of family leave.'
    );
    expect(result.flags).toContain('legal');
  });
});

// ─── No False Positives ──────────────────────────────────

describe('no false positives', () => {
  it('neutral tech research has no flags', () => {
    const result = detectSensitiveClaims(
      'OpenAI announced GPT-5 with improved reasoning capabilities. The model uses a mixture-of-experts architecture with 1.8 trillion parameters.'
    );
    expect(result.flags).toEqual([]);
  });

  it('general business news has no flags', () => {
    const result = detectSensitiveClaims(
      'Anthropic raised $2B in Series D funding. The company plans to expand its enterprise offerings.'
    );
    expect(result.flags).toEqual([]);
  });

  it('empty text returns empty flags', () => {
    const result = detectSensitiveClaims('');
    expect(result.flags).toEqual([]);
    expect(result.matchedPatterns).toEqual([]);
  });

  it('attributed claims are not flagged', () => {
    const result = detectSensitiveClaims(
      'According to Goldman Sachs, Bitcoin could reach $150,000 by 2026. ' +
      'Reported by Reuters, analysts recommend buying tech stocks.'
    );
    // These are reported/attributed, not Atlas making the claims
    expect(result.flags).toEqual([]);
  });
});

// ─── Multiple Categories ─────────────────────────────────

describe('multiple categories', () => {
  it('detects multiple flag categories on mixed content', () => {
    const result = detectSensitiveClaims(
      'You should invest $10,000 in this fund which guarantees 15% returns. ' +
      'Also, take 500mg of vitamin D daily. ' +
      'You have the right to sue your landlord for breach of lease.'
    );
    expect(result.flags).toContain('financial');
    expect(result.flags).toContain('medical');
    expect(result.flags).toContain('legal');
  });

  it('deduplicates flags', () => {
    const result = detectSensitiveClaims(
      'Buy NVIDIA stock. Sell Tesla shares. Invest in Bitcoin.'
    );
    // Should only have 'financial' once
    const financialCount = result.flags.filter(f => f === 'financial').length;
    expect(financialCount).toBe(1);
  });
});
