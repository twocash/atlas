/**
 * Tool Circuit End-to-End — Integration Tests
 *
 * Tests the Autonomaton governance layer as a system:
 *   Classify → Route → Log
 *
 * Every test mocks the Notion config lookup and Feed write,
 * asserts zone routing behavior. No live API calls.
 *
 * Sprint: MASTER-BLASTER-DISPATCH (March 2026)
 */

import { describe, it, expect, beforeEach, mock } from 'bun:test';

// ─── Mock boundaries BEFORE importing tested modules ────

let feedWriteCalls: any[] = [];
let notionUpdateCalls: any[] = [];

// Fixture configs for test scenarios
const FIXTURE_CONFIGS = [
  {
    pageId: 'page-green-001',
    toolPattern: 'mcp__claude_ai_Notion__*',
    zone: 'green' as const,
    description: 'Notion tools — read-only, safe',
    autoPromoteThreshold: 3,
    approvalMessageTemplate: '',
    blockMessageTemplate: '',
    enabled: true,
  },
  {
    pageId: 'page-yellow-001',
    toolPattern: 'mcp__claude_ai_Gmail__gmail_send_message',
    zone: 'yellow' as const,
    description: 'Gmail send — requires approval',
    autoPromoteThreshold: 5,
    approvalMessageTemplate: 'CC wants to send an email via Gmail.',
    blockMessageTemplate: '',
    enabled: true,
  },
  {
    pageId: 'page-red-001',
    toolPattern: 'delete_file',
    zone: 'red' as const,
    description: 'File deletion — always blocked',
    autoPromoteThreshold: 0,
    approvalMessageTemplate: '',
    blockMessageTemplate: 'File deletion is blocked. This action requires human decision in the terminal.',
    enabled: true,
  },
];

// Mock Notion SDK — intercept both query (zone config) and create (telemetry)
mock.module('@notionhq/client', () => ({
  Client: class MockNotionClient {
    constructor() {}
    databases = {
      query: async () => ({
        results: FIXTURE_CONFIGS.map((config, i) => ({
          id: config.pageId,
          properties: {
            'Tool ID': { title: [{ plain_text: config.toolPattern }] },
            Zone: { select: { name: config.zone.charAt(0).toUpperCase() + config.zone.slice(1) } },
            Description: { rich_text: [{ plain_text: config.description }] },
            'Auto Promote Threshold': { number: config.autoPromoteThreshold },
            'Approval Message Template': { rich_text: config.approvalMessageTemplate ? [{ plain_text: config.approvalMessageTemplate }] : [] },
            'Block Message Template': { rich_text: config.blockMessageTemplate ? [{ plain_text: config.blockMessageTemplate }] : [] },
            Active: { checkbox: config.enabled },
          },
        })),
      }),
    };
    pages = {
      create: async (params: any) => {
        feedWriteCalls.push(params);
        return { id: 'feed-entry-mock' };
      },
      update: async (params: any) => {
        notionUpdateCalls.push(params);
        return { id: params.page_id };
      },
    };
  },
}));

mock.module('@atlas/shared/config', () => ({
  NOTION_DB: {
    FEED: 'mock-feed-db-id',
    TOOL_ROUTING_CONFIG: 'mock-tool-routing-db-id',
  },
}));

