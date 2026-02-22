/**
 * Research Prompt V2 — Structured Context Composition
 *
 * Builds research prompts with POV context, evidence requirements,
 * and quality floor sections. Augments the base prompt from
 * buildResearchPrompt() with structured V2 sections.
 *
 * Sprint: ATLAS-RESEARCH-INTEL-001
 */

import type {
  ResearchConfigV2,
  EvidenceRequirements,
  POVContext,
  QualityFloor,
} from '../types/research-v2';

// ─── Section Builders ───────────────────────────────────

/**
 * Build the Analytical Lens section from POV context.
 * Shapes how the research agent frames its findings.
 */
function buildPOVSection(pov: POVContext): string {
  const parts: string[] = [
    `## Analytical Lens: ${pov.title}`,
    '',
    `**Frame findings through this lens:** ${pov.coreThesis}`,
  ];

  if (pov.evidenceStandards) {
    parts.push(`\n**Prioritize evidence of this type:** ${pov.evidenceStandards}`);
  }

  if (pov.counterArguments) {
    parts.push(`\n**Engage these objections:** ${pov.counterArguments}`);
  }

  if (pov.rhetoricalPatterns) {
    parts.push(`\n**Use these argumentative structures:** ${pov.rhetoricalPatterns}`);
  }

  if (pov.boundaryConditions) {
    parts.push(`\n**Note where this thesis does NOT apply:** ${pov.boundaryConditions}`);
  }

  return parts.join('\n');
}

/**
 * Build the Evidence Requirements section.
 * Tells the research agent exactly what evidence standards to meet.
 */
function buildEvidenceSection(reqs: EvidenceRequirements): string {
  const lines: string[] = ['## Evidence Requirements', ''];

  if (reqs.minHardFacts > 0) {
    lines.push(`- Minimum **${reqs.minHardFacts} hard facts** with specific data points (names, numbers, dates)`);
  }

  if (reqs.requireCounterArguments) {
    lines.push('- **Counter-arguments required** — engage opposing viewpoints with evidence');
  }

  if (reqs.requirePrimarySources) {
    lines.push('- **Primary sources required** — official announcements, regulatory filings, investigative journalism, technical analysis');
  }

  if (reqs.requireQuantitative) {
    lines.push('- **Quantitative data required** — include numbers, percentages, dollar amounts, not just qualitative claims');
  }

  if (reqs.maxAcademicPadding === 0) {
    lines.push('- **Zero academic padding** — no generic AI ethics literature, no adjacent academic books unless directly cited in the source material');
  } else if (reqs.maxAcademicPadding < 999) {
    lines.push(`- **Maximum ${reqs.maxAcademicPadding} filler citations** — every citation must directly support a finding`);
  }

  return lines.join('\n');
}

/**
 * Build the Quality Floor section.
 * Sets minimum acceptable source quality.
 */
function buildQualityFloorSection(floor: QualityFloor): string {
  switch (floor) {
    case 'grove_grade':
      return `## Source Quality Floor: Grove-Grade

**Acceptable sources ONLY:**
- Official company announcements and press releases
- SEC filings, regulatory documents, government reports
- Investigative journalism from recognized publications
- Technical analysis with demonstrated methodology
- Peer-reviewed research papers

**NOT acceptable:**
- Generic AI ethics literature or adjacent academic books
- Blog posts from non-practitioners
- "Industry analyst" reports without methodology disclosure
- Social media posts as primary sources (acceptable as signals only)`;

    case 'primary_sources':
      return `## Source Quality Floor: Primary Sources

Prefer primary sources over secondary reporting:
- Original research, datasets, and methodology descriptions
- First-party announcements and documentation
- Direct interviews and expert commentary
- Government and regulatory filings

Secondary sources are acceptable for context but primary sources must anchor each key finding.`;

    case 'any':
    default:
      return '';
  }
}

/**
 * Build the Thesis & Intent section.
 * Tells the agent what lens to apply and what the user wants.
 */
function buildThesisSection(thesisHook: string, intent: string): string {
  const intentDescriptions: Record<string, string> = {
    explore: 'Open-ended investigation — discover what exists and map the landscape',
    validate: 'Test a specific claim — find supporting and contradicting evidence',
    challenge: 'Find counter-evidence — identify weaknesses, blind spots, and opposing data',
    synthesize: 'Combine multiple sources into a coherent position — find the through-line',
    compare: 'Compare approaches, products, or ideas — identify trade-offs and differentiators',
  };

  const desc = intentDescriptions[intent] || intentDescriptions.explore;

  return `## Research Lens

**Thesis hook:** ${thesisHook.replace(/_/g, ' ')}
**Research intent:** ${desc}`;
}

// ─── Main Builder ───────────────────────────────────────

/**
 * Build a structured research prompt from a V2 config.
 *
 * Produces a prompt with clearly delineated sections for:
 * - Topic (no length limit)
 * - Source context
 * - User direction
 * - Thesis & intent
 * - Analytical lens (from POV Library)
 * - Evidence requirements
 * - Quality floor
 *
 * All sections are optional except topic. Missing fields produce
 * a valid prompt with fewer sections — clean degradation.
 */
export function buildResearchPromptV2(config: ResearchConfigV2): string {
  const sections: string[] = [];

  // 1. Research Topic (NO length limit — the whole point of V2)
  sections.push(`## Research Topic\n\n${config.query}`);

  // 2. Source context
  if (config.sourceUrl) {
    const typeLabel = config.sourceType || 'generic';
    sections.push(`## Source\n\n${config.sourceUrl} (${typeLabel})`);
  }

  // 3. User Direction (natural language from Socratic answer)
  if (config.userDirection) {
    sections.push(`## User Direction\n\n${config.userDirection}`);
  } else if (config.userContext) {
    // Fall back to V1 userContext field
    sections.push(`## User Direction\n\n${config.userContext}`);
  }

  // 4. Thesis & Intent
  if (config.thesisHook) {
    sections.push(buildThesisSection(config.thesisHook, config.intent || 'explore'));
  }

  // 5. Source Content (same as V1 — gives Gemini the actual topic)
  if (config.sourceContent) {
    sections.push(
      `## Source Content (extracted from shared URL)\n\n` +
      `Use this content to understand what the original post/article is actually about. ` +
      `Your research should find MORE information about these specific topics.\n\n` +
      config.sourceContent.slice(0, 1500),
    );
  }

  // 6. Analytical Lens (from POV Library)
  if (config.povContext) {
    sections.push(buildPOVSection(config.povContext));
  }

  // 7. Evidence Requirements
  if (config.evidenceRequirements) {
    sections.push(buildEvidenceSection(config.evidenceRequirements));
  }

  // 8. Quality Floor
  if (config.qualityFloor && config.qualityFloor !== 'any') {
    sections.push(buildQualityFloorSection(config.qualityFloor));
  }

  return sections.join('\n\n');
}

// Exported for testing
export { buildPOVSection, buildEvidenceSection, buildQualityFloorSection, buildThesisSection };
