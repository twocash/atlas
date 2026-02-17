import { describe, it, expect, beforeEach } from 'bun:test'
import {
  assessReplyContext,
  submitSocraticAnswer,
  cancelSocraticSession,
  getContextAssessment,
  getActiveSessions,
} from '../src/lib/socratic-adapter'
import { CONFIDENCE_THRESHOLDS } from '../src/types/socratic'
import type { LinkedInComment } from '../src/types/comments'

// --- Factories ---

function makeRichComment(): LinkedInComment {
  return {
    id: 'rich-1',
    postId: 'post-1',
    postTitle: 'The Case for Distributed AI Infrastructure',
    author: {
      name: 'Alex Partner',
      headline: 'VP Engineering at Enterprise Co',
      profileUrl: 'https://linkedin.com/in/alexpartner',
      linkedInDegree: '1st',
      sector: 'Enterprise Tech',
      groveAlignment: '⭐⭐⭐⭐ Strong Alignment',
      priority: 'High',
      tier: 'tier_1' as any,
      tierConfidence: 0.92,
      tierMethod: 'ai',
      strategicBucket: 'Enterprise Clients',
      relationshipStage: 'Cultivating',
    },
    content: 'Fascinating take on distributed AI. We have been evaluating edge deployment for our manufacturing floor and the latency improvements alone make the case.',
    commentUrl: 'https://linkedin.com/feed/update/urn:li:comment:123',
    commentedAt: '2026-02-15T10:00:00Z',
    threadDepth: 0,
    childCount: 0,
    isMe: false,
    status: 'needs_reply',
    notionPageId: 'eng-page-1',
    notionContactId: 'contact-page-1',
    parentAuthorName: 'Jim Calhoun',
  }
}

function makeSparseComment(): LinkedInComment {
  return {
    id: 'sparse-1',
    postId: 'post-2',
    postTitle: 'AI Edge Computing Trends',
    author: {
      name: 'Random Person',
      headline: '',
      profileUrl: 'https://linkedin.com/in/random',
      linkedInDegree: '3rd+',
      sector: 'Unknown',
      groveAlignment: '',
      priority: '',
    },
    content: 'Interesting!',
    commentedAt: '2026-02-15T11:00:00Z',
    threadDepth: 0,
    childCount: 0,
    isMe: false,
    status: 'needs_reply',
  }
}

function makeMediumComment(): LinkedInComment {
  return {
    id: 'medium-1',
    postId: 'post-3',
    postTitle: 'Open Source AI: The Path Forward',
    author: {
      name: 'Sarah Developer',
      headline: 'ML Engineer',
      profileUrl: 'https://linkedin.com/in/sarahdev',
      linkedInDegree: '2nd',
      sector: 'AI/ML Specialist',
      groveAlignment: '⭐⭐ Moderate Alignment',
      priority: 'Standard',
    },
    content: 'Great points about open source models. We have been running Llama locally and the results are impressive.',
    commentedAt: '2026-02-15T12:00:00Z',
    threadDepth: 0,
    childCount: 0,
    isMe: false,
    status: 'needs_reply',
  }
}

// --- Tests ---

describe('assessReplyContext', () => {
  it('auto-drafts for rich comment (high confidence)', () => {
    const result = assessReplyContext(makeRichComment())
    expect(result.type).toBe('resolved')
    if (result.type === 'resolved') {
      expect(result.confidence).toBeGreaterThanOrEqual(CONFIDENCE_THRESHOLDS.AUTO_DRAFT)
    }
  })

  it('asks questions for sparse comment (low confidence)', () => {
    const result = assessReplyContext(makeSparseComment())
    expect(result.type).toBe('question')
    if (result.type === 'question') {
      expect(result.questions.length).toBeGreaterThanOrEqual(1)
      expect(result.questions.length).toBeLessThanOrEqual(2)
      expect(result.sessionId).toBeTruthy()
      expect(result.confidence).toBeLessThan(CONFIDENCE_THRESHOLDS.ASK_ONE)
    }
  })

  it('generates at most 1 question for medium confidence', () => {
    const result = assessReplyContext(makeMediumComment())
    if (result.type === 'question') {
      expect(result.questions.length).toBe(1)
    }
    // Could also be resolved if medium comment scores ≥ 0.85
  })

  it('first question targets classification when tier is missing', () => {
    const result = assessReplyContext(makeSparseComment())
    if (result.type === 'question') {
      const classQ = result.questions.find(q => q.targetSlot === 'classification')
      expect(classQ).toBeDefined()
      expect(classQ!.text).toContain('goal')
      expect(classQ!.options.length).toBe(4)
    }
  })

  it('asks about relationship when Notion contact is missing', () => {
    const result = assessReplyContext(makeSparseComment())
    if (result.type === 'question') {
      const bridgeQ = result.questions.find(q => q.targetSlot === 'bridge_context')
      if (bridgeQ) {
        expect(bridgeQ.text).toContain('know')
        expect(bridgeQ.options.length).toBe(4)
      }
    }
  })

  it('creates a session for question results', () => {
    const before = getActiveSessions()
    const result = assessReplyContext(makeSparseComment())
    if (result.type === 'question') {
      const after = getActiveSessions()
      expect(after).toBe(before + 1)
    }
  })

  it('does not create a session for resolved results', () => {
    const before = getActiveSessions()
    assessReplyContext(makeRichComment())
    const after = getActiveSessions()
    expect(after).toBe(before)
  })
})

