/**
 * Atlas Daily Briefing - Scheduler
 *
 * Schedules briefings at 7am, 12:30pm, and 6pm Eastern Time.
 * Uses setInterval with timezone-aware scheduling.
 */

import { logger } from "../logger";

// ==========================================
// Types
// ==========================================

export interface ScheduledBriefing {
  hour: number;
  minute: number;
  label: string;
}

export interface BriefingScheduler {
  start: () => void;
  stop: () => void;
  getNextBriefingTime: () => Date | null;
  triggerNow: () => Promise<void>;
}

// ==========================================
// Schedule Configuration
// ==========================================

// Briefing times in ET (Eastern Time)
const BRIEFING_SCHEDULE: ScheduledBriefing[] = [
  { hour: 7, minute: 0, label: "morning" },
  { hour: 12, minute: 30, label: "midday" },
  { hour: 18, minute: 0, label: "evening" },
];

// Check every minute for scheduled briefings
const CHECK_INTERVAL_MS = 60 * 1000;

// ==========================================
// Timezone Utilities
// ==========================================

/**
 * Get current time in Eastern Time
 * Handles EST/EDT automatically
 */
function getEasternTime(): Date {
  // Create a date string in ET timezone
  const now = new Date();
  const etString = now.toLocaleString("en-US", { timeZone: "America/New_York" });
  return new Date(etString);
}

/**
 * Get hour and minute in Eastern Time
 */
function getEasternHourMinute(): { hour: number; minute: number } {
  const et = getEasternTime();
  return {
    hour: et.getHours(),
    minute: et.getMinutes(),
  };
}

/**
 * Calculate next briefing time in local time
 */
export function getNextBriefingTimeET(): { time: Date; label: string } | null {
  const { hour, minute } = getEasternHourMinute();
  const currentMinutes = hour * 60 + minute;

  // Find next scheduled briefing
  for (const briefing of BRIEFING_SCHEDULE) {
    const briefingMinutes = briefing.hour * 60 + briefing.minute;
    if (briefingMinutes > currentMinutes) {
      // This briefing is later today
      const now = new Date();
      const etNow = getEasternTime();
      const msUntilBriefing = (briefingMinutes - currentMinutes) * 60 * 1000;
      return {
        time: new Date(now.getTime() + msUntilBriefing),
        label: briefing.label,
      };
    }
  }

  // All briefings for today have passed, next is tomorrow morning
  const now = new Date();
  const etNow = getEasternTime();
  const firstBriefing = BRIEFING_SCHEDULE[0];
  const currentMinutesToday = hour * 60 + minute;
  const firstBriefingMinutes = firstBriefing.hour * 60 + firstBriefing.minute;
  const minutesUntilTomorrow = (24 * 60 - currentMinutesToday) + firstBriefingMinutes;

  return {
    time: new Date(now.getTime() + minutesUntilTomorrow * 60 * 1000),
    label: firstBriefing.label,
  };
}

// ==========================================
// Scheduler Factory
// ==========================================

/**
 * Create a briefing scheduler
 *
 * @param onBriefing - Callback when it's time to send a briefing
 */
export function createBriefingScheduler(
  onBriefing: (label: string) => Promise<void>
): BriefingScheduler {
  let intervalId: ReturnType<typeof setInterval> | null = null;
  let lastTriggeredMinute: number = -1;

  /**
   * Check if we should trigger a briefing now
   */
  function checkSchedule(): void {
    const { hour, minute } = getEasternHourMinute();
    const currentMinutes = hour * 60 + minute;

    // Avoid double-triggering in the same minute
    if (currentMinutes === lastTriggeredMinute) {
      return;
    }

    // Check each scheduled briefing
    for (const briefing of BRIEFING_SCHEDULE) {
      const briefingMinutes = briefing.hour * 60 + briefing.minute;

      if (currentMinutes === briefingMinutes) {
        lastTriggeredMinute = currentMinutes;
        logger.info(`Triggering ${briefing.label} briefing`, {
          hour,
          minute,
          label: briefing.label,
        });

        onBriefing(briefing.label).catch((error) => {
          logger.error(`Failed to send ${briefing.label} briefing`, { error });
        });

        break;
      }
    }
  }

  return {
    /**
     * Start the scheduler
     */
    start(): void {
      if (intervalId) {
        logger.warn("Briefing scheduler already running");
        return;
      }

      logger.info("Starting briefing scheduler", {
        schedule: BRIEFING_SCHEDULE.map((b) => `${b.hour}:${b.minute.toString().padStart(2, "0")} ET`),
      });

      // Check immediately on start
      checkSchedule();

      // Then check every minute
      intervalId = setInterval(checkSchedule, CHECK_INTERVAL_MS);
    },

    /**
     * Stop the scheduler
     */
    stop(): void {
      if (intervalId) {
        clearInterval(intervalId);
        intervalId = null;
        logger.info("Briefing scheduler stopped");
      }
    },

    /**
     * Get next scheduled briefing time
     */
    getNextBriefingTime(): Date | null {
      const next = getNextBriefingTimeET();
      return next?.time || null;
    },

    /**
     * Trigger a briefing immediately (for /briefing now command)
     */
    async triggerNow(): Promise<void> {
      const { hour } = getEasternHourMinute();
      let label = "morning";
      if (hour >= 10 && hour < 15) label = "midday";
      else if (hour >= 15) label = "evening";

      await onBriefing(label);
    },
  };
}
