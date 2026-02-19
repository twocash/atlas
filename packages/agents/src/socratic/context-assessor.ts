/**
 * Context Assessor — Signal → Confidence Scoring
 *
 * Evaluates raw context signals against weighted slots to produce
 * an overall confidence score and identify gaps. Zero Claude calls.
 *
 * Weight distribution (from Notion config):
 *   contact_data: 0.30
 *   content_signals: 0.25
 *   classification: 0.20
 *   bridge_context: 0.15
 *   skill_requirements: 0.10
 */

import type {
  ContextSignals,
  ContextSlot,
  SlotAssessment,
  ConfidenceAssessment,
  ConfidenceRegime,
} from './types';
import { CONTEXT_WEIGHTS } from './types';

// ==========================================
// Slot Assessors
// ==========================================

function assessContactData(signals: ContextSignals): SlotAssessment {
  const slot: ContextSlot = 'contact_data';
  const weight = CONTEXT_WEIGHTS[slot];
  const gaps: string[] = [];

  const data = signals.contactData;

  // URL content shares (articles, social media posts) don't require contact data.
  // Treat the slot as fully satisfied to avoid asking "who is this person?" for URLs.
  if (!data && signals.contentSignals?.hasUrl) {
    return { slot, weight, completeness: 1, contribution: weight, gaps: [] };
  }

  if (!data || !data.isKnown) {
    return { slot, weight, completeness: 0, contribution: 0, gaps: ['No contact data available'] };
  }

  let score = 0.4; // Base: contact is known
  if (data.name) score += 0.2;
  if (data.relationship) score += 0.2;
  if (data.recentActivity) score += 0.1;
  if (data.relationshipHistory) score += 0.1;

  if (!data.name) gaps.push('Contact name unknown');
  if (!data.relationship) gaps.push('Relationship type unknown');
  if (!data.recentActivity) gaps.push('No recent activity data');

  return { slot, weight, completeness: Math.min(score, 1), contribution: Math.min(score, 1) * weight, gaps };
}

function assessContentSignals(signals: ContextSignals): SlotAssessment {
  const slot: ContextSlot = 'content_signals';
  const weight = CONTEXT_WEIGHTS[slot];
  const gaps: string[] = [];

  const data = signals.contentSignals;
  if (!data) {
    return { slot, weight, completeness: 0, contribution: 0, gaps: ['No content signals available'] };
  }

  let score = 0;
  if (data.topic) score += 0.3;
  else gaps.push('Post topic not detected');

  if (data.sentiment) score += 0.2;
  if (data.hasUrl || data.url) score += 0.15;
  if (data.title) score += 0.2;
  if (data.contentLength && data.contentLength > 0) score += 0.15;

  return { slot, weight, completeness: Math.min(score, 1), contribution: Math.min(score, 1) * weight, gaps };
}

function assessClassification(signals: ContextSignals): SlotAssessment {
  const slot: ContextSlot = 'classification';
  const weight = CONTEXT_WEIGHTS[slot];
  const gaps: string[] = [];

  const data = signals.classification;
  if (!data) {
    return { slot, weight, completeness: 0, contribution: 0, gaps: ['No classification available'] };
  }

  let score = 0;
  if (data.intent) score += 0.3;
  else gaps.push('Intent not classified');

  if (data.pillar) score += 0.25;
  else gaps.push('Pillar not determined');

  if (data.confidence && data.confidence > 0.5) score += 0.2;
  if (data.depth) score += 0.15;
  if (data.audience) score += 0.1;

  return { slot, weight, completeness: Math.min(score, 1), contribution: Math.min(score, 1) * weight, gaps };
}

function assessBridgeContext(signals: ContextSignals): SlotAssessment {
  const slot: ContextSlot = 'bridge_context';
  const weight = CONTEXT_WEIGHTS[slot];
  const gaps: string[] = [];

  const data = signals.bridgeContext;

  // URL content shares don't need bridge context (no prior interaction to reference).
  // Same pattern as assessContactData — treat slot as fully satisfied for URLs.
  if (!data && signals.contentSignals?.hasUrl) {
    return { slot, weight, completeness: 1, contribution: weight, gaps: [] };
  }

  if (!data) {
    return { slot, weight, completeness: 0, contribution: 0, gaps: ['No bridge context available'] };
  }

  let score = 0;
  if (data.recentInteraction) score += 0.4;
  else gaps.push('No recent interaction data');

  if (data.lastTouchDate) score += 0.2;
  if (data.pendingFollowUp !== undefined) score += 0.2;
  if (data.notes) score += 0.2;

  return { slot, weight, completeness: Math.min(score, 1), contribution: Math.min(score, 1) * weight, gaps };
}

