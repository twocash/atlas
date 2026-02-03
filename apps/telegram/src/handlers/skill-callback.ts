/**
 * Atlas Skill System - Telegram Callback Handler
 *
 * Phase 3: Handles inline keyboard callbacks for skill approval.
 * Integrates with the approval queue and skill registry.
 */

import { InlineKeyboard } from 'grammy';
import type { Context, CallbackQueryContext } from 'grammy';
import { logger } from '../logger';
import {
  getPendingProposals,
  getProposal,
  approveProposalById,
  rejectProposalById,
  approveAllPending,
  approveAllTier0,
  deferAllPending,
  formatProposalForTelegram,
  getQueueStats,
} from '../skills/approval-queue';
import type { SkillProposal } from '../skills/pattern-detector';
import { getTierEmoji } from '../skills/schema';

// =============================================================================
// CALLBACK DATA FORMAT
// =============================================================================

// Format: skill:<action>:<proposalId>
// Actions: approve, reject, edit, details, batch

/**
 * Check if callback data is a skill callback
 */
export function isSkillCallback(data: string | undefined): boolean {
  return data?.startsWith('skill:') || false;
}

/**
 * Parse skill callback data
 */
function parseCallback(data: string): { action: string; id?: string } | null {
  const parts = data.split(':');
  if (parts[0] !== 'skill' || parts.length < 2) {
    return null;
  }

  return {
    action: parts[1],
    id: parts[2],
  };
}

// =============================================================================
// KEYBOARD BUILDERS
// =============================================================================

/**
 * Build keyboard for a single proposal
 */
export function buildProposalKeyboard(proposal: SkillProposal): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Main actions
  kb.text('✅ Approve', `skill:approve:${proposal.id}`)
    .text('✏️ Edit', `skill:edit:${proposal.id}`)
    .text('❌ Reject', `skill:reject:${proposal.id}`)
    .row();

  // Secondary actions
  kb.text('📋 Details', `skill:details:${proposal.id}`)
    .text('⏭️ Skip', `skill:skip:${proposal.id}`);

  return kb;
}

/**
 * Build keyboard for pending proposals list
 */
export function buildPendingListKeyboard(proposals: SkillProposal[]): InlineKeyboard {
  const kb = new InlineKeyboard();

  // Individual approve buttons
  for (let i = 0; i < Math.min(proposals.length, 5); i++) {
    const p = proposals[i];
    const emoji = getTierEmoji(p.skill.tier);
    kb.text(`${emoji} ${i + 1}. ${p.skill.name.substring(0, 15)}`, `skill:details:${p.id}`);
    if ((i + 1) % 2 === 0) kb.row();
  }

  if (proposals.length % 2 !== 0) kb.row();

  // Batch actions
  kb.text('✅ Approve All', 'skill:batch:approveAll')
    .text('⏭️ Later', 'skill:batch:defer')
    .row();

  // Tier-specific
  const tier0Count = proposals.filter(p => p.skill.tier === 0).length;
  if (tier0Count > 0) {
    kb.text(`🟢 Approve ${tier0Count} Tier 0`, 'skill:batch:approveTier0');
  }

  return kb;
}

/**
 * Build confirmation keyboard for rejection
 */
function buildRejectConfirmKeyboard(proposalId: string): InlineKeyboard {
  return new InlineKeyboard()
    .text('❌ Not useful', `skill:reject-confirm:${proposalId}:not-useful`)
    .text('🔄 Wrong pattern', `skill:reject-confirm:${proposalId}:wrong-pattern`)
    .row()
    .text('⏳ Not now', `skill:reject-confirm:${proposalId}:not-now`)
    .text('↩️ Cancel', `skill:details:${proposalId}`);
}

// =============================================================================
// CALLBACK HANDLERS
// =============================================================================

/**
 * Handle skill callback
 */