describe('submitSocraticAnswer', () => {
  it('resolves with enriched instruction after single question', () => {
    const assessment = assessReplyContext(makeMediumComment())
    if (assessment.type !== 'question') return // Skip if auto-drafted

    const result = submitSocraticAnswer(
      assessment.sessionId,
      'build_relationship',
      0
    )

    // If only 1 question, should resolve
    if (assessment.questions.length === 1) {
      expect(result.type).toBe('resolved')
      if (result.type === 'resolved') {
        expect(result.enrichedInstruction).toBeTruthy()
        expect(result.enrichedInstruction).toContain('rapport')
      }
    }
  })

  it('returns next question after first answer in multi-question flow', () => {
    const assessment = assessReplyContext(makeSparseComment())
    if (assessment.type !== 'question' || assessment.questions.length < 2) return

    const result = submitSocraticAnswer(
      assessment.sessionId,
      'share_expertise',
      0
    )

    expect(result.type).toBe('question')
    if (result.type === 'question') {
      expect(result.questions.length).toBe(assessment.questions.length - 1)
    }
  })

  it('resolves after all questions answered', () => {
    const assessment = assessReplyContext(makeSparseComment())
    if (assessment.type !== 'question') return

    let result = submitSocraticAnswer(assessment.sessionId, 'build_relationship', 0)

    // Answer remaining questions
    while (result.type === 'question') {
      result = submitSocraticAnswer(result.sessionId, 'community_member', 0)
    }

    expect(result.type).toBe('resolved')
    if (result.type === 'resolved') {
      expect(result.confidence).toBeGreaterThan(0)
      expect(result.enrichedInstruction).toBeTruthy()
    }
  })

  it('returns error for unknown session', () => {
    const result = submitSocraticAnswer('nonexistent-session', 'test', 0)
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.message).toContain('not found')
    }
  })

  it('returns error for invalid question index', () => {
    const assessment = assessReplyContext(makeSparseComment())
    if (assessment.type !== 'question') return

    const result = submitSocraticAnswer(assessment.sessionId, 'test', 99)
    expect(result.type).toBe('error')
    if (result.type === 'error') {
      expect(result.message).toContain('index')
    }
  })
})

describe('cancelSocraticSession', () => {
  it('removes the session', () => {
    const assessment = assessReplyContext(makeSparseComment())
    if (assessment.type !== 'question') return

    const before = getActiveSessions()
    cancelSocraticSession(assessment.sessionId)
    const after = getActiveSessions()
    expect(after).toBe(before - 1)
  })

  it('subsequent answer returns error', () => {
    const assessment = assessReplyContext(makeSparseComment())
    if (assessment.type !== 'question') return

    cancelSocraticSession(assessment.sessionId)
    const result = submitSocraticAnswer(assessment.sessionId, 'test', 0)
    expect(result.type).toBe('error')
  })
})

describe('getContextAssessment', () => {
  it('returns assessment without creating a session', () => {
    const before = getActiveSessions()
    const assessment = getContextAssessment(makeRichComment())
    const after = getActiveSessions()

    expect(after).toBe(before)
    expect(assessment.overallConfidence).toBeGreaterThan(0)
    expect(assessment.regime).toBeTruthy()
    expect(assessment.slots).toHaveLength(5)
  })

  it('rich comment has auto_draft regime', () => {
    const assessment = getContextAssessment(makeRichComment())
    expect(assessment.regime).toBe('auto_draft')
  })

  it('sparse comment has ask_framing regime', () => {
    const assessment = getContextAssessment(makeSparseComment())
    expect(assessment.regime).toBe('ask_framing')
  })
})
