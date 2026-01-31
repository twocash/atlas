/**
 * Atlas Telegram Bot - Claude Integration
 * 
 * Sends messages to Claude for processing with SPARKS.md context.
 * 
 * @see IMPLEMENTATION.md Sprint 1.3 for requirements
 * 
 * NOTE: This is a stub implementation. Full Claude Agent SDK integration
 * will be implemented in Sprint 2.3 when we wire up proper classification.
 * For now, we use direct API calls with the SPARKS.md context.
 */

import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "fs";
import { join } from "path";
import type {
  ClassificationResult,
  UrlContent,
  MessageIntent,
  IntentDetectionResult,
  IntentEntities,
} from "./types";
import { logger } from "./logger";

// Initialize Anthropic client
const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

// Load SPARKS.md for classification context
const WORKSPACE_DIR = process.env.CLAUDE_WORKING_DIR || "./workspace";
let sparksContext: string = "";
let atlasIdentity: string = "";

try {
  sparksContext = readFileSync(join(WORKSPACE_DIR, "SPARKS.md"), "utf-8");
  atlasIdentity = readFileSync(join(WORKSPACE_DIR, "CLAUDE.md"), "utf-8");
  logger.info("Loaded workspace context files");
} catch (error) {
  logger.warn("Could not load workspace context files", { error });
}

/**
 * System prompt for Atlas classification
 */
const CLASSIFICATION_SYSTEM_PROMPT = `${atlasIdentity}

---

## Classification Framework

${sparksContext}

---

## Your Task

You are classifying a spark (raw input) from Jim. Analyze the content and return a JSON classification with these fields:

- pillar: One of "The Grove", "Personal", "Consulting", "Home"
- intent: One of "Research", "Catalog", "Build", "Content", "Reference", "Task", "Question"
- confidence: Number 0-100 representing classification confidence
- reasoning: Brief explanation (1-2 sentences) of why you classified this way
- tags: Array of relevant tags (e.g., ["ai-tools", "research"])
- suggestedTitle: A concise title for the Feed entry (max 100 chars)

Return ONLY valid JSON, no markdown formatting or explanation outside the JSON.
`;

/**
 * Classify a spark using Claude
 */
export async function classifyWithClaude(
  message: string,
  urlContent?: UrlContent
): Promise<ClassificationResult> {
  logger.debug("Sending to Claude for classification", { 
    message: message.substring(0, 100),
    hasUrl: !!urlContent 
  });

  // Build the user message with context
  let userMessage = `Classify this spark from Jim:\n\n`;
  
  if (urlContent) {
    userMessage += `URL: ${urlContent.url}\n`;
    userMessage += `Title: ${urlContent.title}\n`;
    userMessage += `Description: ${urlContent.description}\n`;
    userMessage += `Content snippet: ${urlContent.bodySnippet.substring(0, 500)}\n\n`;
  }
  
  userMessage += `Jim's message: "${message}"`;

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: CLASSIFICATION_SYSTEM_PROMPT,
      messages: [
        { role: "user", content: userMessage }
      ],
    });

    // Extract text content
    const textContent = response.content.find(block => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    // Parse JSON response
    const jsonText = textContent.text.trim();
    const result = JSON.parse(jsonText) as ClassificationResult;

    logger.info("Claude classification complete", {
      pillar: result.pillar,
      intent: result.intent,
      confidence: result.confidence,
    });

    return result;
  } catch (error) {
    logger.error("Claude classification failed", { error });
    
    // Return low-confidence fallback
    return {
      pillar: "The Grove",
      intent: "Reference",
      confidence: 30,
      reasoning: "Classification failed, defaulting to Grove reference. Please clarify.",
      tags: [],
      suggestedTitle: message.substring(0, 100),
    };
  }
}

/**
 * Generate a response message for general chat
 */
export async function generateResponse(
  message: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
  logger.debug("Generating response", { message: message.substring(0, 100) });

  const systemPrompt = `${atlasIdentity}

You are chatting with Jim via Telegram. Be concise and helpful.
If Jim shares a link or spark, acknowledge it and prepare to classify.
For general conversation, be brief and direct.
`;

  try {
    const messages = [
      ...conversationHistory.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: message },
    ];

    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: systemPrompt,
      messages,
    });

    const textContent = response.content.find(block => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      return "I'm having trouble processing that. Could you try again?";
    }

    return textContent.text.trim();
  } catch (error) {
    logger.error("Response generation failed", { error });
    return "Something went wrong. Please try again.";
  }
}

/**
 * Test Claude connection
 */