export async function handleSkillCallback(ctx: CallbackQueryContext<Context>): Promise<void> {
  const data = ctx.callbackQuery.data;
  if (!data) {
    await ctx.answerCallbackQuery({ text: 'Invalid callback' });
    return;
  }

  const parsed = parseCallback(data);
  if (!parsed) {
    await ctx.answerCallbackQuery({ text: 'Invalid callback format' });
    return;
  }

  logger.debug('Skill callback', { action: parsed.action, id: parsed.id });

  try {
    switch (parsed.action) {
      case 'approve':
        await handleApprove(ctx, parsed.id!);
        break;

      case 'reject':
        await handleReject(ctx, parsed.id!);
        break;

      case 'reject-confirm':
        // Format: skill:reject-confirm:<id>:<reason>
        const parts = data.split(':');
        await handleRejectConfirm(ctx, parts[2], parts[3]);
        break;

      case 'edit':
        await handleEdit(ctx, parsed.id!);
        break;

      case 'details':
        await handleDetails(ctx, parsed.id!);
        break;

      case 'skip':
        await handleSkip(ctx, parsed.id!);
        break;

      case 'batch':
        await handleBatch(ctx, parsed.id!);
        break;

      case 'list':
        await handleList(ctx);
        break;

      default:
        await ctx.answerCallbackQuery({ text: 'Unknown action' });
    }
  } catch (error) {
    logger.error('Skill callback error', { action: parsed.action, error });
    await ctx.answerCallbackQuery({ text: 'Error processing request' });
  }
}

/**
 * Handle approve action
 */
async function handleApprove(ctx: CallbackQueryContext<Context>, id: string): Promise<void> {
  const skill = await approveProposalById(id);

  if (!skill) {
    await ctx.answerCallbackQuery({ text: 'Proposal not found or already processed' });
    return;
  }

  await ctx.answerCallbackQuery({ text: `✅ ${skill.name} approved!` });

  // Update message
  await ctx.editMessageText(
    `✅ <b>Skill Approved</b>\n\n` +
    `<b>${skill.name}</b> is now active.\n\n` +
    `Tier: ${getTierEmoji(skill.tier)} ${skill.tier}\n` +
    `Triggers: ${skill.triggers.length}\n` +
    `Tools: ${skill.process.steps.length}`,
    { parse_mode: 'HTML' }
  );
}

/**
 * Handle reject action (show confirmation)
 */
async function handleReject(ctx: CallbackQueryContext<Context>, id: string): Promise<void> {
  const proposal = await getProposal(id);

  if (!proposal) {
    await ctx.answerCallbackQuery({ text: 'Proposal not found' });
    return;
  }

  await ctx.answerCallbackQuery();

  await ctx.editMessageText(
    `<b>Reject ${proposal.skill.name}?</b>\n\n` +
    `Select a reason:`,
    {
      parse_mode: 'HTML',
      reply_markup: buildRejectConfirmKeyboard(id),
    }
  );
}

/**
 * Handle reject confirmation
 */
async function handleRejectConfirm(
  ctx: CallbackQueryContext<Context>,
  id: string,
  reason: string
): Promise<void> {
  const reasonMap: Record<string, string> = {
    'not-useful': 'Not useful - pattern doesn\'t represent a skill',
    'wrong-pattern': 'Wrong pattern detection - misidentified actions',
    'not-now': 'Not now - defer indefinitely',
  };

  const success = await rejectProposalById(id, reasonMap[reason] || reason);

  if (!success) {
    await ctx.answerCallbackQuery({ text: 'Proposal not found or already processed' });
    return;
  }

  await ctx.answerCallbackQuery({ text: '❌ Proposal rejected' });

  await ctx.editMessageText(
    `❌ <b>Proposal Rejected</b>\n\n` +
    `Reason: ${reasonMap[reason] || reason}\n\n` +
    `This pattern won't be suggested again for 24 hours.`,
    { parse_mode: 'HTML' }
  );
}

/**
 * Handle edit action (show proposal for modification)
 */
