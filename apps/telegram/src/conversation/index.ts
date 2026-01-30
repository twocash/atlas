/**
 * Atlas Telegram Bot - Conversation Module
 *
 * Exports for the conversational UX system.
 */

export { handleConversation, handleConversationWithTools } from './handler';
export { getConversation, clearConversation, updateConversation } from './context';
export { buildSystemPrompt, getIdentity } from './prompt';
export { detectAttachment, formatAttachmentInfo, buildAttachmentPrompt } from './attachments';
export { createAuditTrail, updateWorkQueueStatus, logReclassification } from './audit';
export { ALL_TOOLS, executeTool } from './tools';
export { recordUsage, getStats, getWorkQueueStats, formatStatsMessage, detectPatterns } from './stats';
export { planTask, determineDepth, selectModel, estimateTime, formatTaskPlan, getModelName } from './router';
export type { TaskDepth, TaskPlan } from './router';
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
export type { AuditEntry, AuditResult } from './audit';
export type { ConversationState, ConversationMessage } from './context';
export type { AttachmentType, AttachmentInfo } from './attachments';
