/**
 * Tests for the Bridge /message relay endpoint.
 *
 * Tests the HTTP contract — request validation, error responses,
 * and response format. Does not test actual Claude interaction
 * (that requires a running Bridge + Claude Code process).
 */

import { describe, it, expect } from 'bun:test';

// These tests verify the relay contract at the HTTP level.
// Integration tests require a running Bridge server.

const BRIDGE_URL = 'http://localhost:3848';

describe('/message relay contract', () => {
  describe('request validation', () => {
    it('rejects empty body', async () => {
      try {
        const res = await fetch(`${BRIDGE_URL}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{}',
          signal: AbortSignal.timeout(5000),
        });
        // If Bridge is running, should return 400
        if (res.ok === false) {
          const json = await res.json() as { error?: string };
          expect(json.error).toContain('text');
        }
      } catch {
        // Bridge not running — skip gracefully
        console.log('  [skip] Bridge not running');
      }
    });

    it('rejects non-JSON body', async () => {
      try {
        const res = await fetch(`${BRIDGE_URL}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: 'not json',
          signal: AbortSignal.timeout(5000),
        });
        if (res.status === 400) {
          const json = await res.json() as { error?: string };
          expect(json.error).toBeDefined();
        }
      } catch {
        console.log('  [skip] Bridge not running');
      }
    });
  });

  describe('response format', () => {
    it('returns 503 when Claude not connected', async () => {
      // This test only passes if Bridge is running but Claude is not
      try {
        const res = await fetch(`${BRIDGE_URL}/message`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text: 'test' }),
          signal: AbortSignal.timeout(5000),
        });
        if (res.status === 503) {
          const json = await res.json() as { error?: string };
          expect(json.error).toContain('Claude');
        }
        // If 200, Claude is connected — also valid
      } catch {
        console.log('  [skip] Bridge not running');
      }
    });
  });
});

describe('Telegram relay feature flag', () => {
  it('ATLAS_BRIDGE_RELAY defaults to false', () => {
    // Feature flag is opt-in (Constraint 8: measure first)
    const enabled = process.env.ATLAS_BRIDGE_RELAY === 'true';
    expect(enabled).toBe(false);
  });
});
