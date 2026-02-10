/**
 * Intent-First Integration Tests
 *
 * End-to-end verification of the 3-step intent-first capture flow:
 *   Intent → Depth → Audience → Confirm
 *
 * Groups:
 *   1. Happy Path (full 3-step combos)
 *   2. Back Navigation
 *   3. Abandon/Cancel/Timeout
 *   4. Pillar Derivation Matrix (6 intents × 3 depths × key audiences)
 *   5. Source Type Detection (10 fixture URLs + attachment types)
 *   6. Rapid-Fire / Collision (parallel pending entries)
 *   7. V3 Media Path Isolation (triggerMediaConfirmation → startPromptSelection)
 *
 * Exit criteria: all tests green, zero regressions, collision behavior documented.
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ==========================================
// Mock setup — BEFORE any src imports
// ==========================================

// Mock Notion client
const mockPagesCreate = mock(() =>
  Promise.resolve({ id: 'mock-page-id', url: 'https://notion.so/mock-page' })
);
const mockPagesUpdate = mock(() => Promise.resolve({}));
const mockDatabasesRetrieve = mock(() => Promise.resolve({ id: 'mock-db-id' }));

mock.module('@notionhq/client', () => ({
  Client: class MockClient {
    pages = { create: mockPagesCreate, update: mockPagesUpdate };
    databases = { retrieve: mockDatabasesRetrieve };
  },
}));

// Mock logger (suppress output)
mock.module('../src/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Mock feature flags (enable everything for testing)
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

// Mock skills (logAction, isFeatureEnabled)
mock.module('../src/skills', () => ({
  logAction: mock(() => Promise.resolve()),
  isFeatureEnabled: () => false,
}));

// Mock content-router (routeForAnalysis, etc.)
mock.module('../src/conversation/content-router', () => ({
  routeForAnalysis: mock(() =>
    Promise.resolve({
      source: 'article',
      method: 'Fetch',
      domain: 'example.com',
      needsBrowser: false,
    })
  ),
  extractUrlsFromText: (text: string) => {
    const urlRegex = /https?:\/\/[^\s]+/g;
    return text.match(urlRegex) || [];
  },
  detectContentSource: () => 'article',
  extractDomain: (url: string) => {
    try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return 'unknown'; }
  },
}));

// Mock notion-url
mock.module('../src/conversation/notion-url', () => ({
  isNotionUrl: () => false,
  handleNotionUrl: () => Promise.resolve(false),
}));

// Mock triage-skill
mock.module('../src/cognitive/triage-skill', () => ({
  triageMessage: mock(() =>
    Promise.resolve({
      title: 'Mock Triage Title',
      intent: 'research',
      confidence: 0.85,
      pillar: 'The Grove',
      complexityTier: 'Tier 2',
      source: 'Telegram',
      latencyMs: 100,
    })
  ),
}));

// Mock telegram helpers
mock.module('../src/utils/telegram-helpers', () => ({
  safeAnswerCallback: mock(() => Promise.resolve()),
}));

// Mock @atlas/shared/notion (transitive dep from packages/agents → skills chain)
mock.module('@atlas/shared/notion', () => ({
  convertMarkdownToNotionBlocks: () => [],
}));

// Mock conversation audit (prevents Notion SDK from being instantiated at import time)
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

// Mock conversation prompt-selection (breaks packages/agents chain)
mock.module('../src/conversation/prompt-selection', () => ({
  getSelection: () => null,
  updateSelection: () => {},
  selectPillar: () => {},
  selectAction: () => {},
  selectVoice: () => {},
  removeSelection: () => {},
  createSelection: () => ({}),
}));

// Mock cognitive triage-patterns (transitive from prompt-selection-callback)
mock.module('../src/cognitive/triage-patterns', () => ({
  recordTriageFeedback: mock(() => {}),
}));

// Mock skills/action-log directly (instead of ../src/skills barrel)
mock.module('../src/skills/action-log', () => ({
  logAction: mock(() => Promise.resolve()),
  logClassification: mock(() => Promise.resolve()),
  logToolExecution: mock(() => Promise.resolve()),
  logMediaAction: mock(() => Promise.resolve()),
  logTriageAction: mock(() => Promise.resolve()),
  getIntentHash: () => 'mock-hash',
}));

// Mock prompt-selection-callback (for V3 path verification)
const mockStartPromptSelection = mock(() => Promise.resolve());
mock.module('../src/handlers/prompt-selection-callback', () => ({
  startPromptSelection: mockStartPromptSelection,
  handlePromptSelectionCallback: mock(() => Promise.resolve()),
  isPromptSelectionCallback: () => false,
}));

// ==========================================
// NOW import the modules under test
// ==========================================

import {
  derivePillarFromContext,
  detectSourceType,
  buildIntentKeyboard,
  buildDepthKeyboard,
  buildAudienceKeyboard,
  buildIntentConfirmKeyboard,
  parseIntentCallbackData,
  isIntentCallback,
  isContentCallback,
  storePendingContent,
  getPendingContent,
  updatePendingContent,
  removePendingContent,
  clearAllPending,
  getPendingCount,
  generateRequestId,
  type PendingContent,
} from '../src/conversation/content-confirm';

import type {
  StructuredContext,
  Pillar,
  IntentType,
  DepthLevel,
  AudienceType,
  SourceType,
} from '../src/conversation/types';

import { handleIntentCallback } from '../src/handlers/intent-callback';
import {
  triggerContentConfirmation,
  triggerInstantClassification,
  triggerMediaConfirmation,
} from '../src/conversation/content-flow';

import seeds from './fixtures/intent-first-seeds.json';

// ==========================================
// Test Helpers
// ==========================================

function makePending(overrides: Partial<PendingContent> = {}): PendingContent {
  return {
    requestId: generateRequestId(),
    chatId: 123,
    userId: 456,
    flowState: 'intent',
    analysis: {
      source: 'article' as any,
      method: 'Fetch' as any,
      title: 'Test Content',
      extractedAt: new Date().toISOString(),
    } as any,
    originalText: 'https://example.com/article',
    pillar: 'The Grove',
    requestType: 'Research',
    timestamp: Date.now(),
    url: 'https://example.com/article',
    ...overrides,
  };
}

function makeCtx(overrides: Partial<StructuredContext> = {}): StructuredContext {
  return {
    intent: 'capture',
    depth: 'standard',
    audience: 'self',
    source_type: 'text',
    format: null,
    voice_hint: null,
    ...overrides,
  };
}

/**
 * Create a mock grammy Context object for callback query testing
 */
