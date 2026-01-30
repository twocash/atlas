/**
 * Find duplicate contacts and show their memberIds
 */

const NOTION_KEY = process.env.NOTION_API_KEY || '';
const CONTACTS_DB = '08b9f73264b24e4b82d4c842f5a11cc8';

const NOTION_HEADERS = {
  'Authorization': `Bearer ${NOTION_KEY}`,
  'Content-Type': 'application/json',
  'Notion-Version': '2022-06-28'
};

async function queryAllContacts() {
  const contacts = [];
  let hasMore = true;
  let cursor = undefined;

  while (hasMore) {
    const resp = await fetch(`https://api.notion.com/v1/databases/${CONTACTS_DB}/query`, {
      method: 'POST',
      headers: NOTION_HEADERS,
      body: JSON.stringify(cursor ? { start_cursor: cursor } : {}),
    });

    const data = await resp.json();
    contacts.push(...data.results);
    hasMore = data.has_more;
    cursor = data.next_cursor;
  }

  return contacts;
}

async function findDuplicates() {
  const contacts = await queryAllContacts();
  console.log(`Total: ${contacts.length} contacts\n`);

  // Group by name
  const byName = new Map();
  for (const contact of contacts) {
    const name = contact.properties?.Name?.title?.[0]?.plain_text || 'Unknown';
    if (!byName.has(name)) {
      byName.set(name, []);
    }
    byName.get(name).push(contact);
  }

  const dupes = Array.from(byName.values()).filter((g) => g.length > 1);
  console.log(`Found ${dupes.length} duplicate names\n`);

  for (const group of dupes.slice(0, 20)) {
    const name = group[0].properties?.Name?.title?.[0]?.plain_text;
    console.log(`${name}: ${group.length} copies`);
    for (const contact of group) {
      const notes = contact.properties?.Notes?.rich_text?.[0]?.plain_text || 'NO NOTES';
      const url = contact.properties?.['LinkedIn URL']?.url || 'NO URL';
      const created = contact.created_time.slice(0, 19);
      console.log(`  - ${notes} | ${url} (${created})`);
    }
    console.log('');
  }
}

findDuplicates().catch(console.error);
