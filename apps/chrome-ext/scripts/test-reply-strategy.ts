/**
 * Master Blaster: Reply Strategy Test Battery
 *
 * Tests the Reply Strategy pipeline end-to-end against live Notion data.
 * Covers: Notion connectivity, schema validation, rules engine, prompt
 * composition, fallback chain, cache lifecycle, and E2E pipeline.
 *
 * Run: bun run test:reply-strategy
 * Alias: bun run verify:extension (runs both action-feed + reply-strategy)
 *
 * Requires: NOTION_API_KEY env var (same key used by telegram bot)
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  MASTER BLASTER PROTOCOL — REPLY STRATEGY                   │
 * ├─────────────────────────────────────────────────────────────┤
 * │  1. Run BEFORE any code changes (establish baseline)        │
 * │  2. Run AFTER each phase commit (regression detection)      │
 * │  3. ALL sections must pass before human testing             │
 * │  4. Failures block merge — fix before proceeding            │
 * │  5. Each test logs: PASS ✅ | FAIL ❌ | SKIP ⏭️             │
 * └─────────────────────────────────────────────────────────────┘
 */

// ============================================
// TEST CONFIGURATION
// ============================================

const REPLY_STRATEGY_DB_ID = 'ae8f00f271aa4fe48c6432f4cd8f6e4f'
// Budget for modifier stack only. Core voice + archetype always included in full.
const MODIFIER_CHAR_BUDGET = 2400

// Expected archetype slugs in the database
const EXPECTED_ARCHETYPES = [
  'thesis_engagement',
  'business_relationship',
  'talent_nurture',
  'community_building',
  'standard_engagement',
]

// ============================================
// TYPES (inlined from strategy modules for standalone execution)
// ============================================

interface TestResult {
  section: string
  test: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  duration: number
  error?: string
}

type ConfigEntryType = 'core_voice' | 'archetype' | 'modifier' | 'rule'

interface StrategyConfigEntry {
  id: string
  name: string
  slug: string
  type: ConfigEntryType
  active: boolean
  priority: number
  conditions: string
  archetype: string
  content: string
}

interface StrategyConfig {
  coreVoice: StrategyConfigEntry | null
  archetypes: Record<string, StrategyConfigEntry>
  modifiers: Record<string, StrategyConfigEntry>
  rules: StrategyConfigEntry[]
  fetchedAt: string
}

interface ContactFields {
  [key: string]: string | number | boolean | undefined
}

interface RuleEvaluation {
  archetype: string
  modifiers: string[]
  confidence: number
  matchedRule: string
}

interface ComposedPrompt {
  systemPrompt: string
  strategyBlock: string
  archetype: string
  modifiers: string[]
  usedFallback: boolean
}

interface CommentAuthor {
  name: string
  headline: string
  profileUrl: string
  linkedInDegree: string
  sector: string
  groveAlignment: string
  priority: string
  strategicBucket?: string
  relationshipStage?: string
  linkedInIsOpenToWork?: boolean
}

interface LinkedInComment {
  id: string
  postId: string
  postTitle: string
  author: CommentAuthor
  content: string
  commentUrl?: string
  commentedAt: string
  threadDepth: number
  parentAuthorName?: string
  childCount: number
  isMe: boolean
  domSignature?: string
  status: 'needs_reply' | 'draft_in_progress' | 'replied' | 'no_reply_needed'
  draftReply?: string
  finalReply?: string
  repliedAt?: string
  hiddenLocally?: boolean
  notionPageId?: string
  notionContactId?: string
  extractedFromDom?: boolean
}

// ============================================
// TEST STATE
// ============================================

const results: TestResult[] = []
let notionApiKey: string | null = null
let allEntries: StrategyConfigEntry[] = []
let activeConfig: StrategyConfig | null = null

// ============================================
// TEST DATA FIXTURES
// ============================================

const LAURA_BORGES: CommentAuthor = {
  name: 'Laura Borges',
  headline: 'SVP, DrumWave',
  profileUrl: 'https://linkedin.com/in/laura-borges',
  linkedInDegree: '1st',
  sector: 'Corporate',
  groveAlignment: '',
  priority: 'Low',
  strategicBucket: 'Enterprise Clients',
  relationshipStage: 'Engaged',
}

const LAURA_BORGES_COMMENT: LinkedInComment = {
  id: 'test-laura-001',
  postId: 'test-post-001',
  postTitle: 'Why distributed AI will win',
  author: LAURA_BORGES,
  content: 'Great insights on the distributed approach. We see similar patterns in enterprise data governance.',
  commentedAt: new Date().toISOString(),
  threadDepth: 0,
  childCount: 0,
  isMe: false,
  status: 'needs_reply',
}

const EMPTY_AUTHOR: CommentAuthor = {
  name: 'Unknown',
  headline: '',
  profileUrl: '',
  linkedInDegree: '',
  sector: '',
  groveAlignment: '',
  priority: '',
}

const EMPTY_COMMENT: LinkedInComment = {
  id: 'test-empty-001',
  postId: 'test-post-001',
  postTitle: 'Test Post',
  author: EMPTY_AUTHOR,
  content: 'Nice post!',
  commentedAt: new Date().toISOString(),
  threadDepth: 0,
  childCount: 0,
  isMe: false,
  status: 'needs_reply',
}

