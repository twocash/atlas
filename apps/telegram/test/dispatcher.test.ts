/**
 * Atlas Neuro-Link Pre-Flight Check: Dispatcher Routing Test
 *
 * Verifies that submit_ticket routes correctly:
 * - dev_bug → Pit Crew MCP (or fallback to direct Notion)
 * - research → Native Notion Work Queue
 * - content → Native Notion Work Queue
 *
 * Run: bun test apps/telegram/test/dispatcher.test.ts
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";

// Track what was called
let mcpCalled = false;
let mcpToolName = "";
let mcpArgs: any = null;
let notionCreateCalled = false;
let notionCreateArgs: any = null;
let mcpStatusResult: Record<string, any> = {};

// Mock the MCP module BEFORE importing dispatcher
// The path must match exactly what dispatcher.ts uses in its import
mock.module("../../mcp", () => ({
  getMcpStatus: () => mcpStatusResult,
  executeMcpTool: async (toolName: string, args: any) => {
    mcpCalled = true;
    mcpToolName = toolName;
    mcpArgs = args;
    return {
      success: true,
      result: {
        content: [
          {
            type: "text",
            text: JSON.stringify({
              success: true,
              discussion_id: "mock-discussion-123",
              notion_url: "https://notion.so/mock-dev-pipeline-item",
            }),
          },
        ],
      },
    };
  },
  isMcpTool: (name: string) => name.startsWith("mcp__"),
}));

// Mock the Notion client
mock.module("@notionhq/client", () => ({
  Client: class MockClient {
    constructor() {}
    pages = {
      create: async (args: any) => {
        notionCreateCalled = true;
        notionCreateArgs = args;
        return {
          id: "mock-page-id-456",
          url: "https://notion.so/mock-work-queue-item",
        };
      },
    };
  },
}));

// Mock logger to suppress output
// The path must match exactly what dispatcher.ts uses in its import
mock.module("../../logger", () => ({
  logger: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
}));

// Now import the dispatcher (after mocks are set up)
import { handleSubmitTicket } from "../src/conversation/tools/dispatcher";

describe("Dispatcher Routing Logic", () => {
  beforeEach(() => {
    // Reset tracking variables
    mcpCalled = false;
    mcpToolName = "";
    mcpArgs = null;
    notionCreateCalled = false;
    notionCreateArgs = null;
    // Default: Pit Crew is connected
    mcpStatusResult = {
      "pit-crew": { status: "connected", toolCount: 5 },
    };
  });

  describe("dev_bug routing", () => {
    it("routes to Pit Crew MCP when connected", async () => {
      const result = await handleSubmitTicket({
        category: "dev_bug",
        title: "Login button broken",
        description: "Steps to reproduce:\n1. Click login\n2. Nothing happens",
        priority: "P0",
        reasoning: "User reported broken login flow. Classified as dev bug.",
      });

      // Should have called MCP
      expect(mcpCalled).toBe(true);
      expect(mcpToolName).toBe("mcp__pit-crew__dispatch_work");
      expect(mcpArgs.type).toBe("bug");
      expect(mcpArgs.title).toBe("Login button broken");

      // Should NOT have called Notion directly for Work Queue
      // (It might call it for Dev Pipeline fallback, but not Work Queue)
      expect(result.success).toBe(true);
      expect((result.result as any).handler).toBe("Pit Crew");
    });

    it("falls back to direct Notion when Pit Crew disconnected", async () => {
      // Simulate Pit Crew disconnected
      mcpStatusResult = {};

      const result = await handleSubmitTicket({
        category: "dev_bug",
        title: "Another bug",
        description: "Something is broken",
        priority: "P1",
        reasoning: "Test fallback path",
      });

      // MCP should NOT be called (disconnected)
      expect(mcpCalled).toBe(false);

      // Should have called Notion directly
      expect(notionCreateCalled).toBe(true);
      expect(notionCreateArgs.parent.database_id).toBe(
        "ce6fbf1b-ee30-433d-a9e6-b338552de7c9" // Dev Pipeline ID
      );

      expect(result.success).toBe(true);
      expect((result.result as any).handler).toBe("Pit Crew");
    });
  });

  describe("research routing", () => {
    it("routes directly to Work Queue (not MCP)", async () => {
      const result = await handleSubmitTicket({
        category: "research",
        title: "AI Coding Assistant Landscape",
        description:
          "1. Compare Cursor vs GitHub Copilot vs Cline\n2. Focus on pricing\n3. Check recent benchmarks",
        priority: "P1",
        reasoning: "User requested research comparison. Standard depth.",
      });

      // MCP should NOT be called for research
      expect(mcpCalled).toBe(false);

      // Should call Notion directly
      expect(notionCreateCalled).toBe(true);
      expect(notionCreateArgs.parent.database_id).toBe(
        "3d679030-b76b-43bd-92d8-1ac51abb4a28" // Work Queue ID
      );

      // Verify the properties
      expect(notionCreateArgs.properties.Task.title[0].text.content).toBe(
        "AI Coding Assistant Landscape"
      );
      expect(notionCreateArgs.properties.Type.select.name).toBe("Research");

      expect(result.success).toBe(true);
      expect((result.result as any).type).toBe("Research");
    });

    it("sets Triaged status when require_review=false", async () => {
      const result = await handleSubmitTicket({
        category: "research",
        title: "Quick Research",
        description: "Simple question",
        priority: "P2",
        reasoning: "Routine research, auto-execute",
        require_review: false,
      });

      expect(notionCreateCalled).toBe(true);
      expect(notionCreateArgs.properties.Status.select.name).toBe("Triaged");
      expect((result.result as any).status).toBe("Triaged");
    });

    it("sets Captured status when require_review=true", async () => {
      const result = await handleSubmitTicket({
        category: "research",
        title: "Complex Research",
        description: "Needs Jim's review",
        priority: "P0",
        reasoning: "Complex scope, needs approval",
        require_review: true,
      });

      expect(notionCreateCalled).toBe(true);
      expect(notionCreateArgs.properties.Status.select.name).toBe("Captured");
      expect((result.result as any).status).toBe("Captured");
    });
  });

  describe("content routing", () => {
    it("routes to Work Queue with Draft type", async () => {
      const result = await handleSubmitTicket({
        category: "content",
        title: "LinkedIn Post: AI Trends",
        description: "Tone: Professional, punchy\nAudience: Tech leaders\nLength: 200 words",
        priority: "P1",
        reasoning: "User wants LinkedIn content. Classified as content/draft.",
        pillar: "The Grove",
      });

      // MCP should NOT be called for content
      expect(mcpCalled).toBe(false);

      // Should call Notion directly
      expect(notionCreateCalled).toBe(true);
      expect(notionCreateArgs.properties.Type.select.name).toBe("Draft");
      expect(notionCreateArgs.properties.Pillar.select.name).toBe("The Grove");

      expect(result.success).toBe(true);
      expect((result.result as any).type).toBe("Draft");
    });
  });

  describe("reasoning field", () => {
    it("includes reasoning in page body (callout block)", async () => {
      await handleSubmitTicket({
        category: "research",
        title: "Test",
        description: "Test description",
        priority: "P2",
        reasoning: "This is my reasoning for the classification",
      });

      expect(notionCreateCalled).toBe(true);
      // Check that children blocks include the reasoning
      const children = notionCreateArgs.children;
      expect(children).toBeDefined();
      expect(children.length).toBeGreaterThan(0);

      // Find the callout block with reasoning
      const calloutBlock = children.find(
        (b: any) => b.type === "callout" && b.callout?.rich_text?.[0]?.text?.content?.includes("reasoning")
      );
      expect(calloutBlock).toBeDefined();
    });
  });
});

describe("URL Requirement (No Ticket, No Work)", () => {
  beforeEach(() => {
    mcpCalled = false;
    notionCreateCalled = false;
    mcpStatusResult = { "pit-crew": { status: "connected", toolCount: 5 } };
  });

  it("returns URL on success", async () => {
    const result = await handleSubmitTicket({
      category: "research",
      title: "Test",
      description: "Test",
      priority: "P2",
      reasoning: "Test",
    });

    expect(result.success).toBe(true);
    expect((result.result as any).url).toBeDefined();
    expect((result.result as any).url).toContain("notion.so");
  });
});
