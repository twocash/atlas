/**
 * Atlas Daily Briefing
 *
 * Scheduled Telegram briefings at 7am, 12:30pm, 6pm ET.
 * Surfaces blocked items, due dates, active work, and feed pending count.
 *
 * @example
 * ```typescript
 * import { initBriefings } from "./briefing";
 *
 * // In bot startup
 * const briefingSystem = await initBriefings(bot.api, ALLOWED_USERS[0]);
 *
 * // Optional: manual trigger
 * await briefingSystem.sendNow();
 * ```
 */

import type { Api } from "grammy";
import { logger } from "../logger";
import { fetchBriefingData } from "./queries";
import { formatBriefing, getBriefingTime } from "./formatter";
import { createBriefingScheduler, getNextBriefingTimeET } from "./scheduler";
import type { BriefingScheduler } from "./scheduler";

// ==========================================
// Types
// ==========================================

export interface BriefingSystem {
  /** Start the scheduler */
  start: () => void;
  /** Stop the scheduler */
  stop: () => void;
  /** Send a briefing immediately */
  sendNow: () => Promise<void>;
  /** Get next scheduled briefing time */
  getNextBriefingTime: () => Date | null;
  /** Get status info */
  getStatus: () => BriefingStatus;
}

export interface BriefingStatus {
  isRunning: boolean;
  nextBriefing: Date | null;
  lastSent: Date | null;
  briefingsSent: number;
}

// ==========================================
// Briefing System Factory
// ==========================================

/**
 * Initialize the briefing system
 *
 * @param api - Telegram bot API
 * @param chatId - Chat ID to send briefings to (usually Jim's user ID)
 */
export function initBriefings(api: Api, chatId: number): BriefingSystem {
  let isRunning = false;
  let lastSent: Date | null = null;
  let briefingsSent = 0;
  let scheduler: BriefingScheduler | null = null;

  /**
   * Send a briefing to Telegram
   */
  async function sendBriefing(label: string): Promise<void> {
    try {
      logger.info(`Fetching briefing data for ${label} briefing`);

      // Fetch all data from Notion
      const data = await fetchBriefingData();

      // Determine briefing time based on label
      const briefingTime = label as "morning" | "midday" | "evening";

      // Format the message
      const message = formatBriefing(data, briefingTime);

      // Send to Telegram
      await api.sendMessage(chatId, message);

      lastSent = new Date();
      briefingsSent++;

      logger.info(`${label} briefing sent successfully`, {
        blocked: data.blocked.length,
        due: data.dueThisWeek.length,
        active: data.active.length,
        completed: data.completedYesterday.length,
        feedPending: data.feedPendingCount,
      });
    } catch (error) {
      logger.error(`Failed to send ${label} briefing`, { error });
      throw error;
    }
  }

  // Create scheduler
  scheduler = createBriefingScheduler(sendBriefing);

  return {
    start(): void {
      if (isRunning) {
        logger.warn("Briefing system already running");
        return;
      }
      scheduler?.start();
      isRunning = true;
      logger.info("Briefing system started");
    },

    stop(): void {
      scheduler?.stop();
      isRunning = false;
      logger.info("Briefing system stopped");
    },

    async sendNow(): Promise<void> {
      const { hour } = getEasternHourMinute();
      let label = "morning";
      if (hour >= 10 && hour < 15) label = "midday";
      else if (hour >= 15) label = "evening";

      await sendBriefing(label);
    },

    getNextBriefingTime(): Date | null {
      return scheduler?.getNextBriefingTime() || null;
    },

    getStatus(): BriefingStatus {
      return {
        isRunning,
        nextBriefing: scheduler?.getNextBriefingTime() || null,
        lastSent,
        briefingsSent,
      };
    },
  };
}

/**
 * Get hour in Eastern Time (helper for external use)
 */
function getEasternHourMinute(): { hour: number; minute: number } {
  const now = new Date();
  const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  const et = new Date(etString);
  return {
    hour: et.getHours(),
    minute: et.getMinutes(),
  };
}

// ==========================================
// Exports
// ==========================================

export { fetchBriefingData } from "./queries";
export { formatBriefing, getBriefingTime } from "./formatter";
export { getNextBriefingTimeET } from "./scheduler";
export type { BriefingData, BriefingItem } from "./queries";
