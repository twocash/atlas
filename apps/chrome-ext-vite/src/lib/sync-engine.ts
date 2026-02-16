/**
 * Sync Engine - Orchestrates PB → Classification → Notion → Comments pipeline
 */

import { Storage } from "~src/lib/chrome-storage"
import { STORAGE_KEYS } from "./storage"
import { debugLog } from "./debug-log"
import { PB_S3_BASE } from "~src/types/phantombuster"
import { PB_PHANTOM_CONFIG } from "~src/types/posts"
import { fetchAgentConfig, hasApiKey as hasPbApiKey } from "./phantombuster-api"
import {
  NOTION_DBS,
  queryDatabase,
  createPage,
  updatePage,
  findContactByMemberId,
  findContactByLinkedInUrl,
  findPostByUrl,
  getEngagementsNeedingReply,
  findEngagement,
  prefetchContactCache,
  clearContactCache,
  richText,
  title,
  select,
  multiSelect,
  url,
  date,
  relation,
  type NotionPage,
} from "./notion-api"
import {
  classifyContact,
  DEGREE_MAP,
  type PBLead,
} from "./classification"
import type { LinkedInComment, CommentAuthor } from "~src/types/comments"

const storage = new Storage({ area: "local" })

// --- Configuration ---

/**
 * Minimum characters for a comment to warrant a reply.
 * Lowered from 50 to 15 - catch short but meaningful questions:
 * - "DM sent" (7 chars) → Now caught
 * - "Link broken?" (12 chars) → Now caught
 * - "Can we chat?" (12 chars) → Now caught
 *
 * If someone typed more than a few characters, it deserves a glance.
 * Takes 0.5s to dismiss but huge effort to recover a missed lead.
 */
const MIN_CHARS_FOR_REPLY = 15

/**
 * Days to look back when resurrecting comments that may have been
 * incorrectly marked as "No Reply Needed" due to old 50-char threshold.
 */
const RESURRECTION_WINDOW_DAYS = 4

// --- Sync State ---

interface SyncState {
  syncedContacts: Record<string, string>      // memberId -> Notion page ID
  syncedEngagements: Record<string, string>   // "memberId:type:postUrl" -> Notion page ID
  syncedPosts: Record<string, string>         // postUrl -> Notion page ID
  lastSync?: string
}

const DEFAULT_SYNC_STATE: SyncState = {
  syncedContacts: {},
  syncedEngagements: {},
  syncedPosts: {},
}

async function loadSyncState(): Promise<SyncState> {
  const state = await storage.get<SyncState>(STORAGE_KEYS.SYNC_STATE)
  return state || DEFAULT_SYNC_STATE
}

async function saveSyncState(state: SyncState): Promise<void> {
  state.lastSync = new Date().toISOString()
  await storage.set(STORAGE_KEYS.SYNC_STATE, state)
}

// --- PB Fetching ---

