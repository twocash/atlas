/**
 * Approval Formatter — Telegram-specific formatting for skill proposals
 *
 * Extracted from approval-queue.ts during CPE Phase 3.
 * These functions use HTML formatting and emoji specific to Telegram rendering.
 */

import type { SkillProposal } from '@atlas/agents/src/skills/pattern-detector';
import { getQueueStats } from '@atlas/agents/src/skills/approval-queue';
import { getDetectionConfig } from '../config/features';

/**
 * Format a proposal for Telegram display
 */
export function formatProposalForTelegram(proposal: SkillProposal): string {
  const { skill, pattern } = proposal;

  const tierEmoji = skill.tier === 0 ? '🟢' : skill.tier === 1 ? '🟡' : '🔴';
  const tierLabel = skill.tier === 0 ? 'Read-only' : skill.tier === 1 ? 'Creates' : 'External';

  const lines = [
    `<b>${skill.name}</b>`,
    `${tierEmoji} Tier ${skill.tier} (${tierLabel})`,
    ``,
    `Pattern: ${pattern.frequency}x in ${getDetectionConfig().windowDays} days`,
    `Pillar: ${pattern.pillar || 'Mixed'}`,
    `Tools: ${pattern.toolsUsed.slice(0, 3).join(', ')}${pattern.toolsUsed.length > 3 ? '...' : ''}`,
    ``,
    `Example: "${pattern.canonicalText.substring(0, 60)}${pattern.canonicalText.length > 60 ? '...' : ''}"`,
  ];

  return lines.join('\n');
}

/**
 * Format queue summary for briefing
 */
export async function formatQueueSummary(): Promise<string | null> {
  const stats = await getQueueStats();

  if (stats.pending === 0) {
    return null;
  }

  const lines = [
    `🔧 <b>${stats.pending} Pending Skills</b>`,
    ``,
  ];

  if (stats.byTier[0] > 0) lines.push(`🟢 ${stats.byTier[0]} Tier 0 (auto-deployable)`);
  if (stats.byTier[1] > 0) lines.push(`🟡 ${stats.byTier[1]} Tier 1 (creates entries)`);
  if (stats.byTier[2] > 0) lines.push(`🔴 ${stats.byTier[2]} Tier 2 (external actions)`);

  lines.push('');
  lines.push(`Use /skills pending to review`);

  return lines.join('\n');
}
