/**
 * Atlas Skill System - Approval Queue
 *
 * Phase 3: Manages pending skill proposals for user approval.
 * Persists to filesystem for durability across restarts.
 *
 * Proposals are queued here and presented to Jim via:
 * - Daily briefing inclusion
 * - `/skills pending` command
 * - Telegram inline keyboards
 */

import { readFile, writeFile, mkdir } from 'fs/promises';
import { join } from 'path';
import { logger } from '../logger';
import {
  type SkillProposal,
  approveProposal as doApprove,
  rejectProposal as doReject,
} from './pattern-detector';
import type { SkillDefinition } from './schema';

// =============================================================================
// QUEUE STORAGE
// =============================================================================

const QUEUE_DIR = join(process.cwd(), 'data', 'skills', '.pending');
const QUEUE_FILE = join(QUEUE_DIR, 'proposals.json');

/**
 * Queue state persisted to disk
 */
interface QueueState {
  proposals: SkillProposal[];
  lastUpdated: string;
  version: number;
}

// In-memory cache
let queueState: QueueState | null = null;

/**
 * Load queue from disk
 */
async function loadQueue(): Promise<QueueState> {
  if (queueState) {
    return queueState;
  }

  try {
    const content = await readFile(QUEUE_FILE, 'utf-8');
    queueState = JSON.parse(content);
    logger.debug('Approval queue loaded', { proposals: queueState?.proposals.length });
    return queueState!;
  } catch (error) {
    // File doesn't exist or is invalid
    queueState = {
      proposals: [],
      lastUpdated: new Date().toISOString(),
      version: 1,
    };
    return queueState;
  }
}

/**
 * Save queue to disk
 */
async function saveQueue(): Promise<void> {
  if (!queueState) return;

  try {
    await mkdir(QUEUE_DIR, { recursive: true });
    queueState.lastUpdated = new Date().toISOString();
    await writeFile(QUEUE_FILE, JSON.stringify(queueState, null, 2));
    logger.debug('Approval queue saved', { proposals: queueState.proposals.length });
  } catch (error) {
    logger.error('Failed to save approval queue', { error });
  }
}

// =============================================================================
// QUEUE OPERATIONS
// =============================================================================

/**
 * Add proposals to the queue
 */
export async function queueProposals(proposals: SkillProposal[]): Promise<number> {
  const state = await loadQueue();

  let added = 0;
  for (const proposal of proposals) {
    // Skip if already in queue (by ID)
    if (state.proposals.some(p => p.id === proposal.id)) {
      continue;
    }

    // Skip if already approved or rejected
    if (proposal.status !== 'pending') {
      continue;
    }

    state.proposals.push(proposal);
    added++;
  }

  if (added > 0) {
    await saveQueue();
    logger.info('Proposals queued', { added, total: state.proposals.length });
  }

  return added;
}

/**
 * Get all pending proposals
 */
export async function getPendingProposals(): Promise<SkillProposal[]> {
  const state = await loadQueue();
  return state.proposals.filter(p => p.status === 'pending');
}

/**
 * Get proposal by ID
 */
export async function getProposal(id: string): Promise<SkillProposal | null> {
  const state = await loadQueue();
  return state.proposals.find(p => p.id === id) || null;
}

/**
 * Get proposals by tier
 */
export async function getProposalsByTier(tier: number): Promise<SkillProposal[]> {
  const state = await loadQueue();
  return state.proposals.filter(p => p.status === 'pending' && p.skill.tier === tier);
}

/**
 * Approve a single proposal by ID
 */
export async function approveProposalById(id: string): Promise<SkillDefinition | null> {
  const state = await loadQueue();
  const proposal = state.proposals.find(p => p.id === id);

  if (!proposal) {
    logger.warn('Proposal not found for approval', { id });
    return null;
  }

  if (proposal.status !== 'pending') {
    logger.warn('Proposal already processed', { id, status: proposal.status });
    return null;
  }

  const skill = doApprove(proposal);
  await saveQueue();

  return skill;
}

