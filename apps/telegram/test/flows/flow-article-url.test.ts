/**
 * Flow Test 2: Article URL → Research Dispatch
 *
 * Scenario: User shares an arxiv/research URL. Pipeline triages as Research,
 * Claude calls dispatch_research, audit writes Feed entry.
 * Verifies research-specific routing through full trace.
 */

import { describe, it, expect, beforeEach } from 'bun:test';
import { state, config, reset, createMockContext, getStepNames, getStep, toolUseClaudeResponse, textOnlyClaudeResponse, handleConversation } from './_setup';

describe('Flow: Article URL → Research Dispatch', () => {
  beforeEach(() => {
    reset();

    config.triageResult = {
      intent: 'capture',
      pillar: 'The Grove',
      confidence: 0.88,
      requestType: 'Research',
      source: 'haiku',
      title: 'Transformer attention mechanisms paper',
      titleRationale: 'Academic paper on attention patterns',
      keywords: ['transformers', 'attention', 'research'],
      command: null,
    };

    config.claudeResponses = [
      toolUseClaudeResponse('dispatch_research', {
        topic: 'Transformer attention mechanisms',
        depth: 'deep',
        source_url: 'https://arxiv.org/abs/2024.12345',
      }),
      textOnlyClaudeResponse('Research dispatched — deep dive queued on transformer attention.'),
    ];

    config.executeToolResult = {
      success: true,
      result: {
        url: 'https://notion.so/research-page-789',
        feedUrl: 'https://notion.so/feed-research-101',
      },
    };
  });

  it('traces research dispatch through 8 pipeline steps', async () => {
    const ctx = createMockContext({
      messageText: 'Research this: https://arxiv.org/abs/2024.12345',
    });

    await handleConversation(ctx);

    const trace = state.capturedTrace;
    expect(trace).not.toBeNull();
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
  });

  it('routes through dispatch_research tool', async () => {
    const ctx = createMockContext({
      messageText: 'Research this: https://arxiv.org/abs/2024.12345',
    });

    await handleConversation(ctx);

    // Correct tool called
    expect(state.toolCallCount).toBe(1);
    expect(state.toolCallArgs[0].name).toBe('dispatch_research');
    expect(state.toolCallArgs[0].input.topic).toBe('Transformer attention mechanisms');

    // Tool step metadata
    const toolStep = getStep(state.capturedTrace, 'tool-execution');
    expect(toolStep.metadata.toolName).toBe('dispatch_research');
    expect(toolStep.metadata.success).toBe(true);
  });

  it('creates audit with Research classification', async () => {
    const ctx = createMockContext({
      messageText: 'Research this: https://arxiv.org/abs/2024.12345',
    });

    await handleConversation(ctx);

    const audit = state.capturedAuditEntry;
    expect(audit).not.toBeNull();
    expect(audit.pillar).toBe('The Grove');
    expect(audit.requestType).toBe('Research');
    expect(audit.keywords).toEqual(['transformers', 'attention', 'research']);
    expect(audit.tokenCount).toBeGreaterThan(0);
  });
});