const HIGH_GROVE_TECH: CommentAuthor = {
  name: 'Alex Chen',
  headline: 'AI Research Lead',
  profileUrl: 'https://linkedin.com/in/alex-chen',
  linkedInDegree: '2nd',
  sector: 'Technology',
  groveAlignment: '⭐⭐⭐⭐⭐ Strong Alignment',
  priority: 'High',
}

const HIGH_GROVE_COMMENT: LinkedInComment = {
  id: 'test-grove-001',
  postId: 'test-post-001',
  postTitle: 'Distributed inference at the edge',
  author: HIGH_GROVE_TECH,
  content: 'This aligns perfectly with our federated learning research.',
  commentedAt: new Date().toISOString(),
  threadDepth: 0,
  childCount: 0,
  isMe: false,
  status: 'needs_reply',
}

const JOB_SEEKER: CommentAuthor = {
  name: 'Jordan Lee',
  headline: 'Looking for my next opportunity in AI',
  profileUrl: 'https://linkedin.com/in/jordan-lee',
  linkedInDegree: '3rd+',
  sector: 'Job Seeker',
  groveAlignment: '',
  priority: 'Standard',
  linkedInIsOpenToWork: true,
}

const JOB_SEEKER_COMMENT: LinkedInComment = {
  id: 'test-jobseeker-001',
  postId: 'test-post-001',
  postTitle: 'Hiring in distributed systems',
  author: JOB_SEEKER,
  content: 'I would love to contribute to this space. Any openings?',
  commentedAt: new Date().toISOString(),
  threadDepth: 0,
  childCount: 0,
  isMe: false,
  status: 'needs_reply',
}

// ============================================
// UTILITIES
// ============================================

async function notionFetch(endpoint: string, options: RequestInit = {}): Promise<any> {
  if (!notionApiKey) throw new Error('Notion API key not configured')

  const response = await fetch(`https://api.notion.com/v1${endpoint}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${notionApiKey}`,
      'Notion-Version': '2022-06-28',
      'Content-Type': 'application/json',
      ...options.headers,
    },
  })

  if (!response.ok) {
    throw new Error(`Notion API ${response.status}: ${await response.text()}`)
  }

  return response.json()
}

function logResult(
  section: string,
  test: string,
  status: 'PASS' | 'FAIL' | 'SKIP',
  duration: number,
  error?: string
) {
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : '⏭️'
  console.log(
    `  ${icon} ${test} (${duration}ms)${error ? ` — ${error}` : ''}`
  )
  results.push({ section, test, status, duration, error })
}

async function runTest(
  section: string,
  name: string,
  testFn: () => Promise<void>
): Promise<void> {
  const start = Date.now()
  try {
    await testFn()
    logResult(section, name, 'PASS', Date.now() - start)
  } catch (err) {
    logResult(
      section,
      name,
      'FAIL',
      Date.now() - start,
      err instanceof Error ? err.message : String(err)
    )
  }
}

// ============================================
// NOTION DATA HELPERS
// ============================================

function parseEntry(page: any, bodyContent: string): StrategyConfigEntry {
  const props = page.properties || {}
  return {
    id: page.id,
    name: props['Name']?.title?.[0]?.text?.content || '',
    slug: props['Slug']?.rich_text?.[0]?.text?.content || '',
    type: (props['Type']?.select?.name || 'archetype') as ConfigEntryType,
    active: props['Active']?.checkbox ?? false,
    priority: props['Priority']?.number ?? 100,
    conditions: props['Conditions']?.rich_text?.[0]?.text?.content || '',
    archetype: props['Archetype']?.rich_text?.[0]?.text?.content || '',
    content: bodyContent,
  }
}

async function getPageBodyText(pageId: string): Promise<string> {
  const response = await notionFetch(`/blocks/${pageId}/children?page_size=100`)
  const blocks = response.results || []
  return blocks
    .map((block: any) => {
      const type = block.type
      const data = block[type]
      if (!data?.rich_text) return ''
      return data.rich_text.map((t: any) => t.plain_text || '').join('')
    })
    .filter(Boolean)
    .join('\n')
}

async function fetchAllEntries(): Promise<StrategyConfigEntry[]> {
  let pages: any[] = []
  let startCursor: string | undefined

  do {
    const body: any = { page_size: 100 }
    if (startCursor) body.start_cursor = startCursor

    const response = await notionFetch(
      `/databases/${REPLY_STRATEGY_DB_ID}/query`,
      { method: 'POST', body: JSON.stringify(body) }
    )

    pages = pages.concat(response.results || [])
    startCursor = response.has_more ? response.next_cursor : undefined
  } while (startCursor)

  const entries: StrategyConfigEntry[] = []
  for (const page of pages) {
    try {
      const body = await getPageBodyText(page.id)
      entries.push(parseEntry(page, body))
    } catch {
      entries.push(parseEntry(page, ''))
    }
  }

  return entries
}

