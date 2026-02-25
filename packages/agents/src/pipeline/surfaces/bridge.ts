/**
 * BridgeSurface — AtlasSurface Implementation for Chrome Extension Bridge
 *
 * The Bridge is Jim sitting at the desk. It provides:
 *   - Delivery: reply via WebSocket, streaming supported
 *   - Context: browser URL, page title, selected text, LinkedIn context
 *   - Device tools: browser automation (click, type, navigate, extract)
 *
 * Bridge sees everything Jim sees on his desktop. It's the richest
 * surface — but it STILL doesn't constrain compute. The same models
 * and backends are available whether Jim messages from Telegram or Bridge.
 *
 * NOTE: Like TelegramSurface, this takes pre-bound delivery functions.
 * The actual WebSocket management lives in packages/bridge/src/server.ts.
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

import { logger } from '../../logger';
import type {
  AtlasSurface,
  DeliveryConstraints,
  SurfaceContext,
  SurfaceReplyOptions,
  DeviceToolDefinition,
  ToolRequest,
  ToolResult,
} from '../surface';

// ─── Delivery Bindings ──────────────────────────────────
// Injected by the Bridge server. Pre-bound to WebSocket session.

export interface BridgeDeliveryBindings {
  /** Send text back via WebSocket */
  reply(text: string, options?: { format?: string }): Promise<void>;
  /** Typing indicator (streamed via WS) */
  sendTyping(): Promise<void>;
  /** Browser context from the Chrome extension */
  getBrowserContext(): Promise<BrowserContextData>;
  /** Execute a browser tool via the extension */
  executeBrowserTool(name: string, input: Record<string, unknown>): Promise<ToolResult>;
}

export interface BrowserContextData {
  url?: string;
  pageTitle?: string;
  selectedText?: string;
  linkedInContext?: Record<string, unknown>;
}

// ─── Browser Device Tools ───────────────────────────────
// These are physical actions on Jim's desktop browser.
// They route through the Chrome extension via WebSocket.

const BROWSER_DEVICE_TOOLS: DeviceToolDefinition[] = [
  {
    name: 'browser_click',
    description: 'Click an element on the current page',
    schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the element' },
      },
      required: ['selector'],
    },
    classification: 'device',
  },
  {
    name: 'browser_type',
    description: 'Type text into a form field',
    schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector for the input' },
        text: { type: 'string', description: 'Text to type' },
      },
      required: ['selector', 'text'],
    },
    classification: 'device',
  },
  {
    name: 'browser_navigate',
    description: 'Navigate to a URL',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to navigate to' },
      },
      required: ['url'],
    },
    classification: 'device',
  },
  {
    name: 'browser_extract',
    description: 'Extract text content from elements on the page',
    schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'CSS selector to extract from' },
      },
      required: ['selector'],
    },
    classification: 'device',
  },
  {
    name: 'browser_open_and_read',
    description: 'Open a URL and extract its text content',
    schema: {
      type: 'object',
      properties: {
        url: { type: 'string', description: 'URL to open and read' },
      },
      required: ['url'],
    },
    classification: 'device',
  },
  {
    name: 'browser_screenshot',
    description: 'Take a screenshot of the current page or element',
    schema: {
      type: 'object',
      properties: {
        selector: { type: 'string', description: 'Optional CSS selector for specific element' },
      },
    },
    classification: 'device',
  },
];

// ─── Implementation ──────────────────────────────────────

export class BridgeSurface implements AtlasSurface {
  readonly surfaceId = 'bridge';

  readonly deliveryConstraints: DeliveryConstraints = {
    supportsStreaming: true,
    // No hard message length limit (WebSocket can send any size)
    supportsRichFormatting: true,    // Markdown rendering in extension
    supportsFileAttachment: false,   // Bridge doesn't handle file uploads
  };

  private readonly bindings: BridgeDeliveryBindings;

  constructor(bindings: BridgeDeliveryBindings) {
    this.bindings = bindings;
  }

  // ─── Delivery Primitives ──────────────────────────────

  async reply(text: string, options?: SurfaceReplyOptions): Promise<void> {
    await this.bindings.reply(text, {
      format: options?.format,
    });
  }

  async sendTyping(): Promise<void> {
    await this.bindings.sendTyping();
  }

  // Bridge doesn't have reactions (no message thread to react on)
  // acknowledge is optional in AtlasSurface, so we don't implement it.

  // ─── Environmental Context ────────────────────────────

  async getContext(): Promise<SurfaceContext> {
    const browser = await this.bindings.getBrowserContext();

    return {
      browserUrl: browser.url,
      pageTitle: browser.pageTitle,
      selectedText: browser.selectedText,
      linkedInContext: browser.linkedInContext,
    };
  }

  // ─── Device Tools ─────────────────────────────────────
  // Bridge has browser device tools — physical actions on Jim's desktop.

  getDeviceTools(): DeviceToolDefinition[] {
    return BROWSER_DEVICE_TOOLS;
  }

  async executeDeviceTool(request: ToolRequest): Promise<ToolResult> {
    try {
      return await this.bindings.executeBrowserTool(request.name, request.input);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      logger.error('Bridge device tool execution failed', {
        tool: request.name,
        error: errorMessage,
      });
      return {
        id: request.id,
        content: `Browser tool failed: ${errorMessage}`,
        isError: true,
      };
    }
  }
}