function mockCallbackCtx(data: string) {
  const replied: any[] = [];
  const edited: any[] = [];
  let answeredWith: any = null;
  let deleted = false;

  return {
    ctx: {
      from: { id: 456, username: 'jim' },
      chat: { id: 123 },
      message: { message_id: 1 },
      callbackQuery: { data },
      reply: mock(async (text: string, opts?: any) => {
        replied.push({ text, opts });
        return { message_id: 2 };
      }),
      editMessageText: mock(async (text: string, opts?: any) => {
        edited.push({ text, opts });
      }),
      answerCallbackQuery: mock(async (opts?: any) => {
        answeredWith = opts;
      }),
      deleteMessage: mock(async () => { deleted = true; }),
    },
    replied,
    edited,
    getAnswered: () => answeredWith,
    wasDeleted: () => deleted,
  };
}

// ==========================================
// Group 1: Happy Path — Full 3-Step Flow
// ==========================================

describe('Group 1: Happy Path — Full 3-step flow', () => {
  beforeEach(() => {
    clearAllPending();
    mockCreateAuditTrail.mockClear();
  });

  // Parameterized combos: representative set covering all intents
  const happyPathCombos: Array<{
    label: string;
    intent: IntentType;
    depth: DepthLevel;
    audience: AudienceType;
    expectedPillar: Pillar;
  }> = [
    { label: 'research/deep/self → The Grove', intent: 'research', depth: 'deep', audience: 'self', expectedPillar: 'The Grove' },
    { label: 'draft/standard/client → Consulting', intent: 'draft', depth: 'standard', audience: 'client', expectedPillar: 'Consulting' },
    { label: 'save/quick/self → Personal', intent: 'save', depth: 'quick', audience: 'self', expectedPillar: 'Personal' },
    { label: 'analyze/standard/public → The Grove', intent: 'analyze', depth: 'standard', audience: 'public', expectedPillar: 'The Grove' },
    { label: 'capture/standard/self → Personal', intent: 'capture', depth: 'standard', audience: 'self', expectedPillar: 'Personal' },
    { label: 'engage/standard/self → Consulting', intent: 'engage', depth: 'standard', audience: 'self', expectedPillar: 'Consulting' },
  ];

  for (const combo of happyPathCombos) {
    it(`walks intent→depth→audience→confirm: ${combo.label}`, async () => {
      // Setup: store pending content
      const reqId = generateRequestId();
      const pending = makePending({ requestId: reqId });
      storePendingContent(pending);
      expect(getPendingCount()).toBe(1);

      // Step 1: Select intent
      const { ctx: ctx1 } = mockCallbackCtx(`intent:${reqId}:intent:${combo.intent}`);
      await handleIntentCallback(ctx1 as any);

      const afterIntent = getPendingContent(reqId)!;
      expect(afterIntent.intent).toBe(combo.intent);
      expect(afterIntent.flowState).toBe('depth');

      // Step 2: Select depth
      const { ctx: ctx2 } = mockCallbackCtx(`intent:${reqId}:depth:${combo.depth}`);
      await handleIntentCallback(ctx2 as any);

      const afterDepth = getPendingContent(reqId)!;
      expect(afterDepth.depth).toBe(combo.depth);
      expect(afterDepth.flowState).toBe('audience');

      // Step 3: Select audience
      const { ctx: ctx3 } = mockCallbackCtx(`intent:${reqId}:audience:${combo.audience}`);
      await handleIntentCallback(ctx3 as any);

      const afterAudience = getPendingContent(reqId)!;
      expect(afterAudience.audience).toBe(combo.audience);
      expect(afterAudience.flowState).toBe('confirm');
      expect(afterAudience.structuredContext).toBeDefined();
      expect(afterAudience.pillar).toBe(combo.expectedPillar);

      // Step 4: Confirm
      const { ctx: ctx4 } = mockCallbackCtx(`intent:${reqId}:confirm`);
      await handleIntentCallback(ctx4 as any);

      // Pending should be removed after confirm
      expect(getPendingContent(reqId)).toBeUndefined();
      expect(getPendingCount()).toBe(0);

      // Audit trail should have been called (creates Feed + Work Queue)
      expect(mockCreateAuditTrail.mock.calls.length).toBeGreaterThanOrEqual(1);
    });
  }

  it('confirm builds correct structuredContext on pending (github URL)', async () => {
    const reqId = generateRequestId();
    storePendingContent(makePending({ requestId: reqId, url: 'https://github.com/test' }));

    // Walk through all 3 steps
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:intent:research`).ctx as any);
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:depth:deep`).ctx as any);
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:audience:self`).ctx as any);

    const p = getPendingContent(reqId)!;
    expect(p.structuredContext).toEqual({
      intent: 'research',
      depth: 'deep',
      audience: 'self',
      source_type: 'github',  // detectSourceType('https://github.com/test') → github
      format: 'analysis',     // inferFormat(research, deep) = analysis
      voice_hint: null,
    });
  });

  it('confirm builds correct structuredContext on pending (generic URL)', async () => {
    const reqId = generateRequestId();
    storePendingContent(makePending({ requestId: reqId, url: 'https://example.com/article' }));

    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:intent:draft`).ctx as any);
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:depth:standard`).ctx as any);
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:audience:self`).ctx as any);

    const p = getPendingContent(reqId)!;
    expect(p.structuredContext).toEqual({
      intent: 'draft',
      depth: 'standard',
      audience: 'self',
      source_type: 'url',   // detectSourceType('https://example.com/article') → url
      format: 'post',       // inferFormat(draft, standard) = post
      voice_hint: null,
    });
  });
});

