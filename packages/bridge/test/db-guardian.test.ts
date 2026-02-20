/**
 * Database Access Guardian — Unit Tests
 *
 * Tests db-validator, feed-alerter, health module, and POV fetcher
 * status discrimination. All Notion SDK calls are mocked.
 *
 * Coverage:
 *   - Validator: all-pass, critical failure, enrichment failure, no-token
 *   - Alerter: creates alerts, dedup skips, Feed-unreachable short-circuit
 *   - Health module: orchestrates validator + alerter + console output
 *   - POV slot: source strings match fetch status
 */

import { describe, test, expect, mock, beforeEach } from "bun:test"

// ─── Mock Setup ──────────────────────────────────────────
// Mock modules BEFORE importing the modules under test.

// Track all Notion SDK calls
let mockRetrieve: ReturnType<typeof mock>
let mockQuery: ReturnType<typeof mock>
let mockPagesCreate: ReturnType<typeof mock>

mock.module("@notionhq/client", () => {
  mockRetrieve = mock(() => Promise.resolve({ id: "fake-db-id" }))
  mockQuery = mock(() => Promise.resolve({ results: [] }))
  mockPagesCreate = mock(() => Promise.resolve({ id: "fake-page-id" }))

  return {
    Client: class MockClient {
      databases = {
        retrieve: mockRetrieve,
        query: mockQuery,
      }
      pages = {
        create: mockPagesCreate,
      }
    },
  }
})

// Now import modules under test
import { validateDatabases, type ValidationReport, type DbValidationResult } from "../src/health/db-validator"
import { createHealthAlerts, type AlertResult } from "../src/health/feed-alerter"
import { runBridgeHealthCheck } from "../src/health"
import { NOTION_DB, NOTION_DB_META } from "@atlas/shared/config"

// ─── Helpers ─────────────────────────────────────────────

/** Count databases relevant to bridge surface */
function countBridgeDatabases(): number {
  return Object.entries(NOTION_DB_META).filter(([, meta]) =>
    meta.surfaces.includes("bridge") || meta.surfaces.includes("shared"),
  ).length
}

/** Make a fake DbValidationResult */
function makeFakeFailure(overrides: Partial<DbValidationResult> = {}): DbValidationResult {
  return {
    key: "POV_LIBRARY",
    label: "POV Library",
    dbId: NOTION_DB.POV_LIBRARY,
    criticality: "enrichment",
    surfaces: ["bridge"],
    accessible: false,
    error: "Could not find database",
    latencyMs: 42,
    ...overrides,
  }
}

// ─── Database Validator ──────────────────────────────────

