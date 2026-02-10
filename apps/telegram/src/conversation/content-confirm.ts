/**
 * Content Confirmation - Interactive Classification Keyboard
 *
 * After content analysis, presents an inline keyboard for Jim to:
 * 1. Review the extracted content summary
 * 2. Confirm or adjust Pillar classification
 * 3. Confirm or adjust Request Type
 * 4. One-tap confirm or skip
 *
 * This ensures accurate classification with minimal friction (10-second rule).
 */

import { InlineKeyboard } from 'grammy';
import { logger } from '../logger';
import type { Pillar, RequestType, IntentType, DepthLevel, AudienceType, StructuredContext, SourceType } from './types';
import type { ContentAnalysis, ContentSource } from './content-router';

/**
 * Two-step flow state (legacy classify-first)
 * - 'classify': Awaiting pillar selection (instant keyboard, no Gemini yet)
 * - 'confirm': Pillar selected, showing type confirmation (after Gemini)
 *
 * Intent-first flow state
 * - 'intent': Awaiting intent selection (What's the play?)
 * - 'depth': Awaiting depth selection (How deep?)
 * - 'audience': Awaiting audience selection (Who's this for?)
 * - 'confirm': Final review before creation
 */
export type ContentFlowState = 'classify' | 'intent' | 'depth' | 'audience' | 'confirm';

/**
 * Pending content awaiting confirmation
 */
export interface PendingContent {
  requestId: string;
  chatId: number;
  userId: number;
  messageId?: number;        // Original message ID
  confirmMessageId?: number; // Confirmation message ID (for editing)

  // Flow state (supports both legacy classify-first and intent-first)
  flowState: ContentFlowState;

  // Content analysis (may be null during 'classify'/'intent' phase)
  analysis: ContentAnalysis;
  originalText: string;      // Original message text

  // Classification (can be adjusted via keyboard)
  pillar: Pillar;
  requestType: RequestType;

  // Pattern learning
  originalSuggestion?: RequestType;  // What Atlas initially suggested
  classificationAdjusted?: boolean;  // Did user change the suggestion?

  // Intent-First structured context (progressive capture)
  intent?: IntentType;
  depth?: DepthLevel;
  audience?: AudienceType;
  structuredContext?: StructuredContext;

  // Metadata
  timestamp: number;
  url?: string;

  // Media context (for deferred Gemini processing)
  mediaBuffer?: Buffer;
  attachmentInfo?: import('./attachments').AttachmentInfo;

  // Full Gemini analysis (not truncated) - for writing to Feed/WQ page body
  fullAnalysisText?: string;
}

/**
 * In-memory store for pending confirmations
 * Key: requestId (unique per confirmation flow)
 */
const pendingContent = new Map<string, PendingContent>();

// Auto-expire pending content after 10 minutes
const EXPIRY_MS = 10 * 60 * 1000;

/**
 * Generate a unique request ID
 */
