/**
 * Action Feed constants and helpers
 * Centralizes all Action Type definitions for Feed 2.0 integration
 */

export const ACTION_STATUS = {
  PENDING: 'Pending',
  ACTIONED: 'Actioned',
  DISMISSED: 'Dismissed',
  EXPIRED: 'Expired',
  SNOOZED: 'Snoozed',
} as const;

export const ACTION_TYPE = {
  TRIAGE: 'Triage',
  APPROVAL: 'Approval',
  REVIEW: 'Review',
  ALERT: 'Alert',
  INFO: 'Info',
} as const;

export const ACTIONED_VIA = {
  EXTENSION: 'Extension',
  TELEGRAM: 'Telegram',
  NOTION: 'Notion',
} as const;

export const TRIAGE_DISPOSITIONS = {
  CAPTURE: 'Capture',
  RESEARCH: 'Research',
  ACT_ON: 'Act On',
  DISMISS: 'Dismiss',
} as const;

export const PILLARS = {
  PERSONAL: 'Personal',
  THE_GROVE: 'The Grove',
  CONSULTING: 'Consulting',
  HOME_GARAGE: 'Home/Garage',
} as const;

// TTL defaults in hours
export const ACTION_TTL = {
  Triage: 168,      // 7 days
  Approval: 48,     // 48 hours
  Review: 72,       // 72 hours
  Alert: 24,        // 24 hours
  Info: 12,         // 12 hours
} as const;

// Card type styling
export const ACTION_TYPE_COLORS = {
  Triage: '#3B82F6',    // blue
  Approval: '#F59E0B',  // amber
  Review: '#8B5CF6',    // purple
  Alert: '#EF4444',     // red
  Info: '#6B7280',      // gray
} as const;

export const ACTION_TYPE_ICONS = {
  Triage: '🎯',
  Approval: '🔐',
  Review: '👁️',
  Alert: '🚨',
  Info: 'ℹ️',
} as const;
