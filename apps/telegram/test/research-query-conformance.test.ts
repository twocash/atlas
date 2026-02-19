/**
 * Research Query Architecture Conformance Tests
 * Sprint: fix/research-query-conformance (2026-02-19)
 * ADR: Research Query Construction (Notion: 30c780a78eef819ba02df11d775ed4f7)
 *
 * Enforces that socratic-adapter.ts follows the canonical ResearchConfig flow:
 *
 *   Route → Triage → Build ResearchConfig → Dispatch → Deliver
 *
 * Key invariants:
 *   1. ResearchConfig.query = triage title (clean, < 200 chars) — never raw content
 *   2. Content Router consulted before any server-side extraction
 *   3. No answerContext strings, ogContent fetches, or URL source lines in query
 *   4. pillar routes prompt composition, not query text
 *
 * Uses source-text inspection — zero mocking, zero live API calls.
 */

import { describe, it, expect } from 'bun:test';
import { join } from 'node:path';

// Resolve paths relative to this test file (Windows-safe)
const rel = (...parts: string[]) => join(import.meta.dir, ...parts);

// ──────────────────────────────────────────────────────────────────────────────
// Shared fixture: read the source file once
// ──────────────────────────────────────────────────────────────────────────────

let src: string;

async function getSource(): Promise<string> {
  if (!src) {
    src = await Bun.file(
      rel('../src/conversation/socratic-adapter.ts')
    ).text();
  }
  return src;
}

// ──────────────────────────────────────────────────────────────────────────────
// Suite 1 — Query Construction Shape
// Positive checks: the canonical pattern MUST be present
// ──────────────────────────────────────────────────────────────────────────────

describe('Suite 1 — Query Construction Shape', () => {
  it('uses a typed ResearchConfig const for dispatch', async () => {
    const s = await getSource();
    expect(s).toContain('const researchConfig: ResearchConfig = {');
  });

  it('sets query field to triage title — not a template string', async () => {
    const s = await getSource();
    // The query field must be the bare `title` identifier, not a template literal
    expect(s).toContain('query: title,');
    expect(s).not.toMatch(/query\s*:\s*`/);
  });

  it('includes pillar field in ResearchConfig', async () => {
    const s = await getSource();
    // pillar shorthand inside the researchConfig block
    expect(s).toContain('pillar,');
  });

  it('calls routeForAnalysis before dispatching', async () => {
    const s = await getSource();
    expect(s).toContain('routeForAnalysis(content)');
  });

  it('stores needsBrowser from route result', async () => {
    const s = await getSource();
    expect(s).toContain('needsBrowser = route.needsBrowser');
  });

  it('imports ResearchConfig type from agents package', async () => {
    const s = await getSource();
    expect(s).toContain('ResearchConfig');
    // Must appear in an import statement, not just inline usage
    expect(s).toMatch(/import type \{[^}]*ResearchConfig/);
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Suite 2 — Anti-Pattern Guards
// Negative checks: the broken patterns must NOT exist
// ──────────────────────────────────────────────────────────────────────────────

describe('Suite 2 — Anti-Pattern Guards', () => {
  it('does NOT build a parts array for query concatenation', async () => {
    const s = await getSource();
    // Broken pattern: const parts = [answerContext, ogContent, ...]
    expect(s).not.toContain('const parts = [');
  });

  it('does NOT use ogContent as query material', async () => {
    const s = await getSource();
    // ogContent was fetched body text joined into query — removed entirely
    expect(s).not.toContain('ogContent');
  });

  it('does NOT inject URL source string into query', async () => {
    const s = await getSource();
    // Broken pattern: `Source: ${content}` appended to query
    expect(s).not.toContain('Source: ${content}');
  });

  it('does NOT import or call fetchUrlContent', async () => {
    const s = await getSource();
    // fetchUrlContent was used to build ogContent for the query — removed
    expect(s).not.toContain('fetchUrlContent');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Suite 3 — Content Router Integration
// The Content Router MUST be wired before any extraction attempt
// ──────────────────────────────────────────────────────────────────────────────

describe('Suite 3 — Content Router Integration', () => {
  it('imports routeForAnalysis from content-router', async () => {
    const s = await getSource();
    expect(s).toContain("import { routeForAnalysis } from './content-router'");
  });

  it('gates routing check on contentType === url', async () => {
    const s = await getSource();
    // Content Router is only called for URL content (not text/media)
    const routerBlock = s.slice(
      s.indexOf('needsBrowser = false'),
      s.indexOf('routeForAnalysis(content)') + 50,
    );
    expect(routerBlock).toContain("contentType === 'url'");
  });

  it('does not call fetchUrlContent for SPA-hostile URLs', async () => {
    const s = await getSource();
    // Social media (Threads, Twitter, LinkedIn) must not be server-fetched
    // The guard is implemented by removing fetchUrlContent from query path entirely
    expect(s).not.toContain('fetchUrlContent');
  });
});

// ──────────────────────────────────────────────────────────────────────────────
// Suite 4 — ADR Reference
// The module must cite the governing ADR so future editors know the constraints
// ──────────────────────────────────────────────────────────────────────────────

describe('Suite 4 — ADR Reference', () => {
  it('references ADR in source comments', async () => {
    const s = await getSource();
    // ADR: Research Query Architecture Conformance must be cited
    expect(s).toContain('ADR');
  });
});