export async function testClaudeConnection(): Promise<boolean> {
  try {
    await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 10,
      messages: [{ role: "user", content: "Say 'ok'" }],
    });
    logger.info("Claude connection successful");
    return true;
  } catch (error) {
    logger.error("Claude connection failed", { error });
    return false;
  }
}

// ==========================================
// Intent Detection
// ==========================================

/**
 * System prompt for intent detection
 */
const INTENT_DETECTION_PROMPT = `${atlasIdentity}

---

## Your Task

You are detecting the **intent** behind a message from Jim. Analyze the message and determine what Jim wants to do.

**Intent Types:**
- **spark**: Jim wants to capture/save something (URL present, "save this", "check this out", hashtags)
- **query**: Jim wants to see/list items ("what's in my...", "show me...", "list...", "how many...")
- **status**: Jim wants a dashboard/summary ("how's...", "status on...", "where are we", "progress")
- **lookup**: Jim wants to find something specific ("find...", "search...", "what did we decide about...")
- **action**: Jim wants to modify a SPECIFIC NOTION ITEM by name ("mark X as done", "complete the telegram bot task", "archive the blog post item", "dismiss...")
- **chat**: General conversation, requests for help, questions, anything NOT about Notion items

IMPORTANT: "action" is ONLY for modifying existing Notion items. If Jim asks for help, wants you to do something external (like review Gmail, check something, help with code), that is "chat" NOT "action".

Examples of "chat" (NOT action):
- "Can you review my Gmail?" → chat (external request)
- "Help me with this code" → chat (assistance request)
- "What do you think about X?" → chat (opinion)
- "Can you check something for me?" → chat (external task)

Examples of "action":
- "Mark the telegram bot task as done" → action (specific Notion item)
- "Complete the blog post" → action (specific Notion item)
- "Archive the DrumWave task" → action (specific Notion item)

Return ONLY valid JSON with these fields:
- intent: One of "spark", "query", "status", "lookup", "action", "chat"
- confidence: Number 0-100
- reasoning: Brief explanation (1 sentence)
- entities: Object with extracted entities (optional fields: url, query, pillar, actionType)
`;

/**
 * Detect intent using Claude (fallback for ambiguous cases)
 */
export async function detectIntentWithClaude(
  message: string,
  heuristicResult?: IntentDetectionResult
): Promise<IntentDetectionResult> {
  logger.debug("Using Claude for intent detection", {
    message: message.substring(0, 100),
    heuristicIntent: heuristicResult?.intent,
  });

  let userMessage = `Detect the intent of this message from Jim:\n\n"${message}"`;

  if (heuristicResult) {
    userMessage += `\n\nHeuristic analysis suggested: ${heuristicResult.intent} (${heuristicResult.confidence}% confidence)`;
    userMessage += `\nReason: ${heuristicResult.reasoning}`;
  }

  try {
    const response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 300,
      system: INTENT_DETECTION_PROMPT,
      messages: [{ role: "user", content: userMessage }],
    });

    const textContent = response.content.find((block) => block.type === "text");
    if (!textContent || textContent.type !== "text") {
      throw new Error("No text response from Claude");
    }

    // Extract JSON from markdown code blocks if present
    let jsonText = textContent.text.trim();
    const jsonMatch = jsonText.match(/```(?:json)?\s*([\s\S]*?)\s*```/);
    if (jsonMatch) {
      jsonText = jsonMatch[1].trim();
    }

    const result = JSON.parse(jsonText) as {
      intent: MessageIntent;
      confidence: number;
      reasoning: string;
      entities?: IntentEntities;
    };

    return {
      intent: result.intent,
      confidence: result.confidence,
      reasoning: `Claude: ${result.reasoning}`,
      entities: result.entities,
    };
  } catch (error: any) {
    // Extract detailed error info from Anthropic SDK errors
    const errorDetails = {
      message: error?.message || String(error),
      status: error?.status,
      type: error?.error?.type,
      code: error?.error?.error?.type || error?.code,
      name: error?.name,
    };
    logger.error("Claude intent detection failed", errorDetails);

    // Return heuristic result if available, otherwise default to chat
    if (heuristicResult) {
      return heuristicResult;
    }

    return {
      intent: "chat",
      confidence: 30,
      reasoning: "Intent detection failed, defaulting to chat",
    };
  }
}

// ==========================================
// Tool-Aware Chat Response
// ==========================================

/**
 * Generate response with tool access (for conversational queries)
 */
