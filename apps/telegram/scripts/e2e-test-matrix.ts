/**
 * Master Blaster V2 - E2E Test Matrix
 *
 * Real-world test cases derived from bug fixes.
 * Each test exercises the actual pipeline, not mocks.
 *
 * Run: bun run scripts/e2e-test-matrix.ts
 */

// ==========================================
// Test Case Definition
// ==========================================

export interface TestCase {
  testId: string;
  bug: string;
  priority: 'HIGH' | 'MEDIUM' | 'LOW';
  inputMessage: string;
  inputUrl?: string;
  expectedIntent: 'capture' | 'command' | 'query' | 'clarify' | 'research';
  expectedPillar: 'The Grove' | 'Consulting' | 'Personal' | 'Home/Garage';
  expectedBehavior: string;
  mockConfidence: number;
  isCompound: boolean;

  // Assertions
  assertions: TestAssertion[];
}

export interface TestAssertion {
  type: 'pillar_eq' | 'intent_eq' | 'reply_count' | 'keyboard_count' |
        'no_clarify' | 'compound_detected' | 'error_sanitized' |
        'sub_intents_count' | 'domain_hint_applied';
  expected: string | number | boolean;
  description: string;
}

// ==========================================
// Test Matrix
// ==========================================

export const TEST_MATRIX: TestCase[] = [
  // BUG-001: Duplicate Confirmations
  {
    testId: 'BUG-001a',
    bug: 'Duplicate Confirmations',
    priority: 'MEDIUM',
    inputMessage: 'Check out this thread on AI agents',
    inputUrl: 'https://twitter.com/karpathy/status/123',
    expectedIntent: 'capture',
    expectedPillar: 'The Grove',
    expectedBehavior: 'Single confirmation message, not two',
    mockConfidence: 0.92,
    isCompound: false,
    assertions: [
      { type: 'reply_count', expected: 1, description: 'Only one confirmation sent' },
      { type: 'keyboard_count', expected: 1, description: 'Only one keyboard shown' },
    ],
  },
  {
    testId: 'BUG-001b',
    bug: 'Duplicate Confirmations',
    priority: 'MEDIUM',
    inputMessage: 'Save this for later',
    inputUrl: 'https://notion.so/some-doc',
    expectedIntent: 'capture',
    expectedPillar: 'Consulting',
    expectedBehavior: 'One confirmation even though Feed + Work Queue both created',
    mockConfidence: 0.88,
    isCompound: false,
    assertions: [
      { type: 'reply_count', expected: 1, description: 'Single confirmation despite dual DB write' },
    ],
  },

  // BUG-002: URL-Only False Negative
  {
    testId: 'BUG-002a',
    bug: 'URL-Only False Negative',
    priority: 'HIGH',
    inputMessage: 'https://bringatrailer.com/listing/1987-mercedes-450sl',
    inputUrl: 'https://bringatrailer.com/listing/1987-mercedes-450sl',
    expectedIntent: 'capture',
    expectedPillar: 'Home/Garage',
    expectedBehavior: 'Captured without asking "what do you want me to do with this?"',
    mockConfidence: 0.85,
    isCompound: false,
    assertions: [
      { type: 'no_clarify', expected: true, description: 'URL-only is valid capture, no clarify' },
      { type: 'pillar_eq', expected: 'Home/Garage', description: 'Vehicle domain → Home/Garage' },
      { type: 'domain_hint_applied', expected: true, description: 'BaT domain hint detected' },
    ],
  },
  {
    testId: 'BUG-002b',
    bug: 'URL-Only False Negative',
    priority: 'HIGH',
    inputMessage: 'https://arxiv.org/abs/2401.12345',
    inputUrl: 'https://arxiv.org/abs/2401.12345',
    expectedIntent: 'capture',
    expectedPillar: 'The Grove',
    expectedBehavior: 'URL-only treated as valid capture, no clarify loop',
    mockConfidence: 0.80,
    isCompound: false,
    assertions: [
      { type: 'no_clarify', expected: true, description: 'URL-only is valid capture' },
      { type: 'pillar_eq', expected: 'The Grove', description: 'arxiv → research → The Grove' },
    ],
  },

  // BUG-003: No Fallback Hierarchy
  {
    testId: 'BUG-003a',
    bug: 'No Fallback Hierarchy',
    priority: 'HIGH',
    inputMessage: 'something about that thing from the meeting',
    inputUrl: undefined,
    expectedIntent: 'capture',
    expectedPillar: 'Consulting',
    expectedBehavior: 'Low confidence → capture with best-guess pillar, not clarify',
    mockConfidence: 0.35,
    isCompound: false,
    assertions: [
      { type: 'intent_eq', expected: 'capture', description: 'Low confidence falls back to capture' },
      { type: 'no_clarify', expected: true, description: 'No clarify loop for ambiguous' },
    ],
  },
  {
    testId: 'BUG-003b',
    bug: 'No Fallback Hierarchy',
    priority: 'HIGH',
    inputMessage: 'interesting idea for the house maybe',
    inputUrl: undefined,
    expectedIntent: 'capture',
    expectedPillar: 'Home/Garage',
    expectedBehavior: 'Confidence 0.45 → capture + reclassify keyboard, not open question',
    mockConfidence: 0.45,
    isCompound: false,
    assertions: [
      { type: 'intent_eq', expected: 'capture', description: '0.45 confidence → capture not clarify' },
      { type: 'keyboard_count', expected: 1, description: 'Reclassify keyboard provided' },
    ],
  },

  // BUG-004: Vehicle Misclassification
  {
    testId: 'BUG-004a',
    bug: 'Vehicle Misclassification',
    priority: 'MEDIUM',
    inputMessage: 'Check out this 450SL listing',
    inputUrl: 'https://bringatrailer.com/listing/1987-mercedes-450sl',
    expectedIntent: 'capture',
    expectedPillar: 'Home/Garage',
    expectedBehavior: 'Pillar is Home/Garage, not The Grove or Personal',
    mockConfidence: 0.91,
    isCompound: false,
    assertions: [
      { type: 'pillar_eq', expected: 'Home/Garage', description: 'BaT + vehicle → Home/Garage' },
      { type: 'domain_hint_applied', expected: true, description: 'Domain hint overrides default' },
    ],
  },
  {
    testId: 'BUG-004b',
    bug: 'Vehicle Misclassification',
    priority: 'MEDIUM',
    inputMessage: 'Found a clean GX460 on Cars and Bids',
    inputUrl: 'https://carsandbids.com/listing/2018-lexus-gx460',
    expectedIntent: 'capture',
    expectedPillar: 'Home/Garage',
    expectedBehavior: 'Vehicle keywords + domain both map to Home/Garage',
    mockConfidence: 0.89,
    isCompound: false,
    assertions: [
      { type: 'pillar_eq', expected: 'Home/Garage', description: 'carsandbids domain → Home/Garage' },
    ],
  },

  // BUG-005: Research Grounding Failure
  {
    testId: 'BUG-005',
    bug: 'Research Grounding Failure',
    priority: 'MEDIUM',
    inputMessage: 'Research the latest on agentic AI frameworks',
    inputUrl: undefined,
    expectedIntent: 'capture', // Falls back to capture on research failure
    expectedPillar: 'The Grove',
    expectedBehavior: 'On Gemini failure: friendly fallback message, no raw error',
    mockConfidence: 0.87,
    isCompound: false,
    assertions: [
      { type: 'error_sanitized', expected: true, description: 'No raw API error exposed' },
    ],
  },

  // BUG-006: Multi-Intent Parsing
  {
    testId: 'BUG-006a',
    bug: 'Multi-Intent Parsing',
    priority: 'HIGH',
    inputMessage: 'Capture this article to The Grove and create a reminder to read it by Friday',
    inputUrl: 'https://stratechery.com/2025/ai-post',
    expectedIntent: 'capture',
    expectedPillar: 'The Grove',
    expectedBehavior: 'Both intents processed: capture article + create reminder. One consolidated confirmation',
    mockConfidence: 0.90,
    isCompound: true,
    assertions: [
      { type: 'compound_detected', expected: true, description: 'isCompound flag set' },
      { type: 'sub_intents_count', expected: 1, description: 'One sub-intent (reminder)' },
      { type: 'reply_count', expected: 1, description: 'Consolidated confirmation' },
    ],
  },
  {
    testId: 'BUG-006b',
    bug: 'Multi-Intent Parsing',
    priority: 'HIGH',
    inputMessage: 'File this under consulting and remind me to follow up with Sarah tomorrow',
    inputUrl: 'https://docs.google.com/doc/d/abc123',
    expectedIntent: 'capture',
    expectedPillar: 'Consulting',
    expectedBehavior: 'Primary: capture to Consulting. Sub-intent: create reminder. Single response',
    mockConfidence: 0.88,
    isCompound: true,
    assertions: [
      { type: 'compound_detected', expected: true, description: 'Multi-intent detected' },
      { type: 'pillar_eq', expected: 'Consulting', description: 'Explicit pillar mention honored' },
      { type: 'sub_intents_count', expected: 1, description: 'Reminder sub-intent captured' },
    ],
  },

  // BUG-007: Notion Links Not Clickable (added from testing)
  {
    testId: 'BUG-007',
    bug: 'Notion Links Not Clickable',
    priority: 'HIGH',
    inputMessage: 'Book a dentist appointment',
    inputUrl: undefined,
    expectedIntent: 'capture',
    expectedPillar: 'Personal',
    expectedBehavior: 'Confirmation includes clickable Notion URL',
    mockConfidence: 0.95,
    isCompound: false,
    assertions: [
      // This would need reply content inspection
      { type: 'reply_count', expected: 1, description: 'Single confirmation with link' },
    ],
  },

  // BUG-008: Domain hint not applied (the one we just fixed)
  {
    testId: 'BUG-008',
    bug: 'Domain Hint Not Applied',
    priority: 'HIGH',
    inputMessage: 'https://bringatrailer.com/listing/1990-porsche-944',
    inputUrl: 'https://bringatrailer.com/listing/1990-porsche-944',
    expectedIntent: 'capture',
    expectedPillar: 'Home/Garage',
    expectedBehavior: 'Domain hint forces Home/Garage even without context',
    mockConfidence: 0.85,
    isCompound: false,
    assertions: [
      { type: 'pillar_eq', expected: 'Home/Garage', description: 'BaT domain → Home/Garage' },
      { type: 'domain_hint_applied', expected: true, description: 'Explicit domain hint in prompt' },
    ],
  },
];

// ==========================================
// Test Markers for Cleanup
// ==========================================

export const TEST_MARKERS = {
  feedKeywords: ['test', 'master-blaster', 'e2e-cleanup'],
  workQueueNotes: '🧪 E2E TEST - Auto-generated by Master Blaster V2 - Safe to delete',
  titlePrefix: '[E2E] ',
};

// ==========================================
// Exports
// ==========================================

export function getTestsByPriority(priority: 'HIGH' | 'MEDIUM' | 'LOW'): TestCase[] {
  return TEST_MATRIX.filter(t => t.priority === priority);
}

export function getTestsByBug(bugName: string): TestCase[] {
  return TEST_MATRIX.filter(t => t.bug.includes(bugName));
}

console.log(`Loaded ${TEST_MATRIX.length} E2E test cases`);
console.log(`  HIGH priority: ${getTestsByPriority('HIGH').length}`);
console.log(`  MEDIUM priority: ${getTestsByPriority('MEDIUM').length}`);
