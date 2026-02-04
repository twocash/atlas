/**
 * Prompt Composition Registry
 *
 * Defines available actions and voices per pillar.
 * This is the source of truth for what options are presented to users.
 */

import type {
  Pillar,
  PillarSlug,
  ActionType,
  ActionOption,
  VoiceOption,
  PillarOption,
} from './types';

// ==========================================
// Pillar Configuration
// ==========================================

/**
 * All pillar options for UI
 */
export const PILLAR_OPTIONS: PillarOption[] = [
  { pillar: 'The Grove', label: 'The Grove', emoji: '🌲' },
  { pillar: 'Consulting', label: 'Consulting', emoji: '💼' },
  { pillar: 'Home/Garage', label: 'Home/Garage', emoji: '🏠' },
  { pillar: 'Personal', label: 'Personal', emoji: '👤' },
];

/**
 * Map pillar to URL-safe slug for drafter IDs
 */
export const PILLAR_SLUGS: Record<Pillar, PillarSlug> = {
  'The Grove': 'the-grove',
  'Personal': 'personal',
  'Consulting': 'consulting',
  'Home/Garage': 'home-garage',
};

/**
 * Reverse lookup: slug to pillar
 */
export const SLUG_TO_PILLAR: Record<PillarSlug, Pillar> = {
  'the-grove': 'The Grove',
  'personal': 'Personal',
  'consulting': 'Consulting',
  'home-garage': 'Home/Garage',
};

// ==========================================
// Action Configuration
// ==========================================

/**
 * All action options
 */
export const ACTION_OPTIONS: ActionOption[] = [
  {
    type: 'research',
    label: 'Research',
    description: 'Deep analysis with sources and citations',
    emoji: '📊',
  },
  {
    type: 'draft',
    label: 'Draft',
    description: 'Create publishable content',
    emoji: '✍️',
  },
  {
    type: 'capture',
    label: 'Capture',
    description: 'Quick extraction and save',
    emoji: '💡',
  },
  {
    type: 'analysis',
    label: 'Analysis',
    description: 'Strategic breakdown',
    emoji: '🔍',
  },
  {
    type: 'summarize',
    label: 'Summarize',
    description: 'TL;DR and key points',
    emoji: '📝',
  },
];

/**
 * Action labels for display
 */
export const ACTION_LABELS: Record<ActionType, string> = {
  research: 'Research',
  draft: 'Draft',
  capture: 'Capture',
  analysis: 'Analysis',
  summarize: 'Summarize',
};

/**
 * Action emojis for display
 */
export const ACTION_EMOJIS: Record<ActionType, string> = {
  research: '📊',
  draft: '✍️',
  capture: '💡',
  analysis: '🔍',
  summarize: '📝',
};

/**
 * Which actions are available per pillar
 * All pillars have access to all actions, but ordering reflects typical usage
 */
export const PILLAR_ACTIONS: Record<Pillar, ActionType[]> = {
  'The Grove': ['research', 'draft', 'capture', 'analysis'],
  'Consulting': ['draft', 'research', 'analysis', 'summarize'],
  'Personal': ['capture', 'research', 'draft', 'summarize'],
  'Home/Garage': ['capture', 'research', 'summarize'],
};

// ==========================================
// Voice Configuration
// ==========================================

/**
 * Voice options per pillar
 * IDs match the voice.{id} pattern in Notion System Prompts DB
 */
export const PILLAR_VOICES: Record<Pillar, VoiceOption[]> = {
  'The Grove': [
    {
      id: 'grove-analytical',
      name: 'Grove Analytical',
      description: 'Technical thought leadership with concentration risk thesis',
      emoji: '🎯',
    },
    {
      id: 'strategic',
      name: 'Strategic',
      description: 'High-level architecture and decision-making',
      emoji: '📈',
    },
    {
      id: 'raw-notes',
      name: 'Raw Notes',
      description: 'Unfiltered extraction without editorial',
      emoji: '📝',
    },
  ],
  'Consulting': [
    {
      id: 'consulting-brief',
      name: 'Consulting Brief',
      description: 'MECE, executive-ready, recommendation-focused',
      emoji: '💼',
    },
    {
      id: 'client-facing',
      name: 'Client-Facing',
      description: 'Professional, polished, presentation-ready',
      emoji: '🎯',
    },
    {
      id: 'strategic',
      name: 'Strategic',
      description: 'Strategic implications and next steps',
      emoji: '📈',
    },
  ],
  'Personal': [
    {
      id: 'reflective',
      name: 'Reflective',
      description: 'Growth-focused, personal development lens',
      emoji: '🌱',
    },
    {
      id: 'raw-notes',
      name: 'Raw Notes',
      description: 'Simple extraction without editorial',
      emoji: '📝',
    },
  ],
  'Home/Garage': [
    {
      id: 'practical',
      name: 'Practical',
      description: 'Actionable steps, materials lists, how-to',
      emoji: '🔧',
    },
    {
      id: 'raw-notes',
      name: 'Raw Notes',
      description: 'Reference capture without editorial',
      emoji: '📝',
    },
  ],
};

/**
 * Action-specific voice overrides
 * Some actions work better with specific voices
 */
export const ACTION_VOICE_PREFERENCES: Partial<Record<ActionType, string[]>> = {
  // Research benefits from analytical voices
  research: ['grove-analytical', 'consulting-brief', 'strategic'],
  // Draft works with any voice
  draft: undefined,
  // Capture typically wants minimal processing
  capture: ['raw-notes', 'practical'],
};

// ==========================================
// Public API
// ==========================================

/**
 * Get available actions for a pillar
 */
export function getAvailableActions(pillar: Pillar): ActionOption[] {
  const actionTypes = PILLAR_ACTIONS[pillar];
  return actionTypes.map(type => {
    const option = ACTION_OPTIONS.find(a => a.type === type);
    if (!option) {
      throw new Error(`Unknown action type: ${type}`);
    }
    return option;
  });
}

/**
 * Get available voices for a pillar and action
 */
export function getAvailableVoices(pillar: Pillar, action?: ActionType): VoiceOption[] {
  const pillarVoices = PILLAR_VOICES[pillar];

  // If action has voice preferences, reorder to put preferred first
  if (action && ACTION_VOICE_PREFERENCES[action]) {
    const preferred = ACTION_VOICE_PREFERENCES[action]!;
    const sorted = [...pillarVoices].sort((a, b) => {
      const aIndex = preferred.indexOf(a.id);
      const bIndex = preferred.indexOf(b.id);
      // Preferred voices first, then others
      if (aIndex >= 0 && bIndex >= 0) return aIndex - bIndex;
      if (aIndex >= 0) return -1;
      if (bIndex >= 0) return 1;
      return 0;
    });
    return sorted;
  }

  return pillarVoices;
}

/**
 * Get pillar slug for drafter ID construction
 */
export function getPillarSlug(pillar: Pillar): PillarSlug {
  return PILLAR_SLUGS[pillar];
}

/**
 * Get pillar from slug
 */
export function getPillarFromSlug(slug: string): Pillar | undefined {
  return SLUG_TO_PILLAR[slug as PillarSlug];
}

/**
 * Check if a pillar supports an action
 */
export function pillarSupportsAction(pillar: Pillar, action: ActionType): boolean {
  return PILLAR_ACTIONS[pillar].includes(action);
}

/**
 * Check if a pillar has a voice
 */
export function pillarHasVoice(pillar: Pillar, voiceId: string): boolean {
  return PILLAR_VOICES[pillar].some(v => v.id === voiceId);
}
