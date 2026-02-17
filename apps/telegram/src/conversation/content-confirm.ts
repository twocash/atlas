/**
 * Content Confirmation - Legacy Content Callback Types & Utilities
 *
 * Gutted in Gate 2 (Socratic migration): keyboard builders for intent-first
 * flow (buildIntentKeyboard, buildDepthKeyboard, buildAudienceKeyboard,
 * buildClassificationKeyboard) removed. Socratic Interview Engine replaces
 * all keyboard-based classification.
 *
 * Remaining: PendingContent type, content:* callback parsing, confirmation
 * keyboard (legacy UCA flow), and content preview formatting.
 *
 * Pending content state management moved to ./pending-content.ts
 */

import { InlineKeyboard } from 'grammy';
import type { Pillar, RequestType, IntentType, DepthLevel, AudienceType, StructuredContext } from './types';
import type { ContentAnalysis, ContentSource } from './content-router';

/**
 * Two-step flow state (legacy classify-first)
 * - 'classify': Awaiting pillar selection (instant keyboard, no Gemini yet)
 * - 'confirm': Pillar selected, showing type confirmation (after Gemini)
 *
 * Intent-first flow state (replaced by Socratic engine in Gate 2)
 * - 'intent': Awaiting intent selection
 * - 'depth': Awaiting depth selection
 * - 'audience': Awaiting audience selection
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

// ==========================================
// Callback Parsing
// ==========================================

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

// ==========================================
// Keyboard Builder (Legacy UCA Confirmation)
// ==========================================

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
// Content Preview Formatting
// ==========================================

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
