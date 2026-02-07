/**
 * Atlas Telegram Bot - Type Definitions
 * 
 * Shared types and interfaces used across the bot.
 */

import type { Context } from "grammy";

// ==========================================
// Bot Types
// ==========================================

/**
 * Extended context with Atlas-specific data
 */
export interface AtlasContext extends Context {
  session?: SessionData;
}

/**
 * Session data persisted between messages
 */
export interface SessionData {
  userId: number;
  conversationHistory: ConversationEntry[];
  pendingClarification?: PendingClarification;
  lastActivity: Date;
}

/**
 * A single conversation entry
 */
export interface ConversationEntry {
  role: "user" | "assistant";
  content: string;
  timestamp: Date;
}

/**
 * Pending clarification waiting for user response
 */
export interface PendingClarification {
  sparkId: string;
  question: string;
  options: ClarificationOption[];
  createdAt: Date;
}

/**
 * A clarification option presented to user
 */
export interface ClarificationOption {
  text: string;
  data: string;
  pillar?: Pillar;
  intent?: Intent;
}

// ==========================================
// Classification Types
// ==========================================

/**
 * The four life pillars
 */
export type Pillar = "Personal" | "The Grove" | "Consulting" | "Home/Garage";

/**
 * Intent classification
 */
export type Intent = 
  | "Research"
  | "Catalog"
  | "Build"
  | "Content"
  | "Reference"
  | "Task"
  | "Question";

/**
 * Classification result from SPARKS analysis
 */
export interface ClassificationResult {
  pillar: Pillar;
  intent: Intent;
  confidence: number; // 0-100
  reasoning: string;
  tags: string[];
  suggestedTitle: string;
}

/**
 * URL fetch result
 */
export interface UrlContent {
  url: string;
  title: string;
  description: string;
  bodySnippet: string;
  fetchedAt: Date;
  success: boolean;
  error?: string;
}

/**
 * A spark (raw input from Jim)
 */
export interface Spark {
  id: string;
  source: "Telegram" | "Browser" | "Manual";
  content: string;
  url?: string;
  urlContent?: UrlContent;
  receivedAt: Date;
  classification?: ClassificationResult;
  clarification?: ClarificationExchange;
}

/**
 * Clarification exchange record
 */
export interface ClarificationExchange {
  question: string;
  response: string;
  respondedAt: Date;
}

// ==========================================
// Notion Types
// ==========================================

/**
 * Decision on what to do with a spark
 */
export type Decision = 
  | "Route to Work"
  | "Archive"
  | "Defer"
  | "Dismiss";

/**
 * Atlas status for feed items
 */
export type AtlasStatus = 
  | "New"
  | "Clarifying"
  | "Classified"
  | "Routed"
  | "Archived"
  | "Dismissed";

/**
 * Work queue item status
 * 
 * Universal statuses that work for all task types:
 * - Captured: Exists, no commitment yet
 * - Active: Currently being worked on
 * - Paused: Intentionally on hold
 * - Blocked: Can't proceed, needs something
 * - Done: Complete
 * - Shipped: Delivered/published/deployed
 */
export type WorkStatus = 
  | "Captured"
  | "Active"
  | "Paused"
  | "Blocked"
  | "Done"
  | "Shipped";

/**
 * Priority levels
 */
export type Priority = "P0" | "P1" | "P2" | "P3";

/**
 * Feed item to create in Notion (activity log entry)
 */
export interface FeedItem {
  spark: string; // title
  source: string; // url
  sourceType: "Telegram" | "Browser" | "Manual";
  pillar: Pillar;
  confidence: number;
  intent: Intent;
  decision: Decision;
  atlasStatus: AtlasStatus;
  atlasNotes: string;
  tags: string[];
  sparkDate: Date;
  decisionDate?: Date;
}

/** @deprecated Use FeedItem instead */
export type InboxItem = FeedItem;

/**
 * Work queue item to create in Notion
 */
export interface WorkItem {
  task: string; // title
  type: "Research" | "Draft" | "Build" | "Schedule" | "Answer" | "Process";
  status: WorkStatus;
  priority: Priority;
  feedSourceId?: string; // relation to feed
  notes: string;
  queuedDate: Date;
}

// ==========================================
// Audit Types
// ==========================================

/**
 * Audit log entry
 */
export interface AuditEntry {
  userId: number;
  username?: string;
  messageType: string;
  content: string;
  timestamp: Date;
  response?: string;
  notionItemId?: string;
}

// ==========================================
// Allowed User
// ==========================================

export type AllowedUser = number;

// ==========================================
// Intent Router Types (Phase 2)
// ==========================================

/**
 * Message intent types - what does the user want to do?
 */