async function fetchPBResults(agentId: string, s3FolderOverride?: string): Promise<PBLead[]> {
  try {
    let s3Folder = s3FolderOverride

    // If no override, try to get from API
    if (!s3Folder) {
      try {
        await debugLog('orchestrator', `Trying API for ${agentId}...`)
        const config = await fetchAgentConfig(agentId)
        s3Folder = config.s3Folder
      } catch (e) {
        await debugLog('orchestrator', `API failed, using hardcoded S3 folder`)
      }
    }

    if (!s3Folder) {
      await debugLog('orchestrator', `No S3 folder for agent ${agentId}`)
      return []
    }

    const url = `${PB_S3_BASE}/${s3Folder}/result.json`
    await debugLog('orchestrator', `Fetching S3: ${url}`)

    const resp = await fetch(url)
    if (resp.ok) {
      const data = await resp.json()
      await debugLog('orchestrator', `Got ${Array.isArray(data) ? data.length : 0} results`)
      return Array.isArray(data) ? data : []
    }
    await debugLog('orchestrator', `S3 fetch failed (${resp.status})`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await debugLog('orchestrator', `PB fetch error: ${msg}`)
  }
  return []
}

async function fetchAllPBLeads(): Promise<PBLead[]> {
  const allLeads: Record<string, PBLead> = {}

  // Single phantom: LinkedIn Post Monitoring (connected to Google Sheets)
  // Workflow: Post on LinkedIn → Paste URL in Google Sheet → Done
  const config = PB_PHANTOM_CONFIG
  await debugLog('orchestrator', `--- Fetching ${config.name} (${config.id}) ---`)
  const leads = await fetchPBResults(config.id, config.s3Folder || undefined)
  await debugLog('orchestrator', `${config.name}: ${leads.length} leads`)

  for (const lead of leads) {
    const mid = lead.memberId || ''
    if (mid && !allLeads[mid]) {
      allLeads[mid] = lead
    } else if (mid && allLeads[mid]) {
      // Merge — keep the record with more data (comments)
      if (lead.comments && !allLeads[mid]!.comments) {
        allLeads[mid] = lead
      }
    }
  }

  return Object.values(allLeads)
}

// --- Notion Sync ---

async function ensurePostExists(postUrl: string, postContent: string = ''): Promise<string | null> {
  // Check if already synced
  const state = await loadSyncState()
  if (state.syncedPosts[postUrl]) {
    return state.syncedPosts[postUrl]!
  }

  // Check Notion
  const existing = await findPostByUrl(postUrl)
  if (existing) {
    state.syncedPosts[postUrl] = existing.id
    await saveSyncState(state)
    return existing.id
  }

  // Create new post
  const postTitle = postContent.slice(0, 80).split('\n')[0] || 'Untitled Post'
  try {
    const page = await createPage(NOTION_DBS.POSTS, {
      'Title': title(postTitle),
      'LinkedIn URL': url(postUrl),
      'Status': select('Published'),
    })
    state.syncedPosts[postUrl] = page.id
    await saveSyncState(state)
    console.log(`[Sync] Created post: ${postTitle.slice(0, 40)}...`)
    return page.id
  } catch (e) {
    console.error(`[Sync] Failed to create post:`, e)
    return null
  }
}

async function upsertContact(lead: PBLead, state: SyncState): Promise<string | null> {
  const memberId = lead.memberId || ''
  const rawUrl = lead.profileUrl || lead.profileLink || ''
  const name = lead.fullName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim()

  if (!rawUrl || !name) {
    return null
  }

  // Normalize URL BEFORE storing/searching (strip www, trailing slash, ensure https)
  const linkedInUrl = rawUrl
    .toLowerCase()
    .replace('http://', 'https://')
    .replace('https://www.linkedin.com', 'https://linkedin.com')
    .replace(/\/$/, '') + '/'

  // ALWAYS check Notion first - LinkedIn URL is primary (memberIds change!)
  let existing = await findContactByLinkedInUrl(linkedInUrl)
  if (!existing && memberId) {
    existing = await findContactByMemberId(memberId)
  }

  const classification = classifyContact(lead)
  const degree = DEGREE_MAP[lead.degree || ''] || 'Unknown'
  const today = new Date().toISOString().slice(0, 10)

  if (existing) {
    // Update existing contact with latest classification AND enrichment
    state.syncedContacts[memberId] = existing.id
    try {
      const updates: Record<string, unknown> = {
        'Last Active': date(today),
        'Sector': select(classification.sector),
        'Grove Alignment': select(classification.alignment),
        'Priority': select(classification.priority),
        'Sales Nav List Status': select(classification.salesNav),
      }

      // Set Connection Status if not already set (don't overwrite "Following" or "Connected")
      const existingStatus = (existing.properties as any)?.['Connection Status']?.select?.name
      if (!existingStatus) {
        updates['Connection Status'] = select('Not Connected')
      }

      // Update enriched fields if available
      if (lead.companyName) {
        updates['Company'] = richText(lead.companyName)
      }
      if (lead.linkedinFollowersCount) {
        updates['Follower Count'] = { number: parseInt(String(lead.linkedinFollowersCount)) || 0 }
      }
      if (lead.linkedinJobTitle) {
        updates['Current Job Title'] = richText(lead.linkedinJobTitle)
      }
      if (lead.companyIndustry) {
        updates['Industry'] = richText(lead.companyIndustry)
      }
      if (lead.location) {
        updates['Location'] = richText(lead.location)
      }
      if (lead.linkedinDescription) {
        updates['About'] = richText(lead.linkedinDescription.slice(0, 2000))
      }
      if (lead.linkedinSkillsLabel) {
        updates['Skills'] = richText(lead.linkedinSkillsLabel.slice(0, 2000))
      }
      if (lead.linkedinIsOpenToWorkBadge === 'Yes') {
        updates['Open to Work'] = { checkbox: true }
      }
      if (lead.salesNavigatorCompanyUrl) {
        updates['Sales Navigator URL'] = url(lead.salesNavigatorCompanyUrl)
      }
      if (classification.buckets.length > 0) {
        updates['Strategic Bucket'] = multiSelect(classification.buckets)
      }

      await updatePage(existing.id, updates)
      console.log(`[Sync] Updated contact: ${name}`)
      return existing.id
    } catch (e) {
      console.error(`[Sync] Failed to update contact ${name}:`, e)
      return existing.id
    }
  }

  // Create new contact with enriched data
  try {
    const properties: Record<string, unknown> = {
      'Name': title(name),
      'LinkedIn URL': url(linkedInUrl),
      'LinkedIn Degree': select(degree),
      'Relationship Stage': select('Engaged'),
      'Connection Level': select(degree),
      'Connection Status': select('Not Connected'), // Default: needs outreach automation
      'Sector': select(classification.sector),
      'Grove Alignment': select(classification.alignment),
      'Priority': select(classification.priority),
      'Sales Nav List Status': select(classification.salesNav),
      'Last Active': date(today),
      'Notes': richText(`PB:${memberId}`),
    }

    // Basic fields
    if (lead.occupation) {
      properties['Headline'] = richText(lead.occupation)
    }
    if (lead.companyName) {
      properties['Company'] = richText(lead.companyName)
    }
    if (lead.linkedinFollowersCount) {
      properties['Follower Count'] = { number: parseInt(String(lead.linkedinFollowersCount)) || 0 }
    }

    // Enriched fields (Phase 2)
    if (lead.linkedinJobTitle) {
      properties['Current Job Title'] = richText(lead.linkedinJobTitle)
    }
    if (lead.companyIndustry) {
      properties['Industry'] = richText(lead.companyIndustry)
    }
    if (lead.location) {
      properties['Location'] = richText(lead.location)
    }
    if (lead.linkedinDescription) {
      properties['About'] = richText(lead.linkedinDescription.slice(0, 2000))
    }
    if (lead.linkedinSkillsLabel) {
      properties['Skills'] = richText(lead.linkedinSkillsLabel.slice(0, 2000))
    }
    if (lead.linkedinIsOpenToWorkBadge === 'Yes') {
      properties['Open to Work'] = { checkbox: true }
    }
    if (lead.salesNavigatorCompanyUrl) {
      properties['Sales Navigator URL'] = url(lead.salesNavigatorCompanyUrl)
    }

    if (classification.buckets.length > 0) {
      properties['Strategic Bucket'] = multiSelect(classification.buckets)
    }

    const page = await createPage(NOTION_DBS.CONTACTS, properties)
    state.syncedContacts[memberId] = page.id

    // Log enrichment details
    const enrichedFields = [
      lead.linkedinJobTitle && 'Job Title',
      lead.companyIndustry && 'Industry',
      lead.linkedinDescription && 'About',
      lead.linkedinSkillsLabel && 'Skills',
      lead.location && 'Location',
      lead.linkedinIsOpenToWorkBadge === 'Yes' && 'Open to Work',
    ].filter(Boolean)

    if (enrichedFields.length > 0) {
      await debugLog('orchestrator', `✓ Created ${name} (+${enrichedFields.join(', ')})`)
    } else {
      await debugLog('orchestrator', `✓ Created ${name}`)
    }

    return page.id
  } catch (e) {
    console.error(`[Sync] Failed to create contact ${name}:`, e)
    return null
  }
}

async function createEngagement(
  lead: PBLead,
  contactPageId: string,
  postPageId: string,
  engType: 'comment' | 'like',
  state: SyncState
): Promise<{ id: string; isNew: boolean; wasUpdated: boolean } | null> {
  const memberId = lead.memberId || ''
  const postUrl = lead.postsUrl || ''
  const engKey = `${memberId}:${engType}:${postUrl}`

  const name = lead.fullName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim()
  const commentText = lead.comments || ''
  const pbDateStr = lead.lastCommentedAt || lead.timestamp || ''
  const pbDate = pbDateStr.slice(0, 10) || new Date().toISOString().slice(0, 10)

  // Check for existing engagement
  const existing = await findEngagement(contactPageId, postPageId, engType)

  if (existing) {
    state.syncedEngagements[engKey] = existing.id

    // For comments, check if PB has newer/different content OR if we should resurrect
    if (engType === 'comment' && commentText) {
      const props = existing.properties as Record<string, any>
      const existingContent = props['Their Content']?.rich_text?.[0]?.plain_text || ''
      const existingDate = props['Date']?.date?.start || ''
      const existingStatus = props['Response Status']?.select?.name || ''

      // Calculate resurrection window
      const resurrectionCutoff = new Date()
      resurrectionCutoff.setDate(resurrectionCutoff.getDate() - RESURRECTION_WINDOW_DAYS)
      const engagementDate = new Date(existingDate || pbDate)
      const isWithinResurrectionWindow = engagementDate >= resurrectionCutoff

      // Check if this is a newer or different comment
      const isNewerDate = pbDate > existingDate
      const isDifferentContent = commentText !== existingContent && commentText.length > existingContent.length
      const canBeReset = existingStatus !== 'Posted' && existingStatus !== 'Drafting'

      // NEW: Resurrect comments that meet new threshold but were marked "No Reply Needed"
      // This fixes the old 50-char threshold that missed short but meaningful comments
      const shouldResurrect =
        isWithinResurrectionWindow &&
        commentText.length > MIN_CHARS_FOR_REPLY &&
        existingStatus === 'No Reply Needed'

      if (((isNewerDate || isDifferentContent) && canBeReset) || shouldResurrect) {
        // Update with new comment content
        const quality = commentText.length > MIN_CHARS_FOR_REPLY ? 'Substantive' : 'Brief'

        try {
          const updates: Record<string, unknown> = {
            'Their Content': richText(commentText),
            'Date': date(pbDate),
            'Engagement Quality': select(quality),
          }

          // Reset to "Needs Reply" if substantive and not already posted/drafting
          if (quality === 'Substantive' && canBeReset) {
            updates['Response Status'] = select('Needs Reply')
            if (shouldResurrect) {
              console.log(`[Sync] Resurrected comment: ${name} - "${commentText.substring(0, 30)}..."`)
            } else {
              console.log(`[Sync] Reset to Needs Reply: ${name} (new comment detected)`)
            }
          }

          if (lead.commentUrl) {
            updates['Their Post URL'] = url(lead.commentUrl)
          }

          await updatePage(existing.id, updates)
          return { id: existing.id, isNew: false, wasUpdated: true }
        } catch (e) {
          console.error(`[Sync] Failed to update engagement:`, e)
        }
      }
    }

    return { id: existing.id, isNew: false, wasUpdated: false }
  }

  // Create new engagement
  let engTitle: string
  let notionType: string
  let theirContent: string
  let quality: string
  let responseStatus: string

  if (engType === 'comment') {
    engTitle = `${name} commented`
    notionType = 'Commented on Our Post'
    theirContent = commentText
    quality = commentText.length > MIN_CHARS_FOR_REPLY ? 'Substantive' : 'Brief'
    responseStatus = quality === 'Substantive' ? 'Needs Reply' : 'No Reply Needed'
  } else {
    engTitle = `${name} liked`
    notionType = 'Liked'
    theirContent = ''
    quality = 'Reaction-only'
    responseStatus = 'No Reply Needed'
  }

  try {
    const properties: Record<string, unknown> = {
      'Engagement': title(engTitle),
      'Contact': relation([contactPageId]),
      'Post': relation([postPageId]),
      'Type': select(notionType),
      'Direction': select('Inbound'),
      'Engagement Quality': select(quality),
      'Response Status': select(responseStatus),
      'Date': date(pbDate),
    }

    if (theirContent) {
      properties['Their Content'] = richText(theirContent)
    }

    if (lead.commentUrl && engType === 'comment') {
      properties['Their Post URL'] = url(lead.commentUrl)
    }

    const page = await createPage(NOTION_DBS.ENGAGEMENTS, properties)
    state.syncedEngagements[engKey] = page.id
    console.log(`[Sync] Created engagement: ${engTitle}`)
    return { id: page.id, isNew: true, wasUpdated: false }
  } catch (e) {
    console.error(`[Sync] Failed to create engagement:`, e)
    return null
  }
}

// --- Main Sync Function ---

export interface SyncResult {
  success: boolean
  leadsProcessed: number
  newContacts: number
  updatedContacts: number
  newEngagements: number
  updatedEngagements: number
  errors: number
  commentsNeedingReply: LinkedInComment[]
}

export async function runFullSync(): Promise<SyncResult> {
  await debugLog('orchestrator', '🚀🚀🚀 SYNC V2 WITH COMMENT REFRESH 🚀🚀🚀')

  const result: SyncResult = {
    success: false,
    leadsProcessed: 0,
    newContacts: 0,
    updatedContacts: 0,
    newEngagements: 0,
    updatedEngagements: 0,
    errors: 0,
    commentsNeedingReply: [],
  }

  try {
    const notionKey = await storage.get<string>(STORAGE_KEYS.NOTION_KEY)
    if (!notionKey) {
      await debugLog('orchestrator', 'ERROR: Notion API key required')
      return result
    }

    // Prefetch all contacts for fast lookups
    await debugLog('orchestrator', 'Prefetching contacts for dedup...')
    await prefetchContactCache()

    // 1. Fetch leads from PB
    const leads = await fetchAllPBLeads()
    await debugLog('orchestrator', `Fetched ${leads.length} leads from PB`)
    result.leadsProcessed = leads.length

    if (leads.length === 0) {
      result.commentsNeedingReply = await fetchCommentsNeedingReply()
      result.success = true
      return result
    }

    // 2. Ensure posts exist
    let state = await loadSyncState()
    const postUrls = new Set(leads.map((l) => l.postsUrl).filter(Boolean) as string[])
    const postPageIds: Record<string, string> = {}

    for (const postUrl of postUrls) {
      const pageId = await ensurePostExists(postUrl, '')
      if (pageId) postPageIds[postUrl] = pageId
      await delay(200)
    }

    // 3. Sync contacts & engagements (with Notion-first dedup)
    await debugLog('orchestrator', `Syncing ${leads.length} leads (dedup enabled)...`)

    for (let i = 0; i < leads.length; i++) {
      const lead = leads[i]!
      if (!lead.memberId) continue

      // Upsert contact (always checks Notion first)
      const contactPageId = await upsertContact(lead, state)
      if (!contactPageId) {
        result.errors++
        continue
      }

      const wasNew = !state.syncedContacts[lead.memberId]
      if (wasNew) result.newContacts++
      else result.updatedContacts++

      // Create engagements (now with Notion-first check + update detection)
      const postPageId = postPageIds[lead.postsUrl || '']
      if (!postPageId) continue

      if (lead.hasCommented === 'true') {
        const engResult = await createEngagement(lead, contactPageId, postPageId, 'comment', state)
        if (engResult?.isNew) result.newEngagements++
        else if (engResult?.wasUpdated) result.updatedEngagements++
        await delay(200)
      }

      if (lead.hasLiked === 'true') {
        const engResult = await createEngagement(lead, contactPageId, postPageId, 'like', state)
        if (engResult?.isNew) result.newEngagements++
        await delay(200)
      }

      // Log progress every 10 leads
      if ((i + 1) % 10 === 0) {
        await debugLog('orchestrator', `Progress: ${i + 1}/${leads.length}`)
      }
    }

    await saveSyncState(state)
    await debugLog('orchestrator', `✓ Synced: ${result.newContacts} new contacts, ${result.updatedContacts} updated contacts`)
    await debugLog('orchestrator', `✓ Engagements: ${result.newEngagements} new, ${result.updatedEngagements} refreshed to Needs Reply`)

    // 4. Fetch comments
    result.commentsNeedingReply = await fetchCommentsNeedingReply()
    await debugLog('orchestrator', `Found ${result.commentsNeedingReply.length} needing reply`)

    result.success = true

  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await debugLog('orchestrator', `ERROR: ${msg}`)
    result.errors++
  } finally {
    // Clear cache after sync
    clearContactCache()
  }

  return result
}

// --- Fetch Comments for Reply Helper ---

async function fetchContactDetails(contactPageId: string): Promise<CommentAuthor | null> {
  try {
    const resp = await fetch(`https://api.notion.com/v1/pages/${contactPageId}`, {
      headers: {
        'Authorization': `Bearer ${await storage.get(STORAGE_KEYS.NOTION_KEY)}`,
        'Notion-Version': '2022-06-28',
      },
    })
    if (!resp.ok) return null

    const page = await resp.json()
    const props = page.properties as Record<string, any>

    return {
      name: props['Name']?.title?.[0]?.plain_text || 'Unknown',
      headline: props['Headline']?.rich_text?.[0]?.plain_text || '',
      profileUrl: props['LinkedIn URL']?.url || '',
      linkedInDegree: props['LinkedIn Degree']?.select?.name || '2nd',
      sector: props['Sector']?.select?.name || 'Other',
      groveAlignment: props['Grove Alignment']?.select?.name || '⭐⭐ Peripheral Interest',
      priority: props['Priority']?.select?.name || 'Standard',
    }
  } catch (e) {
    console.log('[Sync] Failed to fetch contact details:', e)
    return null
  }
}

async function fetchPostTitle(postPageId: string): Promise<string> {
  try {
    const resp = await fetch(`https://api.notion.com/v1/pages/${postPageId}`, {
      headers: {
        'Authorization': `Bearer ${await storage.get(STORAGE_KEYS.NOTION_KEY)}`,
        'Notion-Version': '2022-06-28',
      },
    })
    if (!resp.ok) return 'LinkedIn Post'

    const page = await resp.json()
    const props = page.properties as Record<string, any>
    return props['Title']?.title?.[0]?.plain_text || 'LinkedIn Post'
  } catch {
    return 'LinkedIn Post'
  }
}

export async function fetchCommentsNeedingReply(): Promise<LinkedInComment[]> {
  try {
    const engagements = await getEngagementsNeedingReply()
    console.log(`[Sync] Found ${engagements.length} engagements needing reply`)

    const comments: LinkedInComment[] = []

    for (const eng of engagements) {
      const props = eng.properties as Record<string, any>

      // Extract data from Notion properties
      const engTitle = props['Engagement']?.title?.[0]?.plain_text || 'Unknown'
      const theirContent = props['Their Content']?.rich_text?.[0]?.plain_text || ''
      const dateVal = props['Date']?.date?.start || new Date().toISOString()
      const commentUrl = props['Their Post URL']?.url || ''

      // Get related page IDs
      const contactPageId = props['Contact']?.relation?.[0]?.id
      const postPageId = props['Post']?.relation?.[0]?.id

      // Fetch full contact details from Notion
      let author: CommentAuthor
      if (contactPageId) {
        const contactDetails = await fetchContactDetails(contactPageId)
        author = contactDetails || {
          name: engTitle.replace(' commented', '').replace(' liked', ''),
          headline: '',
          profileUrl: '',
          linkedInDegree: '2nd',
          sector: 'Other',
          groveAlignment: '⭐⭐ Peripheral Interest',
          priority: 'Standard',
        }
        await delay(100) // Rate limiting
      } else {
        author = {
          name: engTitle.replace(' commented', '').replace(' liked', ''),
          headline: '',
          profileUrl: '',
          linkedInDegree: '2nd',
          sector: 'Other',
          groveAlignment: '⭐⭐ Peripheral Interest',
          priority: 'Standard',
        }
      }

      // Fetch post title
      let postTitle = 'LinkedIn Post'
      if (postPageId) {
        postTitle = await fetchPostTitle(postPageId)
        await delay(100)
      }

      comments.push({
        id: eng.id,
        postId: postPageId || '',
        postTitle,
        author,
        content: theirContent,
        commentUrl,
        commentedAt: dateVal,
        threadDepth: 0,
        childCount: 0,
        isMe: false,
        status: 'needs_reply',
        notionPageId: eng.id,
        notionContactId: contactPageId,
      })
    }

    return comments
  } catch (e) {
    console.error('[Sync] Failed to fetch comments:', e)
    return []
  }
}

// --- Update Engagement Status ---

export async function saveDraft(notionPageId: string, draftText: string): Promise<boolean> {
  try {
    await updatePage(notionPageId, {
      'Response Status': select('Drafting'),
      'Our Response Draft': richText(draftText),
    })
    return true
  } catch (e) {
    console.error('[Sync] Failed to save draft:', e)
    return false
  }
}

export async function markEngagementReplied(
  notionPageId: string,
  replyText: string,
  notionContactId?: string,
  isTopEngager?: boolean
): Promise<boolean> {
  try {
    await debugLog('orchestrator', `Marking ${notionPageId} as replied...`)

    // Update engagement - move draft to final
    await updatePage(notionPageId, {
      'Response Status': select('Posted'),
      'Our Response Final': richText(replyText),
      'Our Response Draft': richText(''), // Clear draft
    })
    await debugLog('orchestrator', `✓ Engagement updated: Response Status → Posted`)

    // Update contact: Last Active + optional Top Engager flag
    if (notionContactId) {
      try {
        const contactUpdates: Record<string, unknown> = {
          'Last Active': date(new Date().toISOString().slice(0, 10)),
        }
        if (isTopEngager) {
          contactUpdates['⭐ Top Engager'] = { checkbox: true }
          await debugLog('orchestrator', `Setting Top Engager + Last Active on contact ${notionContactId}...`)
        } else {
          await debugLog('orchestrator', `Updating Last Active on contact ${notionContactId}...`)
        }
        await updatePage(notionContactId, contactUpdates)
        await debugLog('orchestrator', `✓ Contact updated`)
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        await debugLog('orchestrator', `Note: Could not update contact: ${msg}`)
        // Don't fail the whole operation
      }
    }

    return true
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    await debugLog('orchestrator', `ERROR marking replied: ${msg}`)
    console.error(`[Sync] Failed to mark replied:`, e)
    return false
  }
}

// --- Sync Extracted Comments (DOM → Notion) ---

export interface DomSyncResult {
  contactsCreated: number
  contactsUpdated: number
  engagementsCreated: number
  engagementsUpdated: number
  errors: number
  /** Map of profileUrl → Notion IDs for enriching comments */
  notionIdMap: Record<string, { notionPageId: string; notionContactId: string }>
}

/**
 * Sync DOM-extracted comments to Notion.
 * Reuses the same upsertContact/createEngagement pipeline as PB sync.
 */
export async function syncExtractedComments(
  comments: LinkedInComment[],
  postUrl: string,
  postTitle?: string,
): Promise<DomSyncResult> {
  const result: DomSyncResult = {
    contactsCreated: 0,
    contactsUpdated: 0,
    engagementsCreated: 0,
    engagementsUpdated: 0,
    errors: 0,
    notionIdMap: {},
  }

  if (comments.length === 0) return result

  try {
    // Prefetch contact cache for fast dedup lookups
    await prefetchContactCache()

    // Ensure the post exists in Notion
    const postPageId = await ensurePostExists(postUrl, postTitle || 'LinkedIn Post')
    if (!postPageId) {
      console.error('[DomSync] Failed to create/find post in Notion')
      result.errors++
      return result
    }

    const state = await loadSyncState()

    for (const comment of comments) {
      // Skip own comments
      if (comment.isMe) continue

      const profileUrl = comment.author.profileUrl
      if (!profileUrl) {
        result.errors++
        continue
      }

      // Build PBLead from DOM comment
      const lead: PBLead = {
        fullName: comment.author.name,
        occupation: comment.author.headline,
        profileUrl,
        comments: comment.content,
        hasCommented: "true",
        commentUrl: comment.commentUrl || postUrl,
        lastCommentedAt: comment.commentedAt,
        postsUrl: postUrl,
      }

      try {
        // Upsert contact (checks Notion first for dedup)
        const contactPageId = await upsertContact(lead, state)
        if (!contactPageId) {
          result.errors++
          continue
        }

        // Track whether contact was new
        const wasNew = !state.syncedContacts[profileUrl]
        if (wasNew) {
          result.contactsCreated++
          // Use profileUrl as key since DOM comments lack memberId
          state.syncedContacts[profileUrl] = contactPageId
        } else {
          result.contactsUpdated++
        }

        // Create engagement
        const engResult = await createEngagement(lead, contactPageId, postPageId, 'comment', state)
        if (engResult?.isNew) result.engagementsCreated++
        else if (engResult?.wasUpdated) result.engagementsUpdated++

        // Store Notion IDs for enriching comments back in the sidepanel
        const engagementPageId = engResult?.id || ''
        result.notionIdMap[profileUrl] = {
          notionPageId: engagementPageId,
          notionContactId: contactPageId,
        }

        await delay(200) // Rate limit Notion API
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e)
        console.error(`[DomSync] Error syncing ${comment.author.name}:`, msg)
        result.errors++
      }
    }

    await saveSyncState(state)
    console.log(`[DomSync] Done: ${result.contactsCreated} new contacts, ${result.contactsUpdated} updated, ${result.engagementsCreated} new engagements`)
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    console.error('[DomSync] Fatal error:', msg)
    result.errors++
  } finally {
    clearContactCache()
  }

  return result
}

