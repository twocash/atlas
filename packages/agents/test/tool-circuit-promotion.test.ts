/**
 * Tool Circuit Promotion Tests
 *
 * Verifies the "always" → Green zone promotion pathway:
 * 1. findConfigByToolName returns config with pageId
 * 2. promoteToGreen updates Notion and invalidates cache
 * 3. logPromotion writes Feed 2.0 entry
 *
 * These test the exported interfaces without hitting Notion.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';

// ─── Mock Setup (BEFORE imports) ─────────────────────────

// Mock Notion client
const mockUpdate = mock(() => Promise.resolve({}));
const mockCreate = mock(() => Promise.resolve({}));
const mockQuery = mock(() => Promise.resolve({
  results: [
    {
      id: 'page-id-123',
      properties: {
        'Tool ID': { title: [{ plain_text: 'mcp__claude_ai_Gmail__*' }] },
        'Zone': { select: { name: 'Yellow' } },
        'Description': { rich_text: [{ plain_text: 'Gmail read' }] },
        'Auto Promote Threshold': { number: 3 },
        'Approval Message Template': { rich_text: [{ plain_text: 'CC wants Gmail access' }] },
        'Block Message Template': { rich_text: [{ plain_text: '' }] },
        'Active': { checkbox: true },
      },
    },
    {
      id: 'page-id-456',
      properties: {
        'Tool ID': { title: [{ plain_text: 'mcp__notion__*' }] },
        'Zone': { select: { name: 'Green' } },
        'Description': { rich_text: [{ plain_text: 'Notion read' }] },
        'Auto Promote Threshold': { number: 3 },
        'Approval Message Template': { rich_text: [{ plain_text: '' }] },
        'Block Message Template': { rich_text: [{ plain_text: '' }] },
        'Active': { checkbox: true },
      },
    },
  ],
}));

mock.module('@notionhq/client', () => ({
  Client: class {
    pages = { update: mockUpdate, create: mockCreate };
    databases = { query: mockQuery };
  },
}));

mock.module('@atlas/shared/config', () => ({
  NOTION_DB: {
    FEED: '90b2b33f-4b44-4b42-870f-8d62fb8cbf18',
    TOOL_ROUTING_CONFIG: '6e44b8d8-2e5a-4290-9eff-b177b18455d3',
  },
}));

// Set env vars before import
process.env.NOTION_API_KEY = 'test-key';
process.env.TOOL_ROUTING_CONFIG_DB = '6e44b8d8-2e5a-4290-9eff-b177b18455d3';

// ─── Imports (AFTER mocks) ──────────────────────────────

import { findConfigByToolName, invalidateZoneCache, type ToolZoneConfig } from '../src/tool-circuit/tool-zone-classifier';
import { promoteToGreen } from '../src/tool-circuit/tool-circuit';

// ─── Tests ──────────────────────────────────────────────

describe('Tool Circuit Promotion: findConfigByToolName', () => {
  beforeEach(() => {
    invalidateZoneCache();
  });

  it('finds Gmail config by tool name', async () => {
    const config = await findConfigByToolName('mcp__claude_ai_Gmail__search');
    expect(config).not.toBeNull();
    expect(config!.toolPattern).toBe('mcp__claude_ai_Gmail__*');
    expect(config!.zone).toBe('yellow');
    expect(config!.pageId).toBe('page-id-123');
  });

  it('finds Notion config by tool name', async () => {
    const config = await findConfigByToolName('mcp__notion__read_page');
    expect(config).not.toBeNull();
    expect(config!.toolPattern).toBe('mcp__notion__*');
    expect(config!.pageId).toBe('page-id-456');
  });

  it('returns null for unknown tool', async () => {
    const config = await findConfigByToolName('unknown_tool_xyz');
    expect(config).toBeNull();
  });

  it('config includes pageId from Notion response', async () => {
    const config = await findConfigByToolName('mcp__claude_ai_Gmail__list');
    expect(config).not.toBeNull();
    expect(config!.pageId).toBeTruthy();
    expect(typeof config!.pageId).toBe('string');
  });
});

describe('Tool Circuit Promotion: promoteToGreen', () => {
  beforeEach(() => {
    invalidateZoneCache();
    mockUpdate.mockClear();
    mockCreate.mockClear();
  });

  it('updates Notion row zone to Green for Yellow pattern', async () => {
    const result = await promoteToGreen('mcp__claude_ai_Gmail__search');
    expect(result).toBe(true);
    expect(mockUpdate).toHaveBeenCalledTimes(1);

    const updateCall = mockUpdate.mock.calls[0];
    expect(updateCall[0]).toEqual({
      page_id: 'page-id-123',
      properties: {
        Zone: { select: { name: 'Green' } },
      },
    });
  });

  it('returns true without update when already Green', async () => {
    const result = await promoteToGreen('mcp__notion__read_page');
    expect(result).toBe(true);
    // Should NOT call update — already Green
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('returns false for unknown tool pattern', async () => {
    const result = await promoteToGreen('totally_unknown_tool');
    expect(result).toBe(false);
    expect(mockUpdate).not.toHaveBeenCalled();
  });

  it('logs promotion to Feed 2.0', async () => {
    await promoteToGreen('mcp__claude_ai_Gmail__search');
    // Give fire-and-forget a tick
    await new Promise(r => setTimeout(r, 50));
    // mockCreate is used by both logPromotion and logToolEvent
    // At least one Feed entry should have "promotion" keyword
    const promotionCalls = mockCreate.mock.calls.filter((call: any) => {
      const keywords = call[0]?.properties?.Keywords?.multi_select;
      return keywords?.some((k: any) => k.name === 'promotion');
    });
    expect(promotionCalls.length).toBeGreaterThanOrEqual(1);
  });
});
