/**
 * Playwright DOM inspector — loads the extension in Chrome,
 * navigates to a LinkedIn post, and dumps comment container structure
 * so we can fix stale selectors.
 *
 * Usage: node test-selectors.mjs <linkedin-post-url>
 *
 * You'll need to log in to LinkedIn the first time (browser profile is persisted).
 */
import { chromium } from 'playwright'
import { resolve, dirname } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const extensionPath = resolve(__dirname, 'dist')
const userDataDir = resolve(__dirname, '.test-profile')
const postUrl = process.argv[2] || 'https://www.linkedin.com/feed/update/urn:li:ugcPost:7425904212586422272/'

console.log('Extension path:', extensionPath)
console.log('Post URL:', postUrl)
console.log()

// Launch Chrome with extension loaded + persistent profile for LinkedIn login
const context = await chromium.launchPersistentContext(userDataDir, {
  headless: false,
  args: [
    `--disable-extensions-except=${extensionPath}`,
    `--load-extension=${extensionPath}`,
    '--no-first-run',
    '--disable-blink-features=AutomationControlled',
  ],
  viewport: { width: 1400, height: 900 },
  ignoreHTTPSErrors: true,
})

const page = context.pages()[0] || await context.newPage()

// Navigate to LinkedIn
console.log('Navigating to LinkedIn post...')
await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })

// Wait for page to settle
console.log('Waiting for page to load (10s)...')
await page.waitForTimeout(10000)

// Check if we need to log in
const isLoggedIn = await page.evaluate(() => {
  return !window.location.href.includes('/login') && !window.location.href.includes('/authwall')
})

if (!isLoggedIn) {
  console.log('\n⚠️  NOT LOGGED IN — Please log in manually in the browser window.')
  console.log('   After logging in and navigating to the post, press Enter here to continue...\n')
  await new Promise(r => process.stdin.once('data', r))
  // After login, navigate to the post again
  await page.goto(postUrl, { waitUntil: 'domcontentloaded', timeout: 30000 })
  await page.waitForTimeout(10000)
}

console.log('Current URL:', page.url())
console.log()

// Check console for content script log
const consoleLogs = []
page.on('console', msg => {
  if (msg.text().includes('Atlas')) consoleLogs.push(msg.text())
})

// Scroll down to trigger lazy-loaded comments
console.log('Scrolling to trigger comment loading...')
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(2000)

// Look for a "comments" button and click it
const commentBtn = await page.evaluate(() => {
  // LinkedIn uses various patterns for the comment count/button
  const candidates = [
    ...document.querySelectorAll('button[aria-label*="comment" i]'),
    ...document.querySelectorAll('button[aria-label*="Comment" i]'),
    ...document.querySelectorAll('span.social-details-social-counts__comments-count'),
    ...document.querySelectorAll('button.comment-button'),
    ...document.querySelectorAll('button.social-actions-button[aria-label*="comment" i]'),
    // Generic: buttons whose text contains "comment"
    ...Array.from(document.querySelectorAll('button')).filter(b =>
      /\bcomment/i.test(b.textContent || '') && b.textContent.trim().length < 50
    ),
  ]
  if (candidates.length > 0) {
    const btn = candidates[0]
    return {
      found: true,
      text: btn.textContent?.trim().slice(0, 80),
      tag: btn.tagName,
      ariaLabel: btn.getAttribute('aria-label'),
      classes: btn.className?.toString().slice(0, 150),
    }
  }
  return { found: false }
})
console.log('Comment button search:', JSON.stringify(commentBtn))

if (commentBtn.found) {
  console.log('Clicking comment button...')
  const btn = await page.$('button[aria-label*="comment" i], button[aria-label*="Comment" i]')
    || await page.$('button.comment-button')
    || await page.$('span.social-details-social-counts__comments-count')
  if (btn) {
    await btn.click()
    console.log('Waiting for comments to load (5s)...')
    await page.waitForTimeout(5000)
  }
}

// Scroll again to make sure everything is visible
await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight))
await page.waitForTimeout(2000)

// Print Atlas console logs from content script
console.log('Content script console logs:', consoleLogs.length ? consoleLogs : ['(none)'])
console.log()

// ── DUMP DOM STRUCTURE ──────────────────────────────────

console.log('\n═══ DOM ANALYSIS ═══\n')