export type MessageIntent =
  | "spark"   // URL present, "save this", capture to feed
  | "query"   // "what's in my...", "show me...", "list..."
  | "status"  // "how's...", "status on...", "where are we"
  | "lookup"  // "find...", "search...", "what did we decide"
  | "action"  // "mark X as...", "complete...", "archive..."
  | "chat";   // Conversational, unclear, general chat

/**
 * Result from intent detection
 */
export interface IntentDetectionResult {
  intent: MessageIntent;
  confidence: number; // 0-100
  reasoning: string;
  /** Extracted entities for the intent */
  entities?: IntentEntities;
}

/**
 * Entities extracted during intent detection
 */
export interface IntentEntities {
  /** URL if spark intent */
  url?: string;
  /** Filter/search terms */
  query?: string;
  /** Target pillar for filtering */
  pillar?: Pillar;
  /** Target status for filtering */
  status?: string;
  /** Item identifier for actions */
  itemId?: string;
  /** Action type (complete, archive, dismiss) */
  actionType?: "complete" | "archive" | "dismiss" | "defer";
}

/**
 * Query options for Notion databases
 */
export interface NotionQueryOptions {
  pillar?: Pillar;
  status?: AtlasStatus | WorkStatus;
  limit?: number;
  sortBy?: "created" | "updated" | "priority";
  sortDirection?: "asc" | "desc";
}

/**
 * Result from feed/work queue queries
 */
export interface NotionQueryResult {
  items: NotionItemSummary[];
  total: number;
  hasMore: boolean;
}

/**
 * Summary of a Notion item for display
 */
export interface NotionItemSummary {
  id: string;
  title: string;
  pillar?: Pillar;
  status?: string;
  priority?: Priority;
  createdAt?: Date;
  url?: string;
}

/**
 * Status summary across databases
 */
export interface StatusSummary {
  feed: {
    total: number;
    byStatus: Record<string, number>;
    byPillar: Record<string, number>;
  };
  workQueue: {
    total: number;
    byStatus: Record<string, number>;
    byPriority: Record<string, number>;
  };
  lastUpdated: Date;
}

/**
 * Search result from Notion
 */
export interface NotionSearchResult {
  id: string;
  title: string;
  type: "feed" | "work" | "page";
  snippet?: string;
  url: string;
  matchScore?: number;
}

// ==========================================
// Action Feed Types
// ==========================================

export type ActionStatus = 'Pending' | 'Actioned' | 'Dismissed' | 'Expired' | 'Snoozed';

export type ActionType = 'Triage' | 'Approval' | 'Review' | 'Alert' | 'Info';

export type ActionedVia = 'Extension' | 'Telegram' | 'Notion';

export type TriageDisposition = 'Capture' | 'Research' | 'Act On' | 'Dismiss';

export type ApprovalDisposition = 'Approve' | 'Reject' | 'Modify';

export type ReviewDisposition = 'Accept' | 'Revise' | 'Reject';

export type AlertDisposition = 'Acknowledge' | 'Escalate' | 'Snooze';

export interface ActionDataTriage {
  platform: string;
  title: string;
  creator?: string;
  url: string;
  thumbnail?: string;
  pillar?: Pillar;
  disposition?: TriageDisposition;
  wq_item_id?: string;
}

export interface ActionDataApproval {
  skill_id: string;
  skill_name: string;
  description: string;
  wq_item_id?: string;
  disposition?: ApprovalDisposition;
}

export interface ActionDataReview {
  wq_item_id: string;
  wq_title: string;
  output_url?: string;
  disposition?: ReviewDisposition;
  revision_notes?: string;
}

export interface ActionDataAlert {
  alert_type: 'dom_breakage' | 'health_check' | 'rate_limit' | 'error';
  platform?: string;
  breakage_type?: 'TOTAL' | 'PARTIAL' | 'WARNING';
  failed_selectors?: string[];
  dev_pipeline_url?: string;
  disposition?: AlertDisposition;
  snooze_until?: string;
}

export interface ActionDataInfo {
  message: string;
  details?: string;
  source?: string;
}

export type ActionData =
  | ActionDataTriage
  | ActionDataApproval
  | ActionDataReview
  | ActionDataAlert
  | ActionDataInfo;

export interface FeedActionProperties {
  actionStatus: ActionStatus;
  actionType: ActionType;
  actionData: ActionData;
  actionedAt?: string;
  actionedVia?: ActionedVia;
}

export interface ActionFeedEntry {
  id: string;
  url: string;
  createdAt: string;
  title: string;
  source: string;
  actionStatus: ActionStatus;
  actionType: ActionType;
  actionData: ActionData;
  actionedAt?: string;
  actionedVia?: ActionedVia;
}
