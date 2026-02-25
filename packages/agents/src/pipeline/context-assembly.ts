/**
 * Context Assembly Pipeline — Shared Enrichment Contract
 *
 * Defines the pipeline-level interface for context enrichment.
 * Both TelegramSurface and BridgeSurface feed context into this
 * pipeline, which assembles it into the router's AssemblyResult.
 *
 * Architecture:
 *   Surface.getContext() → SurfaceContext (raw observations)
 *   ContextAssembler.assemble() → AssemblyResult (enriched, budgeted)
 *   Router.route() uses AssemblyResult for tier/model/mode decisions
 *
 * The assembler:
 *   1. Takes surface context + system context (triage, session, etc.)
 *   2. Populates shared slots (identity, voice, RAG, POV, session)
 *   3. Populates surface-specific slots (browser for Bridge, etc.)
 *   4. Enforces token budget across all slots
 *   5. Returns AssemblyResult with populated/empty/degraded status
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import { logger } from '../logger';
import type { SurfaceContext } from './surface';
import type { AssemblyResult } from './router';
import type { TriageResult } from '../cognitive/triage-skill';

// ─── Assembly Request ───────────────────────────────────

export interface ContextAssemblyRequest {
  /** The user's message text */
  message: string;
  /** User ID for session/history lookup */
  userId: number;
  /** Triage result (drives slot selection and priority) */
  triage: TriageResult;
  /** Surface context (environmental observations) */
  surfaceContext: SurfaceContext;
  /** Surface ID (affects which slots are relevant) */
  surfaceId: string;
}

// ─── Slot Status ────────────────────────────────────────

export type SlotStatus = 'populated' | 'empty' | 'degraded';

export interface SlotReport {
  slotId: string;
  status: SlotStatus;
  tokenCount: number;
  source: string;
  /** Error message if degraded */
  error?: string;
}

// ─── Context Assembler ──────────────────────────────────

export interface ContextAssembler {
  /** Assemble all context slots for a request */
  assemble(request: ContextAssemblyRequest): Promise<AssemblyResult>;
}

// ─── Default Assembler ──────────────────────────────────
// Bridges to the existing Bridge context assembler during migration.
// Surfaces that have their own enrichment (Telegram) can provide
// a custom assembler; this is the shared default.

export class DefaultContextAssembler implements ContextAssembler {
  async assemble(request: ContextAssemblyRequest): Promise<AssemblyResult> {
    const startMs = Date.now();

    // Shared slots that every surface gets
    const slotsPopulated: string[] = [];
    const slotsEmpty: string[] = [];
    const slotsDegraded: string[] = [];
    const enrichedParts: string[] = [];

    // 1. Identity/intent slot (always populated from triage)
    const intentContent = formatIntentSlot(request.triage);
    if (intentContent) {
      slotsPopulated.push('intent');
      enrichedParts.push(`[INTENT]\n${intentContent}`);
    }

    // 2-5. Other shared slots are seams — the Bridge assembler
    // has full implementations for domain_rag, pov, voice, session.
    // During migration, these populate when wired to the Bridge assembler.

    // Surface-specific slots
    if (request.surfaceContext.browserUrl) {
      slotsPopulated.push('browser');
      enrichedParts.push(formatBrowserSlot(request.surfaceContext));
    } else {
      slotsEmpty.push('browser');
    }

    // Check for degraded slots (context that was attempted but failed)
    const degradedNote = slotsDegraded.length > 0
      ? `Note: Some context sources are currently unavailable (${slotsDegraded.join(', ')}). My responses may be less informed than usual.`
      : null;

    const assemblyLatencyMs = Date.now() - startMs;

    logger.debug('Context assembly complete', {
      slotsPopulated,
      slotsEmpty,
      slotsDegraded,
      assemblyLatencyMs,
    });

    return {
      enrichedContext: enrichedParts.join('\n\n'),
      slotsPopulated,
      slotsEmpty,
      slotsDegraded,
      totalTokens: estimateTokens(enrichedParts.join('\n\n')),
      assemblyLatencyMs,
      hasBrowserContext: slotsPopulated.includes('browser'),
      degradedContextNote: degradedNote,
    };
  }
}

// ─── Slot Formatters ────────────────────────────────────

function formatIntentSlot(triage: TriageResult): string {
  const lines = [
    `Intent: ${triage.intent}`,
    `Pillar: ${triage.pillar}`,
    `Type: ${triage.requestType}`,
    `Confidence: ${(triage.confidence * 100).toFixed(0)}%`,
  ];

  if (triage.complexityTier !== undefined) {
    lines.push(`Complexity: Tier ${triage.complexityTier}`);
  }

  if (triage.keywords?.length > 0) {
    lines.push(`Keywords: ${triage.keywords.join(', ')}`);
  }

  return lines.join('\n');
}

function formatBrowserSlot(ctx: SurfaceContext): string {
  const lines = ['[BROWSER CONTEXT]'];

  if (ctx.browserUrl) lines.push(`URL: ${ctx.browserUrl}`);
  if (ctx.pageTitle) lines.push(`Page: ${ctx.pageTitle}`);
  if (ctx.selectedText) lines.push(`Selected text: ${ctx.selectedText}`);

  return lines.join('\n');
}

function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}