const analysis = await page.evaluate(() => {
  const result = {
    url: window.location.href,
    commentContainers: [],
    candidateSelectors: {},
    rawFirstContainer: null,
  }

  // ── Try known container selectors ──
  const containerSelectors = [
    'article.comments-comment-entity',
    '.comments-comment-item',
    '.comments-comment-entity',
    // New potential selectors
    '[data-urn*="comment"]',
    '.comments-comment-list__comment-item',
    '.comments-comment-entity-list__entity',
    'article[data-id]',
    '.feed-shared-update-v2__comments-container article',
    // Very broad
    '.comments-comments-list > *',
    '.comments-comments-list li',
    '.comments-comments-list article',
  ]

  for (const sel of containerSelectors) {
    try {
      const els = document.querySelectorAll(sel)
      if (els.length > 0) {
        result.candidateSelectors[sel] = {
          count: els.length,
          firstTag: els[0].tagName,
          firstClasses: els[0].className?.toString().slice(0, 200),
        }
      }
    } catch { /* skip */ }
  }

  // ── Also try XPath heuristic ──
  try {
    const xp = document.evaluate(
      "//div[.//a[contains(@href,'/in/')] and .//span[contains(@class,'time')]]",
      document, null, XPathResult.ORDERED_NODE_SNAPSHOT_TYPE, null
    )
    result.candidateSelectors['XPATH: div with /in/ link + time span'] = { count: xp.snapshotLength }
  } catch { /* skip */ }

  // ── Find the comments section ──
  const commentsList = document.querySelector('.comments-comments-list')
    || document.querySelector('[data-finite-scroll-hotkey-context="COMMENTS"]')
    || document.querySelector('section[class*="comments"]')

  if (commentsList) {
    result.commentContainers.push({
      tag: commentsList.tagName,
      classes: commentsList.className?.toString().slice(0, 300),
      childCount: commentsList.children.length,
      childTags: Array.from(commentsList.children).slice(0, 10).map(c => ({
        tag: c.tagName,
        classes: c.className?.toString().slice(0, 200),
        hasProfileLink: !!c.querySelector('a[href*="/in/"]'),
        textPreview: c.textContent?.trim().slice(0, 100),
      })),
    })

    // Dump the first direct child that has a profile link (likely a comment)
    const firstComment = Array.from(commentsList.querySelectorAll('*')).find(el => {
      return el.querySelector('a[href*="/in/"]') && el.textContent && el.textContent.trim().length > 20
    })

    if (!firstComment) {
      // Try children directly
      for (const child of commentsList.children) {
        if (child.querySelector('a[href*="/in/"]')) {
          result.rawFirstContainer = child.outerHTML.slice(0, 5000)
          break
        }
      }
    } else {
      // Walk up to find the comment boundary
      let container = firstComment
      while (container.parentElement && container.parentElement !== commentsList) {
        container = container.parentElement
      }
      result.rawFirstContainer = container.outerHTML.slice(0, 5000)
    }
  } else {
    // No comments section found — dump what we can see
    result.commentContainers.push({ error: 'No comments section found' })

    // Check if any profile links exist on page
    const profileLinks = document.querySelectorAll('a[href*="/in/"]')
    result.candidateSelectors['All a[href*="/in/"] on page'] = { count: profileLinks.length }

    // Check for any article elements
    const articles = document.querySelectorAll('article')
    result.candidateSelectors['All article elements'] = { count: articles.length }
  }

  return result
})

console.log('URL:', analysis.url)
console.log()

console.log('── Candidate Container Selectors ──')
for (const [sel, info] of Object.entries(analysis.candidateSelectors)) {
  console.log(`  ${sel}: ${JSON.stringify(info)}`)
}
console.log()

console.log('── Comments Section ──')
for (const cs of analysis.commentContainers) {
  console.log(JSON.stringify(cs, null, 2))
}
console.log()

