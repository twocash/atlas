/**
 * Flow Test 1: LinkedIn Post → Grove Capture
 *
 * Scenario: User shares a LinkedIn URL. Pipeline triages to The Grove,
 * Claude calls submit_ticket, audit writes Feed + Work Queue entry.
 * Full 8-step trace verified.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { state, config, reset, createMockContext, getStepNames, getStep, toolUseClaudeResponse, textOnlyClaudeResponse, handleConversation } from './_setup';

describe('Flow: LinkedIn Post → Grove Capture', () => {
  beforeEach(() => {
    reset();

    config.triageResult = {
      intent: 'capture',
      pillar: 'The Grove',
      confidence: 0.92,
      requestType: 'Research',
      source: 'haiku',
      title: 'AI agent orchestration patterns',
      titleRationale: 'Article about AI agent patterns',
      keywords: ['AI', 'agents', 'orchestration'],
      command: null,
    };

    config.claudeResponses = [
      toolUseClaudeResponse('submit_ticket', {
        title: 'AI agent orchestration patterns',
        description: 'LinkedIn article on agent orchestration',
        pillar: 'The Grove',
        priority: 'P2',
      }),
      textOnlyClaudeResponse('Captured to The Grove! https://notion.so/test-page-123'),
    ];
  });

  it('traces full pipeline from message to response (8 steps)', async () => {
    const ctx = createMockContext({
      messageText: 'Check out this AI article https://linkedin.com/post/123',
    });

    await handleConversation(ctx);

    const trace = state.capturedTrace;
    expect(trace).not.toBeNull();
    expect(trace.status).toBe('complete');
    expect(trace.totalDurationMs).toBeGreaterThanOrEqual(0);

    const stepNames = getStepNames(trace);
    expect(stepNames).toEqual([
      'message-received',
      'triage',
      'context-enrichment',
      'prompt-build',
      'claude-api',
      'tool-execution',
      'audit-trail',
      'response-sent',
    ]);

    // Every step should have timing
    for (const step of trace.steps) {
      expect(step.startedAt).toBeGreaterThan(0);
      expect(step.completedAt).toBeGreaterThanOrEqual(step.startedAt);
      expect(step.durationMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('populates trace metadata at each pipeline stage', async () => {
    const ctx = createMockContext({
      messageText: 'Check out this AI article https://linkedin.com/post/123',
    });

    await handleConversation(ctx);

    const trace = state.capturedTrace;

    // message-received
    const msgStep = getStep(trace, 'message-received');
    expect(msgStep.metadata.userId).toBe(12345);
    expect(msgStep.metadata.messageLength).toBeGreaterThan(0);
    expect(msgStep.metadata.hasMedia).toBe(false);

    // triage
    const triageStep = getStep(trace, 'triage');
    expect(triageStep.metadata.intent).toBe('capture');
    expect(triageStep.metadata.pillar).toBe('The Grove');
    expect(triageStep.metadata.confidence).toBe(0.92);

    // context-enrichment
    const enrichStep = getStep(trace, 'context-enrichment');
    expect(enrichStep.metadata.slotsUsed).toEqual(['domain']);
    expect(enrichStep.metadata.tier).toBe('quick');

    // claude-api
    const claudeStep = getStep(trace, 'claude-api');
    expect(claudeStep.metadata.model).toBe('claude-sonnet-4-20250514');

    // tool-execution
    const toolStep = getStep(trace, 'tool-execution');
    expect(toolStep.metadata.toolName).toBe('submit_ticket');
    expect(toolStep.metadata.success).toBe(true);

    // audit-trail
    const auditStep = getStep(trace, 'audit-trail');
    expect(auditStep.metadata.feedId).toBe('feed-page-id-123');
    expect(auditStep.metadata.workQueueId).toBe('wq-page-id-456');
  });

  it('creates audit entry with correct classification', async () => {
    const ctx = createMockContext({
      messageText: 'Check out this AI article https://linkedin.com/post/123',
    });

    await handleConversation(ctx);

    const audit = state.capturedAuditEntry;
    expect(audit).not.toBeNull();
    expect(audit.pillar).toBe('The Grove');
    expect(audit.requestType).toBe('Research');
    expect(audit.source).toBe('Telegram');
    expect(audit.userId).toBe(12345);
    expect(audit.hasAttachment).toBe(false);
  });

  it('executes submit_ticket and sends reply', async () => {
    const ctx = createMockContext({
      messageText: 'Check out this AI article https://linkedin.com/post/123',
    });

    await handleConversation(ctx);

    // Tool was called
    expect(state.toolCallCount).toBe(1);
    expect(state.toolCallArgs[0].name).toBe('submit_ticket');

    // Reply was sent
    expect(state.replyCallArgs.length).toBeGreaterThanOrEqual(1);

    // Reactions were set (reading → working → done)
    expect(state.reactCallArgs.length).toBeGreaterThanOrEqual(2);
  });
});
