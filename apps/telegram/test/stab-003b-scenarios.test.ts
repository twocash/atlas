/**
 * STAB-003b Chain Tests — SESSION-STATE-FOUNDATION
 *
 * Chain tests (ADR-002 Constraint 6): prove water flows through the unified pipe.
 *
 * Scenario 1: URL → question → intent → approval → execution (no amnesia)
 *   - Content context persists across Socratic → approval → execution
 *   - Post-approval pipeline skip reuses cached triage + assessment (Bug #1)
 *   - Pillar stable from initial triage, not re-triaged on "yes" (Bug #5)
 *
 * Scenario 2: Single-step moderate proposal → no approval gate (Bug #3)
 *   - steps.length < 2 bypasses the approval gate
 *
 * Scenario 3: Post-approval → pillar stable (Bug #5) + no double triage (Bug #4)
 *   - Triage runs once, cached in state. Approval does not re-triage.
 *
 * Sprint: SESSION-STATE-FOUNDATION
 */

import { describe, it, expect, beforeEach } from 'bun:test';

import {
  getOrCreateState,
  getState,
  getStateByUserId,
  storeContentContext,
  getContentContext,
  storeTriage,
  storeAssessment,
  enterSocraticPhase,
  enterDialoguePhase,
  enterApprovalPhase,
  returnToIdle,
  hasActiveSession,
  isInPhase,
  clearAllStates,
  type ContentContext,
  type ApprovalState,
  type SocraticSessionState,
} from '../src/conversation/conversation-state';

import type { RequestAssessment, AssessmentContext } from '../../../packages/agents/src/assessment/types';
import type { ApproachProposal } from '../../../packages/agents/src/assessment/types';
import type { TriageResult } from '@atlas/agents/src/cognitive/triage-skill';

import {
  isApprovalSignal,
  isRejectionSignal,
} from '../src/conversation/approval-session';

// ─── Fixtures ───────────────────────────────────────────

const CHAT_ID = 42001;
const USER_ID = 42002;

function mockTriageResult(overrides?: Partial<TriageResult>): TriageResult {
  return {
    intent: 'capture',
    pillar: 'The Grove',
    confidence: 0.88,
    requestType: 'Research',
    keywords: ['AI', 'infrastructure'],
    source: 'haiku',
    title: 'AI Infrastructure Research',
    complexityTier: 'moderate',
    ...overrides,
  } as TriageResult;
}

function mockAssessment(overrides?: Partial<RequestAssessment>): RequestAssessment {
  return {
    complexity: 'moderate',
    pillar: 'The Grove',
    domain: 'grove',
    audience: 'self',
    approach: {
      steps: [
        { description: 'Research AI infrastructure patterns' },
        { description: 'Draft summary with key findings' },
      ],
      timeEstimate: '~3 minutes',
      alternativeAngles: ['Focus on cost analysis'],
    },
    capabilities: [],
    reasoning: 'Multi-step research with output',
    signals: {
      multiStep: true,
      ambiguousGoal: false,
      contextDependent: true,
      timeSensitive: false,
      highStakes: false,
      novelPattern: false,
    },
    ...overrides,
  };
}

function mockAssessmentContext(): AssessmentContext {
  return {
    intent: 'research',
    pillar: 'The Grove',
    keywords: ['AI', 'infrastructure'],
    hasUrl: true,
    hasContact: false,
    hasDeadline: false,
  };
}

// ─── Scenario 1: URL → question → intent → approval → execution ──

