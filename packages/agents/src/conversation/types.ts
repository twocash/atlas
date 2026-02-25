/**
 * Atlas Telegram Bot - Conversation Types
 *
 * Type definitions for the conversational UX system.
 */

// The Four Pillars
export const PILLARS = ['Personal', 'The Grove', 'Consulting', 'Home/Garage'] as const;
export type Pillar = typeof PILLARS[number];

// Request types for Feed entries
export const REQUEST_TYPES = [
  'Research', 'Draft', 'Build', 'Schedule',
  'Answer', 'Process', 'Quick', 'Triage', 'Chat'
] as const;
export type RequestType = typeof REQUEST_TYPES[number];

// Feed status
export const FEED_STATUSES = ['Received', 'Processing', 'Routed', 'Done', 'Dismissed'] as const;
export type FeedStatus = typeof FEED_STATUSES[number];

// Work Queue status
export const WQ_STATUSES = ['Captured', 'Active', 'Paused', 'Blocked', 'Done', 'Shipped'] as const;
export type WQStatus = typeof WQ_STATUSES[number];

// Classification result from Claude
export interface ClassificationResult {
  pillar: Pillar;
  requestType: RequestType;
  confidence: number;
  workType: string;
  keywords: string[];
  reasoning: string;
}

// Tool definitions for Claude
export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

// ==========================================
// Intent-First Structured Context (Phase 0)
// ==========================================

// What's the play?
export const INTENT_TYPES = ['research', 'draft', 'save', 'analyze', 'capture', 'engage'] as const;
export type IntentType = typeof INTENT_TYPES[number];

// How deep?
export const DEPTH_LEVELS = ['quick', 'standard', 'deep'] as const;
export type DepthLevel = typeof DEPTH_LEVELS[number];

// Who's this for?
export const AUDIENCE_TYPES = ['self', 'client', 'public', 'team'] as const;
export type AudienceType = typeof AUDIENCE_TYPES[number];

// Source type (auto-detected, not user-selected)
export const SOURCE_TYPES = ['url', 'image', 'document', 'video', 'audio', 'text', 'github', 'linkedin'] as const;
export type SourceType = typeof SOURCE_TYPES[number];

// Output format (derived or selected)
export const FORMAT_TYPES = ['post', 'brief', 'analysis', 'report', 'thread', 'raw'] as const;
export type FormatType = typeof FORMAT_TYPES[number] | null;

// Complete structured context object
export interface StructuredContext {
  intent: IntentType;
  depth: DepthLevel;
  audience: AudienceType;
  source_type: SourceType;
  format: FormatType;
  voice_hint: string | null;
}

// Tool call from Claude
export interface ToolCall {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

// Tool result
export interface ToolResult {
  success: boolean;
  data?: unknown;
  error?: string;
}

/**
 * URL fetch result
 */
export interface UrlContent {
  url: string;
  title: string;
  description: string;
  bodySnippet: string;
  /** Full extracted content for research pipeline (not truncated) */
  fullContent?: string;
  /** Haiku's 2-3 sentence summary of what the content is about */
  preReadSummary?: string;
  /** Content type from Haiku pre-read (article, social_post, discussion, profile, unknown) */
  preReadContentType?: string;
  fetchedAt: Date;
  success: boolean;
  error?: string;
}

/**
 * Two-step flow state (legacy classify-first)
 */
export type ContentFlowState = 'classify' | 'intent' | 'depth' | 'audience' | 'confirm';

/**
 * Pending content awaiting confirmation.
 * Copied from apps/telegram/src/conversation/content-confirm.ts for
 * cross-package type compatibility. Telegram-specific fields use
 * permissive types to avoid pulling in surface-layer dependencies.
 */
export interface PendingContent {
  requestId: string;
  chatId: number;
  userId: number;
  messageId?: number;
  confirmMessageId?: number;

  flowState: ContentFlowState;

  /** Content analysis (Telegram surface-specific shape) */
  analysis: Record<string, unknown>;
  originalText: string;

  pillar: Pillar;
  requestType: RequestType;

  originalSuggestion?: RequestType;
  classificationAdjusted?: boolean;

  intent?: IntentType;
  depth?: DepthLevel;
  audience?: AudienceType;
  structuredContext?: StructuredContext;

  timestamp: number;
  url?: string;

  mediaBuffer?: Buffer;
  attachmentInfo?: Record<string, unknown>;

  fullAnalysisText?: string;
}
