/**
 * Socratic Adapter — Chrome Extension Integration
 *
 * Self-contained adapter that wraps the Socratic assessment concept
 * for the Chrome extension's LinkedIn reply workflow.
 *
 * Architecture:
 *   LinkedInComment → scoreContextSlots → assess → (resolve | question)
 *   On answer → mapInstruction → resolve with enrichedInstruction
 *
 * The adapter makes ZERO Claude API calls. Assessment is deterministic
 * weighted scoring. Questions are hardcoded for the LinkedIn reply surface.
 * Answers map to instruction strings that enrich the reply prompt.
 *
 * Sessions are stored in a module-level Map with 5-minute TTL.
 * Session state persists while the sidepanel is open.
 */

import type { LinkedInComment } from '~src/types/comments'
import type {
  ContextAssessment,
  ConfidenceRegime,
  SocraticQuestion,
  SocraticAdapterResult,
  SlotScore,
} from '~src/types/socratic'
import { CONFIDENCE_THRESHOLDS } from '~src/types/socratic'
import { scoreContextSlots } from './socratic-context-builder'

// ==========================================
// Session Store
// ==========================================

interface SocraticSession {
  id: string
  comment: LinkedInComment
  assessment: ContextAssessment
  questions: SocraticQuestion[]
  /** Accumulated instruction fragments from answered questions */
  answeredInstructions: string[]
  /** Number of questions answered so far */
  answeredCount: number
  createdAt: number
}

const sessions = new Map<string, SocraticSession>()
const SESSION_TTL_MS = 5 * 60 * 1000

function cleanExpired(): void {
  const now = Date.now()
  for (const [id, s] of sessions) {
    if (now - s.createdAt > SESSION_TTL_MS) sessions.delete(id)
  }
}

// ==========================================
// Assessment
// ==========================================

function assess(slots: SlotScore[]): ContextAssessment {
  const overall = slots.reduce((sum, s) => sum + s.contribution, 0)

  let regime: ConfidenceRegime
  if (overall >= CONFIDENCE_THRESHOLDS.AUTO_DRAFT) regime = 'auto_draft'
  else if (overall >= CONFIDENCE_THRESHOLDS.ASK_ONE) regime = 'ask_one'
  else regime = 'ask_framing'

  // Collect gaps, sorted by slot weight (biggest-impact gaps first)
  const topGaps = slots
    .sort((a, b) => b.contribution - a.contribution)
    .flatMap(s => s.gaps.map(gap => ({ slot: s.slot, gap })))

  return { overallConfidence: overall, regime, slots, topGaps }
}

// ==========================================
// Question Generation (LinkedIn-specific)
// ==========================================

function generateLinkedInQuestions(
  assessment: ContextAssessment,
  comment: LinkedInComment
): SocraticQuestion[] {
  const questions: SocraticQuestion[] = []
  const maxQuestions = assessment.regime === 'ask_one' ? 1 : 2

  const slotMap = new Map(assessment.slots.map(s => [s.slot, s]))
  const classification = slotMap.get('classification')
  const bridge = slotMap.get('bridge_context')
  const contact = slotMap.get('contact_data')

  // Priority 1: Reply intent (when classification is weak)
  if (classification && classification.completeness < 0.7 && questions.length < maxQuestions) {
    questions.push({
      text: "What's your goal for this reply?",
      targetSlot: 'classification',
      options: [
        { label: 'Build Relationship', value: 'build_relationship' },
        { label: 'Share Expertise', value: 'share_expertise' },
        { label: 'Ask a Question', value: 'ask_question' },
        { label: 'Simple Thanks', value: 'simple_thanks' },
      ],
    })
  }

  // Priority 2: Relationship context (when bridge context is sparse)
  if (bridge && bridge.completeness < 0.5 && questions.length < maxQuestions) {
    const name = comment.author.name.split(' ')[0] || comment.author.name
    questions.push({
      text: `Do you know ${name}?`,
      targetSlot: 'bridge_context',
      options: [
        { label: 'Key Prospect', value: 'key_prospect' },
        { label: 'Active Community', value: 'community_member' },
        { label: 'New Connection', value: 'new_connection' },
        { label: "Don't Know Them", value: 'unknown' },
      ],
    })
  }

  // Priority 3: Tone preference (when contact data is sparse)
  if (contact && contact.completeness < 0.5 && questions.length < maxQuestions) {
    questions.push({
      text: 'What tone works best here?',
      targetSlot: 'contact_data',
      options: [
        { label: 'Professional', value: 'professional' },
        { label: 'Casual & Warm', value: 'casual' },
        { label: 'Technical', value: 'technical' },
        { label: 'Enthusiastic', value: 'enthusiastic' },
      ],
    })
  }

  return questions
}

// ==========================================
// Answer → Instruction Mapping
// ==========================================

