/**
 * Socratic Interview Engine — State Machine Orchestrator
 *
 * Transport-agnostic engine that manages the interview lifecycle:
 *   IDLE → ASSESSING → (RESOLVED | ASKING) → MAPPING → RESOLVED
 *
 * The engine makes ZERO Claude API calls. All logic is deterministic
 * scoring, gap analysis, and template hydration from Notion config.
 *
 * Usage:
 *   const engine = new SocraticEngine();
 *   const result = await engine.assess(signals, 'chrome', 'linkedin-reply');
 *
 *   if (result.type === 'question') {
 *     // Render questions to UI, collect answer
 *     const mapped = await engine.answer(sessionId, answerValue);
 *   }
 *
 *   if (result.type === 'resolved') {
 *     // Feed result.context into composition pipeline
 *   }
 */

import { randomUUID } from 'crypto';
import type {
  ContextSignals,
  Surface,
  EngineState,
  SocraticSession,
  ResolvedContext,
  EngineResult,
  SocraticQuestion,
  MappedAnswer,
} from './types';
import type { IntentType, DepthLevel, AudienceType, Pillar } from '../services/prompt-composition/types';
import { assessContext } from './context-assessor';
import { analyzeGaps } from './gap-analyzer';
import { generateQuestions } from './question-generator';
import { mapAnswer } from './answer-mapper';
import { getSocraticConfig } from './notion-config';

// ==========================================
// Session Store (in-memory, per-process)
// ==========================================

const sessions = new Map<string, SocraticSession>();

/** Session TTL: 5 minutes */
const SESSION_TTL_MS = 5 * 60 * 1000;

/** Clean expired sessions periodically */
function cleanExpiredSessions(): void {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) {
      sessions.delete(id);
    }
  }
}

// ==========================================
// Engine
// ==========================================

export class SocraticEngine {
  /**
   * Assess context signals and either resolve immediately or generate questions.
   *
   * @param signals - Raw context signals from the transport adapter
   * @param surface - Which surface initiated (chrome, telegram, etc.)
   * @param skill - Optional skill being served (e.g., 'linkedin-reply')
   * @returns EngineResult — either resolved context or questions to ask
   */
  async assess(
    signals: ContextSignals,
    surface: Surface,
    skill?: string
  ): Promise<EngineResult> {
    // Clean up old sessions
    cleanExpiredSessions();

    // Get Notion config
    const config = await getSocraticConfig();
    if (!config) {
      return { type: 'error', message: 'Socratic config unavailable' };
    }

    // Score context
    const assessment = assessContext(signals);

    // Auto-draft: resolve immediately with high confidence
    if (assessment.regime === 'auto_draft') {
      const resolved = buildResolvedContext(signals, assessment.overallConfidence, 'auto_draft');
      return { type: 'resolved', context: resolved };
    }

    // Analyze gaps and generate questions
    const gapAnalysis = analyzeGaps(assessment, config, surface, skill);
    const questions = generateQuestions(gapAnalysis, signals);

    if (questions.length === 0) {
      // No questions could be generated — resolve with what we have
      const resolved = buildResolvedContext(signals, assessment.overallConfidence, 'auto_draft');
      return { type: 'resolved', context: resolved };
    }

    // Create session for tracking the interview
    const session: SocraticSession = {
      id: randomUUID(),
      state: 'ASKING',
      surface,
      skill: skill || '',
      signals,
      assessment,
      questionsAsked: questions,
      answersReceived: [],
      resolvedContext: null,
      createdAt: Date.now(),
      maxQuestions: gapAnalysis.questionCount,
    };
    sessions.set(session.id, session);

    return { type: 'question', questions };
  }