function assessSkillRequirements(signals: ContextSignals): SlotAssessment {
  const slot: ContextSlot = 'skill_requirements';
  const weight = CONTEXT_WEIGHTS[slot];
  const gaps: string[] = [];

  const data = signals.skillRequirements;
  if (!data) {
    // No skill-specific requirements = fully satisfied (default behavior)
    return { slot, weight, completeness: 1, contribution: weight, gaps: [] };
  }

  if (!data.requiredFields || data.requiredFields.length === 0) {
    return { slot, weight, completeness: 1, contribution: weight, gaps: [] };
  }

  const provided = new Set(data.providedFields || []);
  const missing = data.requiredFields.filter(f => !provided.has(f));

  if (missing.length === 0) {
    return { slot, weight, completeness: 1, contribution: weight, gaps: [] };
  }

  const completeness = 1 - (missing.length / data.requiredFields.length);
  for (const field of missing) {
    gaps.push(`Missing required field: ${field}`);
  }

  return { slot, weight, completeness, contribution: completeness * weight, gaps };
}

// ==========================================
// Main Assessment
// ==========================================

const SLOT_ASSESSORS: Record<ContextSlot, (signals: ContextSignals) => SlotAssessment> = {
  contact_data: assessContactData,
  content_signals: assessContentSignals,
  classification: assessClassification,
  bridge_context: assessBridgeContext,
  skill_requirements: assessSkillRequirements,
};

/**
 * Determine confidence regime from overall confidence score.
 */
function determineRegime(confidence: number): ConfidenceRegime {
  if (confidence >= 0.85) return 'auto_draft';
  if (confidence >= 0.5) return 'ask_one';
  return 'ask_framing';
}

/**
 * Assess context signals and produce a weighted confidence score.
 *
 * This is a pure computation — no API calls, no side effects.
 * Returns the assessment with per-slot breakdown and top gaps.
 */
export function assessContext(signals: ContextSignals, skipUrlCeiling = false): ConfidenceAssessment {
  const slots: SlotAssessment[] = [];

  for (const slot of Object.keys(CONTEXT_WEIGHTS) as ContextSlot[]) {
    const assessor = SLOT_ASSESSORS[slot];
    slots.push(assessor(signals));
  }

  // Sum weighted contributions
  let overallConfidence = slots.reduce((sum, s) => sum + s.contribution, 0);

  // URL shares: cap confidence at 0.84 so they always enter ask_one regime.
  // This forces the Socratic engine to ask "what's the play?" for every URL,
  // which is the designed UX — Jim always provides intent for shared links.
  const isUrlShare = signals.contentSignals?.hasUrl === true;
  if (!skipUrlCeiling && isUrlShare && overallConfidence >= 0.85) {
    overallConfidence = 0.84;
  }

  // Build top gaps sorted by weight (highest-weight gap first)
  const topGaps: Array<{ slot: ContextSlot; gap: string; weight: number }> = [];
  for (const assessment of slots) {
    for (const gap of assessment.gaps) {
      topGaps.push({ slot: assessment.slot, gap, weight: assessment.weight });
    }
  }
  topGaps.sort((a, b) => b.weight - a.weight);

  // URL shares: inject synthetic gap for user action intent if none exists.
  // Triage produces a classification intent (e.g. "capture"), but Jim's explicit
  // action (research / draft / capture) is never known until he's asked.
  // This ensures "What's the play?" is always generated for URL shares.
  if (!skipUrlCeiling && isUrlShare && !topGaps.some(g => g.slot === 'content_signals')) {
    topGaps.unshift({
      slot: 'content_signals',
      gap: 'URL intent not specified by user',
      weight: CONTEXT_WEIGHTS['content_signals'],
    });
  }

  return {
    overallConfidence: Math.min(overallConfidence, 1),
    regime: determineRegime(overallConfidence),
    slots,
    topGaps,
  };
}

/**
 * Re-assess after incorporating an answer.
 * Merges the new signal data into existing signals and re-scores.
 */
export function reassessWithAnswer(
  existingSignals: ContextSignals,
  slotUpdate: Partial<ContextSignals>
): ConfidenceAssessment {
  const merged: ContextSignals = {
    contactData: { ...existingSignals.contactData, ...slotUpdate.contactData } as any,
    contentSignals: { ...existingSignals.contentSignals, ...slotUpdate.contentSignals } as any,
    classification: { ...existingSignals.classification, ...slotUpdate.classification } as any,
    bridgeContext: { ...existingSignals.bridgeContext, ...slotUpdate.bridgeContext } as any,
    skillRequirements: { ...existingSignals.skillRequirements, ...slotUpdate.skillRequirements } as any,
  };

  return assessContext(merged);
}