// --- CSV Enrichment ---

export async function enrichContactsFromCSV(csvLeads: Array<Record<string, string>>): Promise<number> {
  await debugLog('orchestrator', `Importing ${csvLeads.length} enriched contacts from CSV...`)

  // Prefetch contact cache for fast lookups
  await debugLog('orchestrator', 'Prefetching contacts for dedup...')
  await prefetchContactCache()

  let created = 0
  let updated = 0

  for (let i = 0; i < csvLeads.length; i++) {
    const lead = csvLeads[i]!

    // Extract and normalize data
    const memberId = lead.id || lead.linkedinProfileId
    const rawUrl = lead.linkedinProfileUrl || ''
    const name = lead.fullName || `${lead.firstName || ''} ${lead.lastName || ''}`.trim()

    if (!rawUrl || !name) {
      continue
    }

    // Normalize URL (same as regular sync)
    const linkedInUrl = rawUrl
      .toLowerCase()
      .replace('http://', 'https://')
      .replace('https://www.linkedin.com', 'https://linkedin.com')
      .replace(/\/$/, '') + '/'

    // Check if exists by LinkedIn URL first (primary key)
    const existing = await findContactByLinkedInUrl(linkedInUrl)

    try {
      const enrichedData: Record<string, unknown> = {}

      // Core fields
      if (lead.companyName) enrichedData['Company'] = richText(lead.companyName)
      if (lead.linkedinFollowersCount) enrichedData['Follower Count'] = { number: parseInt(lead.linkedinFollowersCount) || 0 }
      if (lead.linkedinHeadline) enrichedData['Headline'] = richText(lead.linkedinHeadline)

      // Enriched fields
      if (lead.linkedinJobTitle) enrichedData['Current Job Title'] = richText(lead.linkedinJobTitle)
      if (lead.companyIndustry) enrichedData['Industry'] = richText(lead.companyIndustry)
      if (lead.location) enrichedData['Location'] = richText(lead.location)
      if (lead.linkedinDescription) enrichedData['About'] = richText(lead.linkedinDescription.slice(0, 2000))
      if (lead.linkedinSkillsLabel) enrichedData['Skills'] = richText(lead.linkedinSkillsLabel.slice(0, 2000))
      if (lead.linkedinIsOpenToWorkBadge === 'Yes') enrichedData['Open to Work'] = { checkbox: true }
      if (lead.salesNavigatorCompanyUrl) enrichedData['Sales Navigator URL'] = url(lead.salesNavigatorCompanyUrl)

      if (existing) {
        // Update existing contact
        if (Object.keys(enrichedData).length > 0) {
          await updatePage(existing.id, enrichedData)
          updated++
          await debugLog('orchestrator', `✓ Updated ${name} (+${Object.keys(enrichedData).length} fields)`)
        }
      } else {
        // Create new contact with enrichment
        // Classify first
        const pbLead = {
          memberId,
          fullName: name,
          occupation: lead.linkedinHeadline || '',
          profileUrl: linkedInUrl,
          degree: lead.connectionDegree,
          linkedinFollowersCount: lead.linkedinFollowersCount,
          companyName: lead.companyName,
          linkedinJobTitle: lead.linkedinJobTitle,
          companyIndustry: lead.companyIndustry,
          location: lead.location,
          linkedinDescription: lead.linkedinDescription,
          linkedinSkillsLabel: lead.linkedinSkillsLabel,
          linkedinIsOpenToWorkBadge: lead.linkedinIsOpenToWorkBadge,
          salesNavigatorCompanyUrl: lead.salesNavigatorCompanyUrl,
        }

        const classification = classifyContact(pbLead)
        const degree = DEGREE_MAP[lead.connectionDegree || ''] || 'Unknown'
        const today = new Date().toISOString().slice(0, 10)

        const newContact: Record<string, unknown> = {
          'Name': title(name),
          'LinkedIn URL': url(linkedInUrl),
          'LinkedIn Degree': select(degree),
          'Connection Level': select(degree),
          'Relationship Stage': select('Engaged'),
          'Sector': select(classification.sector),
          'Grove Alignment': select(classification.alignment),
          'Priority': select(classification.priority),
          'Sales Nav List Status': select(classification.salesNav),
          'Last Active': date(today),
          'Notes': richText(`PB:${memberId}`),
          ...enrichedData,
        }

        if (classification.buckets.length > 0) {
          newContact['Strategic Bucket'] = multiSelect(classification.buckets)
        }

        await createPage(NOTION_DBS.CONTACTS, newContact)
        created++
        await debugLog('orchestrator', `✓ Created ${name} (enriched)`)
      }

      await delay(300)
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await debugLog('orchestrator', `Error processing ${name}: ${msg}`)
    }

    if ((i + 1) % 10 === 0) {
      await debugLog('orchestrator', `Progress: ${i + 1}/${csvLeads.length}`)
    }
  }

  await debugLog('orchestrator', `✓ Import complete! Created ${created}, updated ${updated}`)
  clearContactCache()
  return created + updated
}