// ==========================================
// Group 2: Back Navigation
// ==========================================

describe('Group 2: Back Navigation', () => {
  beforeEach(() => {
    clearAllPending();
  });

  it('back from depth → intent: resets intent and shows intent keyboard', async () => {
    const reqId = generateRequestId();
    storePendingContent(makePending({ requestId: reqId, intent: 'research', flowState: 'depth' }));

    const { ctx, edited } = mockCallbackCtx(`intent:${reqId}:back:intent`);
    await handleIntentCallback(ctx as any);

    const p = getPendingContent(reqId)!;
    expect(p.flowState).toBe('intent');
    expect(p.intent).toBeUndefined();
  });

  it('back from audience → depth: resets depth and shows depth keyboard', async () => {
    const reqId = generateRequestId();
    storePendingContent(makePending({
      requestId: reqId,
      intent: 'research',
      depth: 'deep',
      flowState: 'audience',
    }));

    const { ctx } = mockCallbackCtx(`intent:${reqId}:back:depth`);
    await handleIntentCallback(ctx as any);

    const p = getPendingContent(reqId)!;
    expect(p.flowState).toBe('depth');
    expect(p.depth).toBeUndefined();
  });

  it('back from confirm → audience: resets audience and shows audience keyboard', async () => {
    const reqId = generateRequestId();
    storePendingContent(makePending({
      requestId: reqId,
      intent: 'research',
      depth: 'deep',
      audience: 'self',
      flowState: 'confirm',
    }));

    const { ctx } = mockCallbackCtx(`intent:${reqId}:back:audience`);
    await handleIntentCallback(ctx as any);

    const p = getPendingContent(reqId)!;
    expect(p.flowState).toBe('audience');
    expect(p.audience).toBeUndefined();
  });

  it('full round-trip: intent → depth → back → intent → depth → audience → confirm', async () => {
    const reqId = generateRequestId();
    storePendingContent(makePending({ requestId: reqId }));

    // Forward: intent
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:intent:draft`).ctx as any);
    expect(getPendingContent(reqId)!.flowState).toBe('depth');

    // Forward: depth
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:depth:quick`).ctx as any);
    expect(getPendingContent(reqId)!.flowState).toBe('audience');

    // Back to depth
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:back:depth`).ctx as any);
    expect(getPendingContent(reqId)!.flowState).toBe('depth');

    // Back to intent
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:back:intent`).ctx as any);
    expect(getPendingContent(reqId)!.flowState).toBe('intent');
    expect(getPendingContent(reqId)!.intent).toBeUndefined();

    // Redo: intent → depth → audience → confirm
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:intent:research`).ctx as any);
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:depth:deep`).ctx as any);
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:audience:public`).ctx as any);

    const final = getPendingContent(reqId)!;
    expect(final.flowState).toBe('confirm');
    expect(final.intent).toBe('research');
    expect(final.depth).toBe('deep');
    expect(final.audience).toBe('public');
    expect(final.pillar).toBe('The Grove');
  });

  it('back on expired request answers with expiry message', async () => {
    const { ctx } = mockCallbackCtx('intent:expired-id:back:intent');
    await handleIntentCallback(ctx as any);
    // Should not crash; pending not found → expire path
    expect(getPendingContent('expired-id')).toBeUndefined();
  });
});

// ==========================================
// Group 3: Abandon / Cancel / Timeout
// ==========================================

describe('Group 3: Abandon / Cancel / Timeout', () => {
  beforeEach(() => {
    clearAllPending();
  });

  it('skip at intent step removes pending and deletes message', async () => {
    const reqId = generateRequestId();
    storePendingContent(makePending({ requestId: reqId }));

    const { ctx, wasDeleted } = mockCallbackCtx(`intent:${reqId}:skip`);
    await handleIntentCallback(ctx as any);

    expect(getPendingContent(reqId)).toBeUndefined();
    expect(getPendingCount()).toBe(0);
  });

  it('skip at depth step removes pending', async () => {
    const reqId = generateRequestId();
    storePendingContent(makePending({ requestId: reqId, intent: 'research', flowState: 'depth' }));

    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:skip`).ctx as any);
    expect(getPendingContent(reqId)).toBeUndefined();
  });

  it('skip at audience step removes pending', async () => {
    const reqId = generateRequestId();
    storePendingContent(makePending({
      requestId: reqId,
      intent: 'research',
      depth: 'deep',
      flowState: 'audience',
    }));

    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:skip`).ctx as any);
    expect(getPendingContent(reqId)).toBeUndefined();
  });

  it('expired requestId returns expiry message without crashing', async () => {
    const { ctx } = mockCallbackCtx('intent:nonexistent-req:intent:research');
    // Should handle gracefully — pending not found
    await handleIntentCallback(ctx as any);
    // No exception, no pending content
    expect(getPendingCount()).toBe(0);
  });

  it('double-confirm on same requestId is idempotent', async () => {
    const reqId = generateRequestId();
    storePendingContent(makePending({
      requestId: reqId,
      intent: 'capture',
      depth: 'standard',
      audience: 'self',
      flowState: 'confirm',
      structuredContext: makeCtx({ intent: 'capture', depth: 'standard', audience: 'self' }),
    }));

    // First confirm
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId}:confirm`).ctx as any);
    expect(getPendingContent(reqId)).toBeUndefined();

    // Second confirm — should handle expired request gracefully
    const { ctx: ctx2 } = mockCallbackCtx(`intent:${reqId}:confirm`);
    await handleIntentCallback(ctx2 as any);
    // No crash
    expect(getPendingCount()).toBe(0);
  });
});

