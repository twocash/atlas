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
