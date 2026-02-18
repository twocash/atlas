/**
 * Flow Test 3: Command Intent → Forced Tool Use
 *
 * Scenario: User says "Log a bug about the broken classifier".
 * Pre-flight triage detects command intent, rewrites userContent,
 * and forces tool_choice. Pipeline completes with submit_ticket.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { state, config, reset, createMockContext, getStepNames, getStep, toolUseClaudeResponse, textOnlyClaudeResponse, handleConversation } from './_setup';

describe('Flow: Command Intent → Forced Tool Use', () => {
  beforeEach(() => {
    reset();

    config.triageResult = {
      intent: 'command',
      pillar: 'The Grove',
      confidence: 0.94,
      requestType: 'Build',
      source: 'haiku',
      title: 'Bug: broken triage classifier',
      titleRationale: 'Command to log a bug',
      keywords: ['bug', 'triage', 'classifier'],
      command: {
        verb: 'log',
        target: 'bug',
        description: 'The broken triage classifier needs fixing',
        priority: 'P0',
      },
    };

    config.claudeResponses = [
      toolUseClaudeResponse('submit_ticket', {
        title: 'Bug: broken triage classifier',
        description: 'The broken triage classifier needs fixing',
        pillar: 'The Grove',
        priority: 'P0',
      }),
      textOnlyClaudeResponse('Bug logged to Dev Pipeline.'),
    ];
  });

  it('completes full trace with command intent metadata', async () => {
    const ctx = createMockContext({
      messageText: 'Log a bug about the broken triage classifier',
    });

    await handleConversation(ctx);

    const trace = state.capturedTrace;
    expect(trace.status).toBe('complete');

    expect(getStepNames(trace)).toEqual([
      'message-received',
      'triage',
      'context-enrichment',
      'prompt-build',
      'claude-api',
      'tool-execution',
      'audit-trail',
      'response-sent',
    ]);

    // Triage detected command intent
    const triageStep = getStep(trace, 'triage');
    expect(triageStep.metadata.intent).toBe('command');
    expect(triageStep.metadata.pillar).toBe('The Grove');
    expect(triageStep.metadata.confidence).toBe(0.94);
  });

  it('uses command description as smart title in audit', async () => {
    const ctx = createMockContext({
      messageText: 'Log a bug about the broken triage classifier',
    });

    await handleConversation(ctx);

    const audit = state.capturedAuditEntry;
    expect(audit).not.toBeNull();
    // Command intent uses command.description as title (not the meta-request)
    expect(audit.entry).toBe('The broken triage classifier needs fixing');
    expect(audit.pillar).toBe('The Grove');
    expect(audit.requestType).toBe('Build');
  });

  it('executes submit_ticket with command-derived input', async () => {
    const ctx = createMockContext({
      messageText: 'Log a bug about the broken triage classifier',
    });

    await handleConversation(ctx);

    expect(state.toolCallCount).toBe(1);
    expect(state.toolCallArgs[0].name).toBe('submit_ticket');
    expect(state.toolCallArgs[0].input.priority).toBe('P0');
  });
});
