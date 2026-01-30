/**
 * Mark all "Needs Reply" engagements as "Posted"
 * Run with: node mark-all-replied.js
 */

const NOTION_KEY = process.env.NOTION_API_KEY || '';
const ENGAGEMENTS_DB = '25e138b54d1645a3a78b266451585de9';

const NOTION_HEADERS = {
  'Authorization': `Bearer ${NOTION_KEY}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28'
};

async function queryNeedsReply() {
  console.log('Fetching engagements needing reply...');
  const engagements = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const resp = await fetch(`https://api.notion.com/v1/databases/${ENGAGEMENTS_DB}/query`, {
      method: 'POST',
      headers: NOTION_HEADERS,
      body: JSON.stringify({
        filter: {
          property: 'Response Status',
          select: { equals: 'Needs Reply' }
        },
        ...(cursor ? { start_cursor: cursor } : {}),
      }),
    });

    if (!resp.ok) {
      throw new Error(`Failed to query: ${resp.status}`);
    }

    const data = await resp.json();
    engagements.push(...data.results);
    hasMore = data.has_more;
    cursor = data.next_cursor;
    console.log(`  Fetched ${engagements.length} engagements...`);
  }

  return engagements;
}

async function updateEngagement(pageId, note) {
  const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: NOTION_HEADERS,
    body: JSON.stringify({
      properties: {
        'Response Status': { select: { name: 'Posted' } },
        'Our Response Final': { rich_text: [{ text: { content: note } }] },
      }
    }),
  });
  return resp.ok;
}

async function markAllReplied() {
  if (!NOTION_KEY) {
    console.error('ERROR: Set NOTION_API_KEY environment variable');
    process.exit(1);
  }

  const engagements = await queryNeedsReply();
  console.log(`\nFound ${engagements.length} engagements needing reply`);

  if (engagements.length === 0) {
    console.log('Nothing to update!');
    return;
  }

  // Show preview
  console.log('\nPreview:');
  for (const eng of engagements.slice(0, 5)) {
    const title = eng.properties?.Engagement?.title?.[0]?.plain_text || 'Unknown';
    console.log(`  ${title}`);
  }
  if (engagements.length > 5) {
    console.log(`  ... and ${engagements.length - 5} more`);
  }

  console.log(`\nMarking all ${engagements.length} as Posted...\n`);

  let updated = 0;
  for (const eng of engagements) {
    const title = eng.properties?.Engagement?.title?.[0]?.plain_text || 'Unknown';
    try {
      await updateEngagement(eng.id, '(Replied manually - clearing backlog)');
      updated++;
      console.log(`  ✓ ${title}`);
      await new Promise((r) => setTimeout(r, 350)); // Rate limit
    } catch (e) {
      console.log(`  ✗ Failed: ${title} - ${e.message}`);
    }
  }

  console.log(`\n✓ Done! Marked ${updated} engagements as Posted.`);
}

markAllReplied().catch(console.error);
