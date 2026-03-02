/**
 * Provenance Rendering — Surface-agnostic formats
 *
 * ADR-005: No Telegram HTML in packages/agents.
 * Telegram-specific rendering lives in apps/telegram/src/services/.
 *
 * Sprint: Sprint A — Pipeline Unification + Provenance Core
 */

import type { ProvenanceChain } from '../types/provenance';

// ─── Notion (Markdown) ─────────────────────────────────

/**
 * Render provenance as a markdown section for Notion Work Queue pages.
 * Appended at the bottom of the WQ page body.
 */
export function renderProvenanceNotion(chain: ProvenanceChain): string {
  const lines: string[] = [];
  lines.push('---');
  lines.push('## Provenance');
  lines.push('');

  // Route
  lines.push(`**Entry:** ${chain.route.entry}`);
  lines.push(`**Trigger:** ${chain.route.trigger}`);
  lines.push(`**Path:** ${chain.route.path.join(' → ')}`);
  lines.push('');

  // Config
  lines.push('### Config');
  lines.push(`- **Source:** ${chain.config.source}`);
  if (chain.config.depth) lines.push(`- **Depth:** ${chain.config.depth}`);
  if (chain.config.pillar) lines.push(`- **Pillar:** ${chain.config.pillar}`);
  if (chain.config.drafter) lines.push(`- **Drafter:** ${chain.config.drafter}`);
  lines.push(`- **POV Context:** ${chain.config.povContextInjected ? 'Yes' : 'No'}`);
  lines.push(`- **V2 Evidence:** ${chain.config.v2ConfigApplied ? 'Yes' : 'No'}`);
  lines.push('');

  // Compute
  if (chain.compute.phases.length > 0) {
    lines.push('### Compute');
    lines.push(`| Phase | Provider | Tools | Duration |`);
    lines.push(`|-------|----------|-------|----------|`);
    for (const phase of chain.compute.phases) {
      const dur = (phase.durationMs / 1000).toFixed(1);
      const tools = phase.tools.length > 0 ? phase.tools.join(', ') : '—';
      lines.push(`| ${phase.name} | ${phase.provider} | ${tools} | ${dur}s |`);
    }
    lines.push(`\n**Total API calls:** ${chain.compute.apiCalls}`);
    lines.push('');
  }

  // Context
  lines.push('### Context');
  if (chain.context.sourceUrl) lines.push(`- **Source URL:** ${chain.context.sourceUrl}`);
  lines.push(`- **Pre-reader:** ${chain.context.preReaderAvailable ? 'Available' : 'Not available'}`);
  if (chain.context.drafterId) lines.push(`- **Drafter:** ${chain.context.drafterId}`);

  const slotEntries = Object.entries(chain.context.slots);
  if (slotEntries.length > 0) {
    lines.push('- **Slots:** ' + slotEntries.map(([k, v]) => `${k}=${v}`).join(', '));
  }

  if (chain.context.ragSources.length > 0) {
    lines.push(`- **RAG Sources:** ${chain.context.ragSources.join(', ')}`);
  }
  lines.push('');

  // Result
  lines.push('### Result');
  if (chain.result.andonGrade) {
    const conf = chain.result.andonConfidence != null
      ? ` (${chain.result.andonConfidence.toFixed(2)})`
      : '';
    lines.push(`- **Andon Gate:** ${chain.result.andonGrade}${conf}`);
  }
  lines.push(`- **Findings:** ${chain.result.findingCount}`);
  lines.push(`- **Web Citations:** ${chain.result.citations.length}`);
  lines.push(`- **RAG Chunks:** ${chain.result.ragChunks.length}`);
  lines.push(`- **Hallucination Detected:** ${chain.result.hallucinationDetected ? 'Yes' : 'No'}`);
  lines.push('');

  // Timing
  lines.push('### Timing');
  lines.push(`- **Started:** ${chain.time.startedAt}`);
  if (chain.time.finalizedAt) lines.push(`- **Finalized:** ${chain.time.finalizedAt}`);
  if (chain.time.totalDurationMs != null) {
    lines.push(`- **Total Duration:** ${(chain.time.totalDurationMs / 1000).toFixed(1)}s`);

    // Per-phase breakdown
    if (chain.compute.phases.length > 1) {
      const breakdown = chain.compute.phases.map(p =>
        `${p.name}: ${(p.durationMs / 1000).toFixed(1)}s`
      ).join(', ');
      lines.push(`- **Phase Breakdown:** ${breakdown}`);
    }
  }

  return lines.join('\n');
}

// ─── Compact (Feed 2.0 rich_text) ────────────────────────

/**
 * Compact single-line rendering for Feed 2.0 rich_text (2000 char limit).
 * Sprint C: Feed persistence.
 */
export function renderProvenanceCompact(chain: ProvenanceChain): string {
  const parts: string[] = [];
  parts.push(`Route: ${chain.route.path.join(' > ')}`);
  parts.push(`Trigger: ${chain.route.trigger}`);
  if (chain.config.depth) parts.push(`Depth: ${chain.config.depth}`);
  if (chain.config.pillar) parts.push(`Pillar: ${chain.config.pillar}`);

  if (chain.compute.phases.length > 0) {
    const phases = chain.compute.phases.map(p =>
      `${p.name}(${p.provider},${(p.durationMs / 1000).toFixed(1)}s)`
    ).join(' > ');
    parts.push(`Phases: ${phases}`);
  }

  parts.push(`Citations: ${chain.result.citations.length} web`);
  parts.push(`RAG: ${chain.result.ragChunks.length} chunks`);
  if (chain.result.claimFlags.length > 0) {
    parts.push(`Claims: ${chain.result.claimFlags.join(', ')}`);
  }

  if (chain.result.andonGrade) {
    const conf = chain.result.andonConfidence != null
      ? ` (${(chain.result.andonConfidence * 100).toFixed(0)}%)` : '';
    parts.push(`Grade: ${chain.result.andonGrade}${conf}`);
  }

  if (chain.time.totalDurationMs != null) {
    parts.push(`Duration: ${(chain.time.totalDurationMs / 1000).toFixed(1)}s`);
  }

  return parts.join(' | ');
}

/**
 * Extract Andon grade from chain for Feed 2.0 select property.
 * Returns capitalized grade or 'Pending' if not yet assessed.
 */
export function getProvenanceGrade(chain: ProvenanceChain): string {
  return chain.result.andonGrade
    ? chain.result.andonGrade.charAt(0).toUpperCase() + chain.result.andonGrade.slice(1)
    : 'Pending';
}