/**
 * Reject a single proposal by ID
 */
export async function rejectProposalById(id: string, reason: string): Promise<boolean> {
  const state = await loadQueue();
  const proposal = state.proposals.find(p => p.id === id);

  if (!proposal) {
    logger.warn('Proposal not found for rejection', { id });
    return false;
  }

  if (proposal.status !== 'pending') {
    logger.warn('Proposal already processed', { id, status: proposal.status });
    return false;
  }

  doReject(proposal, reason);
  await saveQueue();

  return true;
}

/**
 * Approve all pending proposals
 */
export async function approveAllPending(): Promise<SkillDefinition[]> {
  const state = await loadQueue();
  const pending = state.proposals.filter(p => p.status === 'pending');

  const approved: SkillDefinition[] = [];
  for (const proposal of pending) {
    const skill = doApprove(proposal);
    approved.push(skill);
  }

  if (approved.length > 0) {
    await saveQueue();
    logger.info('All pending proposals approved', { count: approved.length });
  }

  return approved;
}

/**
 * Approve all pending Tier 0 proposals
 */
export async function approveAllTier0(): Promise<SkillDefinition[]> {
  const state = await loadQueue();
  const tier0 = state.proposals.filter(p => p.status === 'pending' && p.skill.tier === 0);

  const approved: SkillDefinition[] = [];
  for (const proposal of tier0) {
    const skill = doApprove(proposal);
    approved.push(skill);
  }

  if (approved.length > 0) {
    await saveQueue();
    logger.info('Tier 0 proposals approved', { count: approved.length });
  }

  return approved;
}

/**
 * Defer all pending proposals (skip until later)
 */
export async function deferAllPending(): Promise<number> {
  // Just leave them pending - they'll show up again in the next briefing
  const pending = await getPendingProposals();
  logger.info('Proposals deferred', { count: pending.length });
  return pending.length;
}

/**
 * Clean up old processed proposals (keep for audit trail)
 */
export async function cleanupOldProposals(maxAgeDays: number = 30): Promise<number> {
  const state = await loadQueue();
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - maxAgeDays);

  const originalCount = state.proposals.length;
  state.proposals = state.proposals.filter(p => {
    // Keep pending
    if (p.status === 'pending') return true;

    // Keep recent processed
    const processedAt = p.processedAt ? new Date(p.processedAt) : new Date(p.createdAt);
    return processedAt > cutoff;
  });

  const removed = originalCount - state.proposals.length;
  if (removed > 0) {
    await saveQueue();
    logger.info('Old proposals cleaned up', { removed });
  }

  return removed;
}

// =============================================================================
// QUEUE STATS
// =============================================================================

/**
 * Get queue statistics
 */
export async function getQueueStats(): Promise<{
  pending: number;
  approved: number;
  rejected: number;
  expired: number;
  byTier: Record<number, number>;
}> {
  const state = await loadQueue();

  const stats = {
    pending: 0,
    approved: 0,
    rejected: 0,
    expired: 0,
    byTier: { 0: 0, 1: 0, 2: 0 } as Record<number, number>,
  };

  for (const proposal of state.proposals) {
    switch (proposal.status) {
      case 'pending':
        stats.pending++;
        stats.byTier[proposal.skill.tier] = (stats.byTier[proposal.skill.tier] || 0) + 1;
        break;
      case 'approved':
        stats.approved++;
        break;
      case 'rejected':
        stats.rejected++;
        break;
      case 'expired':
        stats.expired++;
        break;
    }
  }

  return stats;
}

// =============================================================================
// FORMATTING FOR TELEGRAM
// =============================================================================

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

// Helper to get detection config
function getDetectionConfig() {
  // Import dynamically to avoid circular deps
  const { getDetectionConfig: get } = require('../config/features');
  return get();
}
