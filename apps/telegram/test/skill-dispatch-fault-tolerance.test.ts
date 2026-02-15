/**
 * Skill Dispatch & Fault Tolerance Regression Tests
 *
 * Catches two classes of bugs that shipped in the intent-first flow:
 *
 * BUG A (Silent Failure): content-flow.ts wrapped triage + route + store
 *   in a single try/catch. Any enrichment failure → return false → keyboard
 *   never shows → user sees Claude chat instead of the intent keyboard.
 *   FIX: Three independent try/catch blocks. Keyboard ALWAYS shows.
 *
 * BUG B (Skill Dispatch Gap): intent-callback.ts created Feed + Work Queue
 *   entries on confirm but never dispatched any skill or research agent.
 *   Threads, LinkedIn, Twitter URLs all went into a black hole.
 *   FIX: dispatchSkillOrResearch checks skill registry first, falls back
 *   to Gemini only when no skill matches and intent is 'research'.
 *
 * Added to Master Blaster regression suite.
 */

import { describe, it, expect, beforeEach, mock, afterEach } from 'bun:test';

// ==========================================
// Mock setup — BEFORE any src imports
// ==========================================

// Track skill execution calls
const mockExecuteSkill = mock(() => Promise.resolve({ success: true, steps: [] }));
const mockFindBestMatch = mock(() => null as any);
const mockInitializeSkillRegistry = mock(() => Promise.resolve());

mock.module('../src/skills/registry', () => ({
  getSkillRegistry: () => ({
    findBestMatch: mockFindBestMatch,
    findMatches: () => [],
    get: () => undefined,
  }),
  initializeSkillRegistry: mockInitializeSkillRegistry,
  SkillRegistry: class {},
}));

mock.module('../src/skills/executor', () => ({
  executeSkill: mockExecuteSkill,
  executeSkillByName: mock(() => Promise.resolve()),
  executeSkillWithApproval: mock(() => Promise.resolve()),
}));

// Track research agent calls
const mockRunResearch = mock(() =>
  Promise.resolve({
    agent: { name: 'research' },
    result: { summary: 'Mock research result', findings: [] },
  })
);
const mockSendCompletion = mock(() => Promise.resolve());

mock.module('../src/services/research-executor', () => ({
  runResearchAgentWithNotifications: mockRunResearch,
  sendCompletionNotification: mockSendCompletion,
}));

// Mock Notion client
const mockPagesCreate = mock(() =>
  Promise.resolve({ id: 'mock-page-id', url: 'https://notion.so/mock-page' })
);

mock.module('@notionhq/client', () => ({
  Client: class MockClient {
    pages = {
      create: mockPagesCreate,
      update: mock(() => Promise.resolve({})),
    };
    databases = { retrieve: mock(() => Promise.resolve({ id: 'mock-db-id' })) };
  },
}));