// --- Outreach Notion Integration ---

/**
 * Get pending contact counts for each segment.
 * Only counts contacts that have NOT been processed via Save+Follow.
 */
export async function getSegmentPendingCounts(): Promise<Record<string, number>> {
  const segments = [
    'Saved - Academic',
    'Saved - Technical',
    'Saved - Enterprise',
    'Saved - Influencer',
  ]

  const counts: Record<string, number> = {}

  for (const segment of segments) {
    try {
      const contacts = await queryDatabase(NOTION_DBS.CONTACTS, {
        and: [
          { property: 'Sales Nav List Status', select: { equals: segment } },
          { property: 'Connection Status', select: { equals: 'Not Connected' } },
          // Exclude any already processed (have Follow Date)
          { property: 'Follow Date', date: { is_empty: true } },
        ],
      })
      counts[segment] = contacts.length
    } catch (e) {
      console.error(`[Outreach] Failed to count ${segment}:`, e)
      counts[segment] = 0
    }
  }

  return counts
}

/**
 * Fetch contacts for a specific segment that need processing.
 *
 * IMPORTANT: Only returns contacts that have NOT been processed yet.
 * Filters out:
 * - Connection Status = 'Following' (already followed)
 * - Connection Status = 'Connected' (already connected)
 * - Connection Status = 'Failed Outreach' (automation failed)
 * - Any contact with a Follow Date set (processed via Save+Follow)
 */
