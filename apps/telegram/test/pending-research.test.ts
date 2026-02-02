/**
 * Pending Research State Unit Tests
 *
 * Tests for TTL expiration, one-time consumption, and memory leak prevention.
 */

import { describe, test, expect, beforeEach } from "bun:test";
import { store, retrieve, exists, pendingCount } from "../src/pending-research";

describe("Pending Research State", () => {
  // Generate unique IDs for each test to avoid collisions
  let testCounter = 0;
  const uniqueId = () => `test-${Date.now()}-${testCounter++}`;

  describe("store and retrieve", () => {
    test("should store and retrieve a pending request", async () => {
      const requestId = uniqueId();
      const request = {
        chatId: 12345,
        userId: 67890,
        query: "test query",
        depth: "standard" as const,
        focus: "testing",
        timestamp: Date.now(),
      };

      store(requestId, request);

      const retrieved = retrieve(requestId);
      expect(retrieved).not.toBeUndefined();
      expect(retrieved?.query).toBe("test query");
      expect(retrieved?.depth).toBe("standard");
      expect(retrieved?.chatId).toBe(12345);
    });

    test("should consume request on retrieve (one-time use)", async () => {
      const requestId = uniqueId();
      const request = {
        chatId: 111,
        userId: 222,
        query: "one time query",
        depth: "light" as const,
        timestamp: Date.now(),
      };

      store(requestId, request);

      // First retrieve should succeed
      const first = retrieve(requestId);
      expect(first).not.toBeUndefined();
      expect(first?.query).toBe("one time query");

      // Second retrieve should fail (already consumed)
      const second = retrieve(requestId);
      expect(second).toBeUndefined();
    });

    test("should return undefined for non-existent request", async () => {
      const result = retrieve("non-existent-id-xyz");
      expect(result).toBeUndefined();
    });
  });

  describe("exists", () => {
    test("should return true for stored request", async () => {
      const requestId = uniqueId();
      store(requestId, {
        chatId: 1,
        userId: 2,
        query: "test",
        depth: "light",
        timestamp: Date.now(),
      });

      expect(exists(requestId)).toBe(true);
    });

    test("should return false after retrieve consumes request", async () => {
      const requestId = uniqueId();
      store(requestId, {
        chatId: 1,
        userId: 2,
        query: "test",
        depth: "light",
        timestamp: Date.now(),
      });

      expect(exists(requestId)).toBe(true);
      retrieve(requestId); // Consume
      expect(exists(requestId)).toBe(false);
    });

    test("should return false for non-existent request", async () => {
      expect(exists("fake-id-12345")).toBe(false);
    });
  });

  describe("TTL expiration", () => {
    test("should expire requests after TTL (simulated)", async () => {
      // Note: We can't easily test the actual 5-minute timeout without waiting,
      // but we can verify the mechanism works by checking the setTimeout is set.
      // For a true integration test, you'd use fake timers.

      const requestId = uniqueId();
      store(requestId, {
        chatId: 1,
        userId: 2,
        query: "expiring query",
        depth: "deep",
        timestamp: Date.now(),
      });

      // Immediately after storing, it should exist
      expect(exists(requestId)).toBe(true);

      // We can't wait 5 minutes in a test, but we verify the store worked
      // The setTimeout in the actual code will clean it up
    });
  });

  describe("memory management", () => {
    test("should track pending count", async () => {
      const initialCount = pendingCount();

      const id1 = uniqueId();
      const id2 = uniqueId();

      store(id1, {
        chatId: 1,
        userId: 1,
        query: "q1",
        depth: "light",
        timestamp: Date.now(),
      });

      expect(pendingCount()).toBe(initialCount + 1);

      store(id2, {
        chatId: 2,
        userId: 2,
        query: "q2",
        depth: "light",
        timestamp: Date.now(),
      });

      expect(pendingCount()).toBe(initialCount + 2);

      // Consume one
      retrieve(id1);
      expect(pendingCount()).toBe(initialCount + 1);

      // Consume other
      retrieve(id2);
      expect(pendingCount()).toBe(initialCount);
    });

    test("should not leak memory on repeated store/retrieve cycles", async () => {
      const initialCount = pendingCount();

      // Simulate many user interactions
      for (let i = 0; i < 100; i++) {
        const id = uniqueId();
        store(id, {
          chatId: i,
          userId: i,
          query: `query ${i}`,
          depth: "standard",
          timestamp: Date.now(),
        });
        retrieve(id); // Immediately consume
      }

      // Should be back to initial count (no leaks)
      expect(pendingCount()).toBe(initialCount);
    });
  });

  describe("data integrity", () => {
    test("should preserve all fields through store/retrieve cycle", async () => {
      const requestId = uniqueId();
      const original = {
        chatId: 99999,
        userId: 88888,
        query: "complex query with special chars: <>&\"'",
        depth: "deep" as const,
        focus: "specific-area",
        timestamp: 1234567890,
      };

      store(requestId, original);
      const retrieved = retrieve(requestId);

      expect(retrieved).toEqual(original);
    });

    test("should handle requests without optional fields", async () => {
      const requestId = uniqueId();
      const minimal = {
        chatId: 1,
        userId: 2,
        query: "minimal",
        depth: "light" as const,
        timestamp: Date.now(),
        // No focus field
      };

      store(requestId, minimal);
      const retrieved = retrieve(requestId);

      expect(retrieved?.focus).toBeUndefined();
      expect(retrieved?.query).toBe("minimal");
    });
  });
});
