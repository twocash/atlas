/**
 * Audience-Voice Resolver
 *
 * Maps audience type to a default voice ID per pillar.
 * This sets the starting point; ACTION_VOICE_PREFERENCES in registry.ts
 * reorders by action preference on top of this.
 *
 * If a voice_hint is already provided (user selected), it takes priority.
 */

import type { AudienceType, Pillar } from './types';

/**
 * Default voice per audience × pillar.
 * Rows = audience, columns = pillar.
 *
 * The voice IDs match entries in PILLAR_VOICES (registry.ts).
 */
const AUDIENCE_VOICE_DEFAULTS: Record<AudienceType, Partial<Record<Pillar, string>>> = {
  self: {
    'The Grove': 'raw-notes',
    'Consulting': 'strategic',
    'Personal': 'reflective',
    'Home/Garage': 'practical',
  },
  client: {
    'The Grove': 'grove-analytical',
    'Consulting': 'consulting-brief',
    'Personal': 'reflective',
    'Home/Garage': 'practical',
  },
  public: {
    'The Grove': 'grove-analytical',
    'Consulting': 'client-facing',
    'Personal': 'reflective',
    'Home/Garage': 'practical',
  },
  team: {
    'The Grove': 'strategic',
    'Consulting': 'consulting-brief',
    'Personal': 'raw-notes',
    'Home/Garage': 'practical',
  },
};

/**
 * Resolve a voice ID from audience + pillar.
 *
 * Priority:
 * 1. Explicit voice_hint (user already chose) — returned as-is
 * 2. Audience × pillar default from the matrix above
 * 3. undefined (let the composition system proceed without voice)
 */
export function resolveAudienceVoice(
  audience: AudienceType,
  pillar: Pillar,
  voiceHint: string | null
): string | undefined {
  // User's explicit choice wins
  if (voiceHint) {
    return voiceHint;
  }

  return AUDIENCE_VOICE_DEFAULTS[audience]?.[pillar];
}
