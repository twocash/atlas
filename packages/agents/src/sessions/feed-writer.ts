/**
 * Feed 2.0 Session Completion Writer
 *
 * Creates a rich Notion page in Feed 2.0 when a session completes.
 * This is the conference table — Jim reviews Atlas's intellectual work product.
 * Not a log line.
 *
 * Pattern: lazy Notion client, fire-and-forget with error logging.
 * Same approach as error-escalation.ts and dispatch-callback.ts.
 *
 * Sprint: SESSION-TELEMETRY P0
 */

import { Client } from '@notionhq/client';
import { NOTION_DB, ATLAS_NODE } from '@atlas/shared/config';
import { logger } from '../logger';
import type { SessionState } from './types';

// ── Lazy Notion Client ──────────────────────────────────

let _notion: Client | null = null;

function getNotion(): Client | null {
  if (!_notion) {
    const key = process.env.NOTION_API_KEY;
    if (!key) return null;
    _notion = new Client({ auth: key });
  }
  return _notion;
}

// ── Rich Text Helpers ───────────────────────────────────

function richText(text: string, bold = false) {
  return {
    type: 'text' as const,
    text: { content: text.substring(0, 2000) },
    annotations: bold ? { bold: true } : undefined,
  };
}

function heading2(text: string) {
  return {
    object: 'block' as const,
    type: 'heading_2' as const,
    heading_2: {
      rich_text: [richText(text)],
    },
  };
}

function heading3(text: string) {
  return {
    object: 'block' as const,
    type: 'heading_3' as const,
    heading_3: {
      rich_text: [richText(text)],
    },
  };
}

function paragraph(text: string) {
  return {
    object: 'block' as const,
    type: 'paragraph' as const,
    paragraph: {
      rich_text: [richText(text)],
    },
  };
}

function bullet(text: string) {
  return {
    object: 'block' as const,
    type: 'bulleted_list_item' as const,
    bulleted_list_item: {
      rich_text: [richText(text)],
    },
  };
}

function callout(text: string, emoji: string, color: string) {
  return {
    object: 'block' as const,
    type: 'callout' as const,
    callout: {
      rich_text: [richText(text)],
      icon: { type: 'emoji' as const, emoji },
      color,
    },
  };
}

function divider() {
  return {
    object: 'block' as const,
    type: 'divider' as const,
    divider: {},
  };
}

// ── Feed Entry Builder ──────────────────────────────────

/**
 * Write a rich session completion entry to Feed 2.0.
 * Fire-and-forget — never throws.
 */
export async function writeSessionFeedEntry(state: SessionState): Promise<void> {
  try {
    const notion = getNotion();
    if (!notion) {
      logger.warn('Cannot write session Feed entry: NOTION_API_KEY not set');
      return;
    }

    const completedAt = state.completedAt || new Date().toISOString();
    const startMs = new Date(state.createdAt).getTime();
    const endMs = new Date(completedAt).getTime();
    const durationSec = Math.round((endMs - startMs) / 1000);
    const durationMin = Math.round(durationSec / 60);

    // Title
    const title = state.topic
      ? `Session Complete: ${state.topic}`
      : `Session Complete (${state.turnCount} turns)`;

    // Build keywords
    const keywords: string[] = ['session-completion'];
    if (state.pillar) keywords.push(state.pillar.toLowerCase().replace(/\s+/g, '-'));
    if (state.completionType) keywords.push(state.completionType);

    // Properties
    const properties: Record<string, unknown> = {
      'Entry': {
        title: [{ text: { content: title.substring(0, 100) } }],
      },
      'Source': {
        select: { name: `Atlas [${ATLAS_NODE}]` },
      },
      'Status': {
        select: { name: 'Logged' },
      },
      'Date': {
        date: { start: completedAt },
      },
      'Keywords': {
        multi_select: keywords.slice(0, 5).map(k => ({ name: k })),
      },
    };

    if (state.pillar) {
      properties['Pillar'] = { select: { name: state.pillar } };
    }

    // Body blocks
    const children: unknown[] = [];

    // Session Summary heading + thesis callout
    children.push(heading2('Session Summary'));

    if (state.thesisHook) {
      children.push(callout(
        `Thesis: ${state.thesisHook}`,
        '\uD83C\uDFAF', // direct target emoji
        'blue_background',
      ));
    }

    children.push(paragraph(
      `${state.turnCount} turns over ${durationMin > 0 ? `${durationMin} min` : `${durationSec}s`} ` +
      `| Surface: ${state.surface} | Completion: ${state.completionType || 'natural'}`,
    ));

    children.push(divider());

    // Intent Arc
    if (state.intentSequence.length > 0) {
      children.push(heading3('Intent Arc'));
      for (const intent of state.intentSequence) {
        children.push(bullet(intent));
      }
    }

    // Key Findings (per-turn)
    const turnsWithFindings = state.turns.filter(t => t.findings);
    if (turnsWithFindings.length > 0) {
      children.push(heading3('Key Findings'));
      for (const turn of turnsWithFindings) {
        const label = `Turn ${turn.turnNumber} (${turn.intent || 'unknown'})`;
        children.push(bullet(`${label}: ${turn.findings}`));
      }
    }

    // Metadata
    children.push(heading3('Metadata'));
    children.push(paragraph(
      `Session ID: ${state.id} | Started: ${state.createdAt} | ` +
      `Duration: ${durationSec}s | Turns: ${state.turnCount} | Surface: ${state.surface}`,
    ));

    // Create the page
    await notion.pages.create({
      parent: { database_id: NOTION_DB.FEED },
      properties: properties as Parameters<typeof notion.pages.create>[0]['properties'],
      children: children as Parameters<typeof notion.pages.create>[0]['children'],
    });

    logger.info('Session completion Feed entry created', {
      sessionId: state.id,
      topic: state.topic,
      turns: state.turnCount,
    });
  } catch (err) {
    // Fire-and-forget — never throw from Feed writes
    logger.warn('Failed to write session Feed entry (non-fatal)', {
      sessionId: state.id,
      error: (err as Error).message,
    });
  }
}
