/**
 * Atlas Telegram Bot - Voice Manager
 *
 * Manages voice profile files for research agent output styling.
 * Voice files are stored in apps/telegram/config/voice/*.md
 */

import { readdirSync } from "node:fs";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger";
// Lazy-loaded to avoid pulling @notionhq/client into test environments
// where it causes "Missing 'default' export in module 'node:fs/promises'" errors
let _getPromptManager: typeof import("../../../packages/agents/src/services/prompt-manager").getPromptManager | null = null;
async function lazyGetPromptManager() {
  if (!_getPromptManager) {
    const mod = await import("../../../packages/agents/src/services/prompt-manager");
    _getPromptManager = mod.getPromptManager;
  }
  return _getPromptManager();
}

// Get the directory of THIS file (voice-manager.ts), not the entry point
// import.meta.url gives file:///path/to/voice-manager.ts
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Relative to src/voice-manager.ts → ../config/voice/
const VOICE_DIR = path.resolve(__dirname, "../config/voice");

/**
 * Voice profile metadata
 */
export interface VoiceProfile {
  /** Filename without .md extension (e.g., 'grove') */
  id: string;
  /** Display name (e.g., 'Grove') */
  name: string;
}

/**
 * Files to exclude from voice listing
 */
const EXCLUDED_FILES = ["editorial_memory.md"];

/**
 * Maps filesystem voice IDs to Notion PromptManager IDs.
 * Filesystem: grove.md → id "grove"
 * Notion: prompt ID "voice.grove-analytical"
 *
 * Voices without a mapping (e.g., "personal") are filesystem-only.
 */
const FILESYSTEM_TO_NOTION_ID: Record<string, string> = {
  grove: "voice.grove-analytical",
  linkedin: "voice.linkedin-punchy",
  consulting: "voice.consulting",
};

/**
 * List all available voice profiles from the config/voice directory
 *
 * @returns Array of voice profiles sorted alphabetically
 */
export async function listVoices(): Promise<VoiceProfile[]> {
  try {
    logger.info("Listing voices from directory", { voiceDir: VOICE_DIR });
    const files = readdirSync(VOICE_DIR, { encoding: "utf-8" });
    logger.info("Found voice files", { files });

    return files
      .filter((f) => f.endsWith(".md") && !EXCLUDED_FILES.includes(f))
      .map((f) => {
        const id = f.replace(".md", "");
        // Convert to display name: grove -> Grove, linkedin -> Linkedin
        const name = id
          .split("-")
          .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
          .join(" ");
        return { id, name };
      })
      .sort((a, b) => a.id.localeCompare(b.id));
  } catch (error) {
    logger.error("Failed to list voices", { error, voiceDir: VOICE_DIR, errorMessage: (error as Error).message });
    return [];
  }
}

/**
 * Load voice instructions from a voice profile.
 *
 * Resolution order:
 * 1. PromptManager (Notion) via mapped ID — Notion-tunable, preferred
 * 2. Filesystem fallback (config/voice/*.md) — hardcoded, LOUD about it
 *
 * @param voiceId - The voice ID (filename without .md extension, e.g. "grove")
 * @returns Voice instructions content, or null if not found
 */
export async function loadVoice(voiceId: string): Promise<string | null> {
  // Sanitize to prevent path traversal attacks
  const safeId = voiceId.replace(/[^a-z0-9_-]/gi, "");

  if (safeId !== voiceId) {
    logger.warn("Voice ID sanitized", { original: voiceId, sanitized: safeId });
  }

  // Try PromptManager (Notion) first if a mapping exists
  const notionId = FILESYSTEM_TO_NOTION_ID[safeId];
  if (notionId) {
    try {
      const pm = await lazyGetPromptManager();
      const content = await pm.getPromptById(notionId);
      if (content) {
        logger.info("Loaded voice from PromptManager (Notion)", { voiceId: safeId, notionId, length: content.length });
        return content;
      }
      // Notion returned null — fall through to filesystem with loud error
      logger.error("VOICE MANAGER: PromptManager returned null for mapped voice — falling back to filesystem", {
        voiceId: safeId,
        notionId,
        fix: [
          `1. Verify Notion prompts DB has entry with ID="${notionId}"`,
          '2. Run seed migration: bun run apps/telegram/data/migrations/seed-prompts.ts',
          '3. Check NOTION_PROMPTS_DB_ID is set in .env',
        ],
      });
    } catch (err) {
      logger.error("VOICE MANAGER: PromptManager threw for voice lookup — falling back to filesystem", {
        voiceId: safeId,
        notionId,
        error: err,
        fix: [
          '1. Check NOTION_PROMPTS_DB_ID env var is set',
          `2. Verify Notion DB has entry with ID="${notionId}"`,
          '3. Check network connectivity to Notion API',
        ],
      });
    }
  }

  // Filesystem fallback (or filesystem-only voices like "personal")
  const filePath = path.join(VOICE_DIR, `${safeId}.md`);
  try {
    const content = (await Bun.file(filePath).text()).replace(/\r/g, "");
    if (notionId) {
      // Had a mapping but Notion failed — this is a fallback, not normal
      logger.warn("Loaded voice from FILESYSTEM fallback (Notion failed)", { voiceId: safeId, length: content.length });
    } else {
      logger.debug("Loaded voice from filesystem (no Notion mapping)", { voiceId: safeId, length: content.length });
    }
    return content;
  } catch (error) {
    logger.error("VOICE MANAGER: Voice not found in PromptManager OR filesystem", {
      voiceId: safeId,
      notionId: notionId || 'NO MAPPING',
      filePath,
      fix: [
        `1. Create file: config/voice/${safeId}.md`,
        notionId ? `2. Or add Notion prompt with ID="${notionId}"` : '2. Or add a FILESYSTEM_TO_NOTION_ID mapping + Notion entry',
      ],
    });
    return null;
  }
}

/**
 * Check if a voice profile exists
 *
 * @param voiceId - The voice ID to check
 * @returns true if the voice profile exists
 */
export async function voiceExists(voiceId: string): Promise<boolean> {
  const safeId = voiceId.replace(/[^a-z0-9_-]/gi, "");
  const filePath = path.join(VOICE_DIR, `${safeId}.md`);
  return Bun.file(filePath).exists();
}
