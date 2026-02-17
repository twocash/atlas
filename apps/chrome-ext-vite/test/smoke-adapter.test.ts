import { describe, it, expect } from 'bun:test'
import {
  assessReplyContext,
  submitSocraticAnswer,
  cancelSocraticSession,
  getContextAssessment,
  getActiveSessions,
} from '../src/lib/socratic-adapter'
import { CONFIDENCE_THRESHOLDS } from '../src/types/socratic'
import type { LinkedInComment, CommentAuthor } from '../src/types/comments'

function makeAuthor(overrides: Partial<CommentAuthor> = {}): CommentAuthor {
  return {
    name: 'Jane Developer',
    headline: 'Senior Engineer',
    profileUrl: 'https://linkedin.com/in/janedev',
    linkedInDegree: '2nd',
    sector: 'AI/ML Specialist',
    groveAlignment: '⭐⭐⭐ Good',
    priority: 'High',
    ...overrides,
  }
}

function makeComment(overrides: Partial<LinkedInComment> = {}, authorOverrides: Partial<CommentAuthor> = {}): LinkedInComment {
  return {
    id: 'test-1',
    postId: 'post-1',
    postTitle: 'AI Infrastructure',
    author: makeAuthor(authorOverrides),
    content: 'Great post!',
    commentedAt: '2026-02-15T10:00:00Z',
    threadDepth: 0,
    childCount: 0,
    isMe: false,
    status: 'needs_reply',
    ...overrides,
  }
}

function makeRichComment(): LinkedInComment {
  return makeComment(
    {
      content: 'Fascinating take on distributed AI. We have been evaluating edge deployment and the latency improvements alone make the case.',
      commentUrl: 'https://linkedin.com/feed/update/urn:li:comment:123',
      notionPageId: 'eng-page-1',
      notionContactId: 'contact-page-1',
      parentAuthorName: 'Jim Calhoun',
    },
    {
      name: 'Alex Partner',
      headline: 'VP Engineering at Enterprise Co',
      linkedInDegree: '1st',
      sector: 'Enterprise Tech',
      groveAlignment: '⭐⭐⭐⭐ Strong Alignment',
      priority: 'High',
      tier: 'tier_1' as any,
      tierConfidence: 0.92,
      strategicBucket: 'Enterprise Clients',
      relationshipStage: 'Cultivating',
    }
  )
}

function makeSparseComment(): LinkedInComment {
  return makeComment(
    { content: 'Interesting!', commentUrl: undefined },
    {
      name: 'Unknown Person',
      headline: '',
      linkedInDegree: '3rd+',
      sector: 'Unknown',
      groveAlignment: '',
      priority: '',
    }
  )
}

describe('assessReplyContext', () => {
  it('auto-drafts for rich comment', () => {
    const result = assessReplyContext(makeRichComment())
    expect(result.type).toBe('resolved')
  })

  it('asks questions for sparse comment', () => {
    const result = assessReplyContext(makeSparseComment())
    expect(result.type).toBe('question')
    if (result.type === 'question') {
      expect(result.questions.length).toBeGreaterThanOrEqual(1)
      expect(result.sessionId).toBeTruthy()
    }
  })
})

describe('submitSocraticAnswer', () => {
  it('resolves after answering all questions', () => {
    const assessment = assessReplyContext(makeSparseComment())
    if (assessment.type !== 'question') return

    let result = submitSocraticAnswer(assessment.sessionId, 'build_relationship', 0)
    while (result.type === 'question') {
      result = submitSocraticAnswer(result.sessionId, 'community_member', 0)
    }
    expect(result.type).toBe('resolved')
  })

  it('returns error for unknown session', () => {
    const result = submitSocraticAnswer('nonexistent', 'test', 0)
    expect(result.type).toBe('error')
  })
})

describe('getContextAssessment', () => {
  it('returns assessment without session', () => {
    const before = getActiveSessions()
    const assessment = getContextAssessment(makeRichComment())
    expect(getActiveSessions()).toBe(before)
    expect(assessment.regime).toBe('auto_draft')
  })
})