  /**
   * Process an answer to a previously asked question.
   *
   * @param sessionId - The session ID from the assess() result
   * @param answerValue - The user's answer (from option.value)
   * @param questionIndex - Which question was answered (default 0)
   * @returns EngineResult — either resolved or more questions
   */
  async answer(
    sessionId: string,
    answerValue: string,
    questionIndex: number = 0
  ): Promise<EngineResult> {
    const session = sessions.get(sessionId);
    if (!session) {
      return { type: 'error', message: `Session not found: ${sessionId}` };
    }

    if (session.state !== 'ASKING') {
      return { type: 'error', message: `Session not in ASKING state: ${session.state}` };
    }

    const config = await getSocraticConfig();
    if (!config) {
      return { type: 'error', message: 'Socratic config unavailable' };
    }

    // Map the answer
    const question = session.questionsAsked[questionIndex];
    if (!question) {
      return { type: 'error', message: `No question at index ${questionIndex}` };
    }

    session.state = 'MAPPING';
    const mapped = mapAnswer(answerValue, question, session.signals, config, session.skill);
    session.answersReceived.push(mapped);

    // Check if we have enough confidence now or have asked enough questions
    const questionsRemaining = session.maxQuestions - session.answersReceived.length;
    const resolvedVia = session.maxQuestions === 1 ? 'single_question' : 'multi_question';

    if (mapped.newConfidence >= 0.85 || questionsRemaining <= 0) {
      // Resolve with gathered context
      const resolved = buildResolvedContext(
        session.signals,
        mapped.newConfidence,
        resolvedVia as any,
        session.answersReceived
      );
      session.state = 'RESOLVED';
      session.resolvedContext = resolved;
      return { type: 'resolved', context: resolved };
    }

    // Ask remaining questions (for ask_framing regime)
    const remainingQuestions = session.questionsAsked.slice(session.answersReceived.length);
    session.state = 'ASKING';
    return { type: 'question', questions: remainingQuestions };
  }

  /**
   * Get a session by ID.
   */
  getSession(sessionId: string): SocraticSession | undefined {
    return sessions.get(sessionId);
  }

  /**
   * Cancel/clean up a session.
   */
  cancelSession(sessionId: string): void {
    sessions.delete(sessionId);
  }

  /**
   * Get all active session IDs (for monitoring).
   */
  getActiveSessions(): string[] {
    cleanExpiredSessions();
    return Array.from(sessions.keys());
  }
}

// ==========================================
// Helpers
// ==========================================

/**
 * Build resolved context from signals and any gathered answers.
 */
function buildResolvedContext(
  signals: ContextSignals,
  confidence: number,
  resolvedVia: ResolvedContext['resolvedVia'],
  answers: MappedAnswer[] = []
): ResolvedContext {
  // Start with classification data
  let intent: IntentType = signals.classification?.intent || 'capture';
  let depth: DepthLevel = signals.classification?.depth || 'standard';
  let audience: AudienceType = signals.classification?.audience || 'self';
  let pillar: Pillar = signals.classification?.pillar || 'Personal';
  const extraContext: Record<string, string> = {};

  // Override with answer data (later answers take precedence)
  for (const answer of answers) {
    if (answer.resolved.intent) intent = answer.resolved.intent;
    if (answer.resolved.depth) depth = answer.resolved.depth;
    if (answer.resolved.audience) audience = answer.resolved.audience;
    if (answer.resolved.pillar) pillar = answer.resolved.pillar;
    if (answer.resolved.extraContext) {
      Object.assign(extraContext, answer.resolved.extraContext);
    }
  }

  return {
    intent,
    depth,
    audience,
    pillar,
    confidence,
    resolvedVia,
    extraContext,
    contactName: signals.contactData?.name,
    contentTopic: signals.contentSignals?.topic,
  };
}

// ==========================================
// Singleton
// ==========================================

let engineInstance: SocraticEngine | null = null;

/**
 * Get the singleton SocraticEngine instance.
 */
export function getSocraticEngine(): SocraticEngine {
  if (!engineInstance) {
    engineInstance = new SocraticEngine();
  }
  return engineInstance;
}
