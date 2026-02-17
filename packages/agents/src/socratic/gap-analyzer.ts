/**
 * Gap Analyzer — Gap Detection + Question Selection
 *
 * Analyzes the confidence assessment to determine which gaps
 * to address, selects the highest-impact questions from the
 * Notion config, and returns them ordered by expected boost.
 */

import type {
  ConfidenceAssessment,
  ConfidenceRegime,
  SocraticConfig,
  SocraticConfigEntry,
  ContextSlot,
  Surface,
} from './types';

/** Which gaps should be addressed and how many questions to ask */
export interface GapAnalysis {
  /** The confidence regime driving question count */
  regime: ConfidenceRegime;
  /** How many questions to ask (0 for auto_draft, 1 for ask_one, 2 for ask_framing) */
  questionCount: number;
  /** Gaps to address, ordered by impact (highest-weight gap first) */
  targetGaps: Array<{
    slot: ContextSlot;
    gap: string;
    weight: number;
    /** The matching interview prompt entry (if found in config) */
    promptEntry: SocraticConfigEntry | null;
  }>;
}

/**
 * Map regime to maximum question count.
 */
function maxQuestionsForRegime(regime: ConfidenceRegime): number {
  switch (regime) {
    case 'auto_draft': return 0;
    case 'ask_one': return 1;
    case 'ask_framing': return 2;
  }
}

/**
 * Find the best matching interview prompt for a given slot and surface.
 * Matches by context slot presence and surface compatibility.
 * Returns the highest-priority (lowest number) match.
 */
function findPromptForSlot(
  config: SocraticConfig,
  slot: ContextSlot,
  surface: Surface,
  skill?: string
): SocraticConfigEntry | null {
  const candidates: SocraticConfigEntry[] = [];

  for (const entry of Object.values(config.interviewPrompts)) {
    // Must include this context slot
    if (!entry.contextSlots.includes(slot)) continue;

    // Must match surface
    const surfaceMatch = entry.surfaces.includes(surface) || entry.surfaces.includes('all');
    if (!surfaceMatch) continue;

    // Prefer skill-specific prompts
    if (skill && entry.skill && entry.skill !== skill) continue;

    candidates.push(entry);
  }

  if (candidates.length === 0) return null;

  // Sort by priority (lower = higher precedence), prefer skill-specific
  candidates.sort((a, b) => {
    // Skill-specific entries win over generic
    if (a.skill && !b.skill) return -1;
    if (!a.skill && b.skill) return 1;
    return a.priority - b.priority;
  });

  return candidates[0];
}

/**
 * Analyze gaps in the confidence assessment and determine which
 * questions to ask, matched against the Notion config.
 */
export function analyzeGaps(
  assessment: ConfidenceAssessment,
  config: SocraticConfig,
  surface: Surface,
  skill?: string
): GapAnalysis {
  const regime = assessment.regime;
  const questionCount = maxQuestionsForRegime(regime);

  if (questionCount === 0) {
    return { regime, questionCount: 0, targetGaps: [] };
  }

  // Take the top N gaps by weight, matching to available prompts
  const targetGaps: GapAnalysis['targetGaps'] = [];
  const usedSlots = new Set<ContextSlot>();

  for (const gap of assessment.topGaps) {
    if (targetGaps.length >= questionCount) break;

    // Don't ask two questions about the same slot
    if (usedSlots.has(gap.slot)) continue;

    const promptEntry = findPromptForSlot(config, gap.slot, surface, skill);
    targetGaps.push({
      slot: gap.slot,
      gap: gap.gap,
      weight: gap.weight,
      promptEntry,
    });
    usedSlots.add(gap.slot);
  }

  return { regime, questionCount, targetGaps };
}
