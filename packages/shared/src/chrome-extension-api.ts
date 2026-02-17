/**
 * Chrome Extension API Contract
 *
 * Defines the interface between Atlas core (Telegram bot) and the Chrome Extension.
 * Both sides develop against this contract independently.
 *
 * Integration Point: apps/telegram/src/services/chrome-extractor.ts
 * Extension Endpoint: apps/chrome-ext-vite/src/background/index.ts
 */

// ============================================
// Content Extraction API
// ============================================

export type ContentSource =
  | 'threads'
  | 'twitter'
  | 'linkedin'
  | 'youtube'
  | 'github'
  | 'article'
  | 'generic';

export interface ExtractRequest {
  /** URL to extract content from */
  url: string;
  /** Optional timeout in ms (default: 30000) */
  timeout?: number;
  /** Request ID for tracking */
  requestId?: string;
}

export interface ExtractResponse {
  success: boolean;
  requestId?: string;
  source: ContentSource;
  content: {
    title: string;
    author?: string;
    authorHandle?: string;
    text: string;
    timestamp?: string;
    mediaUrls?: string[];
    engagement?: {
      likes?: number;
      comments?: number;
      shares?: number;
      views?: number;
    };
  };
  /** Raw HTML or data for debugging */
  rawData?: string;
  error?: string;
}

// ============================================
// Calendar API
// ============================================

export type CalendarAction = 'create' | 'read' | 'check_availability' | 'quick_add';

export interface CalendarRequest {
  action: CalendarAction;
  requestId?: string;

  // For 'create' action
  event?: {
    title: string;
    start: string;  // ISO 8601
    end?: string;   // ISO 8601, optional for all-day
    description?: string;
    location?: string;
    calendarId?: string;  // Which calendar (Personal, Take Flight, etc.)
  };

  // For 'read' action
  range?: {
    start: string;  // ISO 8601
    end: string;    // ISO 8601
  };

  // For 'check_availability' action
  datetime?: string;  // ISO 8601

  // For 'quick_add' action (natural language)
  quickAddText?: string;  // e.g., "Lunch with Bob tomorrow at noon"
}

export interface CalendarEvent {
  id: string;
  title: string;
  start: string;
  end: string;
  description?: string;
  location?: string;
  calendarId: string;
  calendarName: string;
  htmlLink: string;
}

export interface CalendarResponse {
  success: boolean;
  requestId?: string;
  action: CalendarAction;

  // For 'create' and 'quick_add'
  createdEvent?: CalendarEvent;

  // For 'read'
  events?: CalendarEvent[];

  // For 'check_availability'
  isAvailable?: boolean;
  conflictingEvents?: CalendarEvent[];

  error?: string;
}

// ============================================
// Social Media Actions API
// ============================================

export type SocialAction = 'post' | 'like' | 'reply' | 'retweet' | 'follow';
export type SocialPlatform = 'twitter' | 'linkedin' | 'threads';

export interface SocialRequest {
  action: SocialAction;
  platform: SocialPlatform;
  requestId?: string;

  // For 'post' action
  post?: {
    text: string;
    mediaUrls?: string[];
    replyToUrl?: string;  // For replies
  };

  // For 'like', 'retweet', 'reply' actions
  targetUrl?: string;

  // For 'follow' action
  profileUrl?: string;
}

export interface SocialResponse {
  success: boolean;
  requestId?: string;
  action: SocialAction;
  platform: SocialPlatform;

  // URL to the created/actioned item
  resultUrl?: string;

  error?: string;
}

// ============================================
// Health Check API
// ============================================

export interface HealthCheckRequest {
  requestId?: string;
}

export interface HealthCheckResponse {
  success: boolean;
  requestId?: string;
  version: string;
  capabilities: {
    extraction: boolean;
    calendar: boolean;
    social: boolean;
  };
  activeTabs: number;
  /** Logged-in platforms */
  authenticatedPlatforms: SocialPlatform[];
}

// ============================================
// Unified Request/Response Wrapper
// ============================================

export type AtlasExtensionAction =
  | 'extract'
  | 'calendar'
  | 'social'
  | 'health_check';

export interface AtlasExtensionRequest {
  action: AtlasExtensionAction;
  requestId: string;
  payload: ExtractRequest | CalendarRequest | SocialRequest | HealthCheckRequest;
}

export interface AtlasExtensionResponse {
  action: AtlasExtensionAction;
  requestId: string;
  success: boolean;
  data: ExtractResponse | CalendarResponse | SocialResponse | HealthCheckResponse;
  error?: string;
  /** Processing time in ms */
  duration?: number;
}

// ============================================
// Native Messaging Types (for production)
// ============================================

export interface NativeMessage {
  type: 'request' | 'response' | 'event';
  id: string;
  timestamp: string;
  payload: AtlasExtensionRequest | AtlasExtensionResponse | ExtensionEvent;
}

export interface ExtensionEvent {
  event: 'ready' | 'error' | 'tab_closed' | 'auth_expired';
  details?: Record<string, unknown>;
}

// ============================================
// Configuration
// ============================================

export interface ChromeExtensionConfig {
  /** HTTP endpoint when using HTTP mode */
  httpUrl?: string;  // e.g., 'http://localhost:3100'

  /** Native messaging host name when using native mode */
  nativeHostName?: string;  // e.g., 'com.atlas.extension'

  /** Communication mode */
  mode: 'http' | 'native' | 'disabled';

  /** Default timeout for requests */
  defaultTimeout: number;

  /** Retry configuration */
  retry: {
    maxAttempts: number;
    backoffMs: number;
  };
}

export const DEFAULT_CONFIG: ChromeExtensionConfig = {
  mode: 'disabled',
  defaultTimeout: 30000,
  retry: {
    maxAttempts: 3,
    backoffMs: 1000,
  },
};