export async function generateResponseWithTools(
  message: string,
  conversationHistory: Array<{ role: "user" | "assistant"; content: string }>
): Promise<string> {
  logger.debug("Generating response with tools", { message: message.substring(0, 100) });

  const tools: Anthropic.Tool[] = [
    {
      name: "query_feed",
      description: "Get items from the Feed activity log. Returns recent entries.",
      input_schema: {
        type: "object" as const,
        properties: {
          pillar: {
            type: "string",
            enum: ["The Grove", "Personal", "Consulting", "Home/Garage"],
            description: "Filter by pillar (optional)"
          },
          limit: { type: "number", description: "Max items to return (default 5)" }
        },
        required: []
      }
    },
    {
      name: "query_work_queue",
      description: "Get items from the work queue. Returns active tasks.",
      input_schema: {
        type: "object" as const,
        properties: {
          status: {
            type: "string",
            enum: ["Queued", "In Progress", "Blocked", "Done"],
            description: "Filter by status (optional)"
          },
          limit: { type: "number", description: "Max items to return (default 5)" }
        },
        required: []
      }
    },
    {
      name: "get_status",
      description: "Get a summary of Feed and Work Queue counts, including P0 items.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: []
      }
    },
    {
      name: "get_atlas_state",
      description: "Get Atlas's current state, pending tasks, and recent activity.",
      input_schema: {
        type: "object" as const,
        properties: {},
        required: []
      }
    }
  ];

  const systemPrompt = `${atlasIdentity}

You are chatting with Jim via Telegram. You have tools to look up his feed, work queue, and Atlas state.

RULES:
- If Jim asks about feed, queue, tasks, status, or priorities — USE THE TOOLS
- Don't guess or make up items — look them up
- Be concise. This is mobile. No walls of text.
- Lead with what matters. Skip pleasantries.
- If something is urgent (P0, blocked), mention it first.

VOICE:
- Direct, efficient, zero-bullshit
- Like a sharp exec assistant, not a chatbot
- No "Great question!" or "I'd be happy to help"
- Just answer.

EXAMPLES:
- "3 items in your feed. 2 Grove, 1 Consulting."
- "Queue's clear. Nothing blocking."
- "Found 2 P0s that need attention."
`;

  try {
    const messages: Anthropic.MessageParam[] = [
      ...conversationHistory.map(m => ({
        role: m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user" as const, content: message },
    ];

    let response = await anthropic.messages.create({
      model: "claude-sonnet-4-20250514",
      max_tokens: 500,
      system: systemPrompt,
      messages,
      tools,
    });

    // Handle tool use loop (max 3 iterations to prevent runaway)
    let iterations = 0;
    while (response.stop_reason === "tool_use" && iterations < 3) {
      iterations++;

      const toolUseBlock = response.content.find(block => block.type === "tool_use");
      if (!toolUseBlock || toolUseBlock.type !== "tool_use") break;

      logger.debug("Tool call", { tool: toolUseBlock.name, input: toolUseBlock.input });

      const toolResult = await executeToolCall(toolUseBlock.name, toolUseBlock.input);

      messages.push({ role: "assistant", content: response.content });
      messages.push({
        role: "user",
        content: [{
          type: "tool_result",
          tool_use_id: toolUseBlock.id,
          content: JSON.stringify(toolResult)
        }]
      });

      response = await anthropic.messages.create({
        model: "claude-sonnet-4-20250514",
        max_tokens: 500,
        system: systemPrompt,
        messages,
        tools,
      });
    }

    const textContent = response.content.find(block => block.type === "text");
    return textContent?.type === "text" ? textContent.text.trim() : "I'm here. What do you need?";

  } catch (error) {
    logger.error("Response with tools failed", { error });
    return "Something went wrong. Try again?";
  }
}

/**
 * Execute a tool call and return results
 */
async function executeToolCall(toolName: string, input: unknown): Promise<unknown> {
  const { queryFeed, queryWorkQueue, getStatusSummary } = await import("./notion");
  const { getState, getTasks, getHeartbeat } = await import("./atlas-system");

  switch (toolName) {
    case "query_feed": {
      const params = input as { pillar?: string; limit?: number };
      const result = await queryFeed({
        pillar: params.pillar as any,
        limit: params.limit || 5
      });
      return result.items.map(i => ({
        title: i.title,
        pillar: i.pillar,
        status: i.status
      }));
    }

    case "query_work_queue": {
      const params = input as { status?: string; limit?: number };
      const result = await queryWorkQueue({
        status: params.status as any,
        limit: params.limit || 5
      });
      return result.items.map(i => ({
        title: i.title,
        status: i.status,
        priority: i.priority
      }));
    }

    case "get_status": {
      return await getStatusSummary();
    }

    case "get_atlas_state": {
      const state = getState();
      const tasks = getTasks();
      const heartbeat = getHeartbeat();
      return {
        status: heartbeat.status,
        lastActive: state.lastActive,
        pendingTasks: tasks.queue.length,
        stats: state.stats
      };
    }

    default:
      return { error: "Unknown tool" };
  }
}
