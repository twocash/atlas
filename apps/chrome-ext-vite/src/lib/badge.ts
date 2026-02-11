/**
 * Atlas Chrome Extension - Badge Feedback
 *
 * Provides visual feedback via extension badge during capture operations.
 */

type BadgeState = 'idle' | 'capturing' | 'success' | 'error';

const BADGE_CONFIG: Record<BadgeState, { text: string; color: string }> = {
  idle: { text: '', color: '#666666' },
  capturing: { text: '...', color: '#FFA500' },  // Orange
  success: { text: '\u2713', color: '#22C55E' }, // Green checkmark ✓
  error: { text: '!', color: '#EF4444' },        // Red
};

let clearTimeoutId: ReturnType<typeof setTimeout> | null = null;

/**
 * Set badge state with optional auto-clear duration
 */
export function setBadge(state: BadgeState, duration?: number): void {
  const config = BADGE_CONFIG[state];

  chrome.action.setBadgeText({ text: config.text });
  chrome.action.setBadgeBackgroundColor({ color: config.color });

  if (clearTimeoutId) {
    clearTimeout(clearTimeoutId);
    clearTimeoutId = null;
  }

  // Auto-clear for success/error states
  if (duration || state === 'success' || state === 'error') {
    clearTimeoutId = setTimeout(() => setBadge('idle'), duration || 3000);
  }
}

/**
 * Show "capturing" state (orange ...)
 */
export const showCapturing = (): void => setBadge('capturing');

/**
 * Show "success" state (green checkmark, clears after 3s)
 */
export const showSuccess = (): void => setBadge('success', 3000);

/**
 * Show "error" state (red !, clears after 5s)
 */
export const showError = (): void => setBadge('error', 5000);
