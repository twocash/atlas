/**
 * Voice Manager Unit Tests
 *
 * Tests for voice profile loading, path traversal prevention, and edge cases.
 */

import { describe, test, expect, beforeAll } from "bun:test";
import { listVoices, loadVoice, voiceExists } from "../src/voice-manager";

describe("Voice Manager", () => {
  describe("listVoices", () => {
    test("should return array of voice profiles", async () => {
      const voices = await listVoices();

      expect(Array.isArray(voices)).toBe(true);
      expect(voices.length).toBeGreaterThan(0);

      // Each voice should have id and name
      for (const voice of voices) {
        expect(voice).toHaveProperty("id");
        expect(voice).toHaveProperty("name");
        expect(typeof voice.id).toBe("string");
        expect(typeof voice.name).toBe("string");
      }
    });

    test("should exclude editorial_memory.md", async () => {
      const voices = await listVoices();
      const ids = voices.map((v) => v.id);

      expect(ids).not.toContain("editorial_memory");
    });

    test("should include expected voice profiles", async () => {
      const voices = await listVoices();
      const ids = voices.map((v) => v.id);

      expect(ids).toContain("grove");
      expect(ids).toContain("consulting");
      expect(ids).toContain("linkedin");
      expect(ids).toContain("personal");
    });

    test("should format display names correctly", async () => {
      const voices = await listVoices();
      const grove = voices.find((v) => v.id === "grove");

      expect(grove?.name).toBe("Grove");
    });
  });

  describe("loadVoice", () => {
    test("should load existing voice content", async () => {
      const content = await loadVoice("grove");

      expect(content).not.toBeNull();
      expect(typeof content).toBe("string");
      expect(content!.length).toBeGreaterThan(100);
    });

    test("should return null for non-existent voice", async () => {
      const content = await loadVoice("nonexistent-voice-12345");

      expect(content).toBeNull();
    });

    test("should prevent path traversal attacks", async () => {
      // Attempt to read .env file via path traversal
      const content1 = await loadVoice("../../../.env");
      expect(content1).toBeNull();

      const content2 = await loadVoice("..%2F..%2F.env");
      expect(content2).toBeNull();

      const content3 = await loadVoice("grove/../../../.env");
      expect(content3).toBeNull();
    });

    test("should sanitize voice IDs with special characters", async () => {
      // These should be sanitized and return null (file won't exist)
      const content1 = await loadVoice("grove<script>");
      expect(content1).toBeNull();

      const content2 = await loadVoice("grove;rm -rf /");
      expect(content2).toBeNull();

      const content3 = await loadVoice("grove|cat /etc/passwd");
      expect(content3).toBeNull();
    });

    test("should handle voice IDs with valid characters", async () => {
      // These are valid characters that should pass through
      const content = await loadVoice("grove");
      expect(content).not.toBeNull();
    });
  });

  describe("voiceExists", () => {
    test("should return true for existing voice", async () => {
      const exists = await voiceExists("grove");
      expect(exists).toBe(true);
    });

    test("should return false for non-existent voice", async () => {
      const exists = await voiceExists("fake-voice-xyz");
      expect(exists).toBe(false);
    });

    test("should prevent path traversal in existence check", async () => {
      const exists = await voiceExists("../../../.env");
      expect(exists).toBe(false);
    });
  });
});
