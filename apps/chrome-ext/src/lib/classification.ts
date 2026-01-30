/**
 * Contact classification engine
 * Ported from phantombuster_etl.py
 */

// --- Sector Classification ---

const SECTOR_KEYWORDS: Record<string, string[]> = {
  'AI/ML Specialist': [
    'artificial intelligence', ' ai ', 'machine learning', 'deep learning',
    'nlp', 'llm', 'large language', 'neural', 'computer vision', 'data scientist',
    'ml engineer', 'ai engineer', 'ai researcher', 'generative ai', 'gpt',
    'transformer', 'reinforcement learning', 'ai/ml', 'ai &', '& ai',
  ],
  'Academia': [
    'professor', ' phd', 'researcher', 'university', 'academic', 'postdoc',
    'faculty', 'graduate student', 'doctoral', 'lecturer', 'adjunct',
    'research fellow', 'lab director', 'dean', 'provost',
  ],
  'Investor': [
    'venture capital', 'investor', 'angel investor', 'partner at', 'fund manager',
    'vc ', ' vc', 'capital', 'portfolio', 'limited partner', 'seed',
    'series a', 'series b', 'venture partner',
  ],
  'Influencer': [
    'thought leader', 'speaker', 'keynote', 'author of', 'podcast',
    'content creator', 'influencer', 'evangelist', 'community builder',
    'newsletter', 'youtuber', 'creator economy',
  ],
  'Job Seeker': [
    'seeking', 'looking for', 'open to work', 'job search', 'available for',
    'actively looking', 'career transition', 'between roles',
  ],
  'Corporate': [
    'vp ', 'vice president', 'director of', 'head of', 'chief',
    'ceo', 'cfo', 'coo', 'cio', 'cto', 'enterprise', 'manager at',
    'senior director', 'svp', 'evp', 'general manager',
  ],
  'Tech': [
    'software', 'developer', 'engineer', 'devops', 'cloud', 'saas',
    'platform', 'startup', 'full stack', 'frontend', 'backend',
    'architect', 'infrastructure', 'systems', 'open source',
    'distributed', 'blockchain', 'web3', 'product manager', 'tech lead',
  ],
}

// Grove alignment keywords
const GROVE_STRONG_KEYWORDS = [
  'distributed', 'decentraliz', 'edge computing', 'peer-to-peer', 'p2p',
  'local-first', 'knowledge graph', 'collective intelligence', 'cognitive',
  'open source ai', 'federated', 'hybrid intelligence', 'autonomous agent',
  'multi-agent', 'knowledge commons', 'infrastructure', 'self-sovereign',
  'exploration', 'declarative', 'ai village', 'personal ai',
]

const GROVE_MODERATE_KEYWORDS = [
  'ai agent', 'llm', 'language model', 'open source', 'privacy',
  'developer tool', 'local ai', 'on-device', 'ai infrastructure',
  'knowledge management', 'second brain', 'personal knowledge',
  'ai assistant', 'copilot', 'rag', 'retrieval', 'embedding',
]

// Strategic bucket keywords
const BUCKET_GOVERNANCE_KEYWORDS = [
  'policy', 'governance', 'ethics', 'regulation', 'compliance', 'legal',
  'responsible ai', 'ai safety', 'alignment', 'trust', 'fairness',
]

const BUCKET_SENIOR_TITLES = [
  'ceo', 'cfo', 'coo', 'cto', 'cio', 'vp ', 'vice president', 'svp',
  'evp', 'director', 'partner', 'founder', 'co-founder', 'head of',
  'chief', 'general manager', 'managing director',
]

// --- Classification Functions ---

export function classifySector(headline: string): string {
  const hl = ` ${headline.toLowerCase()} `

  // Check in priority order
  for (const sector of ['AI/ML Specialist', 'Academia', 'Investor', 'Influencer', 'Job Seeker', 'Corporate', 'Tech']) {
    for (const kw of SECTOR_KEYWORDS[sector]!) {
      if (hl.includes(kw)) {
        return sector
      }
    }
  }
  return 'Other'
}

export function classifyGroveAlignment(
  headline: string,
  commentText: string = '',
  hasCommented: boolean = false,
  hasLiked: boolean = false
): string {
  const hl = ` ${headline.toLowerCase()} `
  const ct = commentText ? ` ${commentText.toLowerCase()} ` : ''
  const combined = hl + ct

  let score = 0

  // Strong keyword matches
  for (const kw of GROVE_STRONG_KEYWORDS) {
    if (combined.includes(kw)) {
      score += 3
    }
  }

  // Moderate keyword matches
  for (const kw of GROVE_MODERATE_KEYWORDS) {
    if (combined.includes(kw)) {
      score += 1
    }
  }

  // Engagement bonuses
  if (hasCommented && commentText.length > 50) {
    score += 2 // Substantive commenter
  } else if (hasCommented) {
    score += 1
  }
  if (hasLiked) {
    score += 0.5
  }

  if (score >= 8) {
    return '⭐⭐⭐⭐⭐ Strong Thesis Alignment'
  } else if (score >= 5) {
    return '⭐⭐⭐⭐ Good Alignment'
  } else if (score >= 3) {
    return '⭐⭐⭐ Moderate Interest'
  } else if (score >= 1) {
    return '⭐⭐ Peripheral Interest'
  } else {
    return '⭐ Minimal Alignment'
  }
}

