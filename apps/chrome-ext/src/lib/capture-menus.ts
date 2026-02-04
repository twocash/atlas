/**
 * Atlas Chrome Extension - V3 Active Capture Menu System
 *
 * 4-level hierarchical context menus:
 * Root → Pillar → Action → Voice
 *
 * Voice selection is the meaningful user choice - it determines output style and depth.
 */

// =============================================================================
// MENU CONFIGURATION
// =============================================================================

export const PILLARS = ['The Grove', 'Consulting', 'Personal', 'Home/Garage'] as const;
export type Pillar = typeof PILLARS[number];

export const ACTIONS = ['capture', 'research'] as const;
export type Action = typeof ACTIONS[number];

// Voices vary by ACTION TYPE, not by Pillar
export const VOICES_BY_ACTION: Record<Action, { id: string; label: string }[]> = {
  capture: [
    { id: 'grove-analytical', label: 'Grove Analytical' },
    { id: 'consulting', label: 'Consulting' },
    { id: 'raw-notes', label: 'Raw Notes' },
  ],
  research: [
    { id: 'grove-analytical', label: 'Grove Analytical' },
    { id: 'consulting', label: 'Consulting' },
    { id: 'raw-notes', label: 'Raw Notes' },
  ],
};

// Future: Draft action with output-focused voices
// draft: [
//   { id: 'linkedin-punchy', label: 'LinkedIn Punchy' },
//   { id: 'executive-brief', label: 'Executive Brief' },
//   { id: 'consulting', label: 'Consulting' },
// ],

// =============================================================================
// TYPES
// =============================================================================

/**
 * Prompt composition IDs for V3 Active Capture
 */
export interface PromptComposition {
  drafter?: string;
  voice?: string;
  lens?: string;
}

/**
 * Full capture configuration from menu selection
 */
export interface CaptureConfig {
  pillar: Pillar;
  action: Action;
  voice: string;
  promptIds: PromptComposition;
}

// =============================================================================
// HELPERS
// =============================================================================

function slugify(str: string): string {
  return str.toLowerCase().replace(/[\s\/]+/g, '-');
}

function getPillarEmoji(pillar: Pillar): string {
  const emojis: Record<Pillar, string> = {
    'The Grove': '\u{1F333}',     // 🌳
    'Consulting': '\u{1F4BC}',    // 💼
    'Personal': '\u{1F464}',      // 👤
    'Home/Garage': '\u{1F3E0}',   // 🏠
  };
  return emojis[pillar];
}

function getActionLabel(action: Action): string {
  const labels: Record<Action, string> = {
    capture: '\u{1F4E5} Save & Extract',  // 📥
    research: '\u{1F52C} Deep Research',  // 🔬
  };
  return labels[action];
}

/**
 * Build prompt IDs from pillar + action + voice
 * Drafters are pillar-specific (worldview framing)
 * Voices are shared (tone/style)
 */
export function buildPromptIds(pillar: Pillar, action: Action, voice: string): PromptComposition {
  const pillarSlug = slugify(pillar);  // "the-grove", "consulting", "personal", "home-garage"
  return {
    drafter: `drafter.${pillarSlug}.${action}`,  // e.g., "drafter.the-grove.research"
    voice: `voice.${voice}`,                      // e.g., "voice.grove-analytical"
    // lens: undefined - future extension point
  };
}

// =============================================================================
// MENU CREATION
// =============================================================================

/**
 * Create 4-level hierarchical menus on install/update
 *
 * Structure:
 * Send to Atlas (Root)
 * ├── Quick Capture
 * ├── ─────────────
 * ├── 🌳 The Grove
 * │   ├── 📥 Save & Extract
 * │   │   ├── Grove Analytical
 * │   │   ├── Consulting
 * │   │   └── Raw Notes
 * │   └── 🔬 Deep Research
 * │       └── (same voices)
 * └── (other pillars...)
 */
export function createCaptureMenus(): void {
  chrome.contextMenus.removeAll(() => {
    // Level 1: Root menu
    chrome.contextMenus.create({
      id: 'atlas-root',
      title: 'Send to Atlas',
      contexts: ['page', 'selection', 'link'],
    });

    // Quick capture (bypass prompt composition)
    chrome.contextMenus.create({
      id: 'atlas-quick',
      parentId: 'atlas-root',
      title: 'Quick Capture',
      contexts: ['page', 'selection', 'link'],
    });

    chrome.contextMenus.create({
      id: 'atlas-separator',
      parentId: 'atlas-root',
      type: 'separator',
      contexts: ['page', 'selection', 'link'],
    });

    // Level 2: Pillar submenus
    for (const pillar of PILLARS) {
      const pillarId = `atlas-${slugify(pillar)}`;
      chrome.contextMenus.create({
        id: pillarId,
        parentId: 'atlas-root',
        title: `${getPillarEmoji(pillar)} ${pillar}`,
        contexts: ['page', 'selection', 'link'],
      });

      // Level 3: Actions under each pillar
      for (const action of ACTIONS) {
        const actionId = `${pillarId}-${action}`;
        chrome.contextMenus.create({
          id: actionId,
          parentId: pillarId,
          title: getActionLabel(action),
          contexts: ['page', 'selection', 'link'],
        });

        // Level 4: Voices under each action (THE CORE VALUE)
        const voices = VOICES_BY_ACTION[action];
        for (const voice of voices) {
          const voiceId = `${actionId}-${voice.id}`;
          chrome.contextMenus.create({
            id: voiceId,
            parentId: actionId,
            title: voice.label,
            contexts: ['page', 'selection', 'link'],
          });
        }
      }
    }

    console.log('Atlas: 4-level capture menus created (Pillar -> Action -> Voice)');
  });
}

// =============================================================================
// MENU PARSING
// =============================================================================

/**
 * Parse menu ID: atlas-{pillar}-{action}-{voice}
 * Example: atlas-the-grove-research-grove-analytical
 *
 * @returns CaptureConfig if full 4-level selection, null otherwise
 */
export function parseMenuItemId(menuItemId: string): CaptureConfig | null {
  // Format: atlas-{pillar-slug}-{action}-{voice}
  // Pillar slugs: the-grove, consulting, personal, home-garage
  const patterns = PILLARS.map(p => ({
    pillar: p,
    slug: slugify(p),
  }));

  for (const { pillar, slug } of patterns) {
    for (const action of ACTIONS) {
      const voices = VOICES_BY_ACTION[action];
      for (const voice of voices) {
        const expectedId = `atlas-${slug}-${action}-${voice.id}`;
        if (menuItemId === expectedId) {
          return {
            pillar,
            action,
            voice: voice.id,
            promptIds: buildPromptIds(pillar, action, voice.id),
          };
        }
      }
    }
  }

  return null;
}
