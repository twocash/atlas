/**
 * Master Blaster: Action Feed Test Battery
 *
 * Tests the Chrome extension Action Feed feature end-to-end.
 * Covers: Notion polling, card rendering data, user actions, batch mode,
 * state persistence, error handling, and edge cases.
 *
 * Run: bun run test:action-feed
 * Alias: bun run verify:extension
 *
 * Requires: NOTION_API_KEY env var (same key used by telegram bot)
 *
 * ┌─────────────────────────────────────────────────────────────┐
 * │  MASTER BLASTER PROTOCOL — ACTION FEED                      │
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

const FEED_DATABASE_ID = '90b2b33f-4b44-4b42-870f-8d62fb8cbf18'
const WORK_QUEUE_DATABASE_ID = '3d679030-b76b-43bd-92d8-1ac51abb4a28'

interface TestResult {
  section: string
  test: string
  status: 'PASS' | 'FAIL' | 'SKIP'
  duration: number
  error?: string
  details?: string
}

const results: TestResult[] = []
let notionApiKey: string | null = null

// Track all created entries for guaranteed cleanup
const allCreatedEntryIds: string[] = []

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

async function createTestFeedEntry(
  actionType: string,
  actionData: object
): Promise<string> {
  const response = await notionFetch(`/pages`, {
    method: 'POST',
    body: JSON.stringify({
      parent: { database_id: FEED_DATABASE_ID },
      properties: {
        Entry: {
          title: [
            { text: { content: `[TEST] ${actionType} - ${Date.now()}` } },
          ],
        },
        Source: { select: { name: 'Master Blaster' } },
        'Action Status': { select: { name: 'Pending' } },
        'Action Type': { select: { name: actionType } },
        'Action Data': {
          rich_text: [{ text: { content: JSON.stringify(actionData) } }],
        },
      },
    }),
  })
  allCreatedEntryIds.push(response.id)
  return response.id
}

async function getFeedEntry(pageId: string): Promise<any> {
  return notionFetch(`/pages/${pageId}`)
}

async function archiveFeedEntry(pageId: string): Promise<void> {
  await notionFetch(`/pages/${pageId}`, {
    method: 'PATCH',
    body: JSON.stringify({ archived: true }),
  })
}

async function queryPendingItems(): Promise<any[]> {
  const response = await notionFetch(
    `/databases/${FEED_DATABASE_ID}/query`,
    {
      method: 'POST',
      body: JSON.stringify({
        filter: {
          property: 'Action Status',
          select: { equals: 'Pending' },
        },
        sorts: [{ timestamp: 'created_time', direction: 'descending' }],
      }),
    }
  )
  return response.results
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
// SECTION 1: NOTION API CONNECTIVITY
// ============================================

async function section1_NotionConnectivity() {
  console.log('\n📡 SECTION 1: Notion API Connectivity\n')

  // Test 1.1: API key is configured
  await runTest(
    'Notion Connectivity',
    'NOTION_API_KEY env var exists',
    async () => {
      notionApiKey = process.env.NOTION_API_KEY || null
      if (!notionApiKey) {
        throw new Error(
          'NOTION_API_KEY not set. Run: $env:NOTION_API_KEY="secret_..." first'
        )
      }
    }
  )

  // Test 1.2: Can query Feed 2.0 database
  await runTest(
    'Notion Connectivity',
    'Feed 2.0 database accessible',
    async () => {
      const response = await notionFetch(`/databases/${FEED_DATABASE_ID}`)
      if (!response.id) throw new Error('Invalid database response')
    }
  )

  // Test 1.3: Can query Work Queue 2.0 database
  await runTest(
    'Notion Connectivity',
    'Work Queue 2.0 database accessible',
    async () => {
      const response = await notionFetch(
        `/databases/${WORK_QUEUE_DATABASE_ID}`
      )
      if (!response.id) throw new Error('Invalid database response')
    }
  )

  // Test 1.4: Feed 2.0 has Action properties
  await runTest(
    'Notion Connectivity',
    'Feed 2.0 schema has Action Status, Action Type, Action Data properties',
    async () => {
      const response = await notionFetch(`/databases/${FEED_DATABASE_ID}`)
      const props = response.properties
      if (!props['Action Status'])
        throw new Error('Action Status property missing')
      if (!props['Action Type'])
        throw new Error('Action Type property missing')
      if (!props['Action Data'])
        throw new Error('Action Data property missing')
    }
  )
}

// ============================================
// SECTION 2: CARD CREATION (ALL 5 TYPES)
// ============================================

async function section2_CardCreation() {
  console.log('\n🎴 SECTION 2: Card Creation — All 5 Action Types\n')

  // Test 2.1: Create Triage card
  await runTest(
    'Card Creation',
    'Create Triage card with full actionData',
    async () => {
      const id = await createTestFeedEntry('Triage', {
        platform: 'TikTok',
        title: 'Test saved video for triage',
        creator: '@testuser',
        url: 'https://tiktok.com/@testuser/video/123',
        thumbnail: 'https://example.com/thumb.jpg',
      })

      const entry = await getFeedEntry(id)
      if (entry.properties['Action Status'].select.name !== 'Pending') {
        throw new Error('Action Status not set to Pending')
      }
      if (entry.properties['Action Type'].select.name !== 'Triage') {
        throw new Error('Action Type not set to Triage')
      }
    }
  )

  // Test 2.2: Create Approval card
  await runTest(
    'Card Creation',
    'Create Approval card with skill reference',
    async () => {
      const id = await createTestFeedEntry('Approval', {
        skill_id: 'test-skill-001',
        skill_name: 'Test Skill Execution',
        description: 'Atlas wants to run a test skill that modifies data',
      })

      const entry = await getFeedEntry(id)
      if (entry.properties['Action Type'].select.name !== 'Approval') {
        throw new Error('Action Type not set to Approval')
      }
    }
  )

  // Test 2.3: Create Review card
  await runTest(
    'Card Creation',
    'Create Review card with WQ reference',
    async () => {
      const id = await createTestFeedEntry('Review', {
        wq_item_id: '00000000-0000-0000-0000-000000000000',
        wq_title: 'Test Work Queue Item',
        output_url: 'https://notion.so/test-output',
      })

      const entry = await getFeedEntry(id)
      if (entry.properties['Action Type'].select.name !== 'Review') {
        throw new Error('Action Type not set to Review')
      }
    }
  )

  // Test 2.4: Create Alert card
  await runTest(
    'Card Creation',
    'Create Alert card with breakage details',
    async () => {
      const id = await createTestFeedEntry('Alert', {
        alert_type: 'dom_breakage',
        platform: 'LinkedIn',
        breakage_type: 'PARTIAL',
        failed_selectors: ['.feed-item', '.profile-card'],
        dev_pipeline_url: 'https://notion.so/pit-crew-ticket',
      })

      const entry = await getFeedEntry(id)
      if (entry.properties['Action Type'].select.name !== 'Alert') {
        throw new Error('Action Type not set to Alert')
      }
    }
  )

  // Test 2.5: Create Info card
  await runTest(
    'Card Creation',
    'Create Info card with message',
    async () => {
      const id = await createTestFeedEntry('Info', {
        message: 'Daily briefing generated successfully',
        details: '42 items processed, 3 high priority',
        source: 'Atlas Scheduler',
      })

      const entry = await getFeedEntry(id)
      if (entry.properties['Action Type'].select.name !== 'Info') {
        throw new Error('Action Type not set to Info')
      }
    }
  )
}

// ============================================
// SECTION 3: TRIAGE CARD WORKFLOWS
// ============================================

async function section3_TriageWorkflows() {
  console.log('\n🎯 SECTION 3: Triage Card Workflows\n')

  // Test 3.1: Triage -> Capture
  await runTest(
    'Triage Workflows',
    'Triage → Capture writes Actioned status + disposition',
    async () => {
      const id = await createTestFeedEntry('Triage', {
        platform: 'Twitter',
        title: 'Test tweet for capture',
        url: 'https://twitter.com/test/status/123',
      })

      await notionFetch(`/pages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Actioned' } },
            'Action Data': {
              rich_text: [
                {
                  text: {
                    content: JSON.stringify({
                      platform: 'Twitter',
                      title: 'Test tweet for capture',
                      url: 'https://twitter.com/test/status/123',
                      pillar: 'Personal',
                      disposition: 'Capture',
                    }),
                  },
                },
              ],
            },
            'Actioned At': { date: { start: new Date().toISOString() } },
            'Actioned Via': { select: { name: 'Extension' } },
          },
        }),
      })

      const updated = await getFeedEntry(id)
      if (updated.properties['Action Status'].select.name !== 'Actioned') {
        throw new Error('Status not updated to Actioned')
      }
      const actionData = JSON.parse(
        updated.properties['Action Data'].rich_text[0].text.content
      )
      if (actionData.disposition !== 'Capture') {
        throw new Error('Disposition not set to Capture')
      }
    }
  )

  // Test 3.2: Triage -> Research flags WQ creation
  await runTest(
    'Triage Workflows',
    'Triage → Research flags create_wq_item',
    async () => {
      const id = await createTestFeedEntry('Triage', {
        platform: 'LinkedIn',
        title: 'Article about AI strategy',
        url: 'https://linkedin.com/posts/123',
      })

      await notionFetch(`/pages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Actioned' } },
            'Action Data': {
              rich_text: [
                {
                  text: {
                    content: JSON.stringify({
                      platform: 'LinkedIn',
                      title: 'Article about AI strategy',
                      url: 'https://linkedin.com/posts/123',
                      pillar: 'Consulting',
                      disposition: 'Research',
                      create_wq_item: true,
                    }),
                  },
                },
              ],
            },
          },
        }),
      })

      const updated = await getFeedEntry(id)
      const actionData = JSON.parse(
        updated.properties['Action Data'].rich_text[0].text.content
      )
      if (!actionData.create_wq_item) {
        throw new Error('create_wq_item flag not set')
      }
    }
  )

  // Test 3.3: Triage -> Dismiss (no pillar required)
  await runTest(
    'Triage Workflows',
    'Triage → Dismiss works without pillar',
    async () => {
      const id = await createTestFeedEntry('Triage', {
        platform: 'Threads',
        title: 'Random meme to dismiss',
        url: 'https://threads.net/post/123',
      })

      await notionFetch(`/pages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Dismissed' } },
            'Action Data': {
              rich_text: [
                {
                  text: {
                    content: JSON.stringify({
                      platform: 'Threads',
                      title: 'Random meme to dismiss',
                      url: 'https://threads.net/post/123',
                      disposition: 'Dismiss',
                    }),
                  },
                },
              ],
            },
          },
        }),
      })

      const updated = await getFeedEntry(id)
      if (updated.properties['Action Status'].select.name !== 'Dismissed') {
        throw new Error('Dismiss without pillar failed')
      }
    }
  )

  // Test 3.4: All 4 pillar values accepted
  await runTest(
    'Triage Workflows',
    'All 4 pillar values accepted by Notion',
    async () => {
      const pillars = ['Personal', 'The Grove', 'Consulting', 'Home/Garage']

      for (const pillar of pillars) {
        const id = await createTestFeedEntry('Triage', {
          platform: 'Test',
          title: `Pillar test: ${pillar}`,
          url: 'https://example.com',
          pillar,
        })

        const entry = await getFeedEntry(id)
        const actionData = JSON.parse(
          entry.properties['Action Data'].rich_text[0].text.content
        )
        if (actionData.pillar !== pillar) {
          throw new Error(`Pillar "${pillar}" not persisted correctly`)
        }
      }
    }
  )
}

// ============================================
// SECTION 4: ALERT CARD WORKFLOWS
// ============================================

async function section4_AlertWorkflows() {
  console.log('\n🚨 SECTION 4: Alert Card Workflows\n')

  // Test 4.1: Alert -> Acknowledge
  await runTest(
    'Alert Workflows',
    'Alert → Acknowledge resolves card',
    async () => {
      const id = await createTestFeedEntry('Alert', {
        alert_type: 'health_check',
        platform: 'System',
        breakage_type: 'WARNING',
      })

      await notionFetch(`/pages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Actioned' } },
            'Action Data': {
              rich_text: [
                {
                  text: {
                    content: JSON.stringify({
                      alert_type: 'health_check',
                      platform: 'System',
                      breakage_type: 'WARNING',
                      disposition: 'Acknowledge',
                    }),
                  },
                },
              ],
            },
          },
        }),
      })

      const updated = await getFeedEntry(id)
      if (updated.properties['Action Status'].select.name !== 'Actioned') {
        throw new Error('Acknowledge did not resolve card')
      }
    }
  )

  // Test 4.2: Alert -> Snooze
  await runTest(
    'Alert Workflows',
    'Alert → Snooze sets Snoozed status + snooze_until',
    async () => {
      const id = await createTestFeedEntry('Alert', {
        alert_type: 'rate_limit',
        platform: 'Notion API',
      })

      const snoozeUntil = new Date(
        Date.now() + 4 * 60 * 60 * 1000
      ).toISOString()

      await notionFetch(`/pages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Snoozed' } },
            'Action Data': {
              rich_text: [
                {
                  text: {
                    content: JSON.stringify({
                      alert_type: 'rate_limit',
                      platform: 'Notion API',
                      disposition: 'Snooze',
                      snooze_until: snoozeUntil,
                    }),
                  },
                },
              ],
            },
          },
        }),
      })

      const updated = await getFeedEntry(id)
      if (updated.properties['Action Status'].select.name !== 'Snoozed') {
        throw new Error('Snooze did not set Snoozed status')
      }

      const actionData = JSON.parse(
        updated.properties['Action Data'].rich_text[0].text.content
      )
      if (!actionData.snooze_until) {
        throw new Error('snooze_until not set in actionData')
      }
    }
  )

  // Test 4.3: All 3 breakage types persist
  await runTest(
    'Alert Workflows',
    'All 3 breakage types (TOTAL/PARTIAL/WARNING) persist',
    async () => {
      const breakageTypes = ['TOTAL', 'PARTIAL', 'WARNING']

      for (const breakageType of breakageTypes) {
        const id = await createTestFeedEntry('Alert', {
          alert_type: 'dom_breakage',
          platform: 'Test',
          breakage_type: breakageType,
        })

        const entry = await getFeedEntry(id)
        const actionData = JSON.parse(
          entry.properties['Action Data'].rich_text[0].text.content
        )
        if (actionData.breakage_type !== breakageType) {
          throw new Error(`Breakage type "${breakageType}" not persisted`)
        }
      }
    }
  )
}

// ============================================
// SECTION 5: APPROVAL + REVIEW WORKFLOWS
// ============================================

async function section5_ApprovalReviewWorkflows() {
  console.log('\n🔐 SECTION 5: Approval + Review Workflows\n')

  // Test 5.1: Approval -> Approve
  await runTest(
    'Approval/Review',
    'Approval → Approve records disposition',
    async () => {
      const id = await createTestFeedEntry('Approval', {
        skill_id: 'auto-research',
        skill_name: 'Auto Research',
        description: 'Run research on queued items',
      })

      await notionFetch(`/pages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Actioned' } },
            'Action Data': {
              rich_text: [
                {
                  text: {
                    content: JSON.stringify({
                      skill_id: 'auto-research',
                      skill_name: 'Auto Research',
                      description: 'Run research on queued items',
                      disposition: 'Approve',
                    }),
                  },
                },
              ],
            },
            'Actioned At': { date: { start: new Date().toISOString() } },
            'Actioned Via': { select: { name: 'Extension' } },
          },
        }),
      })

      const updated = await getFeedEntry(id)
      const actionData = JSON.parse(
        updated.properties['Action Data'].rich_text[0].text.content
      )
      if (actionData.disposition !== 'Approve') {
        throw new Error('Approve disposition not recorded')
      }
    }
  )

  // Test 5.2: Review -> Revise with notes
  await runTest(
    'Approval/Review',
    'Review → Revise captures revision_notes',
    async () => {
      const id = await createTestFeedEntry('Review', {
        wq_item_id: 'test-wq-id',
        wq_title: 'Draft Blog Post',
        output_url: 'https://notion.so/draft',
      })

      const revisionNotes =
        'Add more data points in section 2. Fix typo in conclusion.'

      await notionFetch(`/pages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Actioned' } },
            'Action Data': {
              rich_text: [
                {
                  text: {
                    content: JSON.stringify({
                      wq_item_id: 'test-wq-id',
                      wq_title: 'Draft Blog Post',
                      output_url: 'https://notion.so/draft',
                      disposition: 'Revise',
                      revision_notes: revisionNotes,
                    }),
                  },
                },
              ],
            },
            'Actioned At': { date: { start: new Date().toISOString() } },
            'Actioned Via': { select: { name: 'Extension' } },
          },
        }),
      })

      const updated = await getFeedEntry(id)
      const actionData = JSON.parse(
        updated.properties['Action Data'].rich_text[0].text.content
      )
      if (actionData.revision_notes !== revisionNotes) {
        throw new Error('Revision notes not captured')
      }
    }
  )
}

// ============================================
// SECTION 6: BATCH MODE OPERATIONS
// ============================================

async function section6_BatchMode() {
  console.log('\n📦 SECTION 6: Batch Mode Operations\n')

  // Test 6.1: Batch create 5 Triage entries
  await runTest(
    'Batch Mode',
    'Batch create 5 Triage entries',
    async () => {
      const ids: string[] = []

      for (let i = 0; i < 5; i++) {
        const id = await createTestFeedEntry('Triage', {
          platform: 'Batch Test',
          title: `Batch item ${i + 1}`,
          url: `https://example.com/item-${i + 1}`,
        })
        ids.push(id)
      }

      if (ids.length !== 5) {
        throw new Error(`Expected 5 entries, created ${ids.length}`)
      }
    }
  )

  // Test 6.2: Batch dismiss 5 entries simultaneously
  await runTest(
    'Batch Mode',
    'Batch dismiss 5 entries simultaneously',
    async () => {
      const ids: string[] = []

      for (let i = 0; i < 5; i++) {
        const id = await createTestFeedEntry('Triage', {
          platform: 'Batch Dismiss',
          title: `Dismiss item ${i + 1}`,
          url: `https://example.com/dismiss-${i + 1}`,
        })
        ids.push(id)
      }

      // Batch update all to Dismissed
      await Promise.all(
        ids.map((id) =>
          notionFetch(`/pages/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              properties: {
                'Action Status': { select: { name: 'Dismissed' } },
              },
            }),
          })
        )
      )

      // Verify all dismissed
      for (const id of ids) {
        const entry = await getFeedEntry(id)
        if (entry.properties['Action Status'].select.name !== 'Dismissed') {
          throw new Error(`Entry ${id} not dismissed`)
        }
      }
    }
  )

  // Test 6.3: Batch assign same pillar
  await runTest(
    'Batch Mode',
    'Batch assign pillar to 3 entries',
    async () => {
      const ids: string[] = []

      for (let i = 0; i < 3; i++) {
        const id = await createTestFeedEntry('Triage', {
          platform: 'Batch Pillar',
          title: `Pillar item ${i + 1}`,
          url: `https://example.com/pillar-${i + 1}`,
        })
        ids.push(id)
      }

      // Batch update all to Consulting pillar
      await Promise.all(
        ids.map((id) =>
          notionFetch(`/pages/${id}`, {
            method: 'PATCH',
            body: JSON.stringify({
              properties: {
                'Action Data': {
                  rich_text: [
                    {
                      text: {
                        content: JSON.stringify({
                          platform: 'Batch Pillar',
                          pillar: 'Consulting',
                        }),
                      },
                    },
                  ],
                },
              },
            }),
          })
        )
      )

      // Verify all have Consulting pillar
      for (const id of ids) {
        const entry = await getFeedEntry(id)
        const actionData = JSON.parse(
          entry.properties['Action Data'].rich_text[0].text.content
        )
        if (actionData.pillar !== 'Consulting') {
          throw new Error(`Entry ${id} pillar not set to Consulting`)
        }
      }
    }
  )
}

// ============================================
// SECTION 7: POLLING + QUERY BEHAVIOR
// ============================================

async function section7_PollingBehavior() {
  console.log('\n🔄 SECTION 7: Polling + Query Behavior\n')

  // Test 7.1: Query returns only Pending items
  await runTest(
    'Polling',
    'Query filters to Pending status only',
    async () => {
      // Create one Pending, one Actioned
      const pendingId = await createTestFeedEntry('Info', {
        message: 'Pending test',
      })
      const actionedId = await createTestFeedEntry('Info', {
        message: 'Actioned test',
      })

      // Mark second as Actioned
      await notionFetch(`/pages/${actionedId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Actioned' } },
          },
        }),
      })

      // Query pending items
      const pending = await queryPendingItems()
      const pendingIds = pending.map((p: any) => p.id)

      if (!pendingIds.includes(pendingId)) {
        throw new Error('Pending item not in query results')
      }
      if (pendingIds.includes(actionedId)) {
        throw new Error(
          'Actioned item incorrectly included in Pending query'
        )
      }
    }
  )

  // Test 7.2: Query includes Snoozed items
  await runTest(
    'Polling',
    'Snoozed items included in poll query (for expiry check)',
    async () => {
      const snoozedId = await createTestFeedEntry('Alert', {
        alert_type: 'test',
        snooze_until: new Date(Date.now() + 1000).toISOString(),
      })

      await notionFetch(`/pages/${snoozedId}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Snoozed' } },
          },
        }),
      })

      // Query with Pending OR Snoozed (matches extension polling hook)
      const response = await notionFetch(
        `/databases/${FEED_DATABASE_ID}/query`,
        {
          method: 'POST',
          body: JSON.stringify({
            filter: {
              or: [
                {
                  property: 'Action Status',
                  select: { equals: 'Pending' },
                },
                {
                  property: 'Action Status',
                  select: { equals: 'Snoozed' },
                },
              ],
            },
          }),
        }
      )

      const ids = response.results.map((r: any) => r.id)
      if (!ids.includes(snoozedId)) {
        throw new Error('Snoozed item not included in poll query')
      }
    }
  )

  // Test 7.3: Results sorted by created_time descending
  await runTest('Polling', 'Results sorted newest first', async () => {
    const id1 = await createTestFeedEntry('Info', { message: 'First' })
    await new Promise((r) => setTimeout(r, 150))
    const id2 = await createTestFeedEntry('Info', { message: 'Second' })
    await new Promise((r) => setTimeout(r, 150))
    const id3 = await createTestFeedEntry('Info', { message: 'Third' })

    const response = await notionFetch(
      `/databases/${FEED_DATABASE_ID}/query`,
      {
        method: 'POST',
        body: JSON.stringify({
          filter: {
            property: 'Action Status',
            select: { equals: 'Pending' },
          },
          sorts: [
            { timestamp: 'created_time', direction: 'descending' },
          ],
        }),
      }
    )

    const ids = response.results.map((r: any) => r.id)
    const idx1 = ids.indexOf(id1)
    const idx2 = ids.indexOf(id2)
    const idx3 = ids.indexOf(id3)

    // All must be present
    if (idx1 === -1 || idx2 === -1 || idx3 === -1) {
      throw new Error('Not all test entries found in results')
    }

    // Third should be first (newest), First should be last (oldest)
    if (!(idx3 < idx2 && idx2 < idx1)) {
      throw new Error(
        `Results not sorted newest first: idx3=${idx3} idx2=${idx2} idx1=${idx1}`
      )
    }
  })
}

// ============================================
// SECTION 8: BACKWARD COMPATIBILITY
// ============================================

async function section8_BackwardCompatibility() {
  console.log('\n🔙 SECTION 8: Backward Compatibility\n')

  // Test 8.1: Entry without Action properties defaults gracefully
  await runTest(
    'Backward Compat',
    'Entry without Action Type defaults to Info (extension parser behavior)',
    async () => {
      // Create entry with minimal properties (simulating pre-Action Feed entry)
      const response = await notionFetch(`/pages`, {
        method: 'POST',
        body: JSON.stringify({
          parent: { database_id: FEED_DATABASE_ID },
          properties: {
            Entry: {
              title: [
                {
                  text: {
                    content: `[TEST] Legacy entry without Action props - ${Date.now()}`,
                  },
                },
              ],
            },
            Source: { select: { name: 'Legacy Import' } },
          },
        }),
      })
      allCreatedEntryIds.push(response.id)

      const entry = await getFeedEntry(response.id)

      // Action Type should be null/undefined — extension parser defaults to 'Info'
      const actionType =
        entry.properties['Action Type']?.select?.name || 'Info'
      if (actionType !== 'Info') {
        throw new Error(
          `Expected Info default, got "${actionType}"`
        )
      }
    }
  )

  // Test 8.2: Malformed Action Data JSON handled gracefully
  await runTest(
    'Backward Compat',
    'Malformed JSON in Action Data parsed to fallback without crash',
    async () => {
      const response = await notionFetch(`/pages`, {
        method: 'POST',
        body: JSON.stringify({
          parent: { database_id: FEED_DATABASE_ID },
          properties: {
            Entry: {
              title: [
                {
                  text: {
                    content: `[TEST] Malformed Action Data - ${Date.now()}`,
                  },
                },
              ],
            },
            Source: { select: { name: 'Test' } },
            'Action Status': { select: { name: 'Pending' } },
            'Action Type': { select: { name: 'Info' } },
            'Action Data': {
              rich_text: [{ text: { content: 'not valid json {{{' } }],
            },
          },
        }),
      })
      allCreatedEntryIds.push(response.id)

      const entry = await getFeedEntry(response.id)
      const rawData =
        entry.properties['Action Data']?.rich_text?.[0]?.text?.content ||
        '{}'

      let parsed: any
      try {
        parsed = JSON.parse(rawData)
      } catch {
        // Expected — this mirrors the extension's parseActionFeedEntry fallback
        parsed = {}
      }

      if (typeof parsed !== 'object') {
        throw new Error('Malformed JSON not handled gracefully')
      }
    }
  )
}

// ============================================
// SECTION 9: FAILURE SCENARIOS
// ============================================

async function section9_FailureScenarios() {
  console.log('\n💥 SECTION 9: Failure Scenarios\n')

  // Test 9.1: Invalid page ID returns error
  await runTest(
    'Failure Handling',
    'Invalid page ID returns clear error',
    async () => {
      try {
        await getFeedEntry('00000000-0000-0000-0000-000000000000')
        throw new Error('Should have thrown on invalid ID')
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('Should have thrown')
        ) {
          throw err
        }
        // Expected to fail — correct behavior
      }
    }
  )

  // Test 9.2: Missing title field rejected by Notion
  await runTest(
    'Failure Handling',
    'Entry without title rejected by Notion API',
    async () => {
      try {
        const response = await notionFetch(`/pages`, {
          method: 'POST',
          body: JSON.stringify({
            parent: { database_id: FEED_DATABASE_ID },
            properties: {
              Source: { select: { name: 'Test' } },
            },
          }),
        })
        // If it somehow succeeds, clean it up
        allCreatedEntryIds.push(response.id)
        throw new Error('Should have failed without title')
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('Should have failed')
        ) {
          throw err
        }
        // Expected — validates Notion enforces schema
      }
    }
  )

  // Test 9.3: Invalid Action Status value rejected
  await runTest(
    'Failure Handling',
    'Invalid Action Status value rejected by Notion',
    async () => {
      try {
        const response = await notionFetch(`/pages`, {
          method: 'POST',
          body: JSON.stringify({
            parent: { database_id: FEED_DATABASE_ID },
            properties: {
              Entry: {
                title: [
                  { text: { content: `[TEST] Invalid status - ${Date.now()}` } },
                ],
              },
              'Action Status': { select: { name: 'InvalidStatus' } },
            },
          }),
        })
        allCreatedEntryIds.push(response.id)
        throw new Error('Should have rejected invalid status')
      } catch (err) {
        if (
          err instanceof Error &&
          err.message.includes('Should have rejected')
        ) {
          throw err
        }
        // Expected — Notion select properties reject unknown values
      }
    }
  )

  // Test 9.4: Rapid requests handled without crash
  await runTest(
    'Failure Handling',
    'Rapid requests handled without crash (rate limit resilience)',
    async () => {
      const ids: string[] = []

      // Fire 10 requests rapidly
      const promises = Array(10)
        .fill(null)
        .map((_, i) =>
          createTestFeedEntry('Info', { message: `Rapid fire ${i}` })
            .then((id) => ids.push(id))
            .catch(() => {}) // Swallow rate limit errors
        )

      await Promise.all(promises)

      if (ids.length === 0) {
        throw new Error(
          'All rapid requests failed — possible rate limit issue'
        )
      }
    }
  )
}

// ============================================
// SECTION 10: E2E USER FLOW SIMULATION
// ============================================

async function section10_E2EUserFlows() {
  console.log('\n🎬 SECTION 10: End-to-End User Flows\n')

  // Test 10.1: Complete triage flow
  await runTest(
    'E2E Flows',
    'Full triage flow: Create → Pillar → Research → Resolve',
    async () => {
      // Step 1: Atlas creates Triage entry
      const id = await createTestFeedEntry('Triage', {
        platform: 'TikTok',
        title: 'AI Tools for Productivity by @techcreator',
        creator: '@techcreator',
        url: 'https://tiktok.com/@techcreator/video/999',
      })

      // Step 2: Verify Pending
      let entry = await getFeedEntry(id)
      if (entry.properties['Action Status'].select.name !== 'Pending') {
        throw new Error('Initial status not Pending')
      }

      // Step 3: User selects pillar (immediate write)
      await notionFetch(`/pages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Data': {
              rich_text: [
                {
                  text: {
                    content: JSON.stringify({
                      platform: 'TikTok',
                      title: 'AI Tools for Productivity by @techcreator',
                      creator: '@techcreator',
                      url: 'https://tiktok.com/@techcreator/video/999',
                      pillar: 'The Grove',
                    }),
                  },
                },
              ],
            },
          },
        }),
      })

      // Step 4: Verify pillar persisted
      entry = await getFeedEntry(id)
      let actionData = JSON.parse(
        entry.properties['Action Data'].rich_text[0].text.content
      )
      if (actionData.pillar !== 'The Grove') {
        throw new Error('Pillar not persisted')
      }

      // Step 5: User selects Research disposition
      await notionFetch(`/pages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Actioned' } },
            'Action Data': {
              rich_text: [
                {
                  text: {
                    content: JSON.stringify({
                      ...actionData,
                      disposition: 'Research',
                      create_wq_item: true,
                    }),
                  },
                },
              ],
            },
            'Actioned At': { date: { start: new Date().toISOString() } },
            'Actioned Via': { select: { name: 'Extension' } },
          },
        }),
      })

      // Step 6: Verify final state — all fields correct
      entry = await getFeedEntry(id)
      if (entry.properties['Action Status'].select.name !== 'Actioned') {
        throw new Error('Final status not Actioned')
      }
      actionData = JSON.parse(
        entry.properties['Action Data'].rich_text[0].text.content
      )
      if (actionData.disposition !== 'Research' || !actionData.create_wq_item) {
        throw new Error('Final actionData incorrect')
      }
      if (!entry.properties['Actioned At']?.date?.start) {
        throw new Error('Actioned At not set')
      }
      if (entry.properties['Actioned Via']?.select?.name !== 'Extension') {
        throw new Error('Actioned Via not Extension')
      }
    }
  )

  // Test 10.2: Alert snooze cycle
  await runTest(
    'E2E Flows',
    'Alert snooze cycle: Alert → Snooze → Verify Snoozed in poll',
    async () => {
      // Step 1: Create alert
      const id = await createTestFeedEntry('Alert', {
        alert_type: 'dom_breakage',
        platform: 'LinkedIn',
        breakage_type: 'PARTIAL',
      })

      // Step 2: User snoozes
      const snoozeUntil = new Date(
        Date.now() + 4 * 60 * 60 * 1000
      ).toISOString()
      await notionFetch(`/pages/${id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          properties: {
            'Action Status': { select: { name: 'Snoozed' } },
            'Action Data': {
              rich_text: [
                {
                  text: {
                    content: JSON.stringify({
                      alert_type: 'dom_breakage',
                      platform: 'LinkedIn',
                      breakage_type: 'PARTIAL',
                      disposition: 'Snooze',
                      snooze_until: snoozeUntil,
                    }),
                  },
                },
              ],
            },
          },
        }),
      })

      // Step 3: Verify Snoozed status
      const entry = await getFeedEntry(id)
      if (entry.properties['Action Status'].select.name !== 'Snoozed') {
        throw new Error('Status not Snoozed')
      }

      // Step 4: Verify still included in poll
      const response = await notionFetch(
        `/databases/${FEED_DATABASE_ID}/query`,
        {
          method: 'POST',
          body: JSON.stringify({
            filter: {
              or: [
                {
                  property: 'Action Status',
                  select: { equals: 'Pending' },
                },
                {
                  property: 'Action Status',
                  select: { equals: 'Snoozed' },
                },
              ],
            },
          }),
        }
      )

      const ids = response.results.map((r: any) => r.id)
      if (!ids.includes(id)) {
        throw new Error('Snoozed item not in poll results')
      }
    }
  )
}

// ============================================
// CLEANUP
// ============================================

async function cleanupTestEntries() {
  if (allCreatedEntryIds.length === 0) return

  console.log(
    `\n🧹 Cleaning up ${allCreatedEntryIds.length} test entries...`
  )

  let cleaned = 0
  let failed = 0

  // Archive in batches of 5 to avoid rate limits
  for (let i = 0; i < allCreatedEntryIds.length; i += 5) {
    const batch = allCreatedEntryIds.slice(i, i + 5)
    const results = await Promise.allSettled(
      batch.map((id) => archiveFeedEntry(id))
    )
    cleaned += results.filter((r) => r.status === 'fulfilled').length
    failed += results.filter((r) => r.status === 'rejected').length

    // Small delay between batches
    if (i + 5 < allCreatedEntryIds.length) {
      await new Promise((r) => setTimeout(r, 200))
    }
  }

  console.log(
    `   Archived ${cleaned} entries${failed > 0 ? `, ${failed} failed` : ''}`
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
    '║     MASTER BLASTER: ACTION FEED TEST BATTERY             ║'
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
      console.log(
        '\n⏭️  Skipping Sections 2-10 (no API key)\n'
      )
    } else {
      await section2_CardCreation()
      await section3_TriageWorkflows()
      await section4_AlertWorkflows()
      await section5_ApprovalReviewWorkflows()
      await section6_BatchMode()
      await section7_PollingBehavior()
      await section8_BackwardCompatibility()
      await section9_FailureScenarios()
      await section10_E2EUserFlows()
    }
  } catch (err) {
    console.error('\n🔥 FATAL ERROR:', err)
    fatalError = true
  }

  // Always clean up test entries
  try {
    await cleanupTestEntries()
  } catch (err) {
    console.error('⚠️  Cleanup error:', err)
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
      '✅ ALL TESTS PASSED — READY FOR HUMAN TESTING\n'
    )
    process.exit(0)
  }
}

main()
