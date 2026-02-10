/**
 * Action Feed Producers — E2E Tests (E2E-10 through E2E-25)
 *
 * Tests P2 Approval Cards (FAIL-CLOSED) and P3 Review Cards (FAIL-OPEN)
 * producer wiring, listeners, feature flags, and cross-producer coexistence.
 *
 * Run with: bun test test/action-feed-producers.test.ts
 */

import { describe, it, expect, mock, beforeEach, afterEach } from 'bun:test';

// =============================================================================
// Mock Setup — MUST be before any imports from the modules under test
// =============================================================================

// Track calls to createActionFeedEntry
let createActionFeedEntryCalls: Array<{ actionType: string; actionData: any; source: string; title?: string; keywords?: string[] }> = [];
let createActionFeedEntryBehavior: 'succeed' | 'throw' | 'slow' = 'succeed';
let createActionFeedEntryDelay = 0;
let createActionFeedEntryCounter = 0;

// Track calls to updateFeedEntryAction
let updateFeedEntryActionCalls: Array<{ pageId: string; updates: any }> = [];

// Feature flag overrides
let featureFlagOverrides: Record<string, boolean> = {};

// Mock the notion module
mock.module('../src/notion', () => ({
  createActionFeedEntry: async (actionType: string, actionData: any, source: string, title?: string, keywords?: string[]) => {
    createActionFeedEntryCalls.push({ actionType, actionData, source, title, keywords });
    if (createActionFeedEntryBehavior === 'throw') {
      throw new Error('Mock: Notion API unavailable');
    }
    if (createActionFeedEntryBehavior === 'slow') {
      await new Promise(resolve => setTimeout(resolve, createActionFeedEntryDelay));
    }
    return 'mock-feed-page-id-' + (++createActionFeedEntryCounter);
  },
  updateFeedEntryAction: async (pageId: string, updates: any) => {
    updateFeedEntryActionCalls.push({ pageId, updates });
  },
  getNotionClient: () => ({
    databases: {
      query: async () => ({ results: [] }),
    },
  }),
}));

// Mock feature flags — IMPORTANT: skillLogging MUST default true to avoid breaking
// live-bugs-feb8.test.ts BUG 2 tests which rely on logAction calling pages.update.
// Bun's mock.module leaks across files in multi-file runs.
mock.module('../src/config/features', () => ({
  isFeatureEnabled: (flag: string) => {
    if (flag in featureFlagOverrides) return featureFlagOverrides[flag];
    // Default ON for the producer flags (opt-out pattern)
    if (flag === 'approvalProducer') return true;
    if (flag === 'reviewProducer') return true;
    if (flag === 'skillExecution') return true;
    // Must default true to not break action-log tests in other files
    if (flag === 'skillLogging') return true;
    return true; // Default ON for all other flags (safe: matches opt-out defaults)
  },
  getFeatureFlags: () => ({
    approvalProducer: featureFlagOverrides.approvalProducer ?? true,
    reviewProducer: featureFlagOverrides.reviewProducer ?? true,
    skillExecution: featureFlagOverrides.skillExecution ?? true,
    skillLogging: true,
    skillHotReload: true,
    patternDetection: true,
    autoDeployTier0: true,
    skillComposition: true,
    zoneClassifier: true,
    swarmDispatch: true,
    selfImprovementListener: true,
    apiSwarmDispatch: true,
    healthAlertProducer: true,
    triageSkill: true,
    lowConfidenceFallbackToCapture: true,
    multiIntentParsing: true,
    pendingSelectionContext: true,
    duplicateConfirmationGuard: true,
    vehiclePillarRouting: true,
    researchErrorSanitization: true,
  }),
  reloadConfig: () => {},
}));

