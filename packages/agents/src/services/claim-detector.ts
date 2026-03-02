/**
 * Sensitive Claims Detection — Sprint C
 *
 * Pattern-based detection for financial, medical, and legal claims.
 * Deterministic, fast, no LLM calls. Flags content that should trigger
 * confidence downgrades through the Andon Gate.
 *
 * Design: Detects claims Atlas is MAKING, not claims being quoted/cited.
 * "Stock XYZ will reach $500" → flagged (Atlas presenting as fact)
 * "According to Bloomberg, stock XYZ..." → not flagged (attributed)
 */

export interface ClaimDetectionResult {
  /** Detected claim categories */
  flags: string[];
  /** Human-readable descriptions of what triggered */
  matchedPatterns: string[];
}

// ─── Pattern Definitions ─────────────────────────────────

const ATTRIBUTION_PREFIX = /(?:according to|reported by|per|citing|as stated by|source:|via)\s/i;

const FINANCIAL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\b(?:invest|put money|allocate funds?)\s+(?:in|into)\b/i, description: 'Investment recommendation' },
  { pattern: /\bshould\s+(?:buy|sell|hold|short)\b/i, description: 'Trading advice' },
  { pattern: /\bwill\s+(?:reach|hit|exceed|surpass)\s+\$[\d,.]+/i, description: 'Price prediction' },
  { pattern: /\bworth\s+\$[\d,.]+\s+(?:by|in|within)\b/i, description: 'Valuation forecast' },
  { pattern: /\bguarantee[sd]?\s+(?:a\s+)?(?:\d+%?\s+)?(?:return|profit|gain|annual)/i, description: 'Guaranteed return claim' },
  { pattern: /\byou\s+(?:should|could|can)\s+(?:save|earn|make)\s+\$[\d,.]+/i, description: 'Earnings projection' },
  { pattern: /\btax\s+(?:deduct|write.?off|shelter|avoid)/i, description: 'Tax advice' },
];

const MEDICAL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\b(?:take|prescribe|recommend)\s+\d+\s*(?:mg|ml|mcg|iu)\b/i, description: 'Dosage recommendation' },
  { pattern: /\byou\s+(?:have|suffer from|are diagnosed with)\s+(?:type\s+\d|diabetes|cancer|hypertension|depression|anxiety|adhd|asthma|arthritis)/i, description: 'Diagnostic claim' },
  { pattern: /\b(?:will|can|could)\s+(?:cure|treat|heal|prevent)\s+(?:the\s+)?(?:common\s+)?(?:cold|cancer|disease|illness|infection|condition)/i, description: 'Cure/prevention claim' },
  { pattern: /\bshould\s+(?:stop|start|change)\s+(?:taking|your\s+(?:medication|treatment))/i, description: 'Treatment modification advice' },
  { pattern: /\bsymptoms?\s+(?:indicate|suggest|mean)\s+(?:you|that)\b/i, description: 'Symptom interpretation' },
];

const LEGAL_PATTERNS: Array<{ pattern: RegExp; description: string }> = [
  { pattern: /\b(?:you\s+(?:should|can|could)\s+(?:sue|file\s+a\s+(?:claim|lawsuit|complaint))|(?:have\s+)?grounds?\s+to\s+sue)/i, description: 'Litigation advice' },
  { pattern: /\b(?:your\s+(?:legal\s+)?rights?\s+(?:include|allow|entitle)|you\s+have\s+the\s+right\s+to)/i, description: 'Rights interpretation' },
  { pattern: /\blegally\s+(?:required|obligated|entitled)\s+to\b/i, description: 'Legal obligation claim' },
  { pattern: /\b(?:constitutes|amounts to)\s+(?:breach|fraud|negligence|malpractice)/i, description: 'Legal characterization' },
  { pattern: /\byou\s+(?:should|must)\s+(?:consult|hire|retain)\s+(?:a|an)\s+(?:lawyer|attorney)/i, description: 'Legal representation advice' },
];

// ─── Detection ───────────────────────────────────────────

/**
 * Detect sensitive claims in text.
 * Returns empty flags for most research (neutral content, attributed claims).
 */
export function detectSensitiveClaims(text: string): ClaimDetectionResult {
  if (!text || text.trim().length === 0) {
    return { flags: [], matchedPatterns: [] };
  }

  const flags = new Set<string>();
  const matchedPatterns: string[] = [];

  // Split into sentences for attribution checking
  const sentences = text.split(/[.!?]\s+/);

  for (const sentence of sentences) {
    // Skip sentences that begin with attribution (quoted/cited claims)
    if (ATTRIBUTION_PREFIX.test(sentence.trim())) continue;

    for (const { pattern, description } of FINANCIAL_PATTERNS) {
      if (pattern.test(sentence)) {
        flags.add('financial');
        matchedPatterns.push(description);
      }
    }

    for (const { pattern, description } of MEDICAL_PATTERNS) {
      if (pattern.test(sentence)) {
        flags.add('medical');
        matchedPatterns.push(description);
      }
    }

    for (const { pattern, description } of LEGAL_PATTERNS) {
      if (pattern.test(sentence)) {
        flags.add('legal');
        matchedPatterns.push(description);
      }
    }
  }

  return {
    flags: [...flags],
    matchedPatterns: [...new Set(matchedPatterns)],
  };
}
