/**
 * Domain Correction Logger (STAB-002c)
 *
 * Detects when Jim corrects a domain classification and logs to Feed 2.0
 * for pattern mining. After 3+ corrections share a keyword pattern,
 * a future sprint proposes rule additions to config.domain-inference-rules.
 *
 * This module handles Feed telemetry. WQ pillar corrections are handled
 * separately by logReclassification() in audit.ts.
 */

import { Client } from "@notionhq/client";
import { NOTION_DB } from "@atlas/shared/config";
import type { DomainType } from "./types";
import { derivePillar } from "./domain-inferrer";

// ── Types ────────────────────────────────────────────────────────────────

export interface DomainCorrection {
  corrected: DomainType;
}

export interface CorrectionLogEntry {
  originalDomain: DomainType;
  correctedDomain: DomainType;
  keywords: string[];
  messageSnippet: string;
  timestamp: string;
}

// ── Detection ────────────────────────────────────────────────────────────

/**
 * Domain name aliases — maps natural language to DomainType.
 * "that should have been grove" → grove
 */
const DOMAIN_ALIASES: Record<string, DomainType> = {
  personal: "personal",
  home: "personal",
  private: "personal",
  consulting: "consulting",
  client: "consulting",
  "drum wave": "drumwave",
  drumwave: "drumwave",
  grove: "grove",
  "the grove": "grove",
  research: "grove",
  ai: "grove",
};

/**
 * Patterns that signal a domain correction in Jim's follow-up message.
 * Each regex has a named capture group `domain` for the target domain.
 */
const CORRECTION_PATTERNS = [
  /(?:that |this )?should (?:have been|be) (?:in )?(?<domain>\w[\w\s]*\w|\w+)/i,
  /wrong domain/i,
  /(?:that's|thats|that is) (?<domain>\w[\w\s]*\w|\w+)[,]? not (?:\w[\w\s]*\w|\w+)/i,
  /(?:move|reclassify|change) (?:this |that |it )?to (?<domain>\w[\w\s]*\w|\w+)/i,
  /not (?:\w[\w\s]*\w|\w+)[,]? (?:it's|its|it is) (?<domain>\w[\w\s]*\w|\w+)/i,
];

/**
 * Resolve a natural-language domain reference to a DomainType.
 */
function resolveDomainAlias(raw: string): DomainType | null {
  const normalized = raw.trim().toLowerCase();
  return DOMAIN_ALIASES[normalized] ?? null;
}

/**
 * Detect whether a message contains a domain correction signal.
 * Returns the corrected domain if detected, null otherwise.
 */
export function detectDomainCorrection(
  message: string,
  currentDomain: DomainType,
): DomainCorrection | null {
  // "wrong domain" without specifying target — can't resolve
  if (/wrong domain/i.test(message) && !CORRECTION_PATTERNS.some(p => p !== CORRECTION_PATTERNS[1] && p.test(message))) {
    return null;
  }

  for (const pattern of CORRECTION_PATTERNS) {
    const match = pattern.exec(message);
    if (!match) continue;

    const rawDomain = match.groups?.domain;
    if (!rawDomain) continue;

    const corrected = resolveDomainAlias(rawDomain);
    if (!corrected) continue;

    // Only log if it's actually a change
    if (corrected === currentDomain) continue;

    return { corrected };
  }

  return null;
}

// ── Logging ──────────────────────────────────────────────────────────────

/**
 * Extract up to 5 keywords from a message for Feed multi_select tagging.
 */
function extractKeywords(message: string): string[] {
  const stopwords = new Set([
    "a", "an", "the", "is", "are", "was", "were", "be", "been",
    "being", "have", "has", "had", "do", "does", "did", "will",
    "shall", "would", "should", "may", "might", "must", "can",
    "could", "i", "me", "my", "we", "our", "you", "your", "he",
    "she", "it", "they", "them", "this", "that", "to", "of", "in",
    "for", "on", "with", "at", "by", "from", "as", "into", "about",
    "not", "no", "but", "or", "and", "if", "so", "just", "also",
  ]);

  return message
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, "") // strip URLs
    .replace(/[^a-z0-9\s-]/g, " ")  // strip punctuation
    .split(/\s+/)
    .filter(w => w.length > 2 && !stopwords.has(w))
    .slice(0, 5);
}

/**
 * Log a domain correction to Feed 2.0 for pattern mining.
 *
 * Creates a Feed entry with Request Type = "Correction" so future queries
 * can aggregate corrections by keyword → propose new inference rules.
 */
export async function logDomainCorrection(
  original: DomainType,
  corrected: DomainType,
  keywords: string[],
  messageText: string,
): Promise<void> {
  const apiKey = process.env.NOTION_API_KEY;
  if (!apiKey) {
    console.warn("[correction-logger] NOTION_API_KEY not set, skipping Feed log");
    return;
  }

  const notion = new Client({ auth: apiKey });
  const pillar = derivePillar(corrected);

  const telemetry: CorrectionLogEntry = {
    originalDomain: original,
    correctedDomain: corrected,
    keywords,
    messageSnippet: messageText.substring(0, 200),
    timestamp: new Date().toISOString(),
  };

  try {
    await notion.pages.create({
      parent: { database_id: NOTION_DB.FEED },
      properties: {
        Entry: {
          title: [
            {
              text: {
                content: `Domain correction: ${original} → ${corrected}`,
              },
            },
          ],
        },
        Pillar: {
          select: { name: pillar },
        },
        "Request Type": {
          select: { name: "Correction" },
        },
        Source: {
          select: { name: "Telegram" },
        },
        Author: {
          select: { name: "Atlas [telegram]" },
        },
        Status: {
          select: { name: "Done" },
        },
        Date: {
          date: { start: new Date().toISOString() },
        },
        ...(keywords.length > 0 && {
          Keywords: {
            multi_select: keywords.slice(0, 5).map((k) => ({ name: k })),
          },
        }),
        Notes: {
          rich_text: [
            {
              text: {
                content: JSON.stringify(telemetry, null, 2).substring(0, 2000),
              },
            },
          ],
        },
      },
    });

    console.info(
      `[correction-logger] Logged domain correction: ${original} → ${corrected}`,
    );
  } catch (err) {
    // Fail loud but don't break the conversation — corrections are telemetry
    console.error(
      `[correction-logger] Failed to log correction to Feed: ${err}`,
    );
  }
}

export { extractKeywords };
