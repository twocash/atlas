/**
 * Atlas Procedural UI - Dynamic Use Case Selection
 *
 * Generates dynamic Telegram keyboards based on available prompts
 * from the Atlas System Prompts database in Notion.
 *
 * This enables pillar-specific workflows without hardcoding options:
 * - The Grove: Sprout Generation, Technical Deep Dive
 * - Consulting: Market Analysis, Competitor Research
 * - etc.
 *
 * @see packages/agents/src/services/prompt-manager.ts
 * @see docs/guides/PROMPT_MIGRATION_GUIDE.md
 */

import { Context, InlineKeyboard } from "grammy";
import { logger } from "../logger";
import type { Pillar } from "../conversation/types";

// Lazy import to avoid circular dependencies
let _promptManagerLoaded = false;
let _listUseCases: typeof import("../../../../packages/agents/src").listUseCases | null = null;

/**
 * Lazily load PromptManager to avoid startup issues
 */
async function getListUseCases() {
  if (!_promptManagerLoaded) {
    try {
      const agents = await import("../../../../packages/agents/src");
      _listUseCases = agents.listUseCases;
      _promptManagerLoaded = true;
    } catch (error) {
      logger.warn("[ProceduralUI] Failed to load PromptManager:", error);
      return null;
    }
  }
  return _listUseCases;
}

/**
 * Map Atlas Pillar to PromptPillar
 */
function pillarToPromptPillar(pillar: Pillar): "The Grove" | "Consulting" | "Personal" | "Home/Garage" | "All" {
  switch (pillar) {
    case "The Grove":
      return "The Grove";
    case "Consulting":
      return "Consulting";
    case "Personal":
      return "Personal";
    case "Home/Garage":
      return "Home/Garage";
    default:
      return "All";
  }
}

/**
 * Generate callback data for a use case button
 * Format: "run:{capability}:{pillar}:{useCase}"
 */
function makeCallbackData(capability: string, pillar: string, useCase: string): string {
  // Callback data max is 64 bytes, so we use short keys
  const capShort = capability.replace(/\s+/g, "");
  const pillarShort = pillar.replace(/\s+/g, "").substring(0, 10);
  const useCaseShort = useCase.replace(/\s+/g, "").substring(0, 20);
  return `run:${capShort}:${pillarShort}:${useCaseShort}`;
}

/**
 * Send use case options as an inline keyboard
 *
 * @param ctx - Telegram context
 * @param capability - The capability type (e.g., "Research Agent")
 * @param pillar - The context pillar
 * @param query - Optional: the original query to store for execution
 */
export async function sendUseCaseOptions(
  ctx: Context,
  capability: "Research Agent" | "Voice" | "Classifier" | "Refinery",
  pillar: Pillar,
  query?: string
): Promise<void> {
  const listUseCases = await getListUseCases();

  if (!listUseCases) {
    // Fallback: show default options
    const keyboard = new InlineKeyboard()
      .text("General Research", makeCallbackData(capability, pillar, "General"))
      .row()
      .text("Cancel", "cancel");

    await ctx.reply(
      `Select a <b>${capability}</b> workflow:`,
      { reply_markup: keyboard }
    );
    return;
  }

  try {
    const promptPillar = pillarToPromptPillar(pillar);
    const useCases = await listUseCases(capability as any, promptPillar);

    if (useCases.length === 0) {
      await ctx.reply(
        `No specialized ${capability} workflows found for ${pillar}. Using standard mode.`
      );
      return;
    }

    // Build keyboard with available use cases
    const keyboard = new InlineKeyboard();

    for (const useCase of useCases) {
      keyboard
        .text(useCase, makeCallbackData(capability, pillar, useCase))
        .row();
    }

    // Always add General/Default option
    keyboard
      .text("Standard / Default", makeCallbackData(capability, pillar, "General"))
      .row()
      .text("Cancel", "cancel");

    // Store query in session for later execution
    if (query && ctx.session) {
      (ctx.session as any).pendingQuery = query;
      (ctx.session as any).pendingCapability = capability;
      (ctx.session as any).pendingPillar = pillar;
    }

    await ctx.reply(
      `Select a <b>${capability}</b> workflow for <b>${pillar}</b>:`,
      { reply_markup: keyboard }
    );

    logger.info("[ProceduralUI] Sent use case options", {
      capability,
      pillar,
      useCases: useCases.length,
    });
  } catch (error) {
    logger.error("[ProceduralUI] Failed to fetch use cases:", error);
    await ctx.reply(
      `Error loading workflows. Using standard ${capability} mode.`
    );
  }
}