const GOAL_INSTRUCTIONS: Record<string, string> = {
  build_relationship:
    'Focus on building rapport. Ask a genuine follow-up question. Reference shared interests.',
  share_expertise:
    'Share a relevant insight or perspective. Be helpful and substantive.',
  ask_question:
    'End with a thoughtful question that deepens the conversation.',
  simple_thanks:
    'Keep it brief and warm. A sincere thank you with a small personal touch.',
}

const RELATIONSHIP_INSTRUCTIONS: Record<string, string> = {
  key_prospect:
    'This is a key prospect. Be thoughtful and strategic. Look for ways to add value.',
  community_member:
    'This is an active community member. Reinforce the relationship with genuine engagement.',
  new_connection:
    'This is a new connection. Be welcoming and open.',
  unknown:
    "First interaction with this person. Be friendly but don't over-invest.",
}

const TONE_INSTRUCTIONS: Record<string, string> = {
  professional: 'Use a professional but approachable tone.',
  casual: 'Keep it casual and warm, like talking to a friend.',
  technical: 'Lean into technical depth. Assume expertise.',
  enthusiastic: 'Match their energy with genuine enthusiasm.',
}

function mapAnswerToInstruction(answerValue: string, targetSlot: string): string {
  if (targetSlot === 'classification') return GOAL_INSTRUCTIONS[answerValue] || ''
  if (targetSlot === 'bridge_context') return RELATIONSHIP_INSTRUCTIONS[answerValue] || ''
  if (targetSlot === 'contact_data') return TONE_INSTRUCTIONS[answerValue] || ''
  return ''
}

// ==========================================
// Public API
// ==========================================

/**
 * Assess a LinkedIn comment's context and either resolve (auto-draft)
 * or return questions for the user.
 */
export function assessReplyContext(comment: LinkedInComment): SocraticAdapterResult {
  cleanExpired()

  const slots = scoreContextSlots(comment)
  const assessment = assess(slots)

  // Auto-draft: rich context, no questions needed
  if (assessment.regime === 'auto_draft') {
    return { type: 'resolved', confidence: assessment.overallConfidence }
  }

  // Generate questions for gaps
  const questions = generateLinkedInQuestions(assessment, comment)

  if (questions.length === 0) {
    // Can't generate useful questions — resolve with what we have
    return { type: 'resolved', confidence: assessment.overallConfidence }
  }

  // Create session
  const sessionId = crypto.randomUUID()
  sessions.set(sessionId, {
    id: sessionId,
    comment,
    assessment,
    questions,
    answeredInstructions: [],
    answeredCount: 0,
    createdAt: Date.now(),
  })

  return {
    type: 'question',
    sessionId,
    questions,
    confidence: assessment.overallConfidence,
  }
}

/**
 * Submit an answer to a Socratic question.
 * Returns resolved (with enriched instruction) or remaining questions.
 */
export function submitSocraticAnswer(
  sessionId: string,
  answerValue: string,
  questionIndex: number = 0
): SocraticAdapterResult {
  const session = sessions.get(sessionId)
  if (!session) {
    return { type: 'error', message: `Session not found: ${sessionId}` }
  }

  // questionIndex is relative to remaining questions; convert to absolute
  const absoluteIndex = session.answeredCount + questionIndex
  const question = session.questions[absoluteIndex]
  if (!question) {
    return { type: 'error', message: `No question at index ${questionIndex} (absolute: ${absoluteIndex})` }
  }

  // Map answer to instruction
  const instruction = mapAnswerToInstruction(answerValue, question.targetSlot)
  if (instruction) {
    session.answeredInstructions.push(instruction)
  }
  session.answeredCount++

  // Check if more questions remain (use absolute position, not relative index)
  if (session.answeredCount < session.questions.length) {
    return {
      type: 'question',
      sessionId,
      questions: session.questions.slice(session.answeredCount),
      confidence: session.assessment.overallConfidence,
    }
  }

  // All questions answered — resolve with combined instructions
  const enrichedInstruction = session.answeredInstructions.join(' ')
  sessions.delete(sessionId)

  return {
    type: 'resolved',
    confidence: Math.min(session.assessment.overallConfidence + 0.15, 1.0),
    enrichedInstruction: enrichedInstruction || undefined,
  }
}

/**
 * Cancel a Socratic session (e.g., user closed the panel or switched comments).
 */
export function cancelSocraticSession(sessionId: string): void {
  sessions.delete(sessionId)
}

/**
 * Get a raw context assessment for display (no session created).
 */
export function getContextAssessment(comment: LinkedInComment): ContextAssessment {
  const slots = scoreContextSlots(comment)
  return assess(slots)
}

/**
 * Get active session count (for monitoring).
 */
export function getActiveSessions(): number {
  cleanExpired()
  return sessions.size
}