// Mock logger
mock.module('../src/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Mock feature flags
mock.module('../src/config/features', () => ({
  getFeatureFlags: () => ({
    duplicateConfirmationGuard: false,
    triageSkill: false,
    skillLogging: false,
    zoneClassifier: false,
    swarmDispatch: false,
    selfImprovementListener: false,
  }),
}));

// Mock skills barrel (logAction, isFeatureEnabled)
mock.module('../src/skills', () => ({
  logAction: mock(() => Promise.resolve()),
  isFeatureEnabled: () => false,
}));

// Triage — used to test fault tolerance (can be made to throw)
const mockTriageMessage = mock(() =>
  Promise.resolve({
    title: 'Triage Title',
    intent: 'research',
    confidence: 0.85,
    pillar: 'The Grove',
    complexityTier: 'Tier 2',
    source: 'Telegram',
    latencyMs: 100,
  })
);
mock.module('../src/cognitive/triage-skill', () => ({
  triageMessage: mockTriageMessage,
}));

// Route analysis — can also be made to throw
const mockRouteForAnalysis = mock(() =>
  Promise.resolve({
    source: 'article',
    method: 'Fetch',
    domain: 'example.com',
    needsBrowser: false,
  })
);
mock.module('../src/conversation/content-router', () => ({
  routeForAnalysis: mockRouteForAnalysis,
  extractUrlsFromText: (text: string) => {
    const urlRegex = /https?:\/\/[^\s]+/g;
    return text.match(urlRegex) || [];
  },
  detectContentSource: () => 'article',
  extractDomain: (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
  },
  buildContentPayload: (analysis: any) => ({ title: analysis?.title }),
}));

// Mock notion-url
mock.module('../src/conversation/notion-url', () => ({
  isNotionUrl: () => false,
  handleNotionUrl: () => Promise.resolve(false),
}));

// Mock telegram helpers
mock.module('../src/utils/telegram-helpers', () => ({
  safeAnswerCallback: mock(() => Promise.resolve()),
}));

// Mock @atlas/shared/notion
mock.module('@atlas/shared/notion', () => ({
  convertMarkdownToNotionBlocks: () => [],
}));

// Mock audit — returns IDs for dispatch verification
const mockCreateAuditTrail = mock(() =>
  Promise.resolve({
    feedId: 'mock-feed-id',
    workQueueId: 'mock-wq-id',
    feedUrl: 'https://notion.so/mock-feed',
    workQueueUrl: 'https://notion.so/mock-wq',
  })
);
mock.module('../src/conversation/audit', () => ({
  createAuditTrail: mockCreateAuditTrail,
  verifyDatabaseAccess: mock(() => Promise.resolve({ feed: true, workQueue: true, details: 'ok' })),
}));

// Mock prompt-selection
mock.module('../src/conversation/prompt-selection', () => ({
  getSelection: () => null,
  updateSelection: () => {},
  selectPillar: () => {},
  selectAction: () => {},
  selectVoice: () => {},
  removeSelection: () => {},
  createSelection: () => ({}),
}));

// Mock triage-patterns
mock.module('../src/cognitive/triage-patterns', () => ({
  recordTriageFeedback: mock(() => {}),
}));

// Mock action-log
mock.module('../src/skills/action-log', () => ({
  logAction: mock(() => Promise.resolve()),
  logClassification: mock(() => Promise.resolve()),
  logToolExecution: mock(() => Promise.resolve()),
  logMediaAction: mock(() => Promise.resolve()),
  logTriageAction: mock(() => Promise.resolve()),
  getIntentHash: () => 'mock-hash',
}));

// Mock prompt-selection-callback
mock.module('../src/handlers/prompt-selection-callback', () => ({
  startPromptSelection: mock(() => Promise.resolve()),
  handlePromptSelectionCallback: mock(() => Promise.resolve()),
  isPromptSelectionCallback: () => false,
}));

// Mock packages/agents
mock.module('../../../../packages/agents/src', () => ({
  ResearchAgent: class {},
}));

// ==========================================
// NOW import the modules under test
// ==========================================

import {
  storePendingContent,
  getPendingContent,
  clearAllPending,
  getPendingCount,
  generateRequestId,
  type PendingContent,
} from '../src/conversation/content-confirm';

import { handleIntentCallback } from '../src/handlers/intent-callback';
import { triggerContentConfirmation } from '../src/conversation/content-flow';
import { clearCache as clearDedupCache } from '../src/utils/url-dedup';

// ==========================================
// Test Helpers
// ==========================================

function makeCtx(overrides: Record<string, any> = {}) {
  return {
    from: { id: 456 },
    chat: { id: 123 },
    message: { message_id: 789 },
    callbackQuery: overrides.callbackQuery || undefined,
    reply: mock(() => Promise.resolve({ message_id: 1000 })),
    editMessageText: mock(() => Promise.resolve()),
    deleteMessage: mock(() => Promise.resolve()),
    answerCallbackQuery: mock(() => Promise.resolve()),
    api: { sendMessage: mock(() => Promise.resolve()) },
    ...overrides,
  } as any;
}

/** Build a callback context with callbackQuery.data set */
function makeCallbackCtx(callbackData: string) {
  return makeCtx({ callbackQuery: { data: callbackData } });
}

function makeSkillDef(name: string) {
  return {
    name,
    version: '1.0.0',
    description: `Mock ${name} skill`,
    triggers: [{ type: 'pattern', value: 'mock' }],
    inputs: {},
    outputs: [],
    process: { type: 'tool_sequence', steps: [] },
    tier: 1,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: 'yaml' as const,
    metrics: { executionCount: 0, successCount: 0, failureCount: 0, avgDurationMs: 0 },
    priority: 100,
  };
}

function storePendingForUrl(url: string, intent: string = 'research', depth: string = 'standard') {
  const requestId = generateRequestId();
  const structuredContext = {
    intent: intent as any,
    depth: depth as any,
    audience: 'me' as any,
    source_type: 'url' as any,
    pillar: 'The Grove' as any,
  };
  storePendingContent({
    requestId,
    chatId: 123,
    userId: 456,
    messageId: 789,
    flowState: 'confirm',
    intent: intent as any,
    depth: depth as any,
    audience: 'me',
    structuredContext,
    analysis: { title: `Content from ${url}`, source: 'article', method: 'Fetch', extractedAt: new Date().toISOString() } as any,
    originalText: url,
    pillar: 'The Grove',
    requestType: 'Research',
    timestamp: Date.now(),
    url,
  });
  return requestId;
}

// ==========================================
// BUG A: Silent Failure — Fault Tolerance
// ==========================================

describe('BUG A: content-flow.ts fault tolerance', () => {
  beforeEach(() => {
    clearAllPending();
    clearDedupCache();
    mockTriageMessage.mockClear();
    mockRouteForAnalysis.mockClear();
    // Re-enable default behavior
    mockTriageMessage.mockImplementation(() =>
      Promise.resolve({
        title: 'Triage Title', intent: 'research', confidence: 0.85,
        pillar: 'The Grove', complexityTier: 'Tier 2', source: 'Telegram', latencyMs: 100,
      })
    );
    mockRouteForAnalysis.mockImplementation(() =>
      Promise.resolve({ source: 'article', method: 'Fetch', domain: 'example.com', needsBrowser: false })
    );
  });

  it('keyboard shows when triage throws', async () => {
    mockTriageMessage.mockImplementation(() => { throw new Error('Triage API down'); });
    const ctx = makeCtx();

    const result = await triggerContentConfirmation(ctx as any, 'https://example.com/article', 'Check this out');
    expect(result).toBe(true);
    expect(getPendingCount()).toBe(1);
    expect(ctx.reply).toHaveBeenCalled();
    // Context text is used as fallback title when triage fails
    const replyCall = ctx.reply.mock.calls[0];
    expect(replyCall[0]).toContain('Check this out');
  });

  it('keyboard shows when route analysis throws', async () => {
    mockRouteForAnalysis.mockImplementation(() => { throw new Error('Route analysis exploded'); });
    const ctx = makeCtx();

    const result = await triggerContentConfirmation(ctx as any, 'https://example.com/article', 'Check this');
    expect(result).toBe(true);
    expect(getPendingCount()).toBe(1);
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('keyboard shows when BOTH triage and route throw', async () => {
    mockTriageMessage.mockImplementation(() => { throw new Error('Triage down'); });
    mockRouteForAnalysis.mockImplementation(() => { throw new Error('Route down'); });
    const ctx = makeCtx();

    const result = await triggerContentConfirmation(ctx as any, 'https://example.com/article', 'Check this');
    expect(result).toBe(true);
    expect(getPendingCount()).toBe(1);
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('keyboard shows normally when all enrichment succeeds', async () => {
    const ctx = makeCtx();

    const result = await triggerContentConfirmation(ctx as any, 'https://example.com/article', 'Check this');
    expect(result).toBe(true);
    expect(getPendingCount()).toBe(1);
    expect(ctx.reply).toHaveBeenCalled();
  });

  it('returns false ONLY when storePendingContent or ctx.reply throws', async () => {
    // If reply itself throws, THAT is a real failure
    const ctx = makeCtx({ reply: mock(() => { throw new Error('Telegram API down'); }) });

    const result = await triggerContentConfirmation(ctx as any, 'https://example.com/article', 'Check');
    expect(result).toBe(false);
  });
});

// ==========================================
// BUG B: Skill Dispatch Gap — Routing
// ==========================================

describe('BUG B: intent-callback.ts skill dispatch routing', () => {
  beforeEach(() => {
    clearAllPending();
    clearDedupCache();
    mockExecuteSkill.mockClear();
    mockRunResearch.mockClear();
    mockSendCompletion.mockClear();
    mockFindBestMatch.mockClear();
    mockCreateAuditTrail.mockClear();
    // Reset audit trail to return IDs
    mockCreateAuditTrail.mockImplementation(() =>
      Promise.resolve({
        feedId: 'mock-feed-id',
        workQueueId: 'mock-wq-id',
        feedUrl: 'https://notion.so/mock-feed',
        workQueueUrl: 'https://notion.so/mock-wq',
      })
    );
    // Default: no skill match (Gemini fallback)
    mockFindBestMatch.mockImplementation(() => null);
  });

  it('threads.com URL dispatches threads-lookup skill', async () => {
    const threadsDef = makeSkillDef('threads-lookup');
    mockFindBestMatch.mockImplementation(() => ({
      skill: threadsDef,
      trigger: { type: 'pattern', value: 'threads\\.(net|com)' },
      score: 0.9,
    }));

    const requestId = storePendingForUrl('https://www.threads.net/@marc/post/abc123');
    const ctx = makeCallbackCtx(`intent:${requestId}:confirm:confirm`);

    await handleIntentCallback(ctx);

    // Allow async dispatch to fire
    await new Promise(r => setTimeout(r, 50));

    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockExecuteSkill.mock.calls[0][0].name).toBe('threads-lookup');
    // Verify feedId and workQueueId are passed
    const input = mockExecuteSkill.mock.calls[0][1].input;
    expect(input.feedId).toBe('mock-feed-id');
    expect(input.workQueueId).toBe('mock-wq-id');
    expect(input.telegramChatId).toBe(123);
    // Should NOT have called Gemini research
    expect(mockRunResearch).not.toHaveBeenCalled();
  });

  it('linkedin.com URL dispatches linkedin-lookup skill', async () => {
    const linkedinDef = makeSkillDef('linkedin-lookup');
    mockFindBestMatch.mockImplementation(() => ({
      skill: linkedinDef,
      trigger: { type: 'pattern', value: 'linkedin\\.com/(posts|pulse|in/|company/)' },
      score: 0.9,
    }));

    const requestId = storePendingForUrl('https://www.linkedin.com/posts/johndoe_ai-12345');
    const ctx = makeCallbackCtx(`intent:${requestId}:confirm:confirm`);

    await handleIntentCallback(ctx);
    await new Promise(r => setTimeout(r, 50));

    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockExecuteSkill.mock.calls[0][0].name).toBe('linkedin-lookup');
    expect(mockRunResearch).not.toHaveBeenCalled();
  });

  it('twitter.com URL dispatches twitter-lookup skill', async () => {
    const twitterDef = makeSkillDef('twitter-lookup');
    mockFindBestMatch.mockImplementation(() => ({
      skill: twitterDef,
      trigger: { type: 'pattern', value: 'twitter\\.com|x\\.com' },
      score: 0.9,
    }));

    const requestId = storePendingForUrl('https://x.com/elonmusk/status/12345');
    const ctx = makeCallbackCtx(`intent:${requestId}:confirm:confirm`);

    await handleIntentCallback(ctx);
    await new Promise(r => setTimeout(r, 50));

    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockExecuteSkill.mock.calls[0][0].name).toBe('twitter-lookup');
    expect(mockRunResearch).not.toHaveBeenCalled();
  });

  it('generic URL with research intent falls back to Gemini when no skill matches', async () => {
    mockFindBestMatch.mockImplementation(() => null);

    const requestId = storePendingForUrl('https://arxiv.org/abs/2401.12345', 'research');
    const ctx = makeCallbackCtx(`intent:${requestId}:confirm:confirm`);

    await handleIntentCallback(ctx);
    await new Promise(r => setTimeout(r, 50));

    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(mockRunResearch).toHaveBeenCalledTimes(1);
  });

  it('non-URL research query dispatches Gemini directly', async () => {
    const requestId = generateRequestId();
    storePendingContent({
      requestId,
      chatId: 123,
      userId: 456,
      messageId: 789,
      flowState: 'confirm',
      intent: 'research' as any,
      depth: 'standard',
      audience: 'me',
      structuredContext: { intent: 'research' as any, depth: 'standard' as any, audience: 'me' as any, source_type: 'text' as any, pillar: 'The Grove' as any },
      originalText: 'What are the latest advances in multi-agent systems?',
      pillar: 'The Grove',
      requestType: 'Research',
      timestamp: Date.now(),
      // No URL
    });

    const ctx = makeCallbackCtx(`intent:${requestId}:confirm:confirm`);
    await handleIntentCallback(ctx);
    await new Promise(r => setTimeout(r, 50));

    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(mockRunResearch).toHaveBeenCalledTimes(1);
  });

  it('save intent with URL dispatches skill but not Gemini', async () => {
    const urlExtractDef = makeSkillDef('url-extract');
    mockFindBestMatch.mockImplementation(() => ({
      skill: urlExtractDef,
      trigger: { type: 'pattern', value: 'https?://' },
      score: 0.9,
    }));

    const requestId = storePendingForUrl('https://example.com/useful-page', 'save');
    const ctx = makeCallbackCtx(`intent:${requestId}:confirm:confirm`);

    await handleIntentCallback(ctx);
    await new Promise(r => setTimeout(r, 50));

    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    expect(mockExecuteSkill.mock.calls[0][0].name).toBe('url-extract');
    expect(mockRunResearch).not.toHaveBeenCalled();
  });

  it('save intent with no URL and no skill match does NOT dispatch anything', async () => {
    mockFindBestMatch.mockImplementation(() => null);
    const requestId = generateRequestId();
    storePendingContent({
      requestId,
      chatId: 123,
      userId: 456,
      messageId: 789,
      flowState: 'confirm',
      intent: 'save' as any,
      depth: 'quick',
      audience: 'me',
      structuredContext: { intent: 'save' as any, depth: 'quick' as any, audience: 'me' as any, source_type: 'text' as any, pillar: 'Personal' as any },
      originalText: 'Remember to buy milk',
      pillar: 'Personal',
      requestType: 'Quick',
      timestamp: Date.now(),
    });

    const ctx = makeCallbackCtx(`intent:${requestId}:confirm:confirm`);
    await handleIntentCallback(ctx);
    await new Promise(r => setTimeout(r, 50));

    expect(mockExecuteSkill).not.toHaveBeenCalled();
    expect(mockRunResearch).not.toHaveBeenCalled();
  });

  it('skill execution failure falls back to Gemini for research intent', async () => {
    const threadsDef = makeSkillDef('threads-lookup');
    mockFindBestMatch.mockImplementation(() => ({
      skill: threadsDef,
      trigger: { type: 'pattern', value: 'threads\\.(net|com)' },
      score: 0.9,
    }));
    mockExecuteSkill.mockImplementation(() => { throw new Error('Skill executor crashed'); });

    const requestId = storePendingForUrl('https://threads.net/@user/post/xyz', 'research');
    const ctx = makeCallbackCtx(`intent:${requestId}:confirm:confirm`);

    await handleIntentCallback(ctx);
    await new Promise(r => setTimeout(r, 50));

    // Skill was attempted
    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    // Falls back to Gemini
    expect(mockRunResearch).toHaveBeenCalledTimes(1);
  });

  it('passes depth mapping correctly to skill input', async () => {
    const threadsDef = makeSkillDef('threads-lookup');
    mockFindBestMatch.mockImplementation(() => ({
      skill: threadsDef,
      trigger: { type: 'pattern', value: 'threads\\.(net|com)' },
      score: 0.9,
    }));

    // Store with 'deep' depth
    const requestId = storePendingForUrl('https://threads.net/@user/post/deep', 'research', 'deep');

    const ctx = makeCallbackCtx(`intent:${requestId}:confirm:confirm`);
    await handleIntentCallback(ctx);
    await new Promise(r => setTimeout(r, 50));

    expect(mockExecuteSkill).toHaveBeenCalledTimes(1);
    const input = mockExecuteSkill.mock.calls[0][1].input;
    expect(input.depth).toBe('deep');
    expect(input.pillar).toBe('The Grove');
  });
});
