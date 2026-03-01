/**
 * Atlas Telegram Bot - Voice Selection Callback Handler
 *
 * Handles inline keyboard callbacks for research voice selection.
 * When user selects a voice, loads the voice file and executes research.
 */

import type { Context } from "grammy";
import { logger } from "../logger";
import { retrieve } from "../pending-research";
import { loadVoice } from "../voice-manager";
import {
  runResearchAgentWithNotifications,
  sendCompletionNotification,
} from "../services/research-executor";
import {
  createResearchWorkItem,
  type ResearchConfig,
  EVIDENCE_PRESETS,
  type ResearchConfigV2,
  type QualityFloor,
  inferDomainSync,
  derivePillar,
} from "../../../../packages/agents/src";

/**
 * Handle voice selection callback from inline keyboard
 *
 * Callback data format: voice:<requestId>:<voiceId>
 * - voice:abc123:grove - Select grove voice
 * - voice:abc123:cancel - Cancel research
 */
export async function handleVoiceCallback(ctx: Context): Promise<void> {
  const data = ctx.callbackQuery?.data;
  if (!data?.startsWith("voice:")) return;

  const parts = data.split(":");
  if (parts.length < 3) {
    await ctx.answerCallbackQuery({ text: "Invalid callback data" });
    return;
  }

  const [, requestId, voiceId] = parts;

  // Acknowledge the callback immediately
  await ctx.answerCallbackQuery();

  // Try to delete the keyboard message
  try {
    await ctx.deleteMessage();
  } catch {
    // Ignore if already deleted or can't delete
  }

  // Handle cancel
  if (voiceId === "cancel") {
    await ctx.reply("❌ Research cancelled.");
    return;
  }

  // Retrieve pending research request
  const pending = retrieve(requestId);
  if (!pending) {
    await ctx.reply(
      "⚠️ Request expired. Please try again.\n\n" +
      "Voice selection times out after 5 minutes."
    );
    return;
  }

  // Load voice file
  const voiceContent = await loadVoice(voiceId);
  if (!voiceContent) {
    await ctx.reply(`⚠️ Voice file '${voiceId}.md' not found.`);
    return;
  }

  const chatId = ctx.chat?.id;
  if (!chatId) {
    logger.error("No chat ID in voice callback");
    return;
  }

  // Depth descriptions for user feedback
  const depthDescriptions: Record<string, string> = {
    light: "Quick overview (~2k tokens, 2-3 sources)",
    standard: "Thorough analysis (~8k tokens, 5-8 sources)",
    deep: "Academic rigor (~25k tokens, 10+ sources, Chicago citations)",
  };

  try {
    // Create a new Work Queue item for this research
    const { pageId: workItemId, url: notionUrl } = await createResearchWorkItem({
      query: pending.query,
      depth: pending.depth,
      focus: pending.focus,
    });

    // Send confirmation with voice and Notion link
    await ctx.reply(
      `🚀 Starting research with <b>${voiceId}</b> voice...\n\n` +
      `Query: "${pending.query}"\n` +
      `Depth: ${pending.depth} — ${depthDescriptions[pending.depth] || ""}\n` +
      `${pending.focus ? `Focus: ${pending.focus}\n` : ""}` +
      `\n📝 Notion: ${notionUrl}`,
      { parse_mode: "HTML" }
    );

    // Build config — V2 enriched with inferred defaults (Sprint B: Intent Normalization)
    const voiceDepth = pending.depth || 'standard';
    const inferredDomain = inferDomainSync(pending.query);
    const inferredPillar = derivePillar(inferredDomain);
    const qualityFloor: QualityFloor = voiceDepth === 'deep' ? 'grove_grade'
      : voiceDepth === 'standard' ? 'primary_sources' : 'any';

    const config: ResearchConfigV2 = {
      query: pending.query,
      depth: voiceDepth,
      focus: pending.focus,
      voice: "custom",
      voiceInstructions: voiceContent,
      // V2 inferred defaults — parity with Socratic-resolved path
      pillar: inferredPillar,
      queryMode: 'canonical',
      sourceType: 'command',
      intent: 'explore',
      evidenceRequirements: EVIDENCE_PRESETS[voiceDepth],
      qualityFloor,
      userDirection: pending.query,
    };

    // Execute research (V2 enriched config)
    const { agent, result, assessment } = await runResearchAgentWithNotifications(
      config,
      chatId,
      ctx.api,
      workItemId,
      'voice-research-v2'
    );

    // Send completion notification
    await sendCompletionNotification(ctx.api, chatId, agent, result, notionUrl, 'voice-research-v2', assessment);
  } catch (error) {
    const msg = error instanceof Error ? error.message : "Unknown error";
    logger.error("Voice callback research failed", {
      error,
      requestId,
      voiceId,
      query: pending.query,
    });
    await ctx.reply(`❌ Research failed: ${msg}`);
  }
}