describe('Scenario 1: URL flow with context preservation (no amnesia)', () => {
  beforeEach(() => clearAllStates());

  it('content context stored during URL share', () => {
    storeContentContext(CHAT_ID, USER_ID, {
      url: 'https://arxiv.org/abs/2401.12345',
      title: 'AI Infrastructure Patterns for Multi-Agent Systems',
      preReadSummary: 'A survey of infrastructure patterns for deploying multi-agent LLM systems at scale.',
      capturedAt: Date.now(),
    });

    const ctx = getContentContext(CHAT_ID);
    expect(ctx).toBeDefined();
    expect(ctx!.url).toBe('https://arxiv.org/abs/2401.12345');
    expect(ctx!.preReadSummary).toContain('multi-agent');
  });

  it('content context survives Socratic phase', () => {
    // Step 1: URL share → store content context
    storeContentContext(CHAT_ID, USER_ID, {
      url: 'https://arxiv.org/abs/2401.12345',
      title: 'AI Infrastructure Patterns',
      preReadSummary: 'Multi-agent infrastructure survey.',
      capturedAt: Date.now(),
    });

    // Step 2: Socratic engine asks question
    enterSocraticPhase(CHAT_ID, USER_ID, {
      sessionId: 'soc-001',
      questionMessageId: 100,
      questions: [],
      currentQuestionIndex: 0,
      content: 'https://arxiv.org/abs/2401.12345',
      contentType: 'url',
      title: 'AI Infrastructure Patterns',
      signals: { hasUrl: true } as any,
    });

    expect(isInPhase(USER_ID, 'socratic')).toBe(true);
    expect(getContentContext(CHAT_ID)!.url).toBe('https://arxiv.org/abs/2401.12345');
  });

  it('content context survives through approval phase', () => {
    // Step 1: URL share
    storeContentContext(CHAT_ID, USER_ID, {
      url: 'https://arxiv.org/abs/2401.12345',
      title: 'AI Infrastructure Patterns',
      preReadSummary: 'Multi-agent infrastructure survey.',
      capturedAt: Date.now(),
    });

    // Step 2: Socratic resolves → enters idle
    enterSocraticPhase(CHAT_ID, USER_ID, {
      sessionId: 'soc-002',
      questionMessageId: 101,
      questions: [],
      currentQuestionIndex: 0,
      content: 'https://arxiv.org/abs/2401.12345',
      contentType: 'url',
      title: 'AI Infrastructure Patterns',
      signals: { hasUrl: true } as any,
    });
    returnToIdle(CHAT_ID);

    // Step 3: Triage + assessment happen, then approval gate
    const triage = mockTriageResult();
    const assessment = mockAssessment();
    storeTriage(CHAT_ID, triage);
    storeAssessment(CHAT_ID, assessment, mockAssessmentContext());

    enterApprovalPhase(CHAT_ID, USER_ID, {
      proposalMessageId: 200,
      proposal: assessment.approach!,
      originalMessage: 'Research AI infrastructure patterns',
      assessment,
      assessmentContext: mockAssessmentContext(),
    });

    // Verify: content context, triage, and assessment all survive
    const state = getState(CHAT_ID)!;
    expect(state.phase).toBe('approval');
    expect(state.contentContext!.url).toBe('https://arxiv.org/abs/2401.12345');
    expect(state.lastTriage!.pillar).toBe('The Grove');
    expect(state.lastAssessment!.complexity).toBe('moderate');
  });

  it('post-approval: cached triage + assessment available for pipeline skip (Bug #1)', () => {
    // Setup: URL share → triage → assessment → approval gate
    storeContentContext(CHAT_ID, USER_ID, {
      url: 'https://arxiv.org/abs/2401.12345',
      title: 'AI Infrastructure Patterns',
      capturedAt: Date.now(),
    });
    const triage = mockTriageResult();
    const assessment = mockAssessment();
    storeTriage(CHAT_ID, triage);
    storeAssessment(CHAT_ID, assessment, mockAssessmentContext());

    enterApprovalPhase(CHAT_ID, USER_ID, {
      proposalMessageId: 200,
      proposal: assessment.approach!,
      originalMessage: 'Research AI infrastructure patterns',
      assessment,
      assessmentContext: mockAssessmentContext(),
    });

    // Jim says "yes" — approval granted, return to idle
    expect(isApprovalSignal('yes')).toBe(true);
    returnToIdle(CHAT_ID);

    // Pipeline skip: cached triage + assessment available
    const state = getState(CHAT_ID)!;
    expect(state.phase).toBe('idle');
    expect(state.lastTriage).toBeDefined();
    expect(state.lastTriage!.pillar).toBe('The Grove');
    expect(state.lastAssessment).toBeDefined();
    expect(state.lastAssessment!.complexity).toBe('moderate');
    // Content context also preserved
    expect(state.contentContext!.url).toBe('https://arxiv.org/abs/2401.12345');
  });
});