export async function fetchContactsBySegment(salesNavStatus: string): Promise<NotionPage[]> {
  try {
    return await queryDatabase(NOTION_DBS.CONTACTS, {
      and: [
        { property: 'Sales Nav List Status', select: { equals: salesNavStatus } },
        { property: 'Connection Status', select: { equals: 'Not Connected' } },
        // Additional safeguard: exclude any with Follow Date set
        { property: 'Follow Date', date: { is_empty: true } },
      ],
    })
  } catch (e) {
    console.error(`[Outreach] Failed to fetch ${salesNavStatus}:`, e)
    return []
  }
}

/**
 * Mark contacts as "Following" after successful Save+Follow automation
 */
export async function markContactsAsFollowing(
  contacts: Array<{ pageId: string; salesNavUrl?: string }>,
  options?: { includeRelationshipStage?: boolean; includeFollowDate?: boolean }
): Promise<{ updated: number; errors: string[] }> {
  let updated = 0
  const errors: string[] = []
  const today = new Date().toISOString().slice(0, 10)

  for (const contact of contacts) {
    try {
      const updates: Record<string, unknown> = {
        'Connection Status': select('Following'),
        'Last Active': date(today),
      }

      // Optional: Set Relationship Stage to "Engaged"
      if (options?.includeRelationshipStage) {
        updates['Relationship Stage'] = select('Engaged')
      }

      // Optional: Set Follow Date to today (tracks when we started following)
      if (options?.includeFollowDate) {
        updates['Follow Date'] = date(today)
      }

      // Update Sales Navigator URL if captured during automation
      if (contact.salesNavUrl) {
        updates['Sales Navigator URL'] = url(contact.salesNavUrl)
      }

      await updatePage(contact.pageId, updates)
      updated++
      await debugLog('orchestrator', `✓ Marked ${contact.pageId} as Following in Notion`)
      await delay(300) // Rate limit
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      const error = `Failed to update ${contact.pageId}: ${msg}`
      await debugLog('orchestrator', error)
      errors.push(error)
    }
  }

  await debugLog('orchestrator', `Updated ${updated}/${contacts.length} contacts in Notion`)
  return { updated, errors }
}

