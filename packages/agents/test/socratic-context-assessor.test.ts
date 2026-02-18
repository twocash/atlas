/**
 * Context Assessor Tests
 *
 * Validates weighted confidence scoring across all 5 context slots.
 * Pure computation — no mocks needed.
 */

import { describe, it, expect } from 'bun:test';
import { assessContext, reassessWithAnswer } from '../src/socratic/context-assessor';
import { CONTEXT_WEIGHTS } from '../src/socratic/types';
import type { ContextSignals } from '../src/socratic/types';

describe('Context Assessor', () => {
  describe('Weight validation', () => {
    it('weights sum to 1.0', () => {
      const sum = Object.values(CONTEXT_WEIGHTS).reduce((a, b) => a + b, 0);
      expect(Math.abs(sum - 1.0)).toBeLessThan(0.001);
    });

    it('contact_data has highest weight (0.30)', () => {
      expect(CONTEXT_WEIGHTS.contact_data).toBe(0.30);
    });

    it('skill_requirements has lowest weight (0.10)', () => {
      expect(CONTEXT_WEIGHTS.skill_requirements).toBe(0.10);
    });
  });

  describe('Empty signals → low confidence', () => {
    it('returns 0.10 for completely empty signals (skill_requirements defaults to 1.0)', () => {
      const result = assessContext({});
      // Only skill_requirements contributes (defaults to satisfied = 1.0 * 0.10)
      expect(result.overallConfidence).toBeCloseTo(0.10, 1);
      expect(result.regime).toBe('ask_framing');
    });

    it('has gaps for all content-dependent slots', () => {
      const result = assessContext({});
      expect(result.topGaps.length).toBeGreaterThan(0);

      const gapSlots = result.topGaps.map(g => g.slot);
      expect(gapSlots).toContain('contact_data');
      expect(gapSlots).toContain('content_signals');
      expect(gapSlots).toContain('classification');
      expect(gapSlots).toContain('bridge_context');
    });
  });

  describe('Full signals → high confidence', () => {
    const fullSignals: ContextSignals = {
      contactData: {
        name: 'Jane Smith',
        relationship: 'close colleague',
        recentActivity: 'Posted about AI trends yesterday',
        relationshipHistory: '3 years of collaboration',
        isKnown: true,
      },
      contentSignals: {
        topic: 'AI governance',
        sentiment: 'positive',
        contentLength: 1500,
        hasUrl: true,
        title: 'The Future of AI Governance',
        url: 'https://example.com/ai-governance',
      },
      classification: {
        intent: 'engage',
        pillar: 'The Grove',
        confidence: 0.9,
        depth: 'deep',
        audience: 'public',
      },
      bridgeContext: {
        recentInteraction: 'Discussed AI ethics last week',
        lastTouchDate: '2026-02-10',
        pendingFollowUp: true,
        notes: 'Interested in collaboration',
      },
      skillRequirements: {
        skill: 'linkedin-reply',
        requiredFields: ['intent', 'depth'],
        providedFields: ['intent', 'depth'],
      },
    };

    it('returns high confidence (>= 0.85) for full signals', () => {
      const result = assessContext(fullSignals);
      expect(result.overallConfidence).toBeGreaterThanOrEqual(0.85);
      expect(result.regime).toBe('auto_draft');
    });

    it('has no gaps for full signals', () => {
      const result = assessContext(fullSignals);
      expect(result.topGaps.length).toBe(0);
    });

    it('all slots have positive contribution', () => {
      const result = assessContext(fullSignals);
      for (const slot of result.slots) {
        expect(slot.contribution).toBeGreaterThan(0);
      }
    });
  });

  describe('Partial signals → medium confidence', () => {
    it('contact + content without classification → ask_one', () => {
      const signals: ContextSignals = {
        contactData: {
          name: 'John',
          relationship: 'colleague',
          isKnown: true,
        },
        contentSignals: {
          topic: 'leadership',
          title: 'Leadership in Tech',
        },
      };

      const result = assessContext(signals);
      expect(result.overallConfidence).toBeGreaterThan(0.3);
      expect(result.overallConfidence).toBeLessThan(0.85);
      // Should have classification in the gaps
      const gapSlots = result.topGaps.map(g => g.slot);
      expect(gapSlots).toContain('classification');
    });

    it('classification only → ask_framing (low confidence)', () => {
      const signals: ContextSignals = {
        classification: {
          intent: 'research',
          pillar: 'The Grove',
          confidence: 0.8,
        },
      };

      const result = assessContext(signals);
      // classification (0.20 * ~0.75) + skill_requirements (0.10 * 1.0) = ~0.25
      expect(result.overallConfidence).toBeLessThan(0.5);
      expect(result.regime).toBe('ask_framing');
    });
  });

  describe('Regime determination', () => {
    it('auto_draft for confidence >= 0.85', () => {
      const result = assessContext({
        contactData: { name: 'A', relationship: 'B', recentActivity: 'C', relationshipHistory: 'D', isKnown: true },
        contentSignals: { topic: 'A', sentiment: 'B', contentLength: 100, hasUrl: true, title: 'T' },
        classification: { intent: 'engage', pillar: 'The Grove', confidence: 0.9, depth: 'deep', audience: 'public' },
        bridgeContext: { recentInteraction: 'A', lastTouchDate: 'B', pendingFollowUp: true, notes: 'C' },
      });
      expect(result.regime).toBe('auto_draft');
    });

    it('ask_framing for confidence < 0.5', () => {
      const result = assessContext({});
      expect(result.regime).toBe('ask_framing');
    });
  });

  describe('Gap ordering', () => {
    it('top gaps sorted by weight (highest first)', () => {
      const result = assessContext({});

      for (let i = 1; i < result.topGaps.length; i++) {
        expect(result.topGaps[i].weight).toBeLessThanOrEqual(result.topGaps[i - 1].weight);
      }
    });
  });

  describe('URL content shares → contact_data N/A (P0 regression)', () => {
    it('URL share without contact data: contact_data slot fully satisfied', () => {
      const signals: ContextSignals = {
        contentSignals: {
          topic: 'AI agents',
          title: 'Thread about AI agents',
          hasUrl: true,
          url: 'https://www.threads.com/@omarsar0/post/DUgDaW0EXaP',
          contentLength: 200,
        },
      };

      const result = assessContext(signals);
      const contactSlot = result.slots.find(s => s.slot === 'contact_data');

      // Contact data should be treated as N/A (not a gap) for URL shares
      expect(contactSlot!.completeness).toBe(1);
      expect(contactSlot!.gaps.length).toBe(0);
    });

    it('URL share: contact_data NOT in top gaps', () => {
      const signals: ContextSignals = {
        contentSignals: {
          topic: 'AI trends',
          hasUrl: true,
          url: 'https://www.threads.com/@test/post/ABC123',
        },
      };

      const result = assessContext(signals);
      const gapSlots = result.topGaps.map(g => g.slot);

      // contact_data should NOT appear as a gap for URL content
      expect(gapSlots).not.toContain('contact_data');
    });

    it('URL share with classification: higher confidence than without URL fix', () => {
      const signals: ContextSignals = {
        contentSignals: {
          topic: 'AI governance',
          hasUrl: true,
          url: 'https://twitter.com/karpathy/status/123',
          title: 'AI Governance Thread',
        },
        classification: {
          intent: 'capture',
          pillar: 'The Grove',
          confidence: 0.8,
        },
      };

      const result = assessContext(signals);
      // With contact_data N/A (0.30 contributed), content (0.25 partial),
      // classification (0.20 partial), skill_req (0.10 default) → should be >0.5
      expect(result.overallConfidence).toBeGreaterThan(0.5);
    });

    it('non-URL text without contact data: contact_data IS a gap (unchanged behavior)', () => {
      const signals: ContextSignals = {
        contentSignals: {
          topic: 'Random thought',
          title: 'Idea about something',
        },
      };

      const result = assessContext(signals);
      const gapSlots = result.topGaps.map(g => g.slot);

      // Non-URL content should still flag missing contact data
      expect(gapSlots).toContain('contact_data');
    });

    it('URL share WITH known contact: normal contact scoring (not overridden)', () => {
      const signals: ContextSignals = {
        contactData: {
          name: 'Jane Smith',
          relationship: 'colleague',
          isKnown: true,
        },
        contentSignals: {
          topic: 'AI trends',
          hasUrl: true,
          url: 'https://linkedin.com/posts/janesmith',
        },
      };

      const result = assessContext(signals);
      const contactSlot = result.slots.find(s => s.slot === 'contact_data');

      // When contact data IS provided, normal scoring applies
      expect(contactSlot!.completeness).toBeGreaterThan(0);
      expect(contactSlot!.completeness).toBeLessThan(1);
    });
  });

  describe('reassessWithAnswer', () => {
    it('incorporates new contact data and increases confidence', () => {
      const original = assessContext({});
      const updated = reassessWithAnswer({}, {
        contactData: {
          name: 'Jane',
          relationship: 'colleague',
          isKnown: true,
        },
      });

      expect(updated.overallConfidence).toBeGreaterThan(original.overallConfidence);
    });

    it('merges with existing signals', () => {
      const existing: ContextSignals = {
        contentSignals: { topic: 'AI' },
      };
      const original = assessContext(existing);
      const updated = reassessWithAnswer(existing, {
        classification: {
          intent: 'research',
          pillar: 'The Grove',
          confidence: 0.9,
        },
      });

      expect(updated.overallConfidence).toBeGreaterThan(original.overallConfidence);
    });
  });
});
