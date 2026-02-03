/**
 * Telegram Helper Utilities
 *
 * Common utilities for safe Telegram API interactions.
 */

import type { Context } from 'grammy';
import { GrammyError } from 'grammy';
import { logger } from '../logger';

/**
 * Safely answer a callback query with fallback to regular message.
 *
 * Telegram callback queries expire after ~30 seconds. If the user clicks
 * an old button or there's processing delay, answerCallbackQuery() will fail
 * with error 400. This helper catches that error and falls back to sending
 * a regular reply message so the user always gets feedback.
 *
 * @param ctx - Grammy context
 * @param text - Text to show (toast for callback, message for fallback)
 * @param options - Additional options
 * @returns true if callback was answered, false if fallback was used
 */
export async function safeAnswerCallback(
  ctx: Context,
  text: string,
  options?: {
    /** If true, don't send fallback message on failure (silent fail) */
    silent?: boolean;
    /** Custom fallback message (defaults to text) */
    fallbackMessage?: string;
    /** Show alert instead of toast */
    showAlert?: boolean;
  }
): Promise<boolean> {
  try {
    await ctx.answerCallbackQuery({
      text,
      show_alert: options?.showAlert
    });
    return true;
  } catch (err) {
    // Check if it's a callback timeout error (400 = bad request, query too old)
    if (err instanceof GrammyError && err.error_code === 400) {
      logger.warn('Callback query expired, using fallback message', {
        text,
        queryId: ctx.callbackQuery?.id
      });

      // Send a regular message instead (unless silent mode)
      if (!options?.silent) {
        const fallback = options?.fallbackMessage || `⏱️ ${text}`;
        try {
          await ctx.reply(fallback);
        } catch (replyErr) {
          logger.error('Failed to send fallback message', { error: replyErr });
        }
      }
      return false;
    }

    // Re-throw unexpected errors
    throw err;
  }
}

/**
 * Safely answer callback with no text (just acknowledge)
 */
export async function safeAcknowledgeCallback(ctx: Context): Promise<boolean> {
  try {
    await ctx.answerCallbackQuery();
    return true;
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 400) {
      logger.warn('Callback query expired (acknowledge)', {
        queryId: ctx.callbackQuery?.id
      });
      return false;
    }
    throw err;
  }
}
