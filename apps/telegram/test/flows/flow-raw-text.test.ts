/**
 * Flow Test 4: Raw Text → Chat Response (No Tool Use)
 *
 * Scenario: User sends a plain text reminder. Claude responds with
 * text only (no tool calls). Pipeline still creates audit trail.
 * Trace has 7 steps (no tool-execution step).
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { state, config, reset, createMockContext, getStepNames, getStep, textOnlyClaudeResponse, handleConversation } from './_setup';

describe('Flow: Raw Text → Chat Response (No Tools)', () => {
  beforeEach(() => {
    reset();

    config.triageResult = {
      intent: 'capture',
      pillar: 'Personal',
      confidence: 0.95,
      requestType: 'Process',
      source: 'haiku',
      title: 'Dentist appointment reminder',
      titleRationale: 'Personal reminder task',
      keywords: ['dentist', 'reminder', 'health'],
      command: null,
    };

    // Single text-only response — no tool use
    config.claudeResponses = [
      textOnlyClaudeResponse("Got it! I'll keep track of your dentist appointment for Monday."),
    ];
  });

  it('completes 7-step trace without tool-execution', async () => {
    const ctx = createMockContext({
      messageText: 'Reminder to call the dentist on Monday',
    });

    await handleConversation(ctx);

    const trace = state.capturedTrace;
    expect(trace).not.toBeNull();
    expect(trace.status).toBe('complete');

    const stepNames = getStepNames(trace);
    expect(stepNames).toEqual([
      'message-received',
      'triage',
      'context-enrichment',
      'prompt-build',
      'claude-api',
      'audit-trail',
      'response-sent',
    ]);

    // Notably: NO tool-execution step
    expect(stepNames).not.toContain('tool-execution');
  });

  it('creates audit for chat-only response', async () => {
    const ctx = createMockContext({
      messageText: 'Reminder to call the dentist on Monday',
    });

    await handleConversation(ctx);

    const audit = state.capturedAuditEntry;
    expect(audit).not.toBeNull();
    expect(audit.pillar).toBe('Personal');
    expect(audit.requestType).toBe('Process');
    expect(audit.entry).toBe('Dentist appointment reminder');
    expect(audit.hasAttachment).toBe(false);
  });

  it('sends reply without tool execution', async () => {
    const ctx = createMockContext({
      messageText: 'Reminder to call the dentist on Monday',
    });

    await handleConversation(ctx);

    // No tools called
    expect(state.toolCallCount).toBe(0);
    expect(state.toolCallArgs).toHaveLength(0);

    // Reply was sent
    expect(state.replyCallArgs.length).toBeGreaterThanOrEqual(1);

    // All trace steps have timing
    for (const step of state.capturedTrace.steps) {
      expect(step.completedAt).toBeGreaterThanOrEqual(step.startedAt);
    }
  });
});