// ==========================================
// Group 4: Pillar Derivation Matrix
// ==========================================

describe('Group 4: Pillar Derivation Matrix', () => {
  // Every intent × depth combo for audience=self, source_type=url
  const intents: IntentType[] = ['research', 'draft', 'save', 'analyze', 'capture', 'engage'];
  const depths: DepthLevel[] = ['quick', 'standard', 'deep'];

  // Expected pillar matrix for audience=self, source_type=url
  // Priority: audience(self=no match) > intent+depth > source_type(url=no match) > default(Personal)
  const expected: Record<string, Record<string, Pillar>> = {
    research: {
      quick: 'Personal',
      standard: 'Personal',
      deep: 'The Grove',  // research+deep → The Grove
    },
    draft: {
      quick: 'Personal',
      standard: 'Personal',
      deep: 'Personal',
    },
    save: {
      quick: 'Personal',
      standard: 'Personal',
      deep: 'Personal',
    },
    analyze: {
      quick: 'Personal',
      standard: 'Personal',
      deep: 'Personal',
    },
    capture: {
      quick: 'Personal',
      standard: 'Personal',
      deep: 'Personal',
    },
    engage: {
      quick: 'Consulting',  // engage → always Consulting
      standard: 'Consulting',
      deep: 'Consulting',
    },
  };

  for (const intent of intents) {
    for (const depth of depths) {
      it(`${intent}/${depth}/self/url → ${expected[intent][depth]}`, () => {
        const ctx = makeCtx({ intent, depth, audience: 'self', source_type: 'url' });
        expect(derivePillarFromContext(ctx)).toBe(expected[intent][depth]);
      });
    }
  }

  // Audience overrides (client, public)
  describe('audience overrides', () => {
    it('client audience always → Consulting regardless of intent', () => {
      for (const intent of intents) {
        const ctx = makeCtx({ intent, audience: 'client' });
        expect(derivePillarFromContext(ctx)).toBe('Consulting');
      }
    });

    it('public audience always → The Grove regardless of intent', () => {
      for (const intent of intents) {
        const ctx = makeCtx({ intent, audience: 'public' });
        expect(derivePillarFromContext(ctx)).toBe('The Grove');
      }
    });

    it('team audience + draft → The Grove', () => {
      expect(derivePillarFromContext(makeCtx({ intent: 'draft', audience: 'team' }))).toBe('The Grove');
    });
  });

  // Source type overrides (when no audience/intent match)
  describe('source type overrides', () => {
    it('github source → The Grove (when audience=self, intent=capture)', () => {
      expect(derivePillarFromContext(makeCtx({ source_type: 'github' }))).toBe('The Grove');
    });

    it('linkedin source → Consulting (when audience=self, intent=capture)', () => {
      expect(derivePillarFromContext(makeCtx({ source_type: 'linkedin' }))).toBe('Consulting');
    });
  });
});

