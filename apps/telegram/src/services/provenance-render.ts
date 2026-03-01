/**
 * Provenance Rendering — Telegram HTML
 *
 * ADR-005: Telegram-specific HTML lives in apps/telegram, not packages/agents.
 * Surface adapter responsibility: formatting for Grammy parse_mode: 'HTML'.
 *
 * Sprint: Sprint A — Pipeline Unification + Provenance Core
 */

import type { ProvenanceChain } from '../../../../packages/agents/src/types/provenance';

/**
 * Render provenance as a compact HTML block for Telegram delivery.
 * Appended after the research results message.
 *
 * Format:
 * ───── Provenance ─────
 * Path: socratic-resolved → orchestrator → research
 * Config: notion | deep | grove-drafter
 * Compute: retrieve (claude-haiku, 3.2s) → synthesize (gemini-2.0-flash, 8.1s)
 * Sources: 7 web citations, 0 RAG chunks
 * Andon: Grounded (0.92)
 * Total: 14.3s
 */
export function renderProvenanceTelegram(chain: ProvenanceChain): string {
  const lines: string[] = [];
  lines.push('<b>───── Provenance ─────</b>');

  // Route
  const path = chain.route.path.join(' → ');
  lines.push(`<b>Path:</b> ${escapeHtml(path)}`);

  // Config
  const configParts: string[] = [chain.config.source];
  if (chain.config.depth) configParts.push(chain.config.depth);
  if (chain.config.drafter) configParts.push(chain.config.drafter);
  if (chain.config.povContextInjected) configParts.push('+POV');
  lines.push(`<b>Config:</b> ${escapeHtml(configParts.join(' | '))}`);

  // Compute phases
  if (chain.compute.phases.length > 0) {
    const phases = chain.compute.phases.map(p => {
      const dur = (p.durationMs / 1000).toFixed(1);
      return `${p.name} (${p.provider}, ${dur}s)`;
    });
    lines.push(`<b>Compute:</b> ${escapeHtml(phases.join(' → '))}`);
  }

  // Sources — citations vs RAG chunks (the "25 Sources" fix)
  const citCount = chain.result.citations.length;
  const ragCount = chain.result.ragChunks.length;
  lines.push(`<b>Sources:</b> ${citCount} web citation${citCount !== 1 ? 's' : ''}, ${ragCount} RAG chunk${ragCount !== 1 ? 's' : ''}`);

  // Andon
  if (chain.result.andonGrade) {
    const conf = chain.result.andonConfidence != null
      ? ` (${chain.result.andonConfidence.toFixed(2)})`
      : '';
    lines.push(`<b>Andon:</b> ${escapeHtml(chain.result.andonGrade)}${conf}`);
  }

  // Timing
  if (chain.time.totalDurationMs != null) {
    const secs = (chain.time.totalDurationMs / 1000).toFixed(1);
    lines.push(`<b>Total:</b> ${secs}s`);
  }

  return lines.join('\n');
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}