async function handleEdit(ctx: CallbackQueryContext<Context>, id: string): Promise<void> {
  const proposal = await getProposal(id);

  if (!proposal) {
    await ctx.answerCallbackQuery({ text: 'Proposal not found' });
    return;
  }

  await ctx.answerCallbackQuery();

  // For now, show a message about editing
  // Full editing would require a multi-step conversation
  await ctx.editMessageText(
    `✏️ <b>Edit ${proposal.skill.name}</b>\n\n` +
    `Skill editing is coming soon. For now:\n` +
    `1. Approve the skill\n` +
    `2. Edit the YAML file in data/skills/\n\n` +
    `File: data/skills/${proposal.skill.name}/skill.yaml`,
    {
      parse_mode: 'HTML',
      reply_markup: buildProposalKeyboard(proposal),
    }
  );
}

/**
 * Handle details action
 */
async function handleDetails(ctx: CallbackQueryContext<Context>, id: string): Promise<void> {
  const proposal = await getProposal(id);

  if (!proposal) {
    await ctx.answerCallbackQuery({ text: 'Proposal not found' });
    return;
  }

  await ctx.answerCallbackQuery();

  const text = formatProposalForTelegram(proposal);

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: buildProposalKeyboard(proposal),
  });
}

/**
 * Handle skip action
 */
async function handleSkip(ctx: CallbackQueryContext<Context>, _id: string): Promise<void> {
  await ctx.answerCallbackQuery({ text: '⏭️ Skipped - will show again later' });

  // Show next proposal or return to list
  await handleList(ctx);
}

/**
 * Handle batch actions
 */
async function handleBatch(ctx: CallbackQueryContext<Context>, action: string): Promise<void> {
  switch (action) {
    case 'approveAll': {
      const approved = await approveAllPending();
      await ctx.answerCallbackQuery({ text: `✅ ${approved.length} skills approved!` });
      await ctx.editMessageText(
        `✅ <b>All Skills Approved</b>\n\n` +
        `${approved.length} skills are now active:\n` +
        approved.map(s => `• ${s.name}`).join('\n'),
        { parse_mode: 'HTML' }
      );
      break;
    }

    case 'approveTier0': {
      const approved = await approveAllTier0();
      await ctx.answerCallbackQuery({ text: `✅ ${approved.length} Tier 0 skills approved!` });
      await ctx.editMessageText(
        `✅ <b>Tier 0 Skills Approved</b>\n\n` +
        `${approved.length} read-only skills are now active:\n` +
        approved.map(s => `• ${s.name}`).join('\n'),
        { parse_mode: 'HTML' }
      );
      break;
    }

    case 'defer': {
      const count = await deferAllPending();
      await ctx.answerCallbackQuery({ text: `⏭️ ${count} skills deferred` });
      await ctx.editMessageText(
        `⏭️ <b>Skills Deferred</b>\n\n` +
        `${count} proposals will appear in tomorrow's briefing.`,
        { parse_mode: 'HTML' }
      );
      break;
    }

    default:
      await ctx.answerCallbackQuery({ text: 'Unknown batch action' });
  }
}

/**
 * Handle list action - show pending proposals
 */