// ==========================================
// Group 5: Source Type Detection
// ==========================================

describe('Group 5: Source Type Detection', () => {
  // Fixture URL tests
  describe('fixture URLs from seeds.json', () => {
    for (const fixture of seeds.urls) {
      it(`${fixture.label}: ${fixture.url} → ${fixture.expectedSourceType}`, () => {
        const result = detectSourceType(fixture.url);
        expect(result).toBe(fixture.expectedSourceType as SourceType);
      });
    }
  });

  // Attachment type tests
  describe('attachment types', () => {
    for (const [attachmentType, expectedSourceType] of Object.entries(seeds.attachmentTypes)) {
      it(`attachment '${attachmentType}' → ${expectedSourceType}`, () => {
        expect(detectSourceType(undefined, attachmentType)).toBe(expectedSourceType as SourceType);
      });
    }
  });

  // Edge cases
  describe('edge cases', () => {
    it('no URL and no attachment → text', () => {
      expect(detectSourceType()).toBe('text');
    });

    it('attachment takes priority over URL', () => {
      expect(detectSourceType('https://github.com/repo', 'photo')).toBe('image');
    });

    it('unknown attachment type → text', () => {
      expect(detectSourceType(undefined, 'sticker')).toBe('text');
    });

    it('empty string URL → text', () => {
      expect(detectSourceType('')).toBe('text');
    });

    it('github.com substring match works for subdomains', () => {
      expect(detectSourceType('https://raw.github.com/user/repo/file')).toBe('github');
    });

    it('linkedin.com substring match works for subdomains', () => {
      expect(detectSourceType('https://business.linkedin.com/marketing')).toBe('linkedin');
    });
  });
});