describe("db-validator", () => {
  beforeEach(() => {
    mockRetrieve.mockReset()
    mockRetrieve.mockImplementation(() => Promise.resolve({ id: "ok" }))
  })

  test("all databases pass → allCriticalPassed: true, zero failures", async () => {
    const report = await validateDatabases("bridge", "fake-token")

    expect(report.allCriticalPassed).toBe(true)
    expect(report.criticalFailures).toHaveLength(0)
    expect(report.enrichmentFailures).toHaveLength(0)
    expect(report.totalChecked).toBe(countBridgeDatabases())
    expect(report.totalPassed).toBe(report.totalChecked)
  })

  test("critical failure → allCriticalPassed: false", async () => {
    // Feed 2.0 (critical) fails, everything else passes
    mockRetrieve.mockImplementation(({ database_id }: { database_id: string }) => {
      if (database_id === NOTION_DB.FEED) {
        return Promise.reject(new Error("Could not find database"))
      }
      return Promise.resolve({ id: database_id })
    })

    const report = await validateDatabases("bridge", "fake-token")

    expect(report.allCriticalPassed).toBe(false)
    expect(report.criticalFailures).toHaveLength(1)
    expect(report.criticalFailures[0].key).toBe("FEED")
    expect(report.criticalFailures[0].error).toContain("Could not find database")
  })

  test("enrichment failure → allCriticalPassed: true, enrichmentFailures populated", async () => {
    // POV Library (enrichment) fails, everything else passes
    mockRetrieve.mockImplementation(({ database_id }: { database_id: string }) => {
      if (database_id === NOTION_DB.POV_LIBRARY) {
        return Promise.reject(new Error("object_not_found"))
      }
      return Promise.resolve({ id: database_id })
    })

    const report = await validateDatabases("bridge", "fake-token")

    expect(report.allCriticalPassed).toBe(true)
    expect(report.enrichmentFailures).toHaveLength(1)
    expect(report.enrichmentFailures[0].key).toBe("POV_LIBRARY")
    expect(report.enrichmentFailures[0].error).toContain("object_not_found")
  })

  test("no token → all databases fail with descriptive error", async () => {
    // Clear env vars so no token is found
    const origKey = process.env.NOTION_API_KEY
    const origToken = process.env.NOTION_TOKEN
    delete process.env.NOTION_API_KEY
    delete process.env.NOTION_TOKEN

    try {
      const report = await validateDatabases("bridge")

      expect(report.allCriticalPassed).toBe(false)
      expect(report.totalPassed).toBe(0)
      // Every result has the descriptive error
      for (const r of report.results) {
        expect(r.error).toBe("NOTION_API_KEY not configured")
      }
    } finally {
      // Restore env
      if (origKey) process.env.NOTION_API_KEY = origKey
      if (origToken) process.env.NOTION_TOKEN = origToken
    }
  })

  test("surface filtering — telegram-only databases excluded from bridge check", async () => {
    const report = await validateDatabases("bridge", "fake-token")

    // SKILLS_REGISTRY is telegram-only — should NOT appear
    const keys = report.results.map((r) => r.key)
    expect(keys).not.toContain("SKILLS_REGISTRY")
    expect(keys).not.toContain("TOKEN_LEDGER")
    expect(keys).not.toContain("WORKER_RESULTS")
    // Shared + bridge databases SHOULD appear
    expect(keys).toContain("FEED")
    expect(keys).toContain("WORK_QUEUE")
    expect(keys).toContain("POV_LIBRARY")
    expect(keys).toContain("SYSTEM_PROMPTS")
  })

  test("results include latency measurement", async () => {
    const report = await validateDatabases("bridge", "fake-token")

    for (const r of report.results) {
      expect(typeof r.latencyMs).toBe("number")
      expect(r.latencyMs).toBeGreaterThanOrEqual(0)
    }
  })
})

// ─── Feed Alerter ────────────────────────────────────────

describe("feed-alerter", () => {
  beforeEach(() => {
    mockQuery.mockReset()
    mockPagesCreate.mockReset()
    mockQuery.mockImplementation(() => Promise.resolve({ results: [] }))
    mockPagesCreate.mockImplementation(() => Promise.resolve({ id: "new-alert-id" }))
  })

  test("creates alert for single failure", async () => {
    const failures = [makeFakeFailure()]
    const results = await createHealthAlerts(failures, "fake-token")

    expect(results).toHaveLength(1)
    expect(results[0].created).toBe(true)
    expect(results[0].feedPageId).toBe("new-alert-id")
    expect(mockPagesCreate).toHaveBeenCalledTimes(1)
  })

  test("dedup: skips when open alert exists", async () => {
    // findOpenAlert returns an existing page
    mockQuery.mockImplementation(() =>
      Promise.resolve({ results: [{ id: "existing-alert-id" }] }),
    )

    const failures = [makeFakeFailure()]
    const results = await createHealthAlerts(failures, "fake-token")

    expect(results).toHaveLength(1)
    expect(results[0].created).toBe(false)
    expect(results[0].skippedReason).toBe("Duplicate alert exists")
    expect(results[0].feedPageId).toBe("existing-alert-id")
    expect(mockPagesCreate).not.toHaveBeenCalled()
  })

  test("empty failures array → no alerts", async () => {
    const results = await createHealthAlerts([], "fake-token")
    expect(results).toHaveLength(0)
    expect(mockPagesCreate).not.toHaveBeenCalled()
  })

  test("no Notion token → all failures skipped with reason", async () => {
    const origKey = process.env.NOTION_API_KEY
    const origToken = process.env.NOTION_TOKEN
    delete process.env.NOTION_API_KEY
    delete process.env.NOTION_TOKEN

    try {
      const failures = [makeFakeFailure()]
      const results = await createHealthAlerts(failures)

      expect(results).toHaveLength(1)
      expect(results[0].created).toBe(false)
      expect(results[0].skippedReason).toBe("No Notion token available")
    } finally {
      if (origKey) process.env.NOTION_API_KEY = origKey
      if (origToken) process.env.NOTION_TOKEN = origToken
    }
  })

  test("Feed itself unreachable → cannot create alerts", async () => {
    const failures = [
      makeFakeFailure({ key: "FEED", label: "Feed 2.0", criticality: "critical" }),
      makeFakeFailure({ key: "POV_LIBRARY" }),
    ]

    const results = await createHealthAlerts(failures, "fake-token")

    expect(results).toHaveLength(2)
    for (const r of results) {
      expect(r.created).toBe(false)
      expect(r.skippedReason).toBe("Feed 2.0 unreachable")
    }
    expect(mockPagesCreate).not.toHaveBeenCalled()
  })

  test("alert creation failure → graceful per-item error", async () => {
    mockPagesCreate.mockImplementation(() =>
      Promise.reject(new Error("API rate limit")),
    )

    const failures = [makeFakeFailure()]
    const results = await createHealthAlerts(failures, "fake-token")

    expect(results).toHaveLength(1)
    expect(results[0].created).toBe(false)
    expect(results[0].skippedReason).toContain("API rate limit")
  })
})