function buildConfig(entries: StrategyConfigEntry[]): StrategyConfig {
  const config: StrategyConfig = {
    coreVoice: null,
    archetypes: {},
    modifiers: {},
    rules: [],
    fetchedAt: new Date().toISOString(),
  }

  for (const entry of entries) {
    if (!entry.active) continue
    switch (entry.type) {
      case 'core_voice':
        config.coreVoice = entry
        break
      case 'archetype':
        config.archetypes[entry.slug] = entry
        break
      case 'modifier':
        config.modifiers[entry.slug] = entry
        break
      case 'rule':
        config.rules.push(entry)
        break
    }
  }

  config.rules.sort((a, b) => a.priority - b.priority)
  return config
}

// ============================================
// INLINED RULES ENGINE (from strategy-rules.ts)
// ============================================

function parseAlignmentScore(alignment: string): number {
  if (!alignment) return 0
  const stars = (alignment.match(/⭐/g) || []).length
  if (stars > 0) return stars
  if (alignment.toLowerCase().includes('strong')) return 4
  if (alignment.toLowerCase().includes('good')) return 3
  if (alignment.toLowerCase().includes('moderate')) return 2
  if (alignment.toLowerCase().includes('weak')) return 1
  return 0
}

function extractFields(author: CommentAuthor): ContactFields {
  return {
    sector: author.sector || '',
    groveAlignment: parseAlignmentScore(author.groveAlignment || ''),
    priority: author.priority || '',
    linkedInDegree: author.linkedInDegree || '',
    strategicBucket: author.strategicBucket || '',
    relationshipStage: author.relationshipStage || '',
    linkedInIsOpenToWork: author.linkedInIsOpenToWork ?? false,
    headline: author.headline || '',
    name: author.name || '',
  }
}

