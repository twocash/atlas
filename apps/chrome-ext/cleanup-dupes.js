/**
 * Notion Contacts Deduplication Script
 *
 * Finds duplicate contacts by LinkedIn URL and archives older duplicates.
 * Run with: node cleanup-dupes.js
 */

const NOTION_KEY = process.env.NOTION_API_KEY || '';
const CONTACTS_DB = '08b9f73264b24e4b82d4c842f5a11cc8';

const NOTION_HEADERS = {
  'Authorization': `Bearer ${NOTION_KEY}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28'
};

async function queryAllContacts() {
  console.log('Fetching all contacts...');
  const contacts = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const resp = await fetch(`https://api.notion.com/v1/databases/${CONTACTS_DB}/query`, {
      method: 'POST',
      headers: NOTION_HEADERS,
      body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
    });

    if (!resp.ok) {
      throw new Error(`Failed to query: ${resp.status}`);
    }

    const data = await resp.json();
    contacts.push(...data.results);
    hasMore = data.has_more;
    cursor = data.next_cursor;
    console.log(`  Fetched ${contacts.length} contacts...`);
  }

  return contacts;
}

async function archivePage(pageId) {
  const resp = await fetch(`https://api.notion.com/v1/pages/${pageId}`, {
    method: 'PATCH',
    headers: NOTION_HEADERS,
    body: JSON.stringify({ archived: true }),
  });
  return resp.ok;
}

async function findAndCleanDuplicates() {
  if (!NOTION_KEY) {
    console.error('ERROR: Set NOTION_API_KEY environment variable');
    process.exit(1);
  }

  const contacts = await queryAllContacts();
  console.log(`Total contacts: ${contacts.length}`);

  // Group by LinkedIn URL (memberIds change between scrapes!)
  const withoutPB = [];
  const byUrl = new Map();

  for (const contact of contacts) {
    const notes = contact.properties?.Notes?.rich_text?.[0]?.plain_text || '';
    const hasPB = notes.includes('PB:');
    const linkedInUrl = contact.properties?.['LinkedIn URL']?.url;

    if (!hasPB) {
      withoutPB.push(contact);
      continue;
    }

    if (!linkedInUrl) {
      console.log(`  PB contact without URL: ${contact.properties?.Name?.title?.[0]?.plain_text}`);
      continue;
    }

    // Normalize URL - strip www, trailing slash, lowercase
    const normalized = linkedInUrl
      .toLowerCase()
      .replace('https://www.linkedin.com', 'https://linkedin.com')
      .replace(/\/$/, '');

    if (!byUrl.has(normalized)) {
      byUrl.set(normalized, []);
    }
    byUrl.get(normalized).push(contact);
  }

  console.log(`\n${withoutPB.length} contacts without PB IDs (manual/cruft)`);
  console.log(`${contacts.length - withoutPB.length} contacts with PB IDs`);

  // Find URL-based duplicates
  const duplicateGroups = Array.from(byUrl.values()).filter((group) => group.length > 1);
  console.log(`\nFound ${duplicateGroups.length} sets of URL duplicates`);

  // Show preview
  if (duplicateGroups.length > 0) {
    console.log('\nURL Duplicate preview:');
    for (const group of duplicateGroups.slice(0, 10)) {
      const name = group[0].properties?.Name?.title?.[0]?.plain_text || 'Unknown';
      const hasAbout = group.some((c) => c.properties?.['About']?.rich_text?.length > 0);
      console.log(`  ${name}: ${group.length} copies ${hasAbout ? '(has enriched)' : ''}`);
    }
  }

  if (withoutPB.length > 0) {
    console.log('\nContacts without PB IDs (cruft):');
    for (const contact of withoutPB.slice(0, 10)) {
      const name = contact.properties?.Name?.title?.[0]?.plain_text || 'Unknown';
      console.log(`  ${name}`);
    }
    if (withoutPB.length > 10) {
      console.log(`  ... and ${withoutPB.length - 10} more`);
    }
  }

  const totalToArchive = duplicateGroups.reduce((sum, g) => sum + g.length - 1, 0) + withoutPB.length;

  if (totalToArchive === 0) {
    console.log('\nNothing to archive!');
    return;
  }

  console.log(`\nTotal to archive: ${totalToArchive} contacts`);
  console.log(`  - ${duplicateGroups.reduce((sum, g) => sum + g.length - 1, 0)} memberId duplicates`);
  console.log(`  - ${withoutPB.length} without PB IDs`);

  console.log('\nProceeding with cleanup...');

  // Clean URL duplicates - keep the record with the MOST DATA (fullest profile)
  let archived = 0;
  for (const group of duplicateGroups) {
    // Score each record by how many fields are populated
    const scored = group.map((contact) => {
      const props = contact.properties || {};
      let score = 0;

      // Count populated fields (enriched data)
      if (props['About']?.rich_text?.length > 0) score += 10; // Bio is very valuable
      if (props['Skills']?.rich_text?.length > 0) score += 5;
      if (props['Current Job Title']?.rich_text?.length > 0) score += 3;
      if (props['Industry']?.rich_text?.length > 0) score += 2;
      if (props['Location']?.rich_text?.length > 0) score += 2;
      if (props['Follower Count']?.number) score += 1;
      if (props['Company']?.rich_text?.length > 0) score += 1;

      // Tiebreaker: newest
      score += new Date(contact.created_time).getTime() / 1e15;

      return { contact, score };
    });

    // Sort by score descending (richest data first)
    scored.sort((a, b) => b.score - a.score);

    const keep = scored[0].contact;
    const toArchive = scored.slice(1).map((s) => s.contact);

    const name = keep.properties?.Name?.title?.[0]?.plain_text || 'Unknown';
    const notes = keep.properties?.Notes?.rich_text?.[0]?.plain_text || '';
    const hasAbout = keep.properties?.['About']?.rich_text?.length > 0;
    console.log(`\n${name} (${notes}): keeping ${hasAbout ? 'enriched' : 'basic'}, archiving ${toArchive.length}`);

    for (const dupe of toArchive) {
      try {
        await archivePage(dupe.id);
        archived++;
        console.log(`  ✓ Archived ${dupe.id}`);
        await new Promise((r) => setTimeout(r, 350));
      } catch (e) {
        console.log(`  ✗ Failed: ${e.message}`);
      }
    }
  }

  // Archive contacts without PB IDs (cruft)
  console.log(`\nArchiving ${withoutPB.length} contacts without PB IDs...`);
  for (const contact of withoutPB) {
    try {
      await archivePage(contact.id);
      archived++;
      const name = contact.properties?.Name?.title?.[0]?.plain_text || 'Unknown';
      console.log(`  ✓ Archived ${name}`);
      await new Promise((r) => setTimeout(r, 350));
    } catch (e) {
      console.log(`  ✗ Failed: ${e.message}`);
    }
  }

  console.log(`\n✓ Done! Archived ${archived} total contacts.`);
}

findAndCleanDuplicates().catch(console.error);
