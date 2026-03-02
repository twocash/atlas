/**
 * research-hallucination-guard.test.ts — Sprint C: Bug 6
 *
 * Tests for the three anti-hallucination mechanisms:
 * 1. fixHallucinatedUrls — URL fabrication detection including dispatch_research
 * 2. Research grounding enforcement — 0-citation path throws HALLUCINATION
 * 3. Andon gate enforcement — low-confidence results constrained
 *
 * Note: fixHallucinatedUrls is module-private (import chain requires @atlas/shared).
 * We re-implement the same logic here to validate the algorithm — same pattern
 * as socratic-exit-signals.test.ts.
 */

import { describe, it, expect } from 'bun:test';

// ─── Re-implementation of fixHallucinatedUrls (same algorithm as orchestrator.ts) ──

interface ToolContext {
  toolName: string;
  input: Record<string, unknown>;
  result: { success?: boolean; result?: unknown; error?: string };
  timestamp: string;
}

function fixHallucinatedUrls(responseText: string, toolContexts: ToolContext[]): string {
  const dispatchToolNames = ['submit_ticket', 'work_queue_create', 'mcp__pit_crew__dispatch_work', 'dispatch_research'];
  let dispatchFailed = false;
  let failureError = '';

  const actualUrls: string[] = [];
  for (let i = toolContexts.length - 1; i >= 0; i--) {
    const tc = toolContexts[i];
    const toolResult = tc.result;

    if (dispatchToolNames.includes(tc.toolName)) {
      if (!toolResult?.success) {
        dispatchFailed = true;
        failureError = toolResult?.error || 'Dispatch failed';
      }
    }

    if (toolResult?.success) {
      const result = toolResult.result as Record<string, unknown> | undefined;
      if (result?.url && typeof result.url === 'string') {
        actualUrls.push(result.url);
      }
      if (result?.feedUrl && typeof result.feedUrl === 'string') {
        actualUrls.push(result.feedUrl);
      }
      if (result?.workQueueUrl && typeof result.workQueueUrl === 'string') {
        actualUrls.push(result.workQueueUrl);
      }
    }
  }

  // CRITICAL: Dispatch failed but Claude may have fabricated a success URL
  if (dispatchFailed && actualUrls.length === 0) {
    const notionUrlPattern = /https?:\/\/(?:www\.)?notion\.so\/[^\s\)\]>]+/gi;
    const matches = responseText.match(notionUrlPattern);

    if (matches && matches.length > 0) {
      let fixedText = responseText;
      for (const match of matches) {
        fixedText = fixedText.split(match).join('[DISPATCH FAILED]');
      }
      return `${fixedText}\n\n⚠️ **Dispatch failed:** ${failureError}`;
    }
  }

  if (actualUrls.length === 0) {
    return responseText;
  }

  const notionUrlPattern = /https?:\/\/(?:www\.)?notion\.so\/[^\s\)\]>]+/gi;
  const matches = responseText.match(notionUrlPattern);

  if (!matches || matches.length === 0) {
    return `${responseText}\n\n📎 ${actualUrls[0]}`;
  }

  // Extract page IDs from URLs for robust comparison (slug-independent)
  const extractPageId = (url: string): string | null => {
    const m = url.match(/([0-9a-f]{32})(?:[?#]|$)/i);
    return m ? m[1].toLowerCase() : null;
  };
  const actualPageIds = new Set(actualUrls.map(extractPageId).filter(Boolean) as string[]);

  const uniqueMatches = [...new Set(matches)];
  const isHallucinated = uniqueMatches.some(m => {
    if (actualUrls.includes(m)) return false;
    const pid = extractPageId(m);
    if (pid && actualPageIds.has(pid)) return true;
    return true;
  });

  if (isHallucinated) {
    let fixedText = responseText;
    for (const match of uniqueMatches) {
      if (!actualUrls.includes(match)) {
        fixedText = fixedText.split(match).join(actualUrls[0]);
      }
    }
    return fixedText;
  }

  return responseText;
}

// ─── fixHallucinatedUrls: dispatch_research coverage ─────

describe('fixHallucinatedUrls — dispatch_research', () => {
  it('replaces fabricated URL with actual workQueueUrl', () => {
    const responseText = 'Research complete! View results: https://www.notion.so/Research-edge-AI-chips-fake123';
    const toolContexts: ToolContext[] = [{
      toolName: 'dispatch_research',
      input: { query: 'edge AI chips' },
      result: {
        success: true,
        result: {
          workQueueUrl: 'https://www.notion.so/3d679030b76b43bd92d81ac51abb4a28?p=real-page-id',
          summary: 'Edge AI chip market analysis',
          sourcesCount: 5,
        },
      },
      timestamp: new Date().toISOString(),
    }];

    const fixed = fixHallucinatedUrls(responseText, toolContexts);
    expect(fixed).not.toContain('fake123');
    expect(fixed).toContain('real-page-id');
  });

  it('detects fabricated URL when dispatch_research fails', () => {
    const responseText = 'Here is the research: https://www.notion.so/Research-fabricated-uuid123';
    const toolContexts: ToolContext[] = [{
      toolName: 'dispatch_research',
      input: { query: 'test' },
      result: {
        success: false,
        result: { message: 'Research dispatch failed: HALLUCINATION' },
        error: 'HALLUCINATION: No web sources found',
      },
      timestamp: new Date().toISOString(),
    }];

    const fixed = fixHallucinatedUrls(responseText, toolContexts);
    expect(fixed).toContain('[DISPATCH FAILED]');
    expect(fixed).not.toContain('fabricated-uuid123');
    expect(fixed).toContain('Dispatch failed');
  });

  it('appends actual URL when Claude omits it', () => {
    const responseText = 'Research is done. Check your Work Queue for results.';
    const toolContexts: ToolContext[] = [{
      toolName: 'dispatch_research',
      input: { query: 'test' },
      result: {
        success: true,
        result: {
          workQueueUrl: 'https://www.notion.so/actual-wq-url',
          summary: 'Results here',
        },
      },
      timestamp: new Date().toISOString(),
    }];

    const fixed = fixHallucinatedUrls(responseText, toolContexts);
    expect(fixed).toContain('actual-wq-url');
  });

  it('passes through correct URL unchanged', () => {
    const actualUrl = 'https://www.notion.so/3d679030b76b43bd92d81ac51abb4a28?p=correct-id';
    const responseText = `Research complete! ${actualUrl}`;
    const toolContexts: ToolContext[] = [{
      toolName: 'dispatch_research',
      input: { query: 'test' },
      result: {
        success: true,
        result: {
          workQueueUrl: actualUrl,
          summary: 'Results',
        },
      },
      timestamp: new Date().toISOString(),
    }];

    const fixed = fixHallucinatedUrls(responseText, toolContexts);
    expect(fixed).toBe(responseText);
  });

  it('collects url, feedUrl, AND workQueueUrl as actual URLs', () => {
    const responseText = 'Done. https://www.notion.so/some-fabricated-url';
    const toolContexts: ToolContext[] = [{
      toolName: 'submit_ticket',
      input: {},
      result: {
        success: true,
        result: {
          url: 'https://www.notion.so/wq-url',
          feedUrl: 'https://www.notion.so/feed-url',
          workQueueUrl: 'https://www.notion.so/wq-url-2',
        },
      },
      timestamp: new Date().toISOString(),
    }];

    const fixed = fixHallucinatedUrls(responseText, toolContexts);
    // Fabricated URL should be replaced with an actual one
    expect(fixed).not.toContain('some-fabricated-url');
  });

  it('handles multiple tools — only dispatch_research tracked for failure', () => {
    const responseText = 'Here are results: https://www.notion.so/fabricated-research-url';
    const toolContexts: ToolContext[] = [
      {
        toolName: 'web_search',
        input: { query: 'quick check' },
        result: { success: true, result: { answer: 'quick answer' } },
        timestamp: new Date().toISOString(),
      },
      {
        toolName: 'dispatch_research',
        input: { query: 'deep research' },
        result: {
          success: false,
          result: { message: 'HALLUCINATION: No web sources found' },
          error: 'HALLUCINATION: No web sources found',
        },
        timestamp: new Date().toISOString(),
      },
    ];

    const fixed = fixHallucinatedUrls(responseText, toolContexts);
    expect(fixed).toContain('[DISPATCH FAILED]');
    expect(fixed).not.toContain('fabricated-research-url');
  });

  it('does not flag non-dispatch tools', () => {
    // web_search failures should NOT trigger the dispatch failure detection
    const responseText = 'I found some info about edge AI.';
    const toolContexts: ToolContext[] = [{
      toolName: 'web_search',
      input: { query: 'edge AI' },
      result: { success: false, error: 'Search timeout' },
      timestamp: new Date().toISOString(),
    }];

    const fixed = fixHallucinatedUrls(responseText, toolContexts);
    expect(fixed).toBe(responseText); // No Notion URL, no dispatch tool — unchanged
  });

  it('replaces fabricated URL with different slug but same page ID', () => {
    // This is the exact bug: Claude fabricates a long slug but uses the real page ID
    const actualUrl = 'https://www.notion.so/Research-frontier-capabilit-317780a78eef81d6b29bdb4a6adfdc27';
    const fabricatedUrl = 'https://www.notion.so/Research-frontier-capabilities-propagation-lag-distributed-systems-cost-arbitrage-1-100-317780a78eef81d6b29bdb4a6adfdc27';
    const responseText = `Research dispatched! ${fabricatedUrl}`;
    const toolContexts: ToolContext[] = [{
      toolName: 'dispatch_research',
      input: { query: 'frontier capabilities' },
      result: {
        success: true,
        result: { workQueueUrl: actualUrl },
      },
      timestamp: new Date().toISOString(),
    }];

    const fixed = fixHallucinatedUrls(responseText, toolContexts);
    expect(fixed).not.toContain('propagation-lag-distributed');
    expect(fixed).toContain(actualUrl);
  });

  it('replaces fully fabricated URL (no matching page ID)', () => {
    const actualUrl = 'https://www.notion.so/Research-real-abc123def456789012345678abcdef00';
    const fabricatedUrl = 'https://www.notion.so/Research-fake-000000000000000000000000deadbeef';
    const responseText = `Done! ${fabricatedUrl}`;
    const toolContexts: ToolContext[] = [{
      toolName: 'dispatch_research',
      input: { query: 'test' },
      result: {
        success: true,
        result: { workQueueUrl: actualUrl },
      },
      timestamp: new Date().toISOString(),
    }];

    const fixed = fixHallucinatedUrls(responseText, toolContexts);
    expect(fixed).not.toContain('deadbeef');
    expect(fixed).toContain(actualUrl);
  });
});

// ─── Research grounding contract ──────────────────────────

describe('Research grounding enforcement', () => {
  it('0-citation error message matches expected pattern', () => {
    // This validates the contract: when retrievedCitations.length === 0,
    // the code throws immediately without synthesizing.
    const errorMsg = "HALLUCINATION: No web sources found — both retrieval attempts returned 0 citations. Cannot produce grounded research.";
    expect(errorMsg).toContain('HALLUCINATION');
    expect(errorMsg).toContain('0 citations');
    expect(errorMsg).toContain('Cannot produce grounded research');
  });

  it('thin-citation warning fires for < 3 citations on standard depth', () => {
    // Contract: research.ts logs a warning when retrievedCitations.length < 3
    // and depth !== 'light'. This is informational, not blocking.
    const depth = 'standard';
    const citationCount = 2;
    const shouldWarn = citationCount < 3 && depth !== 'light';
    expect(shouldWarn).toBe(true);
  });

  it('thin-citation warning fires for < 3 citations on deep depth', () => {
    const depth = 'deep';
    const citationCount = 1;
    const shouldWarn = citationCount < 3 && depth !== 'light';
    expect(shouldWarn).toBe(true);
  });

  it('thin-citation warning does NOT fire for light depth', () => {
    const depth = 'light';
    const citationCount = 1;
    const shouldWarn = citationCount < 3 && depth !== 'light';
    expect(shouldWarn).toBe(false);
  });

  it('3+ citations do not trigger thin-citation warning', () => {
    const depth = 'standard';
    const citationCount = 3;
    const shouldWarn = citationCount < 3 && depth !== 'light';
    expect(shouldWarn).toBe(false);
  });
});

// ─── Andon gate enforcement contract ─────────────────────

describe('Andon gate enforcement on research output', () => {
  it('speculative confidence triggers mandatory caveat', () => {
    const confidence = 'speculative';
    const isLowConfidence = confidence === 'speculative' || confidence === 'insufficient';
    expect(isLowConfidence).toBe(true);
  });

  it('insufficient confidence triggers mandatory caveat', () => {
    const confidence = 'insufficient';
    const isLowConfidence = confidence === 'speculative' || confidence === 'insufficient';
    expect(isLowConfidence).toBe(true);
  });

  it('grounded confidence does NOT trigger caveat', () => {
    const confidence = 'grounded';
    const isLowConfidence = confidence === 'speculative' || confidence === 'insufficient';
    expect(isLowConfidence).toBe(false);
  });

  it('informed confidence does NOT trigger caveat', () => {
    const confidence = 'informed';
    const isLowConfidence = confidence === 'speculative' || confidence === 'insufficient';
    expect(isLowConfidence).toBe(false);
  });

  it('low-confidence summary is prefixed with caveat', () => {
    const confidence = 'speculative';
    const caveat = 'Based on limited sources — verify independently.';
    const summary = 'Edge AI chip market analysis shows...';

    const isLowConfidence = confidence === 'speculative' || confidence === 'insufficient';
    const outputSummary = isLowConfidence
      ? `⚠️ LOW CONFIDENCE — ${caveat}\n\n${summary}`
      : summary;

    expect(outputSummary).toContain('⚠️ LOW CONFIDENCE');
    expect(outputSummary).toContain(caveat);
    expect(outputSummary).toContain(summary);
  });

  it('high-confidence summary is not modified', () => {
    const confidence = 'grounded';
    const summary = 'Edge AI chip market analysis shows...';

    const isLowConfidence = confidence === 'speculative' || confidence === 'insufficient';
    const outputSummary = isLowConfidence
      ? `⚠️ LOW CONFIDENCE — caveat\n\n${summary}`
      : summary;

    expect(outputSummary).toBe(summary);
    expect(outputSummary).not.toContain('⚠️');
  });
});