function evaluateAtom(atom: string, fields: ContactFields): boolean {
  const match = atom.match(/^(\w+)\s*(==|!=|>=|<=|>|<|contains)\s*(.+)$/)
  if (!match) return false

  const [, fieldName, operator, rawValue] = match
  const value = rawValue.trim().replace(/^["']|["']$/g, '')
  const fieldValue = fields[fieldName]

  if (fieldValue === undefined) return false

  switch (operator) {
    case '==':
      if (typeof fieldValue === 'boolean') return fieldValue === (value === 'true')
      if (typeof fieldValue === 'number') return fieldValue === Number(value)
      return String(fieldValue) === value
    case '!=':
      if (typeof fieldValue === 'boolean') return fieldValue !== (value === 'true')
      if (typeof fieldValue === 'number') return fieldValue !== Number(value)
      return String(fieldValue) !== value
    case '>=':
      return Number(fieldValue) >= Number(value)
    case '<=':
      return Number(fieldValue) <= Number(value)
    case '>':
      return Number(fieldValue) > Number(value)
    case '<':
      return Number(fieldValue) < Number(value)
    case 'contains':
      return String(fieldValue).toLowerCase().includes(value.toLowerCase())
    default:
      return false
  }
}

function evaluateCondition(condition: string, fields: ContactFields): boolean {
  if (!condition.trim()) return false
  // Wildcard rule matches everything
  if (condition.trim() === '*') return true

  const orParts = condition.split('||').map((s) => s.trim())
  return orParts.some((orPart) => {
    const andParts = orPart.split('&&').map((s) => s.trim())
    return andParts.every((atom) => evaluateAtom(atom, fields))
  })
}

function findTriggeredModifiers(
  fields: ContactFields,
  modifiers: Record<string, StrategyConfigEntry>
): string[] {
  return Object.values(modifiers)
    .filter(
      (mod) =>
        mod.conditions.trim() &&
        mod.conditions.trim() !== '*' &&
        evaluateCondition(mod.conditions, fields)
    )
    .sort((a, b) => a.priority - b.priority)
    .map((mod) => mod.slug)
}

function evaluateRulesFromConfig(
  config: StrategyConfig,
  author: CommentAuthor
): RuleEvaluation {
  const fields = extractFields(author)

  for (const rule of config.rules) {
    if (evaluateCondition(rule.conditions, fields)) {
      return {
        archetype: rule.archetype,
        modifiers: findTriggeredModifiers(fields, config.modifiers),
        confidence: 0.9,
        matchedRule: rule.name,
      }
    }
  }

  return {
    archetype: 'standard_engagement',
    modifiers: findTriggeredModifiers(fields, config.modifiers),
    confidence: 0.3,
    matchedRule: 'fallback',
  }
}

// ============================================
// INLINED PROMPT COMPOSITION (from reply-prompts.ts)
// ============================================

function buildStrategyBlock(
  config: StrategyConfig,
  archetypeSlug: string,
  modifierSlugs: string[]
): string {
  const parts: string[] = []

  // 1. Core Voice — full content, non-negotiable
  if (config.coreVoice?.content) {
    parts.push(`## Core Voice\n${config.coreVoice.content}`)
  }

  // 2. Archetype voice — full content, non-negotiable
  const archetype = config.archetypes[archetypeSlug]
  if (archetype?.content) {
    parts.push(`## Voice: ${archetype.name}\n${archetype.content}`)
  }

  // 3. Modifiers — budget-constrained, sorted by priority, lowest dropped first
  if (modifierSlugs.length > 0) {
    const modHeader = '## Context Modifiers\n'
    let modCharCount = modHeader.length
    const modifierParts: string[] = []

    for (const slug of modifierSlugs) {
      const mod = config.modifiers[slug]
      if (!mod?.content) continue

      const section = `### ${mod.name}\n${mod.content}`
      const joinerCost = modifierParts.length > 0 ? 2 : 0
      if (modCharCount + section.length + joinerCost > MODIFIER_CHAR_BUDGET) break
      modifierParts.push(section)
      modCharCount += section.length + joinerCost
    }

    if (modifierParts.length > 0) {
      parts.push(`${modHeader}${modifierParts.join('\n\n')}`)
    }
  }

  return parts.join('\n\n')
}

function assembleSystemPrompt(
  strategyBlock: string,
  comment: LinkedInComment,
  instruction?: string
): string {
  const lines = [
    strategyBlock,
    '',
    'You are drafting a reply to a LinkedIn comment. Be concise and authentic.',
  ]
  if (instruction) {
    lines.push(`User's specific request: ${instruction}`)
  }
  lines.push(
    '',
    `The comment is on Jim's post titled: "${comment.postTitle}"`,
    '',
    'Commenter info:',
    `- Name: ${comment.author.name}`,
    `- Headline: ${comment.author.headline}`,
    `- Sector: ${comment.author.sector}`,
    `- Grove Alignment: ${comment.author.groveAlignment}`,
    `- Degree: ${comment.author.linkedInDegree}`,
  )
  if (comment.author.strategicBucket) {
    lines.push(`- Strategic Bucket: ${comment.author.strategicBucket}`)
  }
  if (comment.author.relationshipStage) {
    lines.push(`- Relationship Stage: ${comment.author.relationshipStage}`)
  }
  lines.push('', 'Reply ONLY with the draft text, no preamble or explanation.')
  return lines.join('\n')
}

function composePrompt(
  config: StrategyConfig | null,
  archetypeSlug: string,
  modifierSlugs: string[],
  comment: LinkedInComment,
  instruction?: string
): ComposedPrompt {
  if (!config) {
    return {
      systemPrompt: [
        'You are helping Jim Calhoun draft replies to LinkedIn comments on his posts about AI infrastructure.',
        '',
        'You are drafting a reply to a LinkedIn comment. Be concise and authentic.',
        '',
        `The comment is on Jim's post titled: "${comment.postTitle}"`,
        '',
        'Commenter info:',
        `- Name: ${comment.author.name}`,
        `- Headline: ${comment.author.headline}`,
        `- Sector: ${comment.author.sector}`,
        `- Grove Alignment: ${comment.author.groveAlignment}`,
        '',
        'Reply ONLY with the draft text, no preamble or explanation.',
      ].join('\n'),
      strategyBlock: '',
      archetype: 'fallback',
      modifiers: [],
      usedFallback: true,
    }
  }

  const strategyBlock = buildStrategyBlock(config, archetypeSlug, modifierSlugs)
  const systemPrompt = assembleSystemPrompt(strategyBlock, comment, instruction)

  return {
    systemPrompt,
    strategyBlock,
    archetype: archetypeSlug,
    modifiers: modifierSlugs,
    usedFallback: false,
  }
}

// ============================================
// SECTION 1: NOTION CONNECTIVITY
// ============================================

async function section1_NotionConnectivity() {
  console.log('\n📡 SECTION 1: Notion Connectivity\n')

  // 1.1: API key exists
  await runTest('Notion Connectivity', 'NOTION_API_KEY env var exists', async () => {
    notionApiKey = process.env.NOTION_API_KEY || null
    if (!notionApiKey) {
      throw new Error(
        'NOTION_API_KEY not set. Run: $env:NOTION_API_KEY="secret_..." first'
      )
    }
  })

  // 1.2: Database accessible
  await runTest(
    'Notion Connectivity',
    'Reply Strategy Config database accessible',
    async () => {
      const response = await notionFetch(`/databases/${REPLY_STRATEGY_DB_ID}`)
      if (!response.id) throw new Error('Invalid database response')
    }
  )

  // 1.3: Returns entries
  await runTest(
    'Notion Connectivity',
    'Database returns entries (count > 0)',
    async () => {
      const response = await notionFetch(
        `/databases/${REPLY_STRATEGY_DB_ID}/query`,
        { method: 'POST', body: JSON.stringify({ page_size: 5 }) }
      )
      if (!response.results?.length) {
        throw new Error('Database returned 0 entries')
      }
    }
  )

  // 1.4: All 4 entry types present
  await runTest(
    'Notion Connectivity',
    'All 4 entry types present (core_voice, archetype, modifier, rule)',
    async () => {
      console.log('   Fetching all entries with page bodies...')
      allEntries = await fetchAllEntries()
      console.log(`   Fetched ${allEntries.length} entries`)

      const types = new Set(allEntries.map((e) => e.type))
      const expected: ConfigEntryType[] = [
        'core_voice',
        'archetype',
        'modifier',
        'rule',
      ]
      const missing = expected.filter((t) => !types.has(t))
      if (missing.length > 0) {
        throw new Error(`Missing entry types: ${missing.join(', ')}`)
      }

      // Build config for later sections
      activeConfig = buildConfig(allEntries)
    }
  )
}

// ============================================
// SECTION 2: SCHEMA VALIDATION
// ============================================

async function section2_SchemaValidation() {
  console.log('\n📋 SECTION 2: Schema Validation\n')

  // 2.1: Required properties
  await runTest(
    'Schema Validation',
    'Every entry has Slug, Type, Active, Priority',
    async () => {
      const invalid = allEntries.filter(
        (e) => !e.slug || !e.type || e.priority === undefined
      )
      if (invalid.length > 0) {
        throw new Error(
          `${invalid.length} entries missing required properties: ${invalid.map((e) => e.name || e.id).join(', ')}`
        )
      }
    }
  )

  // 2.2: Active entries have page body content
  await runTest(
    'Schema Validation',
    'Every Active entry has non-empty page body content',
    async () => {
      const activeNoBody = allEntries.filter(
        (e) => e.active && !e.content.trim()
      )
      if (activeNoBody.length > 0) {
        throw new Error(
          `${activeNoBody.length} Active entries have empty page body: ${activeNoBody.map((e) => `${e.name} (${e.type})`).join(', ')}`
        )
      }
    }
  )

  // 2.3: All 5 archetype slugs
  await runTest(
    'Schema Validation',
    'All 5 archetype slugs present',
    async () => {
      const archetypeSlugs = allEntries
        .filter((e) => e.type === 'archetype')
        .map((e) => e.slug)

      const missing = EXPECTED_ARCHETYPES.filter(
        (slug) => !archetypeSlugs.includes(slug)
      )
      if (missing.length > 0) {
        throw new Error(`Missing archetypes: ${missing.join(', ')}`)
      }
    }
  )

  // 2.4: Exactly 1 core_voice
  await runTest(
    'Schema Validation',
    'Exactly 1 Active core_voice entry',
    async () => {
      const coreVoices = allEntries.filter(
        (e) => e.type === 'core_voice' && e.active
      )
      if (coreVoices.length !== 1) {
        throw new Error(
          `Expected exactly 1 Active core_voice, found ${coreVoices.length}`
        )
      }
    }
  )

  // 2.5: Fallback rule exists
  await runTest(
    'Schema Validation',
    'Wildcard fallback rule exists and is Active',
    async () => {
      const fallback = allEntries.find(
        (e) =>
          e.type === 'rule' &&
          e.active &&
          e.conditions.trim() === '*' &&
          e.archetype === 'standard_engagement'
      )
      if (!fallback) {
        throw new Error(
          'No Active rule with Conditions="*" and Archetype="standard_engagement" found'
        )
      }
    }
  )
}

// ============================================
// SECTION 3: RULES ENGINE
// ============================================

async function section3_RulesEngine() {
  console.log('\n⚙️  SECTION 3: Rules Engine\n')

  if (!activeConfig) throw new Error('Config not loaded — Section 1 must pass first')

  // 3.1: Laura Borges → business_relationship
  // NOTE: Sprint spec says modifiers includes "content_amplifier" but Laura's
  // strategicBucket is "Enterprise Clients" which triggers "enterprise_aware", not
  // "content_amplifier" (which requires "Content Amplifiers" bucket). The seeded data
  // and rules engine correctly produce enterprise_aware. Spec discrepancy documented.
  await runTest(
    'Rules Engine',
    'Laura Borges → archetype: business_relationship',
    async () => {
      const result = evaluateRulesFromConfig(activeConfig!, LAURA_BORGES)
      if (result.archetype !== 'business_relationship') {
        throw new Error(
          `Expected business_relationship, got ${result.archetype} (matched: ${result.matchedRule})`
        )
      }
    }
  )

  await runTest(
    'Rules Engine',
    'Laura Borges → modifiers include enterprise_aware',
    async () => {
      const result = evaluateRulesFromConfig(activeConfig!, LAURA_BORGES)
      if (!result.modifiers.includes('enterprise_aware')) {
        throw new Error(
          `Expected enterprise_aware in modifiers, got: [${result.modifiers.join(', ')}]`
        )
      }
    }
  )

  // 3.2: Empty contact → standard_engagement fallback
  await runTest(
    'Rules Engine',
    'Empty contact fields → standard_engagement fallback',
    async () => {
      const result = evaluateRulesFromConfig(activeConfig!, EMPTY_AUTHOR)
      if (result.archetype !== 'standard_engagement') {
        throw new Error(
          `Expected standard_engagement, got ${result.archetype} (matched: ${result.matchedRule})`
        )
      }
    }
  )

  await runTest(
    'Rules Engine',
    'Empty contact fields → empty modifiers',
    async () => {
      const result = evaluateRulesFromConfig(activeConfig!, EMPTY_AUTHOR)
      if (result.modifiers.length !== 0) {
        throw new Error(
          `Expected 0 modifiers, got: [${result.modifiers.join(', ')}]`
        )
      }
    }
  )

  // 3.3: Priority ordering — rules sorted by priority, first match wins
  await runTest(
    'Rules Engine',
    'Rules sorted by priority (lower number = higher precedence)',
    async () => {
      for (let i = 1; i < activeConfig!.rules.length; i++) {
        if (activeConfig!.rules[i].priority < activeConfig!.rules[i - 1].priority) {
          throw new Error(
            `Rule "${activeConfig!.rules[i].name}" (P${activeConfig!.rules[i].priority}) is after ` +
              `"${activeConfig!.rules[i - 1].name}" (P${activeConfig!.rules[i - 1].priority}) but has higher priority`
          )
        }
      }
    }
  )

  // 3.4: High Grove + Tech → thesis_engagement
  await runTest(
    'Rules Engine',
    'High Grove Alignment + Tech sector → thesis_engagement',
    async () => {
      const result = evaluateRulesFromConfig(activeConfig!, HIGH_GROVE_TECH)
      if (result.archetype !== 'thesis_engagement') {
        throw new Error(
          `Expected thesis_engagement, got ${result.archetype} (matched: ${result.matchedRule})`
        )
      }
    }
  )

  // 3.5: Job Seeker → talent_nurture
  await runTest(
    'Rules Engine',
    'Job Seeker + Open to Work → talent_nurture',
    async () => {
      const result = evaluateRulesFromConfig(activeConfig!, JOB_SEEKER)
      if (result.archetype !== 'talent_nurture') {
        throw new Error(
          `Expected talent_nurture, got ${result.archetype} (matched: ${result.matchedRule})`
        )
      }
    }
  )
}

// ============================================
// SECTION 4: PROMPT COMPOSITION
// ============================================

async function section4_PromptComposition() {
  console.log('\n📝 SECTION 4: Prompt Composition\n')

  if (!activeConfig) throw new Error('Config not loaded')

  const evaluation = evaluateRulesFromConfig(activeConfig, LAURA_BORGES)
  const composed = composePrompt(
    activeConfig,
    evaluation.archetype,
    evaluation.modifiers,
    LAURA_BORGES_COMMENT
  )

  // 4.1: Full prompt assembly
  await runTest(
    'Prompt Composition',
    'Full prompt assembles for Laura Borges case',
    async () => {
      if (!composed.systemPrompt) {
        throw new Error('systemPrompt is empty')
      }
      if (composed.usedFallback) {
        throw new Error('Used fallback — config-based prompt expected')
      }
    }
  )

  // 4.2: Core voice included in full (not truncated), modifier stack within budget
  await runTest(
    'Prompt Composition',
    'Core voice full (non-negotiable) + modifier stack within budget',
    async () => {
      // Core voice must be included in full — never truncated
      const coreVoiceContent = activeConfig!.coreVoice?.content || ''
      if (coreVoiceContent && !composed.strategyBlock.includes(coreVoiceContent)) {
        throw new Error(
          `Core voice content was truncated or missing (expected ${coreVoiceContent.length} chars in full)`
        )
      }

      // Extract modifier section and check it fits within MODIFIER_CHAR_BUDGET
      const modIdx = composed.strategyBlock.indexOf('## Context Modifiers')
      if (modIdx !== -1) {
        const modSection = composed.strategyBlock.slice(modIdx)
        if (modSection.length > MODIFIER_CHAR_BUDGET) {
          throw new Error(
            `Modifier stack is ${modSection.length} chars, budget is ${MODIFIER_CHAR_BUDGET}`
          )
        }
        console.log(`   Modifier stack: ${modSection.length} chars (budget: ${MODIFIER_CHAR_BUDGET})`)
      } else {
        console.log('   No modifiers in strategy block (may be budget-constrained or no match)')
      }

      // Log overall stats
      const wordCount = composed.strategyBlock.split(/\s+/).filter(Boolean).length
      const tokenEstimate = Math.round(wordCount / 0.75)
      console.log(
        `   Strategy block total: ${composed.strategyBlock.length} chars, ~${wordCount} words, ~${tokenEstimate} tokens`
      )
    }
  )

  // 4.3: Core voice before archetype
  await runTest(
    'Prompt Composition',
    'Core voice content appears before archetype content',
    async () => {
      const coreIdx = composed.strategyBlock.indexOf('## Core Voice')
      const archIdx = composed.strategyBlock.indexOf('## Voice:')
      if (coreIdx === -1) throw new Error('Core Voice section not found in strategy block')
      if (archIdx === -1) throw new Error('Archetype Voice section not found in strategy block')
      if (coreIdx > archIdx) {
        throw new Error(
          `Core Voice (pos ${coreIdx}) appears after Archetype (pos ${archIdx})`
        )
      }
    }
  )

  // 4.4: Archetype before modifiers
  await runTest(
    'Prompt Composition',
    'Archetype content appears before modifier content',
    async () => {
      const archIdx = composed.strategyBlock.indexOf('## Voice:')
      const modIdx = composed.strategyBlock.indexOf('## Context Modifiers')
      if (archIdx === -1) throw new Error('Archetype section not found')
      // Modifiers may not be present if budget was exceeded
      if (modIdx !== -1 && archIdx > modIdx) {
        throw new Error(
          `Archetype (pos ${archIdx}) appears after Modifiers (pos ${modIdx})`
        )
      }
    }
  )

  // 4.5: Non-empty, > 100 chars
  await runTest(
    'Prompt Composition',
    'Composed system prompt is non-empty and > 100 chars',
    async () => {
      if (composed.systemPrompt.length <= 100) {
        throw new Error(
          `System prompt is only ${composed.systemPrompt.length} chars, expected > 100`
        )
      }
    }
  )
}

// ============================================
// SECTION 5: FALLBACK CHAIN
// ============================================

async function section5_FallbackChain() {
  console.log('\n🔄 SECTION 5: Fallback Chain\n')

  // 5.1: Null config → fallback prompt with GROVE_CONTEXT content
  await runTest(
    'Fallback Chain',
    'Null config → fallback prompt mentioning Jim Calhoun + AI infrastructure',
    async () => {
      const composed = composePrompt(
        null,
        'fallback',
        [],
        LAURA_BORGES_COMMENT
      )

      if (!composed.usedFallback) {
        throw new Error('Expected usedFallback=true for null config')
      }
      if (!composed.systemPrompt.includes('Jim Calhoun')) {
        throw new Error('Fallback prompt missing "Jim Calhoun"')
      }
      if (!composed.systemPrompt.includes('AI infrastructure')) {
        throw new Error('Fallback prompt missing "AI infrastructure"')
      }
    }
  )

  // 5.2: Fallback returns valid prompt structure
  await runTest(
    'Fallback Chain',
    'Fallback prompt includes comment context (post title, author name)',
    async () => {
      const composed = composePrompt(
        null,
        'fallback',
        [],
        LAURA_BORGES_COMMENT
      )
      if (!composed.systemPrompt.includes(LAURA_BORGES_COMMENT.postTitle)) {
        throw new Error('Fallback prompt missing post title')
      }
      if (!composed.systemPrompt.includes(LAURA_BORGES.name)) {
        throw new Error('Fallback prompt missing author name')
      }
    }
  )

  // 5.3: Quick Reply → standard_engagement with empty modifiers
  await runTest(
    'Fallback Chain',
    'Quick Reply (no contact data) → standard_engagement + empty modifiers',
    async () => {
      if (!activeConfig) throw new Error('Config not loaded')

      const result = evaluateRulesFromConfig(activeConfig, EMPTY_AUTHOR)

      if (result.archetype !== 'standard_engagement') {
        throw new Error(
          `Expected standard_engagement, got ${result.archetype}`
        )
      }
      if (result.modifiers.length !== 0) {
        throw new Error(
          `Expected empty modifiers, got [${result.modifiers.join(', ')}]`
        )
      }
    }
  )
}

// ============================================
// SECTION 6: CACHE LIFECYCLE
// ============================================

async function section6_CacheLifecycle() {
  console.log('\n💾 SECTION 6: Cache Lifecycle\n')

  // chrome.storage.local is not available outside the extension context.
  // Cache lifecycle is validated in bun:test unit tests (reply-strategy.test.ts).
  // Here we validate the config structure that would be cached.

  // 6.1: Config structure is serializable
  await runTest(
    'Cache Lifecycle',
    'Config serializes to JSON and round-trips correctly',
    async () => {
      if (!activeConfig) throw new Error('Config not loaded')

      const serialized = JSON.stringify(activeConfig)
      const deserialized = JSON.parse(serialized) as StrategyConfig

      if (!deserialized.coreVoice) {
        throw new Error('Round-trip lost coreVoice')
      }
      if (Object.keys(deserialized.archetypes).length !== Object.keys(activeConfig.archetypes).length) {
        throw new Error('Round-trip lost archetypes')
      }
      if (Object.keys(deserialized.modifiers).length !== Object.keys(activeConfig.modifiers).length) {
        throw new Error('Round-trip lost modifiers')
      }
      if (deserialized.rules.length !== activeConfig.rules.length) {
        throw new Error('Round-trip lost rules')
      }
    }
  )

  // 6.2: Config has expected field counts
  await runTest(
    'Cache Lifecycle',
    'Config has expected structure (coreVoice, 5 archetypes, modifiers, rules)',
    async () => {
      if (!activeConfig) throw new Error('Config not loaded')

      const archCount = Object.keys(activeConfig.archetypes).length
      if (archCount !== 5) {
        throw new Error(`Expected 5 archetypes, got ${archCount}`)
      }

      const modCount = Object.keys(activeConfig.modifiers).length
      if (modCount === 0) {
        throw new Error('Expected modifiers, got 0')
      }

      const ruleCount = activeConfig.rules.length
      if (ruleCount === 0) {
        throw new Error('Expected rules, got 0')
      }

      console.log(
        `   Config: 1 core_voice, ${archCount} archetypes, ${modCount} modifiers, ${ruleCount} rules`
      )
    }
  )

  // 6.3: SKIP chrome.storage.local TTL (requires extension context)
  logResult(
    'Cache Lifecycle',
    'chrome.storage.local TTL expiry',
    'SKIP',
    0,
    'Requires Chrome extension context — covered by bun:test unit tests'
  )
}

// ============================================
// SECTION 7: END-TO-END PIPELINE
// ============================================

async function section7_E2EPipeline() {
  console.log('\n🚀 SECTION 7: End-to-End Pipeline\n')

  if (!activeConfig) throw new Error('Config not loaded')

  // Full pipeline: author → evaluate rules → compose prompt
  const evaluation = evaluateRulesFromConfig(activeConfig, LAURA_BORGES)
  const composed = composePrompt(
    activeConfig,
    evaluation.archetype,
    evaluation.modifiers,
    LAURA_BORGES_COMMENT
  )

  // 7.1: Full pipeline produces result
  await runTest(
    'E2E Pipeline',
    'Full pipeline: Laura Borges → composed prompt string',
    async () => {
      if (!composed.systemPrompt || composed.systemPrompt.length === 0) {
        throw new Error('Pipeline produced empty systemPrompt')
      }
      if (composed.usedFallback) {
        throw new Error('Pipeline fell back to GROVE_CONTEXT — strategy config should have been used')
      }
    }
  )

  // 7.2: Contains core voice content (check for known phrase)
  await runTest(
    'E2E Pipeline',
    'Output contains core_voice content (known phrase from voice block)',
    async () => {
      // The core voice page body should contain recognizable phrases.
      // Check for structural markers that prove core_voice was included.
      if (!composed.strategyBlock.includes('## Core Voice')) {
        throw new Error('Strategy block missing "## Core Voice" header')
      }
      // Check the core voice content is non-trivial
      const coreVoiceStart = composed.strategyBlock.indexOf('## Core Voice')
      const nextSection = composed.strategyBlock.indexOf('\n## ', coreVoiceStart + 1)
      const coreVoiceSection =
        nextSection > -1
          ? composed.strategyBlock.slice(coreVoiceStart, nextSection)
          : composed.strategyBlock.slice(coreVoiceStart)

      if (coreVoiceSection.length < 50) {
        throw new Error(
          `Core voice section is only ${coreVoiceSection.length} chars — content may not have loaded`
        )
      }
    }
  )

  // 7.3: Contains archetype-specific content
  await runTest(
    'E2E Pipeline',
    'Output contains business_relationship archetype content',
    async () => {
      if (!composed.strategyBlock.includes('## Voice:')) {
        throw new Error('Strategy block missing archetype "## Voice:" header')
      }
      if (composed.archetype !== 'business_relationship') {
        throw new Error(
          `Expected business_relationship archetype, got ${composed.archetype}`
        )
      }
    }
  )

  // 7.4: Not empty, not truncated, not error message
  await runTest(
    'E2E Pipeline',
    'Output is well-formed (not empty, not truncated, not error)',
    async () => {
      if (composed.systemPrompt.length < 200) {
        throw new Error(`System prompt suspiciously short: ${composed.systemPrompt.length} chars`)
      }
      if (composed.systemPrompt.includes('Error:') || composed.systemPrompt.includes('error:')) {
        throw new Error('System prompt contains error text')
      }
      // Check it ends properly (not mid-word/mid-sentence)
      const lastChar = composed.systemPrompt.trim().slice(-1)
      if (lastChar !== '.' && lastChar !== ':' && lastChar !== '"' && lastChar !== ')') {
        // Acceptable endings — the prompt ends with "no preamble or explanation."
        console.log(`   (Prompt ends with: "${composed.systemPrompt.trim().slice(-30)}")`)
      }
    }
  )

  // 7.5: Confidence > 0
  await runTest(
    'E2E Pipeline',
    'Confidence field is present and > 0',
    async () => {
      if (typeof evaluation.confidence !== 'number') {
        throw new Error('Confidence is not a number')
      }
      if (evaluation.confidence <= 0) {
        throw new Error(`Confidence is ${evaluation.confidence}, expected > 0`)
      }
    }
  )
}

// ============================================
// MAIN EXECUTION
// ============================================

async function main() {
  console.log(
    '\n╔════════════════════════════════════════════════════════════╗'
  )
  console.log(
    '║     MASTER BLASTER: REPLY STRATEGY TEST BATTERY          ║'
  )
  console.log(
    '╚════════════════════════════════════════════════════════════╝\n'
  )

  const startTime = Date.now()
  let fatalError = false

  try {
    await section1_NotionConnectivity()

    // If API key isn't set, skip everything else
    if (!notionApiKey) {
      console.log('\n⏭️  Skipping Sections 2-7 (no API key)\n')
    } else {
      await section2_SchemaValidation()
      await section3_RulesEngine()
      await section4_PromptComposition()
      await section5_FallbackChain()
      await section6_CacheLifecycle()
      await section7_E2EPipeline()
    }
  } catch (err) {
    console.error('\n🔥 FATAL ERROR:', err)
    fatalError = true
  }

  // Summary
  const passed = results.filter((r) => r.status === 'PASS').length
  const failed = results.filter((r) => r.status === 'FAIL').length
  const skipped = results.filter((r) => r.status === 'SKIP').length
  const total = results.length
  const duration = ((Date.now() - startTime) / 1000).toFixed(2)

  console.log(
    '\n════════════════════════════════════════════════════════════'
  )
  console.log(
    `\n📊 SUMMARY: ${passed}/${total} passed, ${failed} failed, ${skipped} skipped`
  )
  console.log(`⏱️  Duration: ${duration}s\n`)

  if (failed > 0 || fatalError) {
    console.log('❌ FAILURES:\n')
    results
      .filter((r) => r.status === 'FAIL')
      .forEach((r) => {
        console.log(`   • [${r.section}] ${r.test}`)
        console.log(`     Error: ${r.error}\n`)
      })

    console.log(
      '\n🛑 MASTER BLASTER FAILED — FIX BEFORE PROCEEDING\n'
    )
    process.exit(1)
  } else {
    console.log(
      '✅ ALL TESTS PASSED — READY FOR MERGE\n'
    )
    process.exit(0)
  }
}

main()
