/**
 * Retrieval-Synthesis Fidelity Score — Unit Tests
 *
 * Verifies that computeFidelity() catches the failure mode where Gemini
 * ignores retrieved web content and hallucinates from training data.
 *
 * Real-world trigger: @shikeb Threads URL → Phase 1 finds social media content →
 * Phase 2 hallucinates "enterprise AI automation" narrative → scored "informed (0.88)"
 */

import { describe, it, expect } from 'bun:test';
import { computeFidelity } from '../src/agents/research';

describe('computeFidelity: basic scoring', () => {
  it('returns high score when synthesis mirrors retrieval', () => {
    const retrieved = 'Quantum computing breakthroughs in 2026 include error correction advances and topological qubits from Google and IBM.';
    const synthesis = 'Recent quantum computing breakthroughs focus on error correction and topological qubit implementations, with Google and IBM leading advances in 2026.';
    const score = computeFidelity(retrieved, synthesis);
    expect(score).toBeGreaterThan(0.4);
  });

  it('returns low score when synthesis is disconnected from retrieval', () => {
    const retrieved = 'Threads post by shikeb about social media trends and content creation tips for influencers.';
    const synthesis = 'Enterprise AI automation for small businesses enables lead generation and follow-up. Custom Claude skills and Grok real-time verification position Threads as strategic platform for AI-native workflows.';
    const score = computeFidelity(retrieved, synthesis);
    expect(score).toBeLessThan(0.15);
  });

  it('returns 0 when retrievedText is empty', () => {
    expect(computeFidelity('', 'Some synthesis output')).toBe(0);
  });

  it('returns 0 when synthesisText is empty', () => {
    expect(computeFidelity('Some retrieval text', '')).toBe(0);
  });

  it('returns 0 when both are empty', () => {
    expect(computeFidelity('', '')).toBe(0);
  });
});

describe('computeFidelity: real-world @shikeb failure case', () => {
  const phase1Text = `
    Found results about Threads social media platform. User @shikeb has posts
    about various topics. Threads is a social media app by Meta for sharing
    text updates and joining public conversations. The post URL points to
    threads.net/@shikeb with content about daily life and social interactions.
    Related results include Instagram integration and Meta's social platform strategy.
  `;

  it('hallucinated enterprise AI narrative scores below floor', () => {
    const hallucinatedPhase2 = `
      @shikeb's presence on Threads offers a direct lens into how enterprise AI
      automation, particularly for small businesses, is being discussed and developed
      in real-time. His focus on leveraging AI for lead generation and follow-up,
      combined with his exploration of advanced AI capabilities like custom Claude
      skills and Grok's real-time verification, positions Threads as a strategic
      platform for tracking emerging AI-native workflows and distribution strategies.
    `;
    const score = computeFidelity(phase1Text, hallucinatedPhase2);
    expect(score).toBeLessThan(0.15);
  });

  it('faithful synthesis about social media scores above floor', () => {
    const faithfulPhase2 = `
      @shikeb's Threads presence is part of Meta's broader social media strategy.
      The platform integrates with Instagram and focuses on public conversations
      and text-based updates. The post content covers social interactions and
      daily topics, typical of the threads.net user base.
    `;
    const score = computeFidelity(phase1Text, faithfulPhase2);
    expect(score).toBeGreaterThan(0.15);
  });
});

describe('computeFidelity: edge cases', () => {
  it('handles whitespace-only inputs', () => {
    expect(computeFidelity('   \n  ', 'real text')).toBe(0);
    expect(computeFidelity('real text', '   \n  ')).toBe(0);
  });

  it('handles very short texts', () => {
    const score = computeFidelity('quantum computing', 'quantum physics');
    // "quantum" overlaps, "computing" vs "physics" don't
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThan(1);
  });

  it('identical texts score high', () => {
    const text = 'The implications of recursive language models for distributed AI systems are significant.';
    const score = computeFidelity(text, text);
    expect(score).toBeGreaterThanOrEqual(0.8);
  });

  it('completely disjoint texts score near zero', () => {
    const retrieved = 'Quantum entanglement photonic crystals superconducting circuits cryogenic temperatures';
    const synthesis = 'Enterprise blockchain tokenomics governance frameworks regulatory compliance auditing';
    const score = computeFidelity(retrieved, synthesis);
    expect(score).toBe(0);
  });
});