export function classifyStrategicBuckets(headline: string, sector: string): string[] {
  const hl = ` ${headline.toLowerCase()} `
  const buckets: string[] = []

  if (sector === 'Academia') {
    buckets.push('University Pipeline')
  }

  if (sector === 'AI/ML Specialist' || sector === 'Tech') {
    for (const kw of ['open source', 'contributor', 'maintainer', 'developer', 'engineer', 'architect', 'infrastructure', 'distributed', 'systems']) {
      if (hl.includes(kw)) {
        buckets.push('Technical Contributors')
        break
      }
    }
  }

  if (sector === 'Influencer' || sector === 'Corporate') {
    for (const kw of BUCKET_SENIOR_TITLES) {
      if (hl.includes(kw)) {
        buckets.push('Content Amplifiers')
        break
      }
    }
    if (sector === 'Influencer' && !buckets.includes('Content Amplifiers')) {
      buckets.push('Content Amplifiers')
    }
  }

  for (const kw of BUCKET_GOVERNANCE_KEYWORDS) {
    if (hl.includes(kw)) {
      buckets.push('Governance/Policy')
      break
    }
  }

  // Potential Advisors: senior people with relevant backgrounds
  for (const kw of BUCKET_SENIOR_TITLES) {
    if (hl.includes(kw)) {
      for (const akw of ['ai', 'infrastructure', 'platform', 'distributed', 'open source', 'venture', 'investor', 'research']) {
        if (hl.includes(akw)) {
          if (!buckets.includes('Potential Advisors')) {
            buckets.push('Potential Advisors')
          }
          break
        }
      }
      break
    }
  }

  if (sector === 'Corporate') {
    for (const kw of ['enterprise', 'saas', 'b2b', 'platform', 'digital transformation']) {
      if (hl.includes(kw)) {
        buckets.push('Enterprise Clients')
        break
      }
    }
  }

  // Dedupe
  return [...new Set(buckets)]
}

export function classifyPriority(alignment: string, hasCommented: boolean, commentText: string = ''): string {
  const isStrong = alignment.includes('Strong') || alignment.includes('Good')
  const isSubstantive = hasCommented && commentText.length > 50

  if (isStrong && isSubstantive) {
    return 'High'
  } else if (isStrong || isSubstantive) {
    return 'Medium'
  } else if (alignment.includes('Moderate')) {
    return 'Standard'
  } else {
    return 'Low'
  }
}

export function classifySalesNavStatus(sector: string, buckets: string[]): string {
  // Priority 1: Bucket-based (most specific)
  if (buckets.includes('University Pipeline')) {
    return 'Saved - Academic'
  }
  if (buckets.includes('Enterprise Clients')) {
    return 'Saved - Enterprise'
  }

  // Priority 2: Sector-based
  if (sector === 'AI/ML Specialist' || sector === 'Tech' || buckets.includes('Technical Contributors')) {
    return 'Saved - Technical'
  }
  if (sector === 'Influencer' || buckets.includes('Content Amplifiers')) {
    return 'Saved - Influencer'
  }
  if (sector === 'Academia') {
    return 'Saved - Academic'
  }
  if (sector === 'Corporate' || sector === 'Investor') {
    return 'Saved - Enterprise'
  }

  // Priority 3: Default for engaged contacts (Job Seekers, Other, etc.)
  // Anyone who engaged with your content is worth following → assign to Technical (broadest category)
  return 'Saved - Technical'
}

// --- Full Classification Pipeline ---

export interface PBLead {
  memberId?: string
  fullName?: string
  firstName?: string
  lastName?: string
  profileUrl?: string
  profileLink?: string
  occupation?: string
  degree?: string
  hasCommented?: string
  hasLiked?: string
  comments?: string
  commentUrl?: string
  lastCommentedAt?: string
  timestamp?: string
  postsUrl?: string
  postContent?: string

  // Enriched profile data from Profile Scraper
  companyName?: string
  linkedinCompanyUrl?: string
  salesNavigatorCompanyUrl?: string
  linkedinJobTitle?: string
  linkedinJobDateRange?: string
  linkedinJobLocation?: string
  companyIndustry?: string
  location?: string
  linkedinFollowersCount?: string | number
  linkedinDescription?: string
  linkedinSkillsLabel?: string
  linkedinIsHiringBadge?: string
  linkedinIsOpenToWorkBadge?: string
  previousCompanyName?: string
  linkedinPreviousJobTitle?: string
  linkedinSchoolName?: string
  linkedinSchoolDegree?: string
}

export interface ClassificationResult {
  sector: string
  alignment: string
  buckets: string[]
  priority: string
  salesNav: string
}

export function classifyContact(lead: PBLead): ClassificationResult {
  const headline = lead.occupation || ''
  const commentText = lead.comments || ''
  const hasCommented = lead.hasCommented === 'true'
  const hasLiked = lead.hasLiked === 'true'

  const sector = classifySector(headline)
  const alignment = classifyGroveAlignment(headline, commentText, hasCommented, hasLiked)
  const buckets = classifyStrategicBuckets(headline, sector)
  const priority = classifyPriority(alignment, hasCommented, commentText)
  const salesNav = classifySalesNavStatus(sector, buckets)

  return { sector, alignment, buckets, priority, salesNav }
}

// --- Degree Mapping ---

export const DEGREE_MAP: Record<string, string> = {
  '1st': '1st',
  '2nd': '2nd',
  '3rd': '3rd+',
  '3rd+': '3rd+',
  'Following': 'Following',
}