if (analysis.rawFirstContainer) {
  console.log('── First Comment Container HTML (up to 5000 chars) ──')
  console.log(analysis.rawFirstContainer)
  console.log()

  // ── Try to extract sub-selectors from the first container ──
  const subAnalysis = await page.evaluate((html) => {
    const div = document.createElement('div')
    div.innerHTML = html
    const container = div.firstElementChild

    if (!container) return { error: 'Could not parse container HTML' }

    const result = {}

    // Profile links
    const profileLinks = container.querySelectorAll('a[href*="/in/"]')
    result['Profile links'] = Array.from(profileLinks).map(a => ({
      href: a.getAttribute('href'),
      text: a.textContent?.trim().slice(0, 80),
      classes: a.className?.toString().slice(0, 150),
      parentClasses: a.parentElement?.className?.toString().slice(0, 150),
    }))

    // Name candidates
    const nameSelectors = [
      '.comments-post-meta__name-text',
      '.comments-post-meta__name-text a span[aria-hidden="true"]',
      'a[href*="/in/"] span[aria-hidden="true"]',
      'a[href*="/in/"] span',
      // new
      '.comment-item-meta__name',
      '[data-control-name="comment_profile_link"]',
      '.comments-comment-meta__description-title',
    ]
    result['Name selectors'] = {}
    for (const sel of nameSelectors) {
      const el = container.querySelector(sel)
      if (el) result['Name selectors'][sel] = el.textContent?.trim().slice(0, 80)
    }

    // Text content candidates
    const textSelectors = [
      '.comments-comment-item__main-content',
      '.comments-comment-item__main-content .update-components-text',
      '.update-components-text',
      'span.break-words',
      'span[dir="ltr"]',
      // new
      '.comments-comment-texteditor__content',
      '.comment-item__body',
      '.feed-shared-inline-show-more-text',
    ]
    result['Text selectors'] = {}
    for (const sel of textSelectors) {
      const el = container.querySelector(sel)
      if (el) result['Text selectors'][sel] = el.textContent?.trim().slice(0, 120)
    }

    // Headline candidates
    const headlineSelectors = [
      '.comments-post-meta__headline',
      '.t-12.t-black--light',
      '[class*="headline"]',
      // new
      '.comment-item-meta__headline',
      '.comments-comment-meta__description-subtitle',
    ]
    result['Headline selectors'] = {}
    for (const sel of headlineSelectors) {
      const el = container.querySelector(sel)
      if (el) result['Headline selectors'][sel] = el.textContent?.trim().slice(0, 120)
    }

    // Timestamp candidates
    const timeSelectors = [
      'time',
      'time.comments-comment-item__timestamp',
      '[class*="timestamp"]',
      'span[class*="time"]',
      // new
      '.comment-item-meta__creation-time',
    ]
    result['Timestamp selectors'] = {}
    for (const sel of timeSelectors) {
      const el = container.querySelector(sel)
      if (el) result['Timestamp selectors'][sel] = {
        text: el.textContent?.trim().slice(0, 50),
        datetime: el.getAttribute('datetime'),
      }
    }

    return result
  }, analysis.rawFirstContainer)

  console.log('── Sub-selector Analysis ──')
  console.log(JSON.stringify(subAnalysis, null, 2))
}

// ── TEST EXTRACTION WITH NEW SELECTORS ──────────────────

console.log('\n── Extraction Test (new selectors) ──')
const extraction = await page.evaluate(() => {
  const results = []

  // New selectors from updated registry
  const containers = document.querySelectorAll('article.comments-comment-entity')

  for (const container of containers) {
    const name = container.querySelector('.comments-comment-meta__description-title')?.textContent?.trim()
      || container.querySelector('a[href*="/in/"]')?.textContent?.trim()

    const profileUrl = container.querySelector('a.comments-comment-meta__description-container[href*="/in/"]')?.getAttribute('href')
      || container.querySelector('a[href*="/in/"]')?.getAttribute('href')

    const headline = container.querySelector('.comments-comment-meta__description-subtitle')?.textContent?.trim()

    const content = container.querySelector('.comments-comment-entity__content .feed-shared-inline-show-more-text')?.textContent?.trim()
      || container.querySelector('.comments-comment-entity__content span.break-words')?.textContent?.trim()

    const timestamp = container.querySelector('time.comments-comment-meta__data')?.textContent?.trim()

    results.push({ name, profileUrl, headline: headline?.slice(0, 80), content: content?.slice(0, 120), timestamp })
  }

  return { containerCount: containers.length, comments: results }
})

console.log(`Found ${extraction.containerCount} containers, extracted ${extraction.comments.length} comments:`)
for (const c of extraction.comments) {
  console.log(`  - ${c.name} (${c.timestamp}) [${c.profileUrl}]`)
  console.log(`    "${c.content}"`)
  console.log(`    ${c.headline}`)
}

console.log('\n═══ DONE ═══')
await context.close()