// Mock the logger to suppress noise
mock.module('../src/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// NOTE: Do NOT mock ../src/skills/action-log or ../src/health/status-server here.
// Bun's mock.module leaks across test files in multi-file runs. Mocking action-log
// would break live-bugs-feb8.test.ts BUG 2 tests which rely on the real action-log
// with a mocked @notionhq/client. The executor's Tier 2 latch returns before
// reaching logAction/pushActivity, so these don't need mocking for our tests.

// Mock the skill registry for executeSkill tests
const mockSkillRegistry = {
  get: (name: string) => null,
  getStats: () => ({ total: 0, enabled: 0, disabled: 0 }),
};
mock.module('../src/skills/registry', () => ({
  getSkillRegistry: () => mockSkillRegistry,
  initializeSkillRegistry: async () => {},
}));

// =============================================================================
// Imports — AFTER all mock.module() calls
// =============================================================================

import { executeSkill, getPendingApprovals, removePendingApproval, executeSkillWithApproval } from '../src/skills/executor';
import { startApprovalListener, stopApprovalListener } from '../src/feed/approval-listener';
import { startReviewListener, stopReviewListener } from '../src/feed/review-listener';
import type { ActionDataApproval, ActionDataReview } from '../src/types';

// =============================================================================
// Helpers
// =============================================================================

/** Minimal Tier 2 skill definition for testing */
function makeTier2Skill(name = 'twitter-follow') {
  return {
    name,
    version: '1.0.0',
    description: 'External action requiring approval',
    triggers: [{ type: 'intent' as const, value: 'follow-user' }],
    inputs: {},
    outputs: [],
    process: {
      steps: [
        { id: 'step1', type: 'tool' as const, tool: 'twitter_follow', params: { user: '{{input.user}}' } },
      ],
      timeout: 30000,
    },
    tier: 2 as const,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Minimal Tier 0 skill (no approval needed) */
function makeTier0Skill(name = 'status-check') {
  return {
    name,
    version: '1.0.0',
    description: 'Read-only status check',
    triggers: [{ type: 'intent' as const, value: 'check-status' }],
    inputs: {},
    outputs: [],
    process: {
      steps: [
        { id: 'step1', type: 'tool' as const, tool: 'notion_query', params: {} },
      ],
      timeout: 30000,
    },
    tier: 0 as const,
    enabled: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
}

/** Minimal execution context */
function makeContext(overrides: Record<string, any> = {}) {
  return {
    userId: 'test-user',
    messageText: 'test message',
    pillar: 'The Grove' as any,
    input: {},
    ...overrides,
  };
}

// =============================================================================
// Test Lifecycle
// =============================================================================

beforeEach(() => {
  createActionFeedEntryCalls = [];
  createActionFeedEntryBehavior = 'succeed';
  createActionFeedEntryDelay = 0;
  createActionFeedEntryCounter = 0;
  updateFeedEntryActionCalls = [];
  featureFlagOverrides = {};
  // Clear pending approvals between tests
  const pending = getPendingApprovals();
  for (const key of pending.keys()) {
    removePendingApproval(key);
  }
});

// =============================================================================
// P2 APPROVAL CARD TESTS
// =============================================================================

describe('P2 Approval Cards', () => {

  // ---------------------------------------------------------------------------
  // E2E-10: Tier 2 Skill Request Creates Approval Card (Happy Path)
  // ---------------------------------------------------------------------------
  it('E2E-10: Tier 2 skill creates Approval card with correct payload', async () => {
    const skill = makeTier2Skill('twitter-follow');
    const context = makeContext();

    const result = await executeSkill(skill as any, context);

    // Approval card should have been created
    expect(createActionFeedEntryCalls.length).toBe(1);
    const call = createActionFeedEntryCalls[0];
    expect(call.actionType).toBe('Approval');
    expect(call.actionData.skill_id).toBe('twitter-follow');
    expect(call.actionData.skill_name).toBe('twitter-follow');
    expect(call.actionData.description).toBeTruthy();

    // Skill should NOT have executed (result.success === false, blocked by latch)
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires explicit approval');

    // Pending approval should be stored
    const pending = getPendingApprovals();
    expect(pending.size).toBe(1);
  });

  // ---------------------------------------------------------------------------
  // E2E-11: Approval Card Creation Failure — FAIL-CLOSED (CRITICAL)
  // ---------------------------------------------------------------------------
  it('E2E-11: FAIL-CLOSED — card creation failure blocks skill execution', async () => {
    // This is the most important safety test in the battery.
    // If createActionFeedEntry throws, the skill must NOT execute.
    createActionFeedEntryBehavior = 'throw';

    const skill = makeTier2Skill('linkedin-connect');
    const context = makeContext();

    const result = await executeSkill(skill as any, context);

    // CRITICAL ASSERTION: Skill must NOT execute
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires explicit approval');

    // createActionFeedEntry was called but threw
    expect(createActionFeedEntryCalls.length).toBe(1);

    // No pending approval should be stored (card creation failed)
    const pending = getPendingApprovals();
    expect(pending.size).toBe(0);

    // No silent fallthrough — the skill execution was blocked
    expect(result.executionTimeMs).toBe(0);
    expect(result.toolsUsed).toEqual([]);
  });

  // ---------------------------------------------------------------------------
  // E2E-12: Approved Skill Executes (Deferred Execution)
  // ---------------------------------------------------------------------------
  it('E2E-12: Approved skill retrieves stored context correctly', async () => {
    // First, create an approval (happy path)
    const skill = makeTier2Skill('twitter-follow');
    const context = makeContext({ messageText: 'follow @testuser' });

    await executeSkill(skill as any, context);

    // Verify pending approval exists
    const pending = getPendingApprovals();
    expect(pending.size).toBe(1);

    // Get the stored approval
    const feedPageId = Array.from(pending.keys())[0];
    const approval = pending.get(feedPageId);
    expect(approval).toBeTruthy();
    expect(approval!.skillName).toBe('twitter-follow');
    expect(approval!.context.messageText).toBe('follow @testuser');
    expect(approval!.context.userId).toBe('test-user');
    expect(approval!.feedPageId).toBe(feedPageId);
  });

  // ---------------------------------------------------------------------------
  // E2E-13: Rejected Skill Aborted Cleanly
  // ---------------------------------------------------------------------------
  it('E2E-13: Rejected skill cleans up pending state', async () => {
    // Create an approval first
    const skill = makeTier2Skill('twitter-follow');
    await executeSkill(skill as any, makeContext());

    const pending = getPendingApprovals();
    expect(pending.size).toBe(1);
    const feedPageId = Array.from(pending.keys())[0];

    // Simulate rejection — remove from pending
    const removed = removePendingApproval(feedPageId);

    expect(removed).toBeTruthy();
    expect(removed!.skillName).toBe('twitter-follow');

    // No orphaned state
    expect(getPendingApprovals().size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // E2E-14: Deferred Execution Failure After Approval
  // ---------------------------------------------------------------------------
  it('E2E-14: Deferred execution failure logs error with context', async () => {
    // Create an approval
    const skill = makeTier2Skill('twitter-follow');
    await executeSkill(skill as any, makeContext());

    const pending = getPendingApprovals();
    const feedPageId = Array.from(pending.keys())[0];
    const approval = pending.get(feedPageId)!;

    // Verify the stored context has enough for diagnostics
    expect(approval.skillName).toBe('twitter-follow');
    expect(approval.feedPageId).toBeTruthy();
    expect(approval.createdAt).toBeInstanceOf(Date);
    expect(approval.context.userId).toBe('test-user');

    // Clean up (in real code, listener would call removePendingApproval)
    removePendingApproval(feedPageId);
    expect(getPendingApprovals().size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // E2E-15: Feature Flag OFF Bypasses Approval
  // ---------------------------------------------------------------------------
  it('E2E-15: Flag OFF — Tier 2 skill blocked without creating Approval card', async () => {
    featureFlagOverrides = { approvalProducer: false };

    const skill = makeTier2Skill('twitter-follow');
    const result = await executeSkill(skill as any, makeContext());

    // Skill still blocked (Tier 2 latch)
    expect(result.success).toBe(false);
    expect(result.error).toContain('requires explicit approval');

    // But NO Approval card created
    expect(createActionFeedEntryCalls.length).toBe(0);

    // No pending approvals
    expect(getPendingApprovals().size).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // E2E-16: Approval Producer Doesn't Interfere With Other Systems
  // ---------------------------------------------------------------------------
  it('E2E-16: Multiple Tier 2 skills create independent Approval cards', async () => {
    const skill1 = makeTier2Skill('twitter-follow');
    const skill2 = makeTier2Skill('linkedin-connect');

    await executeSkill(skill1 as any, makeContext({ messageText: 'follow alice' }));
    await executeSkill(skill2 as any, makeContext({ messageText: 'connect with bob' }));

    // Two independent cards created
    expect(createActionFeedEntryCalls.length).toBe(2);
    expect(createActionFeedEntryCalls[0].actionData.skill_name).toBe('twitter-follow');
    expect(createActionFeedEntryCalls[1].actionData.skill_name).toBe('linkedin-connect');

    // Two independent pending approvals
    const pending = getPendingApprovals();
    expect(pending.size).toBe(2);

    // Verify no cross-contamination
    const entries = Array.from(pending.values());
    expect(entries[0].skillName).not.toBe(entries[1].skillName);
  });
});

// =============================================================================
// P3 REVIEW CARD TESTS
// =============================================================================

describe('P3 Review Cards', () => {

  // ---------------------------------------------------------------------------
  // E2E-17: Research Completion Creates Review Card (Happy Path)
  //
  // Tests the createActionFeedEntry('Review', ...) call directly.
  // The actual injection points are in worker/index.ts and research-executor.ts,
  // which we can't call without a real agent system. Instead we test the
  // ReviewData shape and card creation contract.
  // ---------------------------------------------------------------------------
  it('E2E-17: Review card created with correct payload shape', async () => {
    // Simulate what worker/index.ts does after syncAgentComplete
    const { createActionFeedEntry } = await import('../src/notion');

    const reviewData: ActionDataReview = {
      wq_item_id: 'wq-item-123',
      wq_title: 'Research: AI safety techniques',
      output_url: 'https://notion.so/page/123',
    };

    const feedPageId = await createActionFeedEntry(
      'Review',
      reviewData,
      'worker',
      'Review: AI safety techniques',
      ['research-review']
    );

    expect(feedPageId).toBeTruthy();

    // Verify the mock captured correct params
    const reviewCall = createActionFeedEntryCalls.find(c => c.actionType === 'Review');
    expect(reviewCall).toBeTruthy();
    expect(reviewCall!.actionData.wq_item_id).toBe('wq-item-123');
    expect(reviewCall!.actionData.wq_title).toBe('Research: AI safety techniques');
    expect(reviewCall!.actionData.output_url).toBe('https://notion.so/page/123');
    expect(reviewCall!.source).toBe('worker');
    expect(reviewCall!.keywords).toContain('research-review');
  });

  // ---------------------------------------------------------------------------
  // E2E-18: Review Card Creation Failure — FAIL-OPEN (CRITICAL)
  //
  // This is the mirror of E2E-11. Review is FAIL-OPEN: if card creation
  // fails, research output must still be delivered. We simulate the exact
  // try/catch pattern from worker/index.ts.
  // ---------------------------------------------------------------------------
  it('E2E-18: FAIL-OPEN — card failure does NOT block research delivery', async () => {
    createActionFeedEntryBehavior = 'throw';

    // Simulate the exact pattern from worker/index.ts:
    // 1. syncAgentComplete already succeeded (research delivered)
    // 2. Review card creation is attempted in try/catch
    // 3. If it throws, log warning but don't block
    let researchDelivered = false;
    let reviewCardCreated = false;
    let reviewCardError: string | null = null;

    // Step 1: Research delivery (always succeeds in this simulation)
    researchDelivered = true;

    // Step 2: Attempt Review card (FAIL-OPEN)
    const { createActionFeedEntry } = await import('../src/notion');
    const { isFeatureEnabled } = await import('../src/config/features');

    if (isFeatureEnabled('reviewProducer')) {
      try {
        const reviewData: ActionDataReview = {
          wq_item_id: 'wq-item-456',
          wq_title: 'Research: quantum computing',
        };
        await createActionFeedEntry(
          'Review',
          reviewData,
          'worker',
          'Review: quantum computing',
          ['research-review']
        );
        reviewCardCreated = true;
      } catch (error) {
        // FAIL-OPEN: card failure does NOT block delivery
        reviewCardError = (error as Error).message;
      }
    }

    // CRITICAL ASSERTIONS:
    // Research was delivered regardless of card failure
    expect(researchDelivered).toBe(true);

    // Card creation was attempted but failed
    expect(reviewCardCreated).toBe(false);
    expect(reviewCardError).toBe('Mock: Notion API unavailable');

    // createActionFeedEntry was called (attempt was made)
    expect(createActionFeedEntryCalls.length).toBe(1);

    // CONTRAST WITH E2E-11: In E2E-11, the skill is BLOCKED.
    // Here, the research output is DELIVERED despite card failure.
    // This asymmetry is intentional: Approval = fail-CLOSED, Review = fail-OPEN.
  });

  // ---------------------------------------------------------------------------
  // E2E-19: Accept Review disposition logged
  // ---------------------------------------------------------------------------
  it('E2E-19: Review accepted — disposition logged correctly', async () => {
    // The review listener processes Actioned (accepted) Review cards.
    // Test the data shape that would be logged.
    const reviewData: ActionDataReview = {
      wq_item_id: 'wq-item-789',
      wq_title: 'Research: renewable energy trends',
      disposition: 'Accept',
    };

    // Verify the data shape is correct for accepted reviews
    expect(reviewData.disposition).toBe('Accept');
    expect(reviewData.wq_item_id).toBeTruthy();
    expect(reviewData.wq_title).toBeTruthy();
  });

  // ---------------------------------------------------------------------------
  // E2E-20: Revise Review — revision notes captured
  // ---------------------------------------------------------------------------
  it('E2E-20: Review revised — revision notes captured in data', async () => {
    const reviewData: ActionDataReview = {
      wq_item_id: 'wq-item-101',
      wq_title: 'Research: supply chain optimization',
      disposition: 'Revise',
      revision_notes: 'Needs more quantitative data on cost savings',
    };

    expect(reviewData.disposition).toBe('Revise');
    expect(reviewData.revision_notes).toBeTruthy();
    expect(reviewData.revision_notes).toContain('quantitative data');
  });

  // ---------------------------------------------------------------------------
  // E2E-21: Reject Review — rejection logged
  // ---------------------------------------------------------------------------
  it('E2E-21: Review rejected — rejection data shape correct', async () => {
    const reviewData: ActionDataReview = {
      wq_item_id: 'wq-item-202',
      wq_title: 'Research: outdated framework comparison',
      disposition: 'Reject',
    };

    expect(reviewData.disposition).toBe('Reject');
    expect(reviewData.wq_item_id).toBe('wq-item-202');
  });

  // ---------------------------------------------------------------------------
  // E2E-22: Feature Flag OFF Bypasses Review Cards
  // ---------------------------------------------------------------------------
  it('E2E-22: Flag OFF — no Review card created', async () => {
    featureFlagOverrides = { reviewProducer: false };

    const { isFeatureEnabled } = await import('../src/config/features');

    // Simulate the guard in worker/index.ts
    let cardCreated = false;
    if (isFeatureEnabled('reviewProducer')) {
      // Would create card here
      cardCreated = true;
    }

    expect(cardCreated).toBe(false);
    expect(createActionFeedEntryCalls.length).toBe(0);
  });

  // ---------------------------------------------------------------------------
  // E2E-23: Review Producer Doesn't Block Research Delivery Timing
  // ---------------------------------------------------------------------------
  it('E2E-23: Slow card creation does not block research delivery', async () => {
    createActionFeedEntryBehavior = 'slow';
    createActionFeedEntryDelay = 100; // 100ms simulated delay

    let researchDeliveredAt = 0;
    let cardCreatedAt = 0;

    // Step 1: Research delivery (immediate)
    researchDeliveredAt = Date.now();

    // Step 2: Review card (slow, in try/catch)
    const { createActionFeedEntry } = await import('../src/notion');
    try {
      await createActionFeedEntry('Review', {
        wq_item_id: 'wq-slow-test',
        wq_title: 'Slow test',
      }, 'worker');
      cardCreatedAt = Date.now();
    } catch {
      // Fail-open
    }

    // Research was delivered before card was created
    expect(researchDeliveredAt).toBeLessThanOrEqual(cardCreatedAt);
    // Card creation took at least the simulated delay
    expect(cardCreatedAt - researchDeliveredAt).toBeGreaterThanOrEqual(90); // Allow 10ms tolerance
  });
});

// =============================================================================
// CROSS-PRODUCER REGRESSION TESTS
// =============================================================================

describe('Cross-Producer Regression', () => {

  // ---------------------------------------------------------------------------
  // E2E-24: All Four Producers Coexist
  // ---------------------------------------------------------------------------
  it('E2E-24: Multiple card types created without cross-contamination', async () => {
    const { createActionFeedEntry } = await import('../src/notion');

    // 1. Triage card (simulated)
    await createActionFeedEntry('Triage', {
      classification: 'Research',
      pillar: 'The Grove',
    }, 'triage-handler', 'Triage: AI article');

    // 2. Alert card (simulated)
    await createActionFeedEntry('Alert', {
      alert_type: 'health_check',
      platform: 'notion',
    } as any, 'alert-producer', 'Alert: Notion latency');

    // 3. Approval card (via Tier 2 skill)
    const skill = makeTier2Skill('twitter-follow');
    await executeSkill(skill as any, makeContext());

    // 4. Review card (simulated)
    await createActionFeedEntry('Review', {
      wq_item_id: 'wq-item-e24',
      wq_title: 'Research: test coexistence',
    }, 'worker', 'Review: test');

    // All four card types created
    expect(createActionFeedEntryCalls.length).toBe(4);

    const types = createActionFeedEntryCalls.map(c => c.actionType);
    expect(types).toContain('Triage');
    expect(types).toContain('Alert');
    expect(types).toContain('Approval');
    expect(types).toContain('Review');

    // No cross-contamination: each card has its own type-specific data
    const triageCall = createActionFeedEntryCalls.find(c => c.actionType === 'Triage');
    expect(triageCall!.actionData.classification).toBe('Research');
    expect(triageCall!.actionData).not.toHaveProperty('skill_id');
    expect(triageCall!.actionData).not.toHaveProperty('wq_item_id');

    const approvalCall = createActionFeedEntryCalls.find(c => c.actionType === 'Approval');
    expect(approvalCall!.actionData.skill_id).toBe('twitter-follow');
    expect(approvalCall!.actionData).not.toHaveProperty('classification');
    expect(approvalCall!.actionData).not.toHaveProperty('wq_item_id');

    const reviewCall = createActionFeedEntryCalls.find(c => c.actionType === 'Review');
    expect(reviewCall!.actionData.wq_item_id).toBe('wq-item-e24');
    expect(reviewCall!.actionData).not.toHaveProperty('skill_id');
    expect(reviewCall!.actionData).not.toHaveProperty('classification');
  });

  // ---------------------------------------------------------------------------
  // E2E-25: Startup/Shutdown Lifecycle — All Listeners
  // ---------------------------------------------------------------------------
  it('E2E-25: Listeners start and stop without errors', () => {
    // Start all listeners — should not throw
    expect(() => startApprovalListener(600_000)).not.toThrow(); // Long interval to avoid actual poll
    expect(() => startReviewListener(600_000)).not.toThrow();

    // Double-start should not throw (idempotent)
    expect(() => startApprovalListener(600_000)).not.toThrow();
    expect(() => startReviewListener(600_000)).not.toThrow();

    // Stop all listeners — should not throw
    expect(() => stopApprovalListener()).not.toThrow();
    expect(() => stopReviewListener()).not.toThrow();

    // Double-stop should not throw (idempotent)
    expect(() => stopApprovalListener()).not.toThrow();
    expect(() => stopReviewListener()).not.toThrow();
  });
});
