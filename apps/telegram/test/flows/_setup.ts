/**
 * Shared mock setup for pipeline flow tests.
 *
 * All mock.module() calls live here. The module under test (handler.ts) is
 * dynamically imported AFTER mocks register, so bun resolves the mocked deps.
 *
 * Usage in test files:
 *   import { state, config, reset, createMockContext, handleConversation } from './_setup';
 */

import { mock } from 'bun:test';

// ─── Environment ─────────────────────────────────────────

process.env.ANTHROPIC_API_KEY = 'test-key-for-flow-tests';
process.env.ATLAS_CONTENT_CONFIRM = 'true';
process.env.ATLAS_CONTEXT_ENRICHMENT = 'true';

// ─── State (captured during test execution) ──────────────

export const state = {
  capturedTrace: null as any,
  capturedAuditEntry: null as any,
  claudeCallIndex: 0,
  toolCallCount: 0,
  toolCallArgs: [] as Array<{ name: string; input: any }>,
  replyCallArgs: [] as any[],
  reactCallArgs: [] as string[],
  updateConversationCalls: [] as any[],
  storePendingDispatchCalls: [] as any[],
};

// ─── Configuration (set per-test in beforeEach) ──────────

export const config = {
  triageResult: defaultTriageResult(),
  enrichmentResult: defaultEnrichmentResult(),
  claudeResponses: [textOnlyClaudeResponse('Test response from Claude.')],
  executeToolResult: {
    success: true,
    result: { url: 'https://notion.so/test-page-123', feedUrl: 'https://notion.so/test-feed-456' },
  } as any,
  auditTrailResult: {
    feedId: 'feed-page-id-123',
    workQueueId: 'wq-page-id-456',
  } as any,
};

// ─── Default Factories ───────────────────────────────────

function defaultTriageResult() {
  return {
    intent: 'capture' as string,
    pillar: 'The Grove' as string,
    confidence: 0.9,
    requestType: 'Research' as string,
    source: 'haiku' as string,
    title: 'Test message',
    titleRationale: 'Test rationale',
    keywords: ['test'] as string[],
    command: null as any,
  };
}

function defaultEnrichmentResult() {
  return {
    enrichedContext: 'Test context slot content',
    slotsUsed: ['domain'] as string[],
    tier: 'quick' as string,
    totalTokens: 150,
    assemblyLatencyMs: 10,
    triage: { pillar: 'The Grove', confidence: 0.9 },
  };
}

export function textOnlyClaudeResponse(text: string) {
  return {
    content: [{ type: 'text', text }],
    usage: { input_tokens: 200, output_tokens: 80 },
    stop_reason: 'end_turn',
  };
}

export function toolUseClaudeResponse(toolName: string, input: Record<string, unknown>) {
  return {
    content: [
      { type: 'tool_use', id: `tool-call-${Date.now()}`, name: toolName, input },
    ],
    usage: { input_tokens: 250, output_tokens: 100 },
    stop_reason: 'tool_use',
  };
}

// ─── Reset (call in beforeEach) ──────────────────────────

export function reset() {
  state.capturedTrace = null;
  state.capturedAuditEntry = null;
  state.claudeCallIndex = 0;
  state.toolCallCount = 0;
  state.toolCallArgs = [];
  state.replyCallArgs = [];
  state.reactCallArgs = [];
  state.updateConversationCalls = [];
  state.storePendingDispatchCalls = [];
  traceCounter = 0;

  Object.assign(config, {
    triageResult: defaultTriageResult(),
    enrichmentResult: defaultEnrichmentResult(),
    claudeResponses: [textOnlyClaudeResponse('Test response from Claude.')],
    executeToolResult: {
      success: true,
      result: { url: 'https://notion.so/test-page-123', feedUrl: 'https://notion.so/test-feed-456' },
    },
    auditTrailResult: {
      feedId: 'feed-page-id-123',
      workQueueId: 'wq-page-id-456',
    },
  });
}

// ─── Mock Context Factory ────────────────────────────────

export function createMockContext(options: {
  userId?: number;
  username?: string;
  messageText?: string;
  chatId?: number;
  messageId?: number;
} = {}): any {
  const {
    userId = 12345,
    username = 'testuser',
    messageText = 'Test message',
    chatId = 67890,
    messageId = 1001,
  } = options;

  return {
    from: { id: userId, username },
    message: {
      text: messageText,
      caption: undefined,
      photo: undefined,
      document: undefined,
      video: undefined,
      voice: undefined,
      message_id: messageId,
    },
    chat: { id: chatId },
    react: async (emoji: string) => { state.reactCallArgs.push(emoji); },
    reply: async (text: string, opts?: any) => {
      state.replyCallArgs.push({ text, options: opts });
      return { message_id: messageId + 1 };
    },
    replyWithChatAction: async (_action: string) => {},
  };
}

// ─── Trace Helpers ───────────────────────────────────────

export function getStepNames(trace: any): string[] {
  return (trace?.steps || []).map((s: any) => s.name);
}

export function getStep(trace: any, name: string): any {
  return (trace?.steps || []).find((s: any) => s.name === name);
}

// ─── Trace Implementation (lightweight spy) ──────────────

let traceCounter = 0;

function createTraceImpl() {
  const trace = {
    traceId: `test-trace-${++traceCounter}`,
    startedAt: Date.now(),
    steps: [] as any[],
    status: 'active' as string,
    totalDurationMs: undefined as number | undefined,
    error: undefined as string | undefined,
  };
  state.capturedTrace = trace;
  return trace;
}

