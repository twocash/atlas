/**
 * Degraded Context Warning Tests
 *
 * Verifies the standard degraded-context warning format
 * used when PM lookups fall back to hardcoded defaults.
 */

import { describe, it, expect, mock, beforeEach } from 'bun:test';
import { degradedWarning, logDegradedFallback } from '../src/services/degraded-context';

describe('degradedWarning', () => {
  it('returns standard format with slug', () => {
    const result = degradedWarning('voice.grove-analytical');
    expect(result).toBe('[DEGRADED: voice.grove-analytical unavailable — using hardcoded fallback]');
  });

  it('works with research-agent slugs', () => {
    const result = degradedWarning('research-agent.deep');
    expect(result).toContain('research-agent.deep');
    expect(result).toStartWith('[DEGRADED:');
    expect(result).toEndWith(']');
  });

  it('works with drafter slugs', () => {
    const result = degradedWarning('drafter.the-grove.research');
    expect(result).toContain('drafter.the-grove.research');
  });
});

describe('logDegradedFallback', () => {
  let errorSpy: ReturnType<typeof mock>;

  beforeEach(() => {
    errorSpy = mock(() => {});
    console.error = errorSpy;
  });

  it('logs with standard prefix', () => {
    logDegradedFallback('voice.consulting', 'getVoiceInstructionsAsync');
    expect(errorSpy).toHaveBeenCalledTimes(1);
    const [message] = errorSpy.mock.calls[0];
    expect(message).toContain('[DEGRADED]');
    expect(message).toContain('voice.consulting');
    expect(message).toContain('getVoiceInstructionsAsync');
  });

  it('includes remediation steps in structured data', () => {
    logDegradedFallback('research-agent.standard', 'buildResearchPrompt');
    const [, data] = errorSpy.mock.calls[0];
    expect(data.slug).toBe('research-agent.standard');
    expect(data.caller).toBe('buildResearchPrompt');
    expect(data.fix).toBeDefined();
    expect(data.fix.length).toBeGreaterThan(0);
  });

  it('merges extra context', () => {
    logDegradedFallback('voice.consulting', 'getVoiceInstructionsAsync', {
      depth: 'deep',
      pillar: 'consulting',
    });
    const [, data] = errorSpy.mock.calls[0];
    expect(data.depth).toBe('deep');
    expect(data.pillar).toBe('consulting');
  });
});