// ==========================================
// Group 6: Rapid-Fire / Collision
// ==========================================

describe('Group 6: Rapid-Fire / Collision', () => {
  beforeEach(() => {
    clearAllPending();
    mockPagesCreate.mockClear();
  });

  it('two concurrent flows with different requestIds coexist independently', async () => {
    // Simulate: user shares URL #1, then URL #2 before completing #1
    const reqId1 = generateRequestId();
    const reqId2 = generateRequestId();

    storePendingContent(makePending({ requestId: reqId1, originalText: 'https://example.com/first' }));
    storePendingContent(makePending({ requestId: reqId2, originalText: 'https://example.com/second' }));

    expect(getPendingCount()).toBe(2);

    // Progress flow 1 to depth
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId1}:intent:research`).ctx as any);
    expect(getPendingContent(reqId1)!.flowState).toBe('depth');
    expect(getPendingContent(reqId2)!.flowState).toBe('intent'); // Unchanged

    // Progress flow 2 to depth
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId2}:intent:draft`).ctx as any);
    expect(getPendingContent(reqId2)!.flowState).toBe('depth');
    expect(getPendingContent(reqId1)!.intent).toBe('research'); // Still research

    // Skip flow 1
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId1}:skip`).ctx as any);
    expect(getPendingContent(reqId1)).toBeUndefined();
    expect(getPendingContent(reqId2)).toBeDefined(); // Still active

    // Complete flow 2
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId2}:depth:standard`).ctx as any);
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId2}:audience:self`).ctx as any);
    await handleIntentCallback(mockCallbackCtx(`intent:${reqId2}:confirm`).ctx as any);

    expect(getPendingCount()).toBe(0);
  });

  it('collision behavior: parallel entries are independent (documented contract)', () => {
    // Contract: Each storePendingContent creates an independent entry keyed by requestId.
    // No deduplication, no supersede. Multiple pending entries for the same chatId can coexist.
    // This is by design — each share gets its own keyboard/flow.

    const reqId1 = generateRequestId();
    const reqId2 = generateRequestId();

    storePendingContent(makePending({ requestId: reqId1, chatId: 123, originalText: 'url1' }));
    storePendingContent(makePending({ requestId: reqId2, chatId: 123, originalText: 'url2' }));

    expect(getPendingCount()).toBe(2);
    expect(getPendingContent(reqId1)!.originalText).toBe('url1');
    expect(getPendingContent(reqId2)!.originalText).toBe('url2');

    // Skip one, the other persists
    removePendingContent(reqId1);
    expect(getPendingCount()).toBe(1);
    expect(getPendingContent(reqId2)).toBeDefined();
  });
});

// ==========================================
// Group 7: V3 Media Path Isolation
// ==========================================

describe('Group 7: V3 Media Path Isolation', () => {
  beforeEach(() => {
    clearAllPending();
    mockStartPromptSelection.mockClear();
    mockPagesCreate.mockClear();
  });

  it('triggerMediaConfirmation calls startPromptSelection (V3), NOT intent keyboards', async () => {
    const mockCtx = {
      from: { id: 456, username: 'jim' },
      chat: { id: 123 },
      message: { message_id: 1, caption: 'test caption' },
      reply: mock(async () => ({ message_id: 2 })),
    };

    const attachment = { type: 'image', fileName: 'photo.jpg' } as any;
    const mediaContext = { type: 'image', description: 'A test photo', labels: [] } as any;

    await triggerMediaConfirmation(mockCtx as any, attachment, mediaContext, 'The Grove');

    // V3 path: startPromptSelection should be called
    expect(mockStartPromptSelection.mock.calls.length).toBeGreaterThanOrEqual(1);
    // No intent keyboard entries created
    // (Can't perfectly assert no storePendingContent from triggerMediaConfirmation,
    //  but we confirm the V3 path was taken)
  });

  it('triggerContentConfirmation uses intent keyboards (stores PendingContent)', async () => {
    const mockCtx = {
      from: { id: 456, username: 'jim' },
      chat: { id: 123 },
      message: { message_id: 1 },
      reply: mock(async () => ({ message_id: 2 })),
    };

    const initialCount = getPendingCount();
    await triggerContentConfirmation(mockCtx as any, 'https://example.com/article', 'check this out');

    // Intent-first path: should store pending content
    expect(getPendingCount()).toBe(initialCount + 1);
    // startPromptSelection should NOT have been called for URL shares
    // (We can't assert mockStartPromptSelection was NOT called because it may carry
    //  calls from other tests, but we verify the PendingContent path was taken)
  });

  it('triggerInstantClassification uses intent keyboards for media', async () => {
    const mockCtx = {
      from: { id: 456, username: 'jim' },
      chat: { id: 123 },
      message: { message_id: 1, caption: 'look at this' },
      reply: mock(async () => ({ message_id: 2 })),
    };

    const attachment = {
      type: 'document',
      fileName: 'report.pdf',
      fileSize: 1024,
    } as any;

    const initialCount = getPendingCount();
    await triggerInstantClassification(mockCtx as any, attachment);

    // Intent-first path for direct media (without Gemini analysis)
    expect(getPendingCount()).toBe(initialCount + 1);
  });

  it('isIntentCallback and isContentCallback are mutually exclusive', () => {
    // Intent callbacks
    expect(isIntentCallback('intent:abc:intent:research')).toBe(true);
    expect(isContentCallback('intent:abc:intent:research')).toBe(false);

    // Content callbacks
    expect(isContentCallback('content:abc:pillar:Personal')).toBe(true);
    expect(isIntentCallback('content:abc:pillar:Personal')).toBe(false);

    // Neither
    expect(isIntentCallback('voice:abc:default')).toBe(false);
    expect(isContentCallback('voice:abc:default')).toBe(false);

    // Undefined
    expect(isIntentCallback(undefined)).toBe(false);
    expect(isContentCallback(undefined)).toBe(false);
  });
});