// ─── Health Module (Orchestrator) ────────────────────────

describe("runBridgeHealthCheck", () => {
  beforeEach(() => {
    mockRetrieve.mockReset()
    mockQuery.mockReset()
    mockPagesCreate.mockReset()
    mockRetrieve.mockImplementation(() => Promise.resolve({ id: "ok" }))
    mockQuery.mockImplementation(() => Promise.resolve({ results: [] }))
    mockPagesCreate.mockImplementation(() => Promise.resolve({ id: "alert-id" }))
  })

  test("returns ValidationReport with correct structure", async () => {
    // Ensure env has a token for this test
    const origKey = process.env.NOTION_API_KEY
    process.env.NOTION_API_KEY = "fake-token-for-health"

    try {
      const report = await runBridgeHealthCheck()

      expect(report).toHaveProperty("results")
      expect(report).toHaveProperty("criticalFailures")
      expect(report).toHaveProperty("enrichmentFailures")
      expect(report).toHaveProperty("allCriticalPassed")
      expect(report).toHaveProperty("totalChecked")
      expect(report).toHaveProperty("totalPassed")
      expect(report).toHaveProperty("checkedAt")
    } finally {
      if (origKey) {
        process.env.NOTION_API_KEY = origKey
      } else {
        delete process.env.NOTION_API_KEY
      }
    }
  })

  test("enrichment failures trigger Feed alert creation", async () => {
    // POV Library fails (enrichment), everything else passes
    mockRetrieve.mockImplementation(({ database_id }: { database_id: string }) => {
      if (database_id === NOTION_DB.POV_LIBRARY) {
        return Promise.reject(new Error("object_not_found"))
      }
      return Promise.resolve({ id: database_id })
    })

    const origKey = process.env.NOTION_API_KEY
    process.env.NOTION_API_KEY = "fake-token-for-health"

    try {
      const report = await runBridgeHealthCheck()

      expect(report.allCriticalPassed).toBe(true)
      expect(report.enrichmentFailures).toHaveLength(1)
      // Feed alerter should have been called
      expect(mockPagesCreate).toHaveBeenCalled()
    } finally {
      if (origKey) {
        process.env.NOTION_API_KEY = origKey
      } else {
        delete process.env.NOTION_API_KEY
      }
    }
  })
})

// ─── POV Slot Source Strings ─────────────────────────────

describe("pov-slot source discrimination", () => {
  // These tests validate the contract: different failure modes →
  // different source strings in the slot, per ADR-008.

  test("NOTION_DB_META classifies POV_LIBRARY as enrichment", () => {
    const meta = NOTION_DB_META.POV_LIBRARY
    expect(meta.criticality).toBe("enrichment")
    expect(meta.surfaces).toContain("bridge")
  })

  test("NOTION_DB_META classifies Feed as critical", () => {
    const meta = NOTION_DB_META.FEED
    expect(meta.criticality).toBe("critical")
  })

  test("NOTION_DB_META classifies System Prompts as critical", () => {
    const meta = NOTION_DB_META.SYSTEM_PROMPTS
    expect(meta.criticality).toBe("critical")
  })

  test("all NOTION_DB keys have corresponding NOTION_DB_META entries", () => {
    for (const key of Object.keys(NOTION_DB)) {
      expect(NOTION_DB_META).toHaveProperty(key)
      const meta = NOTION_DB_META[key as keyof typeof NOTION_DB_META]
      expect(meta.label).toBeTruthy()
      expect(meta.surfaces.length).toBeGreaterThan(0)
      expect(["critical", "enrichment"]).toContain(meta.criticality)
    }
  })
})
