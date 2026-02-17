import { describe, it, expect } from 'bun:test'
import { scoreContextSlots } from '../src/lib/socratic-context-builder'
import { CONTEXT_WEIGHTS } from '../src/types/socratic'
import type { LinkedInComment, CommentAuthor } from '../src/types/comments'

// --- Factories ---

function makeAuthor(overrides: Partial<CommentAuthor> = {}): CommentAuthor {
  return {
    name: 'Jane Developer',
    headline: 'Senior Engineer at TechCorp',
    profileUrl: 'https://linkedin.com/in/janedev',
    linkedInDegree: '2nd',
    sector: 'AI/ML Specialist',
    groveAlignment: '⭐⭐⭐ Good Alignment',
    priority: 'High',
    ...overrides,
  }
}

function makeComment(overrides: Partial<LinkedInComment> = {}, authorOverrides: Partial<CommentAuthor> = {}): LinkedInComment {
  return {
    id: 'test-1',
    postId: 'post-1',
    postTitle: 'Test Post About AI Infrastructure',
    author: makeAuthor(authorOverrides),
    content: 'Great post! This really resonates with what we are building.',
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
      content: 'Fascinating take on distributed AI. We have been evaluating edge deployment for our manufacturing floor and the latency improvements alone make the case. Would love to compare notes.',
      commentUrl: 'https://linkedin.com/feed/update/urn:li:comment:123',
      notionPageId: 'eng-page-1',
      notionContactId: 'contact-page-1',
      parentAuthorName: 'Jim Calhoun',
    },
    {
      name: 'Alex Partner',
      headline: 'VP Engineering at Enterprise Co',
      profileUrl: 'https://linkedin.com/in/alexpartner',
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
      profileUrl: 'https://linkedin.com/in/unknown',
      linkedInDegree: '3rd+',
      sector: 'Unknown',
      groveAlignment: '',
      priority: '',
    }
  )
}

// --- Tests ---

describe('scoreContextSlots', () => {
  it('returns exactly 5 slot scores', () => {
    const scores = scoreContextSlots(makeComment())
    expect(scores).toHaveLength(5)
    expect(scores.map(s => s.slot)).toEqual([
      'contact_data',
      'content_signals',
      'classification',
      'bridge_context',
      'skill_requirements',
    ])
  })

  it('weights sum to 1.0', () => {
    const sum = Object.values(CONTEXT_WEIGHTS).reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - 1.0)).toBeLessThan(0.001)
  })

  it('slot completeness is between 0 and 1', () => {
    const scores = scoreContextSlots(makeComment())
    for (const s of scores) {
      expect(s.completeness).toBeGreaterThanOrEqual(0)
      expect(s.completeness).toBeLessThanOrEqual(1)
    }
  })

  it('contribution = completeness * weight', () => {
    const scores = scoreContextSlots(makeComment())
    for (const s of scores) {
      expect(Math.abs(s.contribution - s.completeness * CONTEXT_WEIGHTS[s.slot]))
        .toBeLessThan(0.001)
    }
  })

  it('rich comment scores high overall confidence', () => {
    const scores = scoreContextSlots(makeRichComment())
    const total = scores.reduce((sum, s) => sum + s.contribution, 0)
    expect(total).toBeGreaterThanOrEqual(0.85)
  })

  it('sparse comment scores low overall confidence', () => {
    const scores = scoreContextSlots(makeSparseComment())
    const total = scores.reduce((sum, s) => sum + s.contribution, 0)
    expect(total).toBeLessThan(0.50)
  })

  it('skill_requirements is always 1.0 for LinkedIn replies', () => {
    const scores = scoreContextSlots(makeComment())
    const skill = scores.find(s => s.slot === 'skill_requirements')!
    expect(skill.completeness).toBe(1.0)
    expect(skill.gaps).toHaveLength(0)
  })

  it('identifies correct gaps for sparse contact data', () => {
    const scores = scoreContextSlots(makeSparseComment())
    const contact = scores.find(s => s.slot === 'contact_data')!
    expect(contact.gaps).toContain('sector')
    expect(contact.gaps).toContain('grove alignment')
    expect(contact.gaps).toContain('strategic bucket')
    expect(contact.gaps).toContain('relationship stage')
  })

  it('bridge_context scores higher with Notion records', () => {
    const withNotion = scoreContextSlots(makeComment({ notionPageId: 'eng-1', notionContactId: 'contact-1' }))
    const withoutNotion = scoreContextSlots(makeComment())

    const bridgeWith = withNotion.find(s => s.slot === 'bridge_context')!
    const bridgeWithout = withoutNotion.find(s => s.slot === 'bridge_context')!
    expect(bridgeWith.completeness).toBeGreaterThan(bridgeWithout.completeness)
  })

  it('content_signals scores higher for longer comments', () => {
    const short = scoreContextSlots(makeComment({ content: 'Nice!' }))
    const long = scoreContextSlots(makeComment({
      content: 'This is a very detailed comment that explains my thoughts about distributed AI and how it connects to our work in edge computing. The implications for sovereignty and resilience are profound and worth exploring further.',
    }))

    const shortContent = short.find(s => s.slot === 'content_signals')!
    const longContent = long.find(s => s.slot === 'content_signals')!
    expect(longContent.completeness).toBeGreaterThan(shortContent.completeness)
  })

  it('classification scores higher with tier data', () => {
    const withTier = scoreContextSlots(makeComment({}, {
      tier: 'tier_1' as any,
      tierConfidence: 0.9,
      priority: 'High',
    }))
    const withoutTier = scoreContextSlots(makeComment({}, {
      tier: undefined,
      tierConfidence: undefined,
      priority: '',
    }))

    const classWith = withTier.find(s => s.slot === 'classification')!
    const classWithout = withoutTier.find(s => s.slot === 'classification')!
    expect(classWith.completeness).toBeGreaterThan(classWithout.completeness)
  })

  it('1st-degree connections get bonus contact_data score', () => {
    const first = scoreContextSlots(makeComment({}, { linkedInDegree: '1st' }))
    const third = scoreContextSlots(makeComment({}, { linkedInDegree: '3rd+' }))

    const contactFirst = first.find(s => s.slot === 'contact_data')!
    const contactThird = third.find(s => s.slot === 'contact_data')!
    expect(contactFirst.completeness).toBeGreaterThan(contactThird.completeness)
  })
})
