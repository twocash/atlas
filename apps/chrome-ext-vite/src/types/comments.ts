/**
 * Comment and Reply types for the engagement workflow
 */

export interface CommentAuthor {
  name: string
  headline: string
  profileUrl: string
  linkedInDegree: string        // "1st", "2nd", "3rd+"
  sector: string                // AI/ML Specialist, Academia, etc.
  groveAlignment: string        // ⭐⭐⭐⭐ Strong Alignment, etc.
  priority: string              // High, Medium, Standard, Low
}

export interface LinkedInComment {
  id: string                    // Unique ID (from PB or Notion)
  postId: string                // Which post this comment is on
  postTitle: string             // Post title for context
  author: CommentAuthor
  content: string               // The actual comment text
  commentUrl?: string           // Direct link to comment thread
  commentedAt: string           // ISO date

  // Reply tracking
  status: 'needs_reply' | 'draft_in_progress' | 'replied' | 'no_reply_needed'
  draftReply?: string           // Current draft
  finalReply?: string           // What was actually posted
  repliedAt?: string            // When we replied
  hiddenLocally?: boolean       // Locally hidden (not synced to Notion)

  // Notion sync
  notionPageId?: string         // Engagement page ID in Notion
  notionContactId?: string      // Contact page ID in Notion (for "View in Notion" link)

  // Source tracking
  extractedFromDom?: boolean    // true = DOM extraction, false/undefined = PB pipeline
}

export interface ReplyDraftRequest {
  comment: LinkedInComment
  instruction?: string          // User's refinement feedback
  style?: 'shorter' | 'longer' | 'casual' | 'professional' | 'add_question' | 'reference_grove'
  previousDraft?: string        // For iterative refinement
}

export interface ReplyDraftResponse {
  draft: string
  reasoning?: string            // Why Claude chose this approach
}

export interface CommentsState {
  comments: LinkedInComment[]
  lastFetched?: string
}

export const DEFAULT_COMMENTS_STATE: CommentsState = {
  comments: [],
}

/**
 * Grove voice/thesis context for reply drafting
 */
export const GROVE_CONTEXT = `
You are helping Jim Calhoun draft replies to LinkedIn comments on his posts about AI infrastructure.

## Jim's Voice
- Conversational but substantive
- Asks genuine questions to continue dialogue
- Connects ideas back to distributed/decentralized AI infrastructure
- Avoids corporate buzzwords, prefers plain language
- Acknowledges good points before building on them
- Brief but not curt — 2-4 sentences typical

## The Grove Thesis (reference when relevant)
- Concentrated AI infrastructure (like Stargate) creates fragility and dependency
- Distributed, edge-based AI democratizes access and builds resilience
- Open source + local compute = sovereignty over your AI
- The "training ratchet" means local models keep getting better
- Collective intelligence > centralized control

## Reply Guidelines
- Match the energy of the original comment
- If they asked a question, answer it directly first
- Add value — share an insight, pose a question, or offer a resource
- Keep it authentic, not promotional
- End with engagement hook when natural (question, invitation to discuss)
`
