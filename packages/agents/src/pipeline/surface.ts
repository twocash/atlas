/**
 * AtlasSurface — Universal Surface Contract
 *
 * A surface provides THREE things:
 *   1. Delivery primitives (how to send responses back to Jim)
 *   2. Environmental context (what this surface can observe)
 *   3. Device tools (physical actions on Jim's device)
 *
 * A surface NEVER constrains compute. Atlas always has the full desk.
 * Compute capabilities are SYSTEM-LEVEL (see system.ts).
 *
 * Sprint: ARCH-CPE-001 Phase 6 — Unified Cognitive Architecture
 */

// ─── Delivery Constraints ────────────────────────────────
// The ONLY surface limitations — how responses are delivered.

export interface DeliveryConstraints {
  /** Can we stream token-by-token? */
  supportsStreaming: boolean;
  /** Character limit per message (e.g., Telegram 4096) */
  maxResponseLength?: number;
  /** Markdown, code blocks, rich formatting support */
  supportsRichFormatting: boolean;
  /** Can we send files back to the user? */
  supportsFileAttachment: boolean;
}

// ─── Surface Context ─────────────────────────────────────
// What a surface can observe from Jim's environment.
// Varies by surface. Bridge sees the browser; Telegram sees message history.

export interface SurfaceContext {
  /** Browser URL (Bridge only) */
  browserUrl?: string;
  /** Browser page title (Bridge only) */
  pageTitle?: string;
  /** User-selected text (Bridge only) */
  selectedText?: string;
  /** LinkedIn-specific context (Bridge only) */
  linkedInContext?: Record<string, unknown>;
  /** Recent message history (Telegram) */
  messageHistory?: string[];
  /** Reply chain context (Telegram) */
  replyChain?: string;
  /** Any surface-specific context data */
  [key: string]: unknown;
}

// ─── Tool Protocol ───────────────────────────────────────
// Device tools = physical actions on Jim's device (surface-specific).
// Desk tools = system-level actions (always available).

export type ToolClassification = 'desk' | 'device';

export interface ToolDefinition {
  name: string;
  description: string;
  schema: Record<string, unknown>;
  classification: ToolClassification;
}

export interface ToolRequest {
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResult {
  id: string;
  content: string;
  isError: boolean;
}

/** Callback for executing tools during backend execution */
export interface ToolExecutor {
  execute(request: ToolRequest): Promise<ToolResult>;
}

// ─── Device Tool Definitions ─────────────────────────────
// Surface-specific tools that require physical device access.

export interface DeviceToolDefinition extends ToolDefinition {
  classification: 'device';
}

// ─── AtlasSurface ────────────────────────────────────────
// The universal contract for any channel Jim uses to communicate
// with Atlas. ≤4 delivery methods. Context + device tools.
//
// ANTI-PATTERNS (FORBIDDEN):
//   ❌ maxTier / supportsAgenticExecution (compute is system-level)
//   ❌ Surface-specific cognitive logic in orchestrator
//   ❌ More than 4 delivery methods

export interface AtlasSurface {
  // ─── Identity ──────────────────────────────────────
  readonly surfaceId: string;

  // ─── Delivery Constraints (the ONLY surface limitations) ───
  readonly deliveryConstraints: DeliveryConstraints;

  // ─── Delivery Primitives (≤4 methods) ──────────────
  /** Send a text response to the user */
  reply(text: string, options?: SurfaceReplyOptions): Promise<void>;
  /** Show typing indicator */
  sendTyping(): Promise<void>;
  /** Optional: reactions, read receipts, etc. */
  acknowledge?(emoji: string): Promise<void>;
  /** Optional: acquire media/file from surface (e.g., Telegram file download) */
  acquireMedia?(ref: string): Promise<Buffer>;

  // ─── Environmental Context (what this surface can see) ───
  /** Returns context from Jim's current environment */
  getContext(): Promise<SurfaceContext>;

  // ─── Device Tools (physical actions on Jim's device) ───
  /** Returns tools that can act ON Jim's device */
  getDeviceTools(): DeviceToolDefinition[];
  /** Execute a physical action on Jim's device */
  executeDeviceTool(request: ToolRequest): Promise<ToolResult>;
}

/** Surface-specific reply options (format hints, not cognitive decisions) */
export interface SurfaceReplyOptions {
  /** Format hint for the surface (e.g., 'HTML', 'markdown') */
  format?: string;
  /** Reply to a specific message */
  replyToId?: number;
}
