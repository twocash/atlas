/**
 * Question Generator — Template Hydration + UX Formatting
 *
 * Takes gap analysis results and generates transport-ready questions
 * with tap-friendly A/B/C options. Hydrates {variable} templates
 * from the Notion config with actual signal data.
 */

import type {
  ContextSignals,
  ContextSlot,
  SocraticQuestion,
  QuestionOption,
  SocraticConfigEntry,
} from './types';
import type { GapAnalysis } from './gap-analyzer';

// ==========================================
// Default Questions (when no Notion prompt matches)
// ==========================================

const DEFAULT_QUESTIONS: Record<ContextSlot, { text: string; options: QuestionOption[] }> = {
  contact_data: {
    text: "What's your relationship with this person?",
    options: [
      { label: 'Close connection', value: 'close' },
      { label: 'Professional contact', value: 'professional' },
      { label: 'New acquaintance', value: 'new' },
    ],
  },
  content_signals: {
    text: "What's the key takeaway from this content?",
    options: [
      { label: 'Industry insight', value: 'insight' },
      { label: 'Personal story', value: 'personal' },
      { label: 'Technical topic', value: 'technical' },
    ],
  },
  classification: {
    text: 'What area does this belong to?',
    options: [
      { label: 'The Grove (AI venture)', value: 'the-grove' },
      { label: 'Consulting', value: 'consulting' },
      { label: 'Personal', value: 'personal' },
      { label: 'Home/Garage', value: 'home-garage' },
    ],
  },
  bridge_context: {
    text: 'Any recent context I should know?',
    options: [
      { label: 'Recent conversation', value: 'recent' },
      { label: 'Pending follow-up', value: 'follow-up' },
      { label: 'No recent context', value: 'none' },
    ],
  },
  skill_requirements: {
    text: 'What specific outcome do you want?',
    options: [
      { label: 'Quick response', value: 'quick' },
      { label: 'Thoughtful reply', value: 'thoughtful' },
      { label: 'Just acknowledge', value: 'acknowledge' },
    ],
  },
};

// ==========================================
// Template Hydration
// ==========================================

/**
 * Hydrate {variable_name} placeholders in a template with signal data.
 * Uses a flat mapping extracted from ContextSignals.
 */
function hydrateTemplate(template: string, signals: ContextSignals): string {
  const vars: Record<string, string> = {};

  // Contact data
  if (signals.contactData) {
    vars['contact_name'] = signals.contactData.name || 'this person';
    vars['contact_relationship'] = signals.contactData.relationship || 'unknown';
    vars['recent_activity'] = signals.contactData.recentActivity || 'none available';
    vars['relationship_history'] = signals.contactData.relationshipHistory || 'none available';
  }

  // Content signals
  if (signals.contentSignals) {
    vars['post_topic'] = signals.contentSignals.topic || 'unknown topic';
    vars['post_sentiment'] = signals.contentSignals.sentiment || 'neutral';
    vars['title'] = signals.contentSignals.title || '';
    vars['url'] = signals.contentSignals.url || '';
  }

  // Classification
  if (signals.classification) {
    vars['detected_intent'] = signals.classification.intent || 'unknown';
    vars['detected_pillar'] = signals.classification.pillar || 'unknown';
    vars['classification_confidence'] = String(signals.classification.confidence ?? 0);
  }

  return template.replace(/\{(\w+)\}/g, (match, varName) => {
    return vars[varName] ?? match;
  });
}

/**
 * Extract question text and options from a Notion config entry's content.
 * Looks for the first question pattern and option list in the content.
 *
 * Falls back to default question for the slot if parsing fails.
 */
function extractQuestionFromContent(
  entry: SocraticConfigEntry,
  slot: ContextSlot,
  signals: ContextSignals
): { text: string; options: QuestionOption[] } {
  const content = hydrateTemplate(entry.content, signals);

  // Look for lines starting with "- " that contain A/B/C style options
  // or structured option patterns
  const lines = content.split('\n').filter(l => l.trim());

  // Find question lines (ending with ?)
  const questionLines = lines.filter(l => l.trim().endsWith('?'));
  const questionText = questionLines[0]?.trim();

  // Find option lines: "A) ...", "- \"...\"", or "| ... |" table rows
  const optionPatterns = [
    /^[A-D]\)\s*(.+)/,               // A) Option text
    /^-\s*"([^"]+)"/,                 // - "option text"
    /^\|\s*"([^"]+)"\s*\|/,          // | "option text" | ...
  ];

  const options: QuestionOption[] = [];
  for (const line of lines) {
    const trimmed = line.trim();
    for (const pattern of optionPatterns) {
      const match = trimmed.match(pattern);
      if (match) {
        const label = match[1].trim();
        const value = label.toLowerCase().replace(/[^a-z0-9]+/g, '-');
        options.push({ label, value });
        break;
      }
    }
  }

  // If we found a question and options, use them
  if (questionText && options.length >= 2) {
    return { text: questionText, options: options.slice(0, 4) };
  }

  // Fall back to default
  return DEFAULT_QUESTIONS[slot];
}

// ==========================================
// Question Generation
// ==========================================

/**
 * Generate questions from gap analysis results.
 * Returns transport-ready questions with hydrated templates
 * and tap-friendly options.
 */
export function generateQuestions(
  gapAnalysis: GapAnalysis,
  signals: ContextSignals
): SocraticQuestion[] {
  const questions: SocraticQuestion[] = [];

  for (const gap of gapAnalysis.targetGaps) {
    let questionData: { text: string; options: QuestionOption[] };

    if (gap.promptEntry) {
      questionData = extractQuestionFromContent(gap.promptEntry, gap.slot, signals);
    } else {
      questionData = DEFAULT_QUESTIONS[gap.slot];
    }

    questions.push({
      text: questionData.text,
      targetSlot: gap.slot,
      options: questionData.options,
      expectedBoost: gap.weight * 0.8, // ~80% of the slot weight as expected boost
    });
  }

  return questions;
}
