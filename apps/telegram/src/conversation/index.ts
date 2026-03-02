/**
 * Atlas Telegram Bot - Conversation Module
 *
 * Exports for the conversational UX system.
 */

export { handleConversation, handleConversationWithTools } from './handler';
export { getConversation, clearConversation, updateConversation } from '@atlas/agents/src/conversation/context';
export { buildSystemPrompt, getIdentity } from '@atlas/agents/src/conversation/prompt';
export { detectAttachment, formatAttachmentInfo, buildAttachmentPrompt } from '@atlas/agents/src/conversation/attachments';
export { createAuditTrail, updateWorkQueueStatus, logReclassification } from '@atlas/agents/src/conversation/audit';

// Socratic Interview Engine (Gate 2)
export { socraticInterview, handleSocraticAnswer } from './socratic-adapter';
export { hasActiveSession, getState, getStateByUserId, isInPhase } from '@atlas/agents/src/conversation/conversation-state';
export { generateRequestId, storePendingContent, getPendingContent, updatePendingContent, removePendingContent } from '@atlas/agents/src/conversation/conversation-state';

// Universal Content Analysis (Phase 5)
export { maybeHandleAsContentShare, triggerContentConfirmation, detectContentShare } from './content-flow';
export { routeForAnalysis, detectContentSource, extractDomain } from '@atlas/agents/src/conversation/content-router';
export type { ContentAnalysis, ContentSource, ExtractionMethod, RouteResult } from '@atlas/agents/src/conversation/content-router';
export type { PendingContent } from './content-confirm';
export { getAllTools, executeTool } from '@atlas/agents/src/conversation/tools';
export { recordUsage, getStats, getWorkQueueStats, formatStatsMessage, detectPatterns } from '@atlas/agents/src/conversation/stats';
export { planTask, determineDepth, selectModel, estimateTime, formatTaskPlan, getModelName } from '@atlas/agents/src/conversation/router';
export type { TaskDepth, TaskPlan } from '@atlas/agents/src/conversation/router';
export type {
  Pillar,
  RequestType,
  FeedStatus,
  WQStatus,
  ClassificationResult,
  ToolDefinition,
  ToolCall,
  ToolResult,
} from './types';
export type { AuditEntry, AuditResult } from '@atlas/agents/src/conversation/audit';
export type { ConversationState, ConversationMessage } from '@atlas/agents/src/conversation/context';
export type { AttachmentType, AttachmentInfo } from '@atlas/agents/src/conversation/attachments';
