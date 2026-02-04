/**
 * Prompt Composition Types
 *
 * Core type definitions for the shared composition system.
 * Used by both Telegram and Chrome extension adapters.
 */

// ==========================================
// Core Domain Types
// ==========================================

/**
 * The four life pillars - routing context for all content
 */
export type Pillar = 'The Grove' | 'Personal' | 'Consulting' | 'Home/Garage';

/**
 * Action types - what the user wants to do with content
 */
export type ActionType = 'research' | 'draft' | 'capture' | 'analysis' | 'summarize';

/**
 * Pillar slug for drafter ID construction
 */
export type PillarSlug = 'the-grove' | 'personal' | 'consulting' | 'home-garage';

// ==========================================
// State Types (for Telegram adapter)
// ==========================================

/**
 * State for tracking a prompt selection flow
 * Used by Telegram's interactive Pillar → Action → Voice flow
 */
export interface PromptSelectionState {
  /** UUID for callback routing */
  requestId: string;
  /** Telegram chat ID */
  chatId: number;
  /** Telegram user ID */
  userId: number;
  /** Message ID for editing keyboard message */
  messageId?: number;

  // Content context
  /** URL or query text */
  content: string;
  /** Type of content being processed */
  contentType: 'url' | 'text';
  /** Page title if URL */
  title?: string;

  // Selection state (Pillar → Action → Voice)
  /** Current step in the flow */
  step: 'pillar' | 'action' | 'voice' | 'confirm';
  /** Selected pillar */
  pillar?: Pillar;
  /** Selected action */
  action?: ActionType;
  /** Selected voice ID from System Prompts DB */
  voice?: string;

  // Smart defaults tracking (Phase 3)
  /** Suggested action based on patterns */
  suggestedAction?: ActionType;
  /** Suggested voice based on patterns */
  suggestedVoice?: string;
  /** Whether user accepted the shortcut */
  acceptedShortcut?: boolean;

  // Metadata
  /** Creation timestamp */
  timestamp: number;
  /** Auto-expire timestamp (5 min TTL) */
  expiresAt: number;
}

// ==========================================
// Composition Types
// ==========================================

/**
 * IDs for prompt composition (matches existing PromptComposition interface)
 * Used to resolve actual prompts from Notion
 */
export interface PromptCompositionIds {
  /** Drafter ID, e.g. "drafter.the-grove.research" */
  drafter?: string;
  /** Voice ID, e.g. "voice.grove-analytical" */
  voice?: string;
  /** Lens ID, e.g. "lens.strategic" (future) */
  lens?: string;
}

/**
 * Context provided by channel adapters for composition
 */
export interface CompositionContext {
  /** Which pillar/worldview */
  pillar: Pillar;
  /** What action to perform */
  action: ActionType;
  /** Optional voice modifier */
  voice?: string;
  /** The URL or text content */
  content: string;
  /** Page title for context */
  title?: string;
  /** Original URL if applicable */
  url?: string;
}

/**
 * Result from prompt composition
 */
export interface PromptCompositionResult {
  /** The fully assembled prompt */
  prompt: string;
  /** Model temperature */
  temperature: number;
  /** Max tokens for response */
  maxTokens: number;
  /** Metadata about what was composed */
  metadata: {
    /** Which drafter was used */
    drafter: string;
    /** Which voice was applied (if any) */
    voice?: string;
    /** Which lens was applied (future) */
    lens?: string;
  };
}

// ==========================================
// Registry Types
// ==========================================

/**
 * Voice option for UI presentation
 */
export interface VoiceOption {
  /** Voice ID (e.g. "grove-analytical") */
  id: string;
  /** Display name (e.g. "Grove Analytical") */
  name: string;
  /** Short description */
  description?: string;
  /** Emoji for display */
  emoji?: string;
}

/**
 * Action option for UI presentation
 */
export interface ActionOption {
  /** Action type */
  type: ActionType;
  /** Display label */
  label: string;
  /** Short description */
  description?: string;
  /** Emoji for display */
  emoji?: string;
}

/**
 * Pillar option for UI presentation
 */
export interface PillarOption {
  /** Pillar value */
  pillar: Pillar;
  /** Display label */
  label: string;
  /** Emoji for display */
  emoji: string;
}

// ==========================================
// Validation Types
// ==========================================

/**
 * Validation error for incomplete selections
 */
export interface ValidationError {
  /** Which field is invalid */
  field: 'pillar' | 'action' | 'voice' | 'content';
  /** Error message */
  message: string;
}