function addStepImpl(trace: any, name: string, metadata?: any) {
  const step = {
    name,
    startedAt: Date.now(),
    metadata,
    completedAt: undefined as number | undefined,
    durationMs: undefined as number | undefined,
  };
  trace.steps.push(step);
  return step;
}

function completeStepImpl(step: any) {
  step.completedAt = Date.now();
  step.durationMs = step.completedAt - step.startedAt;
}

function completeTraceImpl(trace: any) {
  trace.status = 'complete';
  trace.totalDurationMs = Date.now() - trace.startedAt;
}

function failTraceImpl(trace: any, error: any) {
  trace.status = 'failed';
  trace.error = error instanceof Error ? error.message : String(error);
  trace.totalDurationMs = Date.now() - trace.startedAt;
}

// ─── Mock Module Registrations ───────────────────────────

// Trace
mock.module('@atlas/shared/trace', () => ({
  createTrace: createTraceImpl,
  addStep: addStepImpl,
  completeStep: completeStepImpl,
  completeTrace: completeTraceImpl,
  failTrace: failTraceImpl,
}));

// Anthropic SDK
mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    constructor(_opts: any) {}
    messages = {
      create: async (_opts: any) => {
        const resp = config.claudeResponses[state.claudeCallIndex++];
        if (!resp) throw new Error(`No Claude response configured for call #${state.claudeCallIndex}`);
        return resp;
      },
    };
  },
}));

// Logger
mock.module('../../src/logger', () => ({
  logger: { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} },
}));

// Formatting
mock.module('../../src/formatting', () => ({
  formatMessage: (text: string) => text,
}));

// Conversation context
mock.module('../../src/conversation/context', () => ({
  getConversation: async () => ({ userId: 12345, messages: [], toolContexts: [], metadata: {} }),
  updateConversation: async (...args: any[]) => { state.updateConversationCalls.push(args); },
  buildMessages: (_conv: any, userContent: string) => [{ role: 'user', content: userContent }],
}));

// Prompt builder
mock.module('../../src/conversation/prompt', () => ({
  buildSystemPrompt: async () => 'You are Atlas, a test system prompt.',
}));

// Attachments
mock.module('../../src/conversation/attachments', () => ({
  detectAttachment: () => ({ type: 'none' }),
  buildAttachmentPrompt: () => '',
}));

// Media
mock.module('../../src/conversation/media', () => ({
  processMedia: async () => null,
  buildMediaContext: () => '',
  buildAnalysisContent: () => '',
}));

// Audit
mock.module('../../src/conversation/audit', () => ({
  createAuditTrail: async (entry: any, trace: any) => {
    state.capturedAuditEntry = entry;
    return config.auditTrailResult;
  },
}));

// Tools
mock.module('../../src/conversation/tools', () => ({
  getAllTools: () => [
    { name: 'submit_ticket', description: 'Submit a ticket', input_schema: { type: 'object', properties: {} } },
    { name: 'dispatch_research', description: 'Dispatch research', input_schema: { type: 'object', properties: {} } },
  ],
  executeTool: async (name: string, input: any) => {
    state.toolCallCount++;
    state.toolCallArgs.push({ name, input });
    return config.executeToolResult;
  },
}));

// Stats
mock.module('../../src/conversation/stats', () => ({
  recordUsage: async () => {},
}));

// Content flow
mock.module('../../src/conversation/content-flow', () => ({
  maybeHandleAsContentShare: async () => false,
  triggerMediaConfirmation: async () => false,
  triggerInstantClassification: async () => false,
}));

// Socratic session
mock.module('../../src/conversation/socratic-session', () => ({
  hasPendingSocraticSessionForUser: () => false,
}));

// Socratic adapter
mock.module('../../src/conversation/socratic-adapter', () => ({
  handleSocraticAnswer: async () => false,
}));

// Skills
mock.module('../../src/skills', () => ({
  logAction: async () => {},
  isFeatureEnabled: () => false,
}));

// Error escalation
mock.module('@atlas/shared/error-escalation', () => ({
  reportFailure: () => {},
}));

// Triage skill
mock.module('../../src/cognitive/triage-skill', () => ({
  classifyWithFallback: async () => ({ pillar: 'The Grove', confidence: 0.9 }),
  triageForAudit: async (text: string) => ({
    classification: {
      pillar: config.triageResult.pillar,
      requestType: config.triageResult.requestType,
      confidence: config.triageResult.confidence,
      workType: config.triageResult.requestType.toLowerCase(),
      keywords: config.triageResult.keywords,
      reasoning: 'fallback triage',
    },
    smartTitle: text.substring(0, 100),
  }),
  triageMessage: async () => config.triageResult,
}));

// Context enrichment
mock.module('../../src/conversation/context-enrichment', () => ({
  enrichWithContextSlots: async () => config.enrichmentResult,
}));

// Dispatch choice
mock.module('../../src/conversation/dispatch-choice', () => ({
  generateDispatchChoiceId: () => 'test-choice-id-1',
  storePendingDispatch: (data: any) => { state.storePendingDispatchCalls.push(data); },
  formatRoutingChoiceMessage: () => '<b>Choose routing:</b>',
  buildRoutingChoiceKeyboard: () => ({
    inline_keyboard: [[
      { text: 'The Grove', callback_data: 'route:test-choice-id-1:The Grove' },
      { text: 'Consulting', callback_data: 'route:test-choice-id-1:Consulting' },
    ]],
  }),
}));

// ─── Dynamic Import (AFTER all mocks) ───────────────────
// bun hoists mock.module() within a single file only. Since our mocks live
// here in _setup.ts, we must dynamically import the handler so bun resolves
// its dependencies against the mocked modules.

export const { handleConversation } = await import('../../src/conversation/handler');
