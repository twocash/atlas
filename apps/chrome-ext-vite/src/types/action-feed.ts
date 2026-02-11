/**
 * Action Feed types for Chrome Extension
 * Mirrors telegram types but standalone for extension bundle
 */

export type ActionStatus = 'Pending' | 'Actioned' | 'Dismissed' | 'Expired' | 'Snoozed';
export type ActionType = 'Triage' | 'Approval' | 'Review' | 'Alert' | 'Info';
export type ActionedVia = 'Extension' | 'Telegram' | 'Notion';
export type Pillar = 'Personal' | 'The Grove' | 'Consulting' | 'Home/Garage';

export interface ActionFeedEntry {
  id: string;
  url: string;
  createdAt: string;
  title: string;
  source: string;
  actionStatus: ActionStatus;
  actionType: ActionType;
  actionData: Record<string, any>;
  actionedAt?: string;
  actionedVia?: ActionedVia;
}

export interface ActionCardProps {
  entry: ActionFeedEntry;
  onAction: (entryId: string, updates: Partial<ActionFeedEntry>) => Promise<void>;
  isSelected?: boolean;
  onSelect?: (entryId: string, selected: boolean) => void;
  batchMode?: boolean;
}

export const ACTION_TYPE_COLORS: Record<ActionType, string> = {
  Triage: 'border-l-blue-500 bg-blue-500',
  Approval: 'border-l-amber-500 bg-amber-500',
  Review: 'border-l-purple-500 bg-purple-500',
  Alert: 'border-l-red-500 bg-red-500',
  Info: 'border-l-gray-400 bg-gray-400',
};

export const ACTION_TYPE_ICONS: Record<ActionType, string> = {
  Triage: '🎯',
  Approval: '🔐',
  Review: '👁️',
  Alert: '🚨',
  Info: 'ℹ️',
};

export const PILLARS: Pillar[] = ['Personal', 'The Grove', 'Consulting', 'Home/Garage'];
