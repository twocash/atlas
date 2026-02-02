/**
 * Voice Health Check Tests
 *
 * Tests for the startup health check that verifies voice configuration.
 */

import { describe, test, expect } from "bun:test";
import { verifyVoiceConfig, runVoiceHealthCheck } from "../src/health/voice-check";

describe("Voice Health Check", () => {
  describe("verifyVoiceConfig", () => {
    test("should return ok status when voices are configured", async () => {
      const result = await verifyVoiceConfig();

      expect(result.status).toBe("ok");
      expect(result.message).toContain("Voice profiles loaded");
    });

    test("should include voice list in details", async () => {
      const result = await verifyVoiceConfig();

      expect(result.details).toBeDefined();
      expect(result.details?.voicesFound).toContain("grove");
      expect(result.details?.voicesFound).toContain("consulting");
      expect(result.details?.defaultVoiceExists).toBe(true);
    });

    test("should verify default voice exists", async () => {
      const result = await verifyVoiceConfig();

      expect(result.details?.defaultVoiceExists).toBe(true);
    });
  });

  describe("runVoiceHealthCheck", () => {
    test("should return true when configuration is valid", async () => {
      const result = await runVoiceHealthCheck();

      expect(result).toBe(true);
    });
  });
});