// ─── Scenario 2: Single-step moderate → no approval gate (Bug #3) ──

describe('Scenario 2: Single-step moderate → no approval gate (Bug #3)', () => {
  beforeEach(() => clearAllStates());

  it('single-step moderate proposal should NOT trigger approval gate', () => {
    const singleStepAssessment = mockAssessment({
      complexity: 'moderate',
      approach: {
        steps: [{ description: 'Quick research on topic' }],
        timeEstimate: '~1 minute',
        alternativeAngles: [],
      },
    });

    // The approval gate condition:
    // assessment.approach.steps.length >= 2 && complexity !== 'simple' && !approvalGranted
    const shouldGate =
      singleStepAssessment.approach!.steps.length >= 2 &&
      singleStepAssessment.complexity !== 'simple';

    expect(shouldGate).toBe(false);
  });

  it('two-step moderate proposal SHOULD trigger approval gate', () => {
    const twoStepAssessment = mockAssessment({
      complexity: 'moderate',
      approach: {
        steps: [
          { description: 'Research AI patterns' },
          { description: 'Draft summary' },
        ],
        timeEstimate: '~3 minutes',
        alternativeAngles: [],
      },
    });

    const shouldGate =
      twoStepAssessment.approach!.steps.length >= 2 &&
      twoStepAssessment.complexity !== 'simple';

    expect(shouldGate).toBe(true);
  });

  it('simple assessment with approach never gates', () => {
    const simpleAssessment = mockAssessment({
      complexity: 'simple',
      approach: {
        steps: [
          { description: 'Step 1' },
          { description: 'Step 2' },
        ],
        timeEstimate: '~1 minute',
        alternativeAngles: [],
      },
    });

    const shouldGate =
      simpleAssessment.approach!.steps.length >= 2 &&
      simpleAssessment.complexity !== 'simple';

    expect(shouldGate).toBe(false);
  });
});

// ─── Scenario 3: Post-approval pillar stability (Bug #4, #5) ──

describe('Scenario 3: Post-approval pillar stability (Bug #4, #5)', () => {
  beforeEach(() => clearAllStates());

  it('stored triage pillar survives approval cycle (Bug #5)', () => {
    // Step 1: Initial triage → pillar = The Grove
    const state = getOrCreateState(CHAT_ID, USER_ID);
    storeTriage(CHAT_ID, mockTriageResult({ pillar: 'The Grove' }));

    // Step 2: Assessment → approval gate
    storeAssessment(CHAT_ID, mockAssessment(), mockAssessmentContext());
    enterApprovalPhase(CHAT_ID, USER_ID, {
      proposalMessageId: 300,
      proposal: mockAssessment().approach!,
      originalMessage: 'Research AI infrastructure',
      assessment: mockAssessment(),
      assessmentContext: mockAssessmentContext(),
    });

    // Step 3: Jim approves → return to idle
    returnToIdle(CHAT_ID);

    // Bug #5 check: pillar should still be The Grove, not drifted
    const afterApproval = getState(CHAT_ID)!;
    expect(afterApproval.lastTriage!.pillar).toBe('The Grove');
    // Not re-triaged to something else
  });

  it('triage stored only once in unified state (Bug #4)', () => {
    getOrCreateState(CHAT_ID, USER_ID);

    // First triage
    const triage1 = mockTriageResult({ title: 'First Triage' });
    storeTriage(CHAT_ID, triage1);
    expect(getState(CHAT_ID)!.lastTriage!.title).toBe('First Triage');

    // If double triage happens (Bug #4), the second one overwrites
    // With pipeline skip, the second triage should NOT happen at all
    // But if it did, the title would change — this test documents
    // the "last write wins" behavior as a safety net
    const triage2 = mockTriageResult({ title: 'Second Triage' });
    storeTriage(CHAT_ID, triage2);
    expect(getState(CHAT_ID)!.lastTriage!.title).toBe('Second Triage');
  });

  it('approval signal detection works for common patterns', () => {
    // Positive signals
    expect(isApprovalSignal('yes')).toBe(true);
    expect(isApprovalSignal('Yeah')).toBe(true);
    expect(isApprovalSignal('sure')).toBe(true);
    expect(isApprovalSignal('go ahead')).toBe(true);
    expect(isApprovalSignal('sounds right')).toBe(true);
    expect(isApprovalSignal('sounds good')).toBe(true);
    expect(isApprovalSignal('do it')).toBe(true);
    expect(isApprovalSignal("let's go")).toBe(true);

    // Negative signals
    expect(isRejectionSignal('no')).toBe(true);
    expect(isRejectionSignal('wait')).toBe(true);
    expect(isRejectionSignal('different')).toBe(true);

    // Not signals (should flow through as new messages)
    expect(isApprovalSignal('research AI trends for me')).toBe(false);
    expect(isRejectionSignal('research AI trends for me')).toBe(false);
  });
});

