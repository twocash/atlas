/**
 * Atlas Telegram Bot - Voice Configuration Health Check
 *
 * Verifies voice profile files are present and loadable at startup.
 * Prevents silent failures when config/voice directory is missing or empty.
 */

import { listVoices, loadVoice, voiceExists } from "../voice-manager";
import { logger } from "../logger";

export interface VoiceHealthResult {
  status: "ok" | "warning" | "critical";
  message: string;
  details?: {
    voiceDir: string;
    voicesFound: string[];
    defaultVoiceExists: boolean;
  };
}

/** The default voice that must exist for the system to work */
const DEFAULT_VOICE = "grove";

/**
 * Verify voice configuration is healthy
 *
 * - Critical: Default voice is missing (system won't work correctly)
 * - Warning: Voice directory is empty (interactive selection will be disabled)
 * - OK: Voices found and default exists
 */
export async function verifyVoiceConfig(): Promise<VoiceHealthResult> {
  try {
    // List all available voices
    const voices = await listVoices();
    const voiceIds = voices.map((v) => v.id);

    // Check if default voice exists
    const defaultExists = await voiceExists(DEFAULT_VOICE);

    // Also verify we can actually load the default voice content
    let defaultLoadable = false;
    if (defaultExists) {
      const content = await loadVoice(DEFAULT_VOICE);
      defaultLoadable = content !== null && content.length > 0;
    }

    // Determine status
    if (!defaultLoadable) {
      logger.error("Voice health check CRITICAL: Default voice not loadable", {
        defaultVoice: DEFAULT_VOICE,
        defaultExists,
      });
      return {
        status: "critical",
        message: `Default voice '${DEFAULT_VOICE}' is missing or empty. Voice-driven research will not work correctly.`,
        details: {
          voiceDir: "config/voice/",
          voicesFound: voiceIds,
          defaultVoiceExists: defaultExists,
        },
      };
    }

    if (voices.length === 0) {
      logger.warn("Voice health check WARNING: No voice profiles found");
      return {
        status: "warning",
        message: "No voice profiles found. Interactive voice selection will be disabled.",
        details: {
          voiceDir: "config/voice/",
          voicesFound: [],
          defaultVoiceExists: false,
        },
      };
    }

    logger.info("Voice health check OK", {
      voicesFound: voiceIds.length,
      defaultVoice: DEFAULT_VOICE,
    });

    return {
      status: "ok",
      message: `Voice profiles loaded: ${voiceIds.join(", ")}`,
      details: {
        voiceDir: "config/voice/",
        voicesFound: voiceIds,
        defaultVoiceExists: true,
      },
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    logger.error("Voice health check failed", { error: message });

    return {
      status: "critical",
      message: `Voice configuration check failed: ${message}`,
    };
  }
}

/**
 * Run voice health check at startup and log results
 * Call this from bot initialization
 */
export async function runVoiceHealthCheck(): Promise<boolean> {
  const result = await verifyVoiceConfig();

  if (result.status === "critical") {
    console.error(`\n❌ VOICE CHECK CRITICAL: ${result.message}\n`);
    return false;
  }

  if (result.status === "warning") {
    console.warn(`\n⚠️ VOICE CHECK WARNING: ${result.message}\n`);
    return true; // Allow startup but warn
  }

  console.log(`✅ Voice profiles: ${result.details?.voicesFound.join(", ")}`);
  return true;
}
