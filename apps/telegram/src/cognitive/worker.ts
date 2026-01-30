/**
 * Cognitive Router - Worker Execution
 *
 * Executes LLM requests across different providers.
 * Handles Anthropic, OpenAI, and OpenRouter APIs.
 */

import Anthropic from "@anthropic-ai/sdk";
import type {
  WorkerRequest,
  WorkerResult,
  TokenUsage,
  WorkerToolCall,
} from "./types";
import { MODEL_CATALOG, estimateCost } from "./models";
import { getCognitiveConfig } from "../config/cognitive";
import { logger } from "../logger";

/**
 * Execute a worker request
 */
export async function executeWorker(request: WorkerRequest): Promise<WorkerResult> {
  const startTime = Date.now();

  try {
    let result: WorkerResult;

    switch (request.route.provider) {
      case "anthropic":
        result = await executeAnthropicWorker(request, startTime);
        break;
      case "openai":
        result = await executeOpenAIWorker(request, startTime);
        break;
      case "google":
        result = await executeGeminiWorker(request, startTime);
        break;
      case "openrouter":
        result = await executeOpenRouterWorker(request, startTime);
        break;
      case "local":
        result = executeLocalWorker(request, startTime);
        break;
      default:
        throw new Error(`Unknown provider: ${request.route.provider}`);
    }

    logger.info("Worker completed", {
      taskId: request.taskId,
      success: result.success,
      latencyMs: result.latencyMs,
      cost: result.usage.cost.toFixed(6),
    });

    return result;
  } catch (error) {
    const latencyMs = Date.now() - startTime;
    const errorMessage = error instanceof Error ? error.message : String(error);

    logger.error("Worker failed", {
      taskId: request.taskId,
      error: errorMessage,
      latencyMs,
    });

    return {
      taskId: request.taskId,
      success: false,
      error: errorMessage,
      usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
      latencyMs,
      modelId: request.model.modelId,
      provider: request.route.provider,
      endpoint: request.route.endpoint,
    };
  }
}

/**
 * Execute Anthropic worker (direct API)
 */
async function executeAnthropicWorker(
  request: WorkerRequest,
  startTime: number
): Promise<WorkerResult> {
  const client = new Anthropic({
    apiKey: request.route.apiKey,
  });

  const modelConfig = MODEL_CATALOG[request.model.modelId];

  // Build tools if provided
  const tools: Anthropic.Tool[] | undefined = request.tools?.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: t.inputSchema as Anthropic.Tool.InputSchema,
  }));

  const response = await client.messages.create({
    model: request.route.modelId,
    max_tokens: modelConfig.maxOutputTokens || 4096,
    system: request.systemPrompt,
    messages: [{ role: "user", content: request.userMessage }],
    tools,
  });

  const latencyMs = Date.now() - startTime;

  // Extract content
  const textBlock = response.content.find((b) => b.type === "text");
  const content = textBlock?.type === "text" ? textBlock.text : undefined;

  // Extract tool calls
  const toolCalls: WorkerToolCall[] = response.content
    .filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use")
    .map((b) => ({
      name: b.name,
      input: b.input,
      output: undefined, // Will be filled by executor
    }));

  // Calculate usage
  const usage: TokenUsage = {
    inputTokens: response.usage.input_tokens,
    outputTokens: response.usage.output_tokens,
    totalTokens: response.usage.input_tokens + response.usage.output_tokens,
    cost: estimateCost(
      request.model.modelId,
      response.usage.input_tokens,
      response.usage.output_tokens
    ),
  };

  return {
    taskId: request.taskId,
    success: true,
    content,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
    latencyMs,
    modelId: request.model.modelId,
    provider: "anthropic",
    endpoint: "direct",
  };
}

/**
 * Execute OpenAI worker (direct API)
 */