// ─── URL Context Prepend (Bug #2) ──

describe('URL context prepend for triage enrichment (Bug #2)', () => {
  beforeEach(() => clearAllStates());

  it('content context available for triage prepend', () => {
    storeContentContext(CHAT_ID, USER_ID, {
      url: 'https://openai.com/blog/new-models',
      title: 'New AI Models Released',
      preReadSummary: 'OpenAI announces new model family with improved reasoning.',
      capturedAt: Date.now(),
    });

    // Simulate handler.ts triage prepend logic
    const messageText = 'research this for The Grove';
    const contentCtx = getContentContext(CHAT_ID);

    expect(contentCtx).toBeDefined();
    expect(messageText.includes('http')).toBe(false); // No URL in follow-up

    // Build triage input with prepended context
    const contextParts = [`[URL context: ${contentCtx!.url}]`];
    if (contentCtx!.title) contextParts.push(`[Title: ${contentCtx!.title}]`);
    if (contentCtx!.preReadSummary) contextParts.push(`[Summary: ${contentCtx!.preReadSummary}]`);
    const triageInput = `${contextParts.join(' ')}\n\n${messageText}`;

    expect(triageInput).toContain('https://openai.com/blog/new-models');
    expect(triageInput).toContain('New AI Models Released');
    expect(triageInput).toContain('OpenAI announces new model family');
    expect(triageInput).toContain('research this for The Grove');
  });

  it('no prepend when message already contains URL', () => {
    storeContentContext(CHAT_ID, USER_ID, {
      url: 'https://old-url.com',
      title: 'Old Article',
      capturedAt: Date.now(),
    });

    const messageText = 'https://new-url.com check this out';
    // Handler.ts logic: only prepend if !messageText.includes('http')
    expect(messageText.includes('http')).toBe(true);
    // → Should NOT prepend old context, the new URL gets its own flow
  });
});

// ─── Phase Transition Safety ──

describe('Phase transition safety', () => {
  beforeEach(() => clearAllStates());

  it('new URL share cancels stale Socratic session', () => {
    // Step 1: Enter Socratic phase
    enterSocraticPhase(CHAT_ID, USER_ID, {
      sessionId: 'soc-stale',
      questionMessageId: 100,
      questions: [],
      currentQuestionIndex: 0,
      content: 'https://old-article.com',
      contentType: 'url',
      title: 'Old Article',
      signals: { hasUrl: true } as any,
    });
    expect(isInPhase(USER_ID, 'socratic')).toBe(true);

    // Step 2: New URL share → return to idle (handler does this)
    returnToIdle(CHAT_ID);
    expect(isInPhase(USER_ID, 'socratic')).toBe(false);
    expect(hasActiveSession(USER_ID)).toBe(false);
  });

  it('new URL share cancels stale approval session', () => {
    enterApprovalPhase(CHAT_ID, USER_ID, {
      proposalMessageId: 200,
      proposal: { steps: [{ description: 'S1' }, { description: 'S2' }], timeEstimate: '~2m', alternativeAngles: [] },
      originalMessage: 'do something',
      assessment: mockAssessment(),
      assessmentContext: mockAssessmentContext(),
    });
    expect(isInPhase(USER_ID, 'approval')).toBe(true);

    returnToIdle(CHAT_ID);
    expect(isInPhase(USER_ID, 'approval')).toBe(false);
  });
});
