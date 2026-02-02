/**
 * Atlas Telegram Bot - Voice Manager
 *
 * Manages voice profile files for research agent output styling.
 * Voice files are stored in apps/telegram/config/voice/*.md
 */

import fs from "fs/promises";
import path from "path";
import { fileURLToPath } from "url";
import { logger } from "./logger";

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
 * List all available voice profiles from the config/voice directory
 *
 * @returns Array of voice profiles sorted alphabetically
 */
export async function listVoices(): Promise<VoiceProfile[]> {
  try {
    logger.info("Listing voices from directory", { voiceDir: VOICE_DIR });
    const files = await fs.readdir(VOICE_DIR);
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
 * Load voice instructions from a voice profile file
 *
 * @param voiceId - The voice ID (filename without .md extension)
 * @returns Voice instructions content, or null if not found
 */
export async function loadVoice(voiceId: string): Promise<string | null> {
  // Sanitize to prevent path traversal attacks
  const safeId = voiceId.replace(/[^a-z0-9_-]/gi, "");

  if (safeId !== voiceId) {
    logger.warn("Voice ID sanitized", { original: voiceId, sanitized: safeId });
  }

  const filePath = path.join(VOICE_DIR, `${safeId}.md`);

  try {
    const content = await fs.readFile(filePath, "utf-8");
    logger.debug("Loaded voice profile", { voiceId: safeId, length: content.length });
    return content;
  } catch (error) {
    logger.debug("Voice profile not found", { voiceId: safeId, filePath });
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

  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}