async function executeOpenAIWorker(
  request: WorkerRequest,
  startTime: number
): Promise<WorkerResult> {
  // Dynamic import to avoid issues if openai isn't installed
  const { default: OpenAI } = await import("openai");

  const client = new OpenAI({
    apiKey: request.route.apiKey,
  });

  const modelConfig = MODEL_CATALOG[request.model.modelId];

  // Build tools if provided
  const tools = request.tools?.map((t) => ({
    type: "function" as const,
    function: {
      name: t.name,
      description: t.description,
      parameters: t.inputSchema,
    },
  }));

  const response = await client.chat.completions.create({
    model: request.route.modelId,
    max_tokens: modelConfig.maxOutputTokens || 4096,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userMessage },
    ],
    tools,
    response_format: request.jsonMode ? { type: "json_object" } : undefined,
  });

  const latencyMs = Date.now() - startTime;

  const message = response.choices[0]?.message;
  const content = message?.content || undefined;

  // Extract tool calls
  const toolCalls: WorkerToolCall[] =
    message?.tool_calls?.map((tc: { function: { name: string; arguments: string } }) => ({
      name: tc.function.name,
      input: JSON.parse(tc.function.arguments),
      output: undefined,
    })) || [];

  // Parse JSON if json mode
  let json: unknown;
  if (request.jsonMode && content) {
    try {
      json = JSON.parse(content);
    } catch {
      logger.warn("Failed to parse JSON response", { taskId: request.taskId });
    }
  }

  // Calculate usage
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: estimateCost(request.model.modelId, inputTokens, outputTokens),
  };

  return {
    taskId: request.taskId,
    success: true,
    content,
    json,
    toolCalls: toolCalls.length > 0 ? toolCalls : undefined,
    usage,
    latencyMs,
    modelId: request.model.modelId,
    provider: "openai",
    endpoint: "direct",
  };
}

/**
 * Execute Gemini worker with Google Search grounding
 */
async function executeGeminiWorker(
  request: WorkerRequest,
  startTime: number
): Promise<WorkerResult> {
  // Dynamic import for Google Generative AI SDK
  const { GoogleGenerativeAI } = await import("@google/generative-ai");

  const client = new GoogleGenerativeAI(request.route.apiKey || "");

  // Determine if we should use grounding (for research tasks)
  const useGrounding = request.tools?.some((t) => t.name === "googleSearch");

  // Get the model with optional grounding config
  const model = client.getGenerativeModel({
    model: "gemini-2.0-flash",
    // Enable Google Search grounding for research
    ...(useGrounding && {
      tools: [{ googleSearch: {} }],
    }),
  });

  // Combine system prompt and user message for Gemini
  const prompt = `${request.systemPrompt}\n\n---\n\nUser: ${request.userMessage}`;

  const result = await model.generateContent(prompt);
  const response = result.response;

  const latencyMs = Date.now() - startTime;

  // Extract text content
  const content = response.text();

  // Extract grounding metadata if available
  const groundingMetadata = response.candidates?.[0]?.groundingMetadata;
  const groundingChunks = groundingMetadata?.groundingChunks || [];

  // Build citations from grounding chunks
  const citations: Array<{ url: string; title: string }> = [];
  for (const chunk of groundingChunks) {
    if (chunk.web) {
      citations.push({
        url: chunk.web.uri || "",
        title: chunk.web.title || "",
      });
    }
  }

  // Estimate token usage (Gemini doesn't always provide exact counts)
  const inputTokens = Math.ceil(prompt.length / 4);
  const outputTokens = Math.ceil(content.length / 4);

  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    cost: estimateCost(request.model.modelId, inputTokens, outputTokens),
  };

  // Attach grounding info to result
  const resultWithGrounding = {
    taskId: request.taskId,
    success: true,
    content,
    json: citations.length > 0 ? { citations, groundingMetadata } : undefined,
    usage,
    latencyMs,
    modelId: request.model.modelId,
    provider: "google" as const,
    endpoint: "direct" as const,
  };

  logger.debug("Gemini response with grounding", {
    taskId: request.taskId,
    citationCount: citations.length,
    hasGrounding: !!groundingMetadata,
  });

  return resultWithGrounding;
}

/**
 * Execute OpenRouter worker (fallback)
 */
