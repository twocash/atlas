/**
 * Atlas Daily Briefing - Message Formatter
 *
 * Builds clean Telegram messages from briefing data.
 */

import type { BriefingData, BriefingItem } from "./queries";

// ==========================================
// Time-of-Day Labels
// ==========================================

type BriefingTime = "morning" | "midday" | "evening";

const BRIEFING_LABELS: Record<BriefingTime, { emoji: string; greeting: string }> = {
  morning: { emoji: "☀️", greeting: "Morning Briefing" },
  midday: { emoji: "🌤️", greeting: "Midday Check-in" },
  evening: { emoji: "🌙", greeting: "Evening Wrap-up" },
};

/**
 * Determine briefing type based on current hour (ET)
 */
export function getBriefingTime(hour: number): BriefingTime {
  if (hour < 10) return "morning";
  if (hour < 15) return "midday";
  return "evening";
}

// ==========================================
// Message Formatting
// ==========================================

/**
 * Format briefing data into a Telegram message
 */
export function formatBriefing(data: BriefingData, briefingTime: BriefingTime): string {
  const { emoji, greeting } = BRIEFING_LABELS[briefingTime];
  const dateStr = formatDate(data.queriedAt);

  const sections: string[] = [];

  // Header
  sections.push(`${emoji} Atlas ${greeting} — ${dateStr}`);

  // Blocked items (urgent - needs attention)
  if (data.blocked.length > 0) {
    sections.push(formatBlockedSection(data.blocked));
  }

  // Due this week
  if (data.dueThisWeek.length > 0) {
    sections.push(formatDueSection(data.dueThisWeek));
  }

  // Active work
  if (data.active.length > 0) {
    sections.push(formatActiveSection(data.active));
  }

  // Completed yesterday (morning briefing only shows this prominently)
  if (data.completedYesterday.length > 0 && briefingTime === "morning") {
    sections.push(formatCompletedSection(data.completedYesterday));
  }

  // Feed pending count
  if (data.feedPendingCount > 0) {
    sections.push(`📥 FEED (pending): ${data.feedPendingCount} item${data.feedPendingCount === 1 ? "" : "s"}`);
  }

  // Pending skill proposals (if any)
  if (data.pendingSkills && data.pendingSkills > 0) {
    sections.push(`🔧 SKILLS: ${data.pendingSkills} pending proposal${data.pendingSkills === 1 ? "" : "s"}\n   /skills pending to review`);
  }

  // If nothing to report
  if (sections.length === 1) {
    sections.push("✨ All clear! No blocked items, nothing due soon.");
  }

  // Footer
  sections.push("—\nReply /status for full queue");

  return sections.join("\n\n");
}

/**
 * Format blocked items section
 */
function formatBlockedSection(items: BriefingItem[]): string {
  const lines = ["🔴 BLOCKED (needs you):"];

  for (const item of items.slice(0, 5)) {
    let line = `• ${item.title}`;
    if (item.blockedReason) {
      line += ` — ${truncate(item.blockedReason, 40)}`;
    }
    if (item.daysSinceBlocked !== undefined && item.daysSinceBlocked > 0) {
      line += ` (${item.daysSinceBlocked}d)`;
    }
    lines.push(line);
  }

  if (items.length > 5) {
    lines.push(`  + ${items.length - 5} more`);
  }

  return lines.join("\n");
}

/**
 * Format due this week section
 */
function formatDueSection(items: BriefingItem[]): string {
  const lines = ["📅 DUE THIS WEEK:"];

  for (const item of items.slice(0, 5)) {
    let line = `• ${item.title}`;
    if (item.dueDate) {
      line += ` — ${formatDayOfWeek(item.dueDate)}`;
    }
    lines.push(line);
  }

  if (items.length > 5) {
    lines.push(`  + ${items.length - 5} more`);
  }

  return lines.join("\n");
}

/**
 * Format active items section
 */
function formatActiveSection(items: BriefingItem[]): string {
  const lines = ["🏃 ACTIVE (in progress):"];

  for (const item of items.slice(0, 5)) {
    let line = `• ${item.title}`;
    if (item.progress !== undefined) {
      line += ` — ${item.progress}% complete`;
    }
    lines.push(line);
  }

  if (items.length > 5) {
    lines.push(`  + ${items.length - 5} more`);
  }

  return lines.join("\n");
}

/**
 * Format completed yesterday section
 */
function formatCompletedSection(items: BriefingItem[]): string {
  const lines = ["✅ COMPLETED YESTERDAY:"];

  for (const item of items.slice(0, 5)) {
    lines.push(`• ${item.title}`);
  }

  if (items.length > 5) {
    lines.push(`  + ${items.length - 5} more`);
  }

  return lines.join("\n");
}

// ==========================================
// Helper Functions
// ==========================================

/**
 * Format date as "Thu Jan 30"
 */
function formatDate(date: Date): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

  return `${days[date.getDay()]} ${months[date.getMonth()]} ${date.getDate()}`;
}

/**
 * Format day of week from date
 */
function formatDayOfWeek(date: Date): string {
  const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
  const today = new Date();
  const tomorrow = new Date(today.getTime() + 24 * 60 * 60 * 1000);

  if (isSameDay(date, today)) return "Today";
  if (isSameDay(date, tomorrow)) return "Tomorrow";

  return days[date.getDay()];
}

/**
 * Check if two dates are the same day
 */
function isSameDay(d1: Date, d2: Date): boolean {
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  );
}

/**
 * Truncate text to max length
 */
function truncate(text: string, maxLength: number): string {
  if (text.length <= maxLength) return text;
  return text.substring(0, maxLength - 3) + "...";
}
