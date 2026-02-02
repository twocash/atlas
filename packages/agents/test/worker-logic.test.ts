/**
 * Atlas Neuro-Link Pre-Flight Check: Worker Logic Test
 *
 * Verifies the worker's state machine:
 * 1. Picks up Triaged tasks
 * 2. Locks them (Status → Active)
 * 3. Executes research
 * 4. Completes them (Status → Done)
 *
 * Run: bun test packages/agents/test/worker-logic.test.ts
 */

import { describe, it, expect, mock, beforeEach } from "bun:test";

// Track calls to Notion
let queryCallCount = 0;
let updateCalls: Array<{ page_id: string; properties: any }> = [];
let blocksAppendCalls: Array<{ block_id: string; children: any }> = [];
let commentsCreateCalls: Array<any> = [];

// Mock task data
const mockTriagedTask = {
  id: "task-123-triaged",
  url: "https://notion.so/mock-task",
  properties: {
    Task: { type: "title", title: [{ plain_text: "Research AI Trends" }] },
    Status: { type: "select", select: { name: "Triaged" } },
    Type: { type: "select", select: { name: "Research" } },
    Priority: { type: "select", select: { name: "P2" } },
    Pillar: { type: "select", select: { name: "The Grove" } },
    Notes: { type: "rich_text", rich_text: [] },
  },
};

// Reset state
function resetMocks() {
  queryCallCount = 0;
  updateCalls = [];
  blocksAppendCalls = [];
  commentsCreateCalls = [];
}

// Mock Notion client
mock.module("@notionhq/client", () => ({
  Client: class MockNotionClient {
    constructor() {}

    databases = {
      retrieve: async () => ({ id: "db-123", properties: {} }),
      query: async (params: any) => {
        queryCallCount++;
        // Return triaged task on first call, empty on subsequent
        if (queryCallCount === 1) {
          return { results: [mockTriagedTask] };
        }
        return { results: [] };
      },
    };

    pages = {
      retrieve: async (params: any) => mockTriagedTask,
      update: async (params: any) => {
        updateCalls.push({
          page_id: params.page_id,
          properties: params.properties,
        });
        return { id: params.page_id };
      },
    };

    blocks = {
      children: {
        list: async () => ({
          results: [
            {
              type: "paragraph",
              paragraph: {
                rich_text: [{ plain_text: "Research AI coding assistants" }],
              },
            },
          ],
        }),
        append: async (params: any) => {
          blocksAppendCalls.push({
            block_id: params.block_id,
            children: params.children,
          });
          return {};
        },
      },
    };

    comments = {
      create: async (params: any) => {
        commentsCreateCalls.push(params);
        return { id: "comment-123" };
      },
    };
  },
}));

// Mock the research agent to avoid spending tokens
// Path must match worker.ts import: "./agents/research"
mock.module("./agents/research", () => ({
  executeResearch: async () => ({
    success: true,
    output: {
      summary: "Mock research completed successfully",
      findings: [{ claim: "AI is evolving", source: "Test", url: "http://test.com" }],
      sources: ["http://test.com"],
    },
    summary: "Mock research completed successfully",
    artifacts: ["http://test.com"],
    metrics: { durationMs: 1000, apiCalls: 1 },
  }),
}));

// Mock the registry
// Path must match worker.ts import: "./registry"
mock.module("./registry", () => ({
  AgentRegistry: class MockRegistry {
    spawn = async (config: any) => ({
      id: "agent-mock-123",
      type: config.type,
      name: config.name,
      status: "pending",
      priority: config.priority,
      createdAt: new Date(),
      workItemId: config.workItemId,
    });

    start = async () => {};
    complete = async () => {};
    fail = async () => {};
    status = async (id: string) => ({
      id,
      type: "research",
      name: "Mock Agent",
      status: "completed",
      priority: "P2",
      createdAt: new Date(),
      completedAt: new Date(),
    });
    subscribe = () => ({ unsubscribe: () => {} });
    updateProgress = async () => {};
  },
}));

// Mock workqueue sync functions
// Path must match worker.ts import: "./workqueue"
mock.module("./workqueue", () => ({
  wireAgentToWorkQueue: async () => ({ unsubscribe: () => {} }),
  syncAgentSpawn: async () => {},
  syncAgentComplete: async () => {},
  syncAgentFailure: async () => {},
}));

// Now import the worker (after mocks are set up)
// Note: This import happens AFTER all mock.module calls
const { runCycle } = await import("../src/worker");

describe("Active Worker Logic", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("queries for Triaged Research tasks", async () => {
    await runCycle();

    expect(queryCallCount).toBeGreaterThanOrEqual(1);
  });

  it("locks task by setting Status to Active", async () => {
    await runCycle();

    // Find the update call that sets Active
    const lockCall = updateCalls.find(
      (call) => call.properties?.Status?.select?.name === "Active"
    );

    expect(lockCall).toBeDefined();
    expect(lockCall?.page_id).toBe("task-123-triaged");
  });

  it("completes task by setting Status to Done", async () => {
    await runCycle();

    // Find the update call that sets Done
    const completeCall = updateCalls.find(
      (call) => call.properties?.Status?.select?.name === "Done"
    );

    expect(completeCall).toBeDefined();
  });

  it("processes tasks in correct order: Lock → Execute → Complete", async () => {
    await runCycle();

    // Should have at least 2 update calls (lock + complete)
    expect(updateCalls.length).toBeGreaterThanOrEqual(2);

    // First update should be Lock (Active)
    const firstUpdate = updateCalls[0];
    expect(firstUpdate.properties?.Status?.select?.name).toBe("Active");

    // Later update should include Done
    const hasCompleteUpdate = updateCalls.some(
      (call) => call.properties?.Status?.select?.name === "Done"
    );
    expect(hasCompleteUpdate).toBe(true);
  });

  it("handles empty queue gracefully", async () => {
    // First cycle processes the task
    await runCycle();
    resetMocks();

    // Second cycle should find no tasks
    await runCycle();

    // Should query but not update anything
    expect(queryCallCount).toBe(1);
    expect(updateCalls.length).toBe(0);
  });
});

describe("Worker State Machine", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("sets Started date when locking", async () => {
    await runCycle();

    const lockCall = updateCalls.find(
      (call) => call.properties?.Status?.select?.name === "Active"
    );

    expect(lockCall?.properties?.Started).toBeDefined();
    expect(lockCall?.properties?.Started?.date?.start).toBeDefined();
  });

  it("sets Completed date when finishing", async () => {
    await runCycle();

    const completeCall = updateCalls.find(
      (call) => call.properties?.Status?.select?.name === "Done"
    );

    expect(completeCall?.properties?.Completed).toBeDefined();
  });
});