mock.module('../src/logger', () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// ─── Import tested modules (AFTER mocks) ────────────────

import { evaluateToolCall, promoteToGreen, logApprovalOutcome } from '../src/tool-circuit/tool-circuit';
import { classifyTool, invalidateZoneCache } from '../src/tool-circuit/tool-zone-classifier';
import { logToolEvent } from '../src/tool-circuit/telemetry';

// ─── Reset state between tests ──────────────────────────

beforeEach(() => {
  feedWriteCalls = [];
  notionUpdateCalls = [];
  invalidateZoneCache();
});

// ═══════════════════════════════════════════════════════════
// Suite 2 — Tool Circuit End-to-End
// ═══════════════════════════════════════════════════════════

describe('Tool Circuit Integration', () => {

  // ─── Green zone — auto-execute ────────────────────────

  describe('Green zone — auto-execute', () => {
    it('approves Green tools immediately with no approval message', async () => {
      const decision = await evaluateToolCall('mcp__claude_ai_Notion__notion-search');

      expect(decision.action).toBe('approve');
      expect(decision.zone).toBe('green');
      expect(decision.matched).toBe(true);
      expect(decision.toolPattern).toBe('mcp__claude_ai_Notion__*');
      expect(decision.approvalMessage).toBeUndefined();
    });

    it('logs Green tool event to Feed 2.0', async () => {
      await evaluateToolCall('mcp__claude_ai_Notion__notion-search');

      // Give fire-and-forget telemetry a tick to resolve
      await new Promise(r => setTimeout(r, 10));

      // logToolEvent fires with zone=green, action=auto-approved
      const feedEntry = feedWriteCalls.find(c =>
        c.properties?.Keywords?.multi_select?.some((k: any) => k.name === 'green')
      );
      expect(feedEntry).toBeDefined();
    });
  });

  // ─── Yellow zone — approval surfaced ──────────────────

  describe('Yellow zone — approval surfaced', () => {
    it('holds Yellow tools and provides approval message', async () => {
      const decision = await evaluateToolCall('mcp__claude_ai_Gmail__gmail_send_message');

      expect(decision.action).toBe('hold');
      expect(decision.zone).toBe('yellow');
      expect(decision.matched).toBe(true);
      expect(decision.approvalMessage).toBeDefined();
      expect(decision.approvalMessage).toContain('Gmail');
      expect(decision.approvalMessage).toContain('1. Yes');
      expect(decision.approvalMessage).toContain('2. No');
      expect(decision.approvalMessage).toContain('3. Always');
    });

    it('logs Yellow hold event to Feed 2.0', async () => {
      await evaluateToolCall('mcp__claude_ai_Gmail__gmail_send_message');

      await new Promise(r => setTimeout(r, 10));

      const feedEntry = feedWriteCalls.find(c =>
        c.properties?.Keywords?.multi_select?.some((k: any) => k.name === 'yellow')
      );
      expect(feedEntry).toBeDefined();

      const entryTitle = feedEntry?.properties?.Entry?.title?.[0]?.text?.content ?? '';
      expect(entryTitle).toContain('held');
    });
  });

  // ─── Red zone — blocked with Jidoka explanation ───────

  describe('Red zone — blocked with Jidoka explanation', () => {
    it('blocks Red tools with explanation', async () => {
      const decision = await evaluateToolCall('delete_file');

      expect(decision.action).toBe('block');
      expect(decision.zone).toBe('red');
      expect(decision.matched).toBe(true);
      expect(decision.blockReason).toBeDefined();
      expect(decision.blockReason).toContain('blocked');
      expect(decision.blockReason).toContain('human decision');
    });

    it('logs Red block event to Feed 2.0', async () => {
      await evaluateToolCall('delete_file');

      await new Promise(r => setTimeout(r, 10));

      const feedEntry = feedWriteCalls.find(c =>
        c.properties?.Keywords?.multi_select?.some((k: any) => k.name === 'red')
      );
      expect(feedEntry).toBeDefined();

      const entryTitle = feedEntry?.properties?.Entry?.title?.[0]?.text?.content ?? '';
      expect(entryTitle).toContain('blocked');
    });
  });

  // ─── Feed 2.0 telemetry — all three zones ─────────────

  describe('Feed 2.0 telemetry — all zones produce entries', () => {
    it('creates Feed entries for green, yellow, and red tool calls', async () => {
      await evaluateToolCall('mcp__claude_ai_Notion__notion-search');  // green
      await evaluateToolCall('mcp__claude_ai_Gmail__gmail_send_message');  // yellow
      await evaluateToolCall('delete_file');  // red

      await new Promise(r => setTimeout(r, 20));

      // Each call produces one feed entry
      expect(feedWriteCalls.length).toBeGreaterThanOrEqual(3);

      const zones = feedWriteCalls.flatMap(c =>
        c.properties?.Keywords?.multi_select?.map((k: any) => k.name) ?? []
      );
      expect(zones).toContain('green');
      expect(zones).toContain('yellow');
      expect(zones).toContain('red');
    });
  });

  // ─── Zone config lookup — unclassified tool ───────────

  describe('Unclassified tool defaults to Green', () => {
    it('returns green with matched=false for unknown tools', async () => {
      const result = await classifyTool('totally_unknown_tool_xyz');

      expect(result.zone).toBe('green');
      expect(result.matched).toBe(false);
      expect(result.config).toBeNull();
    });
  });

  // ─── Approval outcome logging ─────────────────────────

  describe('Approval outcome logging', () => {
    it('logApprovalOutcome writes to Feed 2.0', async () => {
      await logApprovalOutcome('mcp__claude_ai_Gmail__gmail_send_message', 'approved', 'mcp__claude_ai_Gmail__*');

      const feedEntry = feedWriteCalls.find(c =>
        c.properties?.Keywords?.multi_select?.some((k: any) => k.name === 'approved')
      );
      expect(feedEntry).toBeDefined();
    });
  });

  // ─── Classify tool — glob matching ────────────────────

  describe('Glob matching', () => {
    it('matches wildcard patterns', async () => {
      const result = await classifyTool('mcp__claude_ai_Notion__notion-fetch');
      expect(result.zone).toBe('green');
      expect(result.matched).toBe(true);
      expect(result.config?.toolPattern).toBe('mcp__claude_ai_Notion__*');
    });

    it('matches exact patterns', async () => {
      const result = await classifyTool('delete_file');
      expect(result.zone).toBe('red');
      expect(result.matched).toBe(true);
    });
  });
});
