/**
 * ClaudeSearchProvider Unit Tests
 *
 * Tests the Claude web_search_20250305 fallback provider.
 * Uses mock.module() to mock @anthropic-ai/sdk.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// Mock response factory
function makeResponse(opts: {
  textBlocks?: Array<{ text: string; citations?: any[] }>;
  searchResults?: Array<{ url: string; title: string }>;
  stopReason?: string;
}) {
  const content: any[] = [];

  // Add server_tool_use block (Claude's decision to search)
  if (opts.searchResults && opts.searchResults.length > 0) {
    content.push({
      type: 'server_tool_use',
      id: 'srvtoolu_test123',
      name: 'web_search',
      input: { query: 'test query' },
    });

    // Add web_search_tool_result block
    content.push({
      type: 'web_search_tool_result',
      tool_use_id: 'srvtoolu_test123',
      content: opts.searchResults.map(r => ({
        type: 'web_search_result',
        url: r.url,
        title: r.title,
        encrypted_content: 'encrypted...',
        page_age: 'March 1, 2026',
      })),
    });
  }

  // Add text blocks
  for (const block of opts.textBlocks ?? []) {
    content.push({
      type: 'text',
      text: block.text,
      ...(block.citations ? { citations: block.citations } : {}),
    });
  }

  return {
    content,
    stop_reason: opts.stopReason ?? 'end_turn',
    usage: {
      input_tokens: 100,
      output_tokens: 200,
      server_tool_use: { web_search_requests: opts.searchResults?.length ? 1 : 0 },
    },
  };
}

// Mock setup
const mockCreate = mock(() => Promise.resolve(makeResponse({
  searchResults: [
    { url: 'https://example.com/article1', title: 'Article 1' },
    { url: 'https://example.com/article2', title: 'Article 2' },
  ],
  textBlocks: [
    {
      text: 'Based on search results, here is the answer.',
      citations: [
        {
          type: 'web_search_result_location',
          url: 'https://example.com/article1',
          title: 'Article 1',
          cited_text: 'Some cited text...',
        },
      ],
    },
  ],
})));

mock.module('@anthropic-ai/sdk', () => ({
  default: class MockAnthropic {
    messages = { create: mockCreate };
  },
}));

// Import AFTER mock
const { ClaudeSearchProvider } = await import('../src/search/claude-search-provider');

describe('ClaudeSearchProvider', () => {
  let provider: InstanceType<typeof ClaudeSearchProvider>;

  beforeEach(() => {
    mockCreate.mockClear();
    provider = new ClaudeSearchProvider('test-api-key');
  });

  it('has correct provider name', () => {
    expect(provider.name).toBe('claude-web-search');
  });

  it('returns citations from web_search_tool_result blocks', async () => {
    const result = await provider.generate({
      query: 'test research query',
      systemInstruction: 'You are a research assistant.',
      maxOutputTokens: 4096,
    });

    expect(result.citations.length).toBe(2);
    expect(result.citations[0].url).toBe('https://example.com/article1');
    expect(result.citations[1].url).toBe('https://example.com/article2');
  });

  it('maps citation URLs and titles correctly', async () => {
    const result = await provider.generate({
      query: 'test query',
      systemInstruction: 'test',
      maxOutputTokens: 4096,
    });

    expect(result.citations[0]).toEqual({
      url: 'https://example.com/article1',
      title: 'Article 1',
    });
    expect(result.citations[1]).toEqual({
      url: 'https://example.com/article2',
      title: 'Article 2',
    });
  });

  it('deduplicates citations across search results and text citations', async () => {
    // The mock has article1 in both search results AND text citations
    const result = await provider.generate({
      query: 'test query',
      systemInstruction: 'test',
      maxOutputTokens: 4096,
    });

    // Should have 2 unique URLs, not 3 (article1 appears in both blocks)
    const urls = result.citations.map(c => c.url);
    expect(new Set(urls).size).toBe(2);
    expect(result.citations.length).toBe(2);
  });

  it('sets groundingUsed=true when citations present', async () => {
    const result = await provider.generate({
      query: 'test query',
      systemInstruction: 'test',
      maxOutputTokens: 4096,
    });

    expect(result.groundingUsed).toBe(true);
    expect(result.groundingSupportCount).toBe(2);
  });

  it('sets groundingUsed=false when no search results', async () => {
    // Mock a response with no search results
    mockCreate.mockImplementationOnce(() =>
      Promise.resolve(makeResponse({
        textBlocks: [{ text: 'I cannot search the web right now.' }],
        searchResults: [],
      }))
    );

    const result = await provider.generate({
      query: 'test query',
      systemInstruction: 'test',
      maxOutputTokens: 4096,
    });

    expect(result.groundingUsed).toBe(false);
    expect(result.citations.length).toBe(0);
    expect(result.groundingSupportCount).toBe(0);
  });

  it('extracts text from text blocks', async () => {
    const result = await provider.generate({
      query: 'test query',
      systemInstruction: 'test',
      maxOutputTokens: 4096,
    });

    expect(result.text).toBe('Based on search results, here is the answer.');
  });

  it('concatenates multiple text blocks', async () => {
    mockCreate.mockImplementationOnce(() =>
      Promise.resolve(makeResponse({
        searchResults: [{ url: 'https://example.com/1', title: 'Source 1' }],
        textBlocks: [
          { text: 'First part. ' },
          { text: 'Second part.' },
        ],
      }))
    );

    const result = await provider.generate({
      query: 'test query',
      systemInstruction: 'test',
      maxOutputTokens: 4096,
    });

    expect(result.text).toBe('First part. Second part.');
  });

  it('handles API errors by propagating them', async () => {
    mockCreate.mockImplementationOnce(() =>
      Promise.reject(new Error('API rate limit exceeded'))
    );

    await expect(
      provider.generate({
        query: 'test query',
        systemInstruction: 'test',
        maxOutputTokens: 4096,
      })
    ).rejects.toThrow('API rate limit exceeded');
  });

  it('passes the query as the user message', async () => {
    await provider.generate({
      query: 'research recent anthropic product announcements',
      systemInstruction: 'You are a research assistant.',
      maxOutputTokens: 4096,
    });

    expect(mockCreate).toHaveBeenCalledTimes(1);
    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.messages[0].content).toBe('research recent anthropic product announcements');
    expect(callArgs.messages[0].role).toBe('user');
  });

  it('passes system instruction as system parameter', async () => {
    await provider.generate({
      query: 'test query',
      systemInstruction: 'You are a research assistant. Be thorough.',
      maxOutputTokens: 4096,
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.system).toBe('You are a research assistant. Be thorough.');
  });

  it('caps maxOutputTokens at 8192', async () => {
    await provider.generate({
      query: 'test query',
      systemInstruction: 'test',
      maxOutputTokens: 65536,
    });

    const callArgs = mockCreate.mock.calls[0][0];
    expect(callArgs.max_tokens).toBe(8192);
  });

  it('throws if no API key provided', () => {
    // Save and clear env
    const savedKey = process.env.ANTHROPIC_API_KEY;
    delete process.env.ANTHROPIC_API_KEY;

    try {
      expect(() => new ClaudeSearchProvider('')).toThrow('ANTHROPIC_API_KEY is required');
    } finally {
      // Restore
      if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey;
    }
  });
});