async function handleList(ctx: CallbackQueryContext<Context>): Promise<void> {
  const proposals = await getPendingProposals();

  if (proposals.length === 0) {
    await ctx.editMessageText(
      `✨ <b>No Pending Skills</b>\n\n` +
      `All caught up! New skill proposals will appear here.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const stats = await getQueueStats();

  const text = [
    `🔧 <b>${proposals.length} Pending Skills</b>`,
    ``,
    `🟢 Tier 0 (Read-only): ${stats.byTier[0]}`,
    `🟡 Tier 1 (Creates): ${stats.byTier[1]}`,
    `🔴 Tier 2 (External): ${stats.byTier[2]}`,
    ``,
    `Select a skill to review:`,
  ].join('\n');

  await ctx.editMessageText(text, {
    parse_mode: 'HTML',
    reply_markup: buildPendingListKeyboard(proposals),
  });
}

// =============================================================================
// COMMAND HANDLERS
// =============================================================================

/**
 * Handle /skills command
 */
export async function handleSkillsCommand(ctx: Context): Promise<void> {
  const text = ctx.message?.text || '';
  const args = text.split(/\s+/).slice(1);
  const subcommand = args[0]?.toLowerCase();

  switch (subcommand) {
    case 'pending':
      await showPendingSkills(ctx);
      break;

    case 'list':
    case 'all':
      await showAllSkills(ctx);
      break;

    case 'stats':
      await showSkillStats(ctx);
      break;

    default:
      await showSkillsHelp(ctx);
  }
}

/**
 * Show pending skills
 */
async function showPendingSkills(ctx: Context): Promise<void> {
  const proposals = await getPendingProposals();

  if (proposals.length === 0) {
    await ctx.reply(
      `✨ <b>No Pending Skills</b>\n\n` +
      `All caught up! New skill proposals will appear when patterns are detected.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const stats = await getQueueStats();

  const text = [
    `🔧 <b>${proposals.length} Pending Skills</b>`,
    ``,
    `🟢 Tier 0 (Read-only): ${stats.byTier[0]}`,
    `🟡 Tier 1 (Creates): ${stats.byTier[1]}`,
    `🔴 Tier 2 (External): ${stats.byTier[2]}`,
    ``,
    `Select a skill to review:`,
  ].join('\n');

  await ctx.reply(text, {
    parse_mode: 'HTML',
    reply_markup: buildPendingListKeyboard(proposals),
  });
}

/**
 * Show all registered skills
 */
async function showAllSkills(ctx: Context): Promise<void> {
  const { getSkillRegistry } = await import('../skills/registry');
  const registry = getSkillRegistry();
  const skills = registry.getEnabled();

  if (skills.length === 0) {
    await ctx.reply(
      `📭 <b>No Active Skills</b>\n\n` +
      `No skills are registered yet. Patterns will be detected and proposed automatically.`,
      { parse_mode: 'HTML' }
    );
    return;
  }

  const lines = [
    `📋 <b>${skills.length} Active Skills</b>`,
    ``,
  ];

  for (const skill of skills.slice(0, 10)) {
    const emoji = getTierEmoji(skill.tier);
    lines.push(`${emoji} <b>${skill.name}</b>`);
    lines.push(`   ${skill.description?.substring(0, 50) || 'No description'}...`);
    lines.push(``);
  }

  if (skills.length > 10) {
    lines.push(`<i>...and ${skills.length - 10} more</i>`);
  }

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
}

/**
 * Show skill system stats
 */
async function showSkillStats(ctx: Context): Promise<void> {
  const { getSkillRegistry } = await import('../skills/registry');
  const registry = getSkillRegistry();
  const registryStats = registry.getStats();
  const queueStats = await getQueueStats();

  const lines = [
    `📊 <b>Skill System Stats</b>`,
    ``,
    `<b>Registry:</b>`,
    `  Total: ${registryStats.total}`,
    `  Enabled: ${registryStats.enabled}`,
    `  By source:`,
    `    YAML: ${registryStats.bySource.yaml}`,
    `    Markdown: ${registryStats.bySource.markdown}`,
    `    Generated: ${registryStats.bySource.generated}`,
    ``,
    `<b>Queue:</b>`,
    `  Pending: ${queueStats.pending}`,
    `  Approved: ${queueStats.approved}`,
    `  Rejected: ${queueStats.rejected}`,
  ];

  await ctx.reply(lines.join('\n'), { parse_mode: 'HTML' });
}

/**
 * Show skills help
 */
async function showSkillsHelp(ctx: Context): Promise<void> {
  const text = [
    `🔧 <b>Skills System</b>`,
    ``,
    `Atlas learns patterns and proposes skills to automate repetitive actions.`,
    ``,
    `<b>Commands:</b>`,
    `/skills pending  — Review pending proposals`,
    `/skills list     — View all active skills`,
    `/skills stats    — System statistics`,
    ``,
    `<b>How it works:</b>`,
    `1. Atlas logs your actions with intent hashes`,
    `2. When 5+ similar actions occur in 14 days, a skill is proposed`,
    `3. Approve to make it active, or reject to skip`,
    `4. Tier 0 skills auto-deploy if enabled`,
  ].join('\n');

  await ctx.reply(text, { parse_mode: 'HTML' });
}