/**
 * Handle callback from use case selection
 *
 * @param ctx - Telegram context with callback query
 * @returns Object with parsed callback data, or null if not a run callback
 */
export function parseRunCallback(callbackData: string): {
  capability: string;
  pillar: string;
  useCase: string;
} | null {
  if (!callbackData.startsWith("run:")) {
    return null;
  }

  const parts = callbackData.split(":");
  if (parts.length < 4) {
    return null;
  }

  return {
    capability: parts[1],
    pillar: parts[2],
    useCase: parts[3],
  };
}

/**
 * Register procedural UI callback handlers
 *
 * Call this from bot.ts to wire up the dynamic UI handlers.
 */
export function registerProceduralHandlers(bot: any): void {
  // Handle "run:..." callbacks
  bot.callbackQuery(/^run:(.+):(.+):(.+)$/, async (ctx: any) => {
    const parsed = parseRunCallback(ctx.callbackQuery.data);

    if (!parsed) {
      await ctx.answerCallbackQuery({ text: "Invalid callback" });
      return;
    }

    await ctx.answerCallbackQuery();

    // Remove the keyboard
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      // Message might be too old to edit
    }

    const { capability, pillar, useCase } = parsed;

    logger.info("[ProceduralUI] Use case selected", { capability, pillar, useCase });

    // Get pending query from session
    const pendingQuery = (ctx.session as any)?.pendingQuery;

    if (capability === "ResearchAgent" || capability === "Research") {
      await ctx.reply(`Starting <b>${useCase}</b> research...`);

      try {
        // Import and execute research
        const { runResearchAgent } = await import("../../../../packages/agents/src");
        const { registry } = await import("../../../../packages/agents/src");

        // Map pillar back
        let fullPillar: Pillar = "The Grove";
        if (pillar.includes("Consult")) fullPillar = "Consulting";
        else if (pillar.includes("Personal")) fullPillar = "Personal";
        else if (pillar.includes("Home") || pillar.includes("Garage")) fullPillar = "Home/Garage";

        const result = await runResearchAgent(registry, {
          query: pendingQuery || "General research",
          depth: useCase.includes("Deep") ? "deep" : "standard",
          pillar: fullPillar,
          useCase: useCase,
        });

        if (result.result.success) {
          const output = result.result.output as any;
          const summary = output?.summary || result.result.summary || "Research complete.";

          // Truncate for Telegram (max 4096 chars)
          const truncatedSummary = summary.length > 3800
            ? summary.substring(0, 3800) + "\n\n<i>... (truncated)</i>"
            : summary;

          await ctx.reply(truncatedSummary);
        } else {
          await ctx.reply(`Research failed: ${result.result.summary || "Unknown error"}`);
        }
      } catch (error: any) {
        logger.error("[ProceduralUI] Research execution failed:", error);
        await ctx.reply(`Research failed: ${error.message}`);
      }
    } else {
      await ctx.reply(`${capability} workflow "${useCase}" selected. Execution not yet implemented.`);
    }

    // Clear session
    if (ctx.session) {
      delete (ctx.session as any).pendingQuery;
      delete (ctx.session as any).pendingCapability;
      delete (ctx.session as any).pendingPillar;
    }
  });

  // Handle cancel
  bot.callbackQuery("cancel", async (ctx: any) => {
    await ctx.answerCallbackQuery({ text: "Cancelled" });
    try {
      await ctx.editMessageReplyMarkup({ reply_markup: undefined });
    } catch {
      // Message might be too old
    }
    await ctx.reply("Operation cancelled.");
  });

  logger.info("[ProceduralUI] Handlers registered");
}