export function generateRequestId(): string {
  return `${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Store pending content for confirmation
 */
export function storePendingContent(content: PendingContent): void {
  pendingContent.set(content.requestId, content);

  // Schedule auto-cleanup
  setTimeout(() => {
    if (pendingContent.has(content.requestId)) {
      pendingContent.delete(content.requestId);
      logger.debug('Expired pending content', { requestId: content.requestId });
    }
  }, EXPIRY_MS);

  logger.debug('Stored pending content', {
    requestId: content.requestId,
    pillar: content.pillar,
    requestType: content.requestType,
  });
}

/**
 * Retrieve pending content by request ID
 */
export function getPendingContent(requestId: string): PendingContent | undefined {
  return pendingContent.get(requestId);
}

/**
 * Update pending content (after keyboard selection)
 */
export function updatePendingContent(requestId: string, updates: Partial<PendingContent>): boolean {
  const existing = pendingContent.get(requestId);
  if (!existing) return false;

  pendingContent.set(requestId, { ...existing, ...updates });
  return true;
}

/**
 * Remove pending content (after confirm/skip)
 */
export function removePendingContent(requestId: string): boolean {
  return pendingContent.delete(requestId);
}

/**
 * Get icon for content source
 */
function getSourceIcon(source: ContentSource): string {
  const icons: Record<ContentSource, string> = {
    threads: '🧵',
    twitter: '🐦',
    linkedin: '💼',
    github: '🐙',
    youtube: '📺',
    article: '📄',
    generic: '🔗',
  };
  return icons[source] || '📎';
}

/**
 * Get icon for media type
 */
function getMediaIcon(type: string): string {
  const icons: Record<string, string> = {
    image: '🖼️',
    photo: '🖼️',
    document: '📄',
    audio: '🎵',
    voice: '🎤',
    video: '🎬',
    video_note: '🎬',
  };
  return icons[type] || '📎';
}

/**
 * Format INSTANT classification preview (before Gemini analysis)
 * Shows minimal info to enable fast classification
 */
export function formatClassificationPreview(pending: PendingContent): string {
  const icon = pending.attachmentInfo
    ? getMediaIcon(pending.attachmentInfo.type)
    : getSourceIcon(pending.analysis?.source || 'generic');

  let preview = `${icon} <b>Content received</b>\n`;

  if (pending.attachmentInfo) {
    const att = pending.attachmentInfo;
    if (att.fileName) {
      preview += `📁 ${att.fileName}\n`;
    } else {
      preview += `📁 ${att.type}\n`;
    }
    if (att.fileSize) {
      preview += `📊 ${formatFileSize(att.fileSize)}\n`;
    }
    if (att.caption) {
      preview += `\n"${att.caption.substring(0, 100)}${att.caption.length > 100 ? '...' : ''}"\n`;
    }
  } else if (pending.url) {
    preview += `🔗 ${pending.url.substring(0, 60)}${pending.url.length > 60 ? '...' : ''}\n`;
  }

  preview += `\n<b>Quick classify:</b>`;

  return preview;
}

/**
 * Helper to format file size
 */
function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

/**
 * Get icon for pillar
 */
function getPillarIcon(pillar: Pillar): string {
  const icons: Record<Pillar, string> = {
    'Personal': '👤',
    'The Grove': '🌳',
    'Consulting': '💼',
    'Home/Garage': '🏠',
  };
  return icons[pillar] || '📁';
}

/**
 * Format content preview message
 */
export function formatContentPreview(pending: PendingContent): string {
  const { analysis, pillar, requestType } = pending;
  const icon = getSourceIcon(analysis.source);
  const pillarIcon = getPillarIcon(pillar);

  let preview = `${icon} <b>${analysis.title || 'Content Shared'}</b>\n`;

  if (analysis.author) {
    preview += `By: ${analysis.author}\n`;
  }

  if (analysis.description) {
    const desc = analysis.description.length > 150
      ? analysis.description.substring(0, 147) + '...'
      : analysis.description;
    preview += `\n${desc}\n`;
  }

  preview += `\n${pillarIcon} <b>Pillar:</b> ${pillar}`;
  preview += `\n📋 <b>Type:</b> ${requestType}`;
  preview += `\n🔍 <b>Method:</b> ${analysis.method}`;

  return preview;
}

/**
 * Build the INSTANT classification keyboard (Phase 1: Classify First)
 *
 * Layout:
 * [🌳 Grove] [💼 Consult] [👤 Personal] [🏠 Home]
 * [📂 Quick File] [🔍 Analyze First]
 *
 * This shows IMMEDIATELY when media/URL is shared, BEFORE running Gemini.
 */
export function buildClassificationKeyboard(requestId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Pillar row with icons
  keyboard.text('🌳 Grove', `content:${requestId}:classify:The Grove`);
  keyboard.text('💼 Consult', `content:${requestId}:classify:Consulting`);
  keyboard.text('👤 Personal', `content:${requestId}:classify:Personal`);
  keyboard.text('🏠 Home', `content:${requestId}:classify:Home/Garage`);
  keyboard.row();

  // Quick actions
  keyboard.text('📂 Quick File', `content:${requestId}:quickfile`);
  keyboard.text('🔍 Analyze First', `content:${requestId}:analyze`);

  return keyboard;
}

/**
 * Build the confirmation inline keyboard (Phase 2: After Pillar Selected)
 *
 * Layout:
 * [Grove] [Consulting] [Personal] [Home]
 * [Research] [Draft] [Build] [Quick]
 * [✅ Confirm] [❌ Skip]
 */
export function buildConfirmationKeyboard(
  requestId: string,
  currentPillar: Pillar,
  currentType: RequestType
): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  // Pillar row - checkmark on selected
  const pillars: Pillar[] = ['The Grove', 'Consulting', 'Personal', 'Home/Garage'];
  pillars.forEach((p) => {
    const isSelected = p === currentPillar;
    const label = isSelected ? `✓ ${p.replace('Home/Garage', 'Home')}` : p.replace('Home/Garage', 'Home');
    keyboard.text(label, `content:${requestId}:pillar:${p}`);
    // Add to same row (4 buttons)
  });
  keyboard.row();

  // Type row - checkmark on selected
  const types: RequestType[] = ['Research', 'Draft', 'Build', 'Quick'];
  types.forEach((t) => {
    const isSelected = t === currentType;
    const label = isSelected ? `✓ ${t}` : t;
    keyboard.text(label, `content:${requestId}:type:${t}`);
  });
  keyboard.row();

  // Action row
  keyboard.text('✅ Confirm', `content:${requestId}:confirm`);
  keyboard.text('❌ Skip', `content:${requestId}:skip`);

  return keyboard;
}

// ==========================================
// Intent-First Keyboard Builders (Phase 1)
// ==========================================

/**
 * Build the INTENT keyboard (Step 1: "What's the play?")
 *
 * Layout:
 * [🔍 Research] [✏️ Draft]
 * [📌 Save] [📊 Analyze]
 * [📸 Capture] [💬 Engage]
 */
export function buildIntentKeyboard(requestId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text('🔍 Research', `intent:${requestId}:intent:research`);
  keyboard.text('✏️ Draft', `intent:${requestId}:intent:draft`);
  keyboard.row();
  keyboard.text('📌 Save', `intent:${requestId}:intent:save`);
  keyboard.text('📊 Analyze', `intent:${requestId}:intent:analyze`);
  keyboard.row();
  keyboard.text('📸 Capture', `intent:${requestId}:intent:capture`);
  keyboard.text('💬 Engage', `intent:${requestId}:intent:engage`);
  keyboard.row();
  keyboard.text('❌ Skip', `intent:${requestId}:skip`);

  return keyboard;
}

/**
 * Build the DEPTH keyboard (Step 2: "How deep?")
 *
 * Layout:
 * [⚡ Quick] [📊 Standard] [🔬 Deep Dive]
 */
export function buildDepthKeyboard(requestId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text('⚡ Quick', `intent:${requestId}:depth:quick`);
  keyboard.text('📊 Standard', `intent:${requestId}:depth:standard`);
  keyboard.text('🔬 Deep Dive', `intent:${requestId}:depth:deep`);
  keyboard.row();
  keyboard.text('⬅️ Back', `intent:${requestId}:back:intent`);
  keyboard.text('❌ Skip', `intent:${requestId}:skip`);

  return keyboard;
}

/**
 * Build the AUDIENCE keyboard (Step 3: "Who's this for?")
 *
 * Layout:
 * [🙋 Just Me] [💼 Client]
 * [🌐 Public] [👥 Team]
 */
export function buildAudienceKeyboard(requestId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text('🙋 Just Me', `intent:${requestId}:audience:self`);
  keyboard.text('💼 Client', `intent:${requestId}:audience:client`);
  keyboard.row();
  keyboard.text('🌐 Public', `intent:${requestId}:audience:public`);
  keyboard.text('👥 Team', `intent:${requestId}:audience:team`);
  keyboard.row();
  keyboard.text('⬅️ Back', `intent:${requestId}:back:depth`);
  keyboard.text('❌ Skip', `intent:${requestId}:skip`);

  return keyboard;
}

/**
 * Build the intent-first CONFIRMATION keyboard (Step 4: Review)
 *
 * Shows assembled context with confirm/back/skip
 */
export function buildIntentConfirmKeyboard(requestId: string): InlineKeyboard {
  const keyboard = new InlineKeyboard();

  keyboard.text('✅ Confirm', `intent:${requestId}:confirm`);
  keyboard.text('⬅️ Back', `intent:${requestId}:back:audience`);
  keyboard.text('❌ Skip', `intent:${requestId}:skip`);

  return keyboard;
}

// ==========================================
// Pillar Derivation (Phase 1)
// ==========================================

/**
 * Derive pillar from structured context
 *
 * Backward-compatible: produces a Pillar value from intent+depth+audience
 * so downstream systems (prompt composition, voice, agent routing) work unchanged.
 */
export function derivePillarFromContext(ctx: StructuredContext): Pillar {
  // Audience-driven primary mapping
  if (ctx.audience === 'client') return 'Consulting';
  if (ctx.audience === 'public') return 'The Grove';  // public content = Grove voice

  // Intent-driven secondary mapping
  if (ctx.intent === 'research' && ctx.depth === 'deep') return 'The Grove';
  if (ctx.intent === 'engage') return 'Consulting';  // engagement = professional
  if (ctx.intent === 'draft' && ctx.audience === 'team') return 'The Grove';

  // Source-type hints
  if (ctx.source_type === 'github') return 'The Grove';
  if (ctx.source_type === 'linkedin') return 'Consulting';

  // Default
  return 'Personal';
}

/**
 * Detect source type from URL or attachment info
 */
export function detectSourceType(url?: string, attachmentType?: string): SourceType {
  if (attachmentType) {
    switch (attachmentType) {
      case 'photo':
      case 'image': return 'image';
      case 'document': return 'document';
      case 'video':
      case 'video_note': return 'video';
      case 'voice':
      case 'audio': return 'audio';
      default: return 'text';
    }
  }

  if (url) {
    const lower = url.toLowerCase();
    if (lower.includes('github.com')) return 'github';
    if (lower.includes('linkedin.com')) return 'linkedin';
    return 'url';
  }

  return 'text';
}

// ==========================================
// Intent-First Callback Parsing
// ==========================================

/**
 * Parse callback data from intent-first keyboard press
 */
export type IntentCallbackAction = 'intent' | 'depth' | 'audience' | 'confirm' | 'skip' | 'back';

export function parseIntentCallbackData(data: string): {
  requestId: string;
  action: IntentCallbackAction;
  value?: string;
} | null {
  if (!data.startsWith('intent:')) return null;

  const parts = data.split(':');
  if (parts.length < 3) return null;

  const [, requestId, action, value] = parts;

  if (!['intent', 'depth', 'audience', 'confirm', 'skip', 'back'].includes(action)) return null;

  return {
    requestId,
    action: action as IntentCallbackAction,
    value,
  };
}

/**
 * Check if a callback query is for intent-first flow
 */
export function isIntentCallback(data: string | undefined): boolean {
  return data?.startsWith('intent:') ?? false;
}

/**
 * Parse callback data from keyboard press
 * Supports both classify-first flow and confirmation flow
 */
export function parseCallbackData(data: string): {
  requestId: string;
  action: 'classify' | 'quickfile' | 'analyze' | 'pillar' | 'type' | 'confirm' | 'skip';
  value?: string;
} | null {
  if (!data.startsWith('content:')) return null;

  const parts = data.split(':');
  if (parts.length < 3) return null;

  const [, requestId, action, value] = parts;

  // Valid actions: classify-first (classify, quickfile, analyze) + confirmation (pillar, type, confirm, skip)
  if (!['classify', 'quickfile', 'analyze', 'pillar', 'type', 'confirm', 'skip'].includes(action)) return null;

  return {
    requestId,
    action: action as 'classify' | 'quickfile' | 'analyze' | 'pillar' | 'type' | 'confirm' | 'skip',
    value: value ? decodeURIComponent(value) : undefined,
  };
}

/**
 * Check if a callback query is for content confirmation
 */
export function isContentCallback(data: string | undefined): boolean {
  return data?.startsWith('content:') ?? false;
}

/**
 * Get count of pending confirmations (for debugging)
 */
export function getPendingCount(): number {
  return pendingContent.size;
}

/**
 * Clear all pending content (for testing/reset)
 */
export function clearAllPending(): void {
  pendingContent.clear();
}