async function executeOpenRouterWorker(
  request: WorkerRequest,
  startTime: number
): Promise<WorkerResult> {
  // Dynamic import - OpenRouter uses OpenAI SDK with different base URL
  const { default: OpenAI } = await import("openai");

  const client = new OpenAI({
    apiKey: request.route.apiKey,
    baseURL: request.route.baseUrl,
    defaultHeaders: {
      "HTTP-Referer": "https://atlas.thegrove.ai",
      "X-Title": "Atlas Cognitive Router",
    },
  });

  // Get the original model config for cost calculation
  const originalModelId = request.model.modelId;

  const response = await client.chat.completions.create({
    model: request.route.modelId, // OpenRouter model ID
    max_tokens: 4096,
    messages: [
      { role: "system", content: request.systemPrompt },
      { role: "user", content: request.userMessage },
    ],
    response_format: request.jsonMode ? { type: "json_object" } : undefined,
  });

  const latencyMs = Date.now() - startTime;

  const message = response.choices[0]?.message;
  const content = message?.content || undefined;

  // Parse JSON if json mode
  let json: unknown;
  if (request.jsonMode && content) {
    try {
      json = JSON.parse(content);
    } catch {
      logger.warn("Failed to parse JSON response from OpenRouter", {
        taskId: request.taskId,
      });
    }
  }

  // Calculate usage (OpenRouter provides this in response)
  const inputTokens = response.usage?.prompt_tokens || 0;
  const outputTokens = response.usage?.completion_tokens || 0;
  const usage: TokenUsage = {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    // Note: OpenRouter may charge different rates, but we estimate based on original model
    cost: estimateCost(originalModelId, inputTokens, outputTokens),
  };

  return {
    taskId: request.taskId,
    success: true,
    content,
    json,
    usage,
    latencyMs,
    modelId: originalModelId,
    provider: "openrouter",
    endpoint: "openrouter",
  };
}

/**
 * Execute local worker (no API call)
 */
function executeLocalWorker(
  request: WorkerRequest,
  startTime: number
): WorkerResult {
  // Local workers handle simple transforms without LLM
  // For now, just return the input as-is
  // Future: implement actual local processing (regex, parsing, etc.)

  const latencyMs = Date.now() - startTime;

  return {
    taskId: request.taskId,
    success: true,
    content: `Local processing not yet implemented for: ${request.userMessage.substring(0, 100)}`,
    usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0, cost: 0 },
    latencyMs,
    modelId: "local",
    provider: "local",
    endpoint: "local",
  };
}

/**
 * Execute multiple workers in parallel
 */
export async function executeWorkersParallel(
  requests: WorkerRequest[]
): Promise<WorkerResult[]> {
  const config = getCognitiveConfig();
  const maxConcurrent = config.maxConcurrentWorkers;

  // If under concurrency limit, run all in parallel
  if (requests.length <= maxConcurrent) {
    return Promise.all(requests.map(executeWorker));
  }

  // Otherwise, batch execution
  const results: WorkerResult[] = [];
  for (let i = 0; i < requests.length; i += maxConcurrent) {
    const batch = requests.slice(i, i + maxConcurrent);
    const batchResults = await Promise.all(batch.map(executeWorker));
    results.push(...batchResults);
  }

  return results;
}

/**
 * Check if a result indicates a retriable error
 */
export function isRetriableError(result: WorkerResult): boolean {
  if (result.success) return false;

  const retriablePatterns = [
    /rate limit/i,
    /timeout/i,
    /503/i,
    /502/i,
    /overloaded/i,
    /temporarily unavailable/i,
  ];

  return retriablePatterns.some((p) => p.test(result.error || ""));
}

/**
 * Get timeout for a worker based on profile
 */
export function getWorkerTimeout(request: WorkerRequest): number {
  const config = getCognitiveConfig();
  const baseTimeout = config.defaultTimeoutMs;

  // Increase timeout for complex tasks
  if (request.profile.complexity === "complex") {
    return baseTimeout * 2;
  }

  // Decrease timeout for trivial tasks
  if (request.profile.complexity === "trivial") {
    return baseTimeout / 2;
  }

  return baseTimeout;
}