/**
 * Mark contacts as "Failed Outreach" after automation failures
 */
export async function markContactsAsFailed(
  failures: Array<{ pageId: string; error: string }>
): Promise<number> {
  let updated = 0
  const today = new Date().toISOString().slice(0, 10)

  for (const failure of failures) {
    try {
      const updates: Record<string, unknown> = {
        'Connection Status': select('Failed Outreach'),
        'Last Active': date(today),
      }

      // Append error details to Atlas Notes
      if (failure.error) {
        updates['Atlas Notes'] = richText(`Error: ${failure.error}`)
      }

      await updatePage(failure.pageId, updates)
      updated++
      await debugLog('orchestrator', `✓ Marked ${failure.pageId} as Failed Outreach in Notion`)
      await delay(300) // Rate limit
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await debugLog('orchestrator', `Failed to update failed contact ${failure.pageId}: ${msg}`)
    }
  }

  await debugLog('orchestrator', `Updated ${updated}/${failures.length} failed contacts in Notion`)
  return updated
}

/**
 * Dismiss contacts from outreach workflow.
 * Sets Connection Status to "Dismissed" so they won't appear in future queries.
 */
export async function dismissContacts(pageIds: string[]): Promise<number> {
  let dismissed = 0
  const today = new Date().toISOString().slice(0, 10)

  for (const pageId of pageIds) {
    try {
      await updatePage(pageId, {
        'Connection Status': select('Dismissed'),
        'Last Active': date(today),
      })
      dismissed++
      await debugLog('orchestrator', `✓ Dismissed contact ${pageId}`)
      await delay(300) // Rate limit
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e)
      await debugLog('orchestrator', `Failed to dismiss ${pageId}: ${msg}`)
    }
  }

  await debugLog('orchestrator', `Dismissed ${dismissed}/${pageIds.length} contacts`)
  return dismissed
}

// --- Helpers ---

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}
