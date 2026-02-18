/**
 * Flow Test 5: Ambiguous Input → Routing Keyboard
 *
 * Scenario: User sends an ambiguous message. Claude calls submit_ticket
 * but the tool returns needsChoice (low routing confidence). Handler
 * presents a routing choice keyboard and exits early — NO audit trail.
 * Trace has 6 steps, status remains 'active'.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { state, config, reset, createMockContext, getStepNames, getStep, toolUseClaudeResponse, handleConversation } from './_setup';

describe('Flow: Ambiguous → Routing Choice Keyboard', () => {
  beforeEach(() => {
    reset();

    config.triageResult = {
      intent: 'capture',
      pillar: 'Consulting',
      confidence: 0.45,
      requestType: 'Research',
      source: 'haiku',
      title: 'Notion CRM integration evaluation',
      titleRationale: 'Ambiguous — could be client or Grove',
      keywords: ['notion', 'CRM', 'integration'],
      command: null,
    };

    config.claudeResponses = [
      toolUseClaudeResponse('submit_ticket', {
        title: 'Notion CRM integration',
        description: 'Evaluate Notion-CRM integration options',
        pillar: 'Consulting',
        priority: 'P1',
      }),
    ];

    // Tool returns needsChoice — triggers routing keyboard
    config.executeToolResult = {
      success: true,
      needsChoice: true,
      result: {
        routingConfidence: 55,
        suggestedCategory: 'Consulting',
        alternativeCategory: 'The Grove',
        title: 'Notion CRM integration',
        description: 'Evaluate Notion-CRM integration options',
        priority: 'P1',
        requireReview: false,
        pillar: 'Consulting',
        reasoning: 'Could be client work or Grove research project',
      },
    };
  });

  it('stops at 6 steps with trace status active (no audit)', async () => {
    const ctx = createMockContext({
      messageText: 'Should we integrate Notion with the CRM?',
    });

    await handleConversation(ctx);

    const trace = state.capturedTrace;
    expect(trace).not.toBeNull();

    // Trace is NOT complete — keyboard shown, waiting for user choice
    expect(trace.status).toBe('active');
    expect(trace.totalDurationMs).toBeUndefined();

    const stepNames = getStepNames(trace);
    expect(stepNames).toEqual([
      'message-received',
      'triage',
      'context-enrichment',
      'prompt-build',
      'claude-api',
      'tool-execution',
    ]);

    // No audit-trail or response-sent steps
    expect(stepNames).not.toContain('audit-trail');
    expect(stepNames).not.toContain('response-sent');
  });

  it('does not create audit entry', async () => {
    const ctx = createMockContext({
      messageText: 'Should we integrate Notion with the CRM?',
    });

    await handleConversation(ctx);

    // No audit was created (early return before audit step)
    expect(state.capturedAuditEntry).toBeNull();
  });

  it('stores pending dispatch and sends keyboard reply', async () => {
    const ctx = createMockContext({
      messageText: 'Should we integrate Notion with the CRM?',
    });

    await handleConversation(ctx);

    // Pending dispatch was stored
    expect(state.storePendingDispatchCalls).toHaveLength(1);
    const pending = state.storePendingDispatchCalls[0];
    expect(pending.userId).toBe(12345);
    expect(pending.suggestedCategory).toBe('Consulting');
    expect(pending.alternativeCategory).toBe('The Grove');

    // Reply was sent (the keyboard message)
    expect(state.replyCallArgs.length).toBeGreaterThanOrEqual(1);
    const lastReply = state.replyCallArgs[state.replyCallArgs.length - 1];
    expect(lastReply.options?.reply_markup).toBeDefined();

    // Conversation was updated
    expect(state.updateConversationCalls).toHaveLength(1);
  });
});
