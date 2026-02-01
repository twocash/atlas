const fs = require('fs');
const path = require('path');
const d = JSON.parse(fs.readFileSync(path.join(__dirname, 'devpipeline.json'), 'utf8'));

console.log('='.repeat(100));
console.log('ATLAS DEV PIPELINE - REVIEW');
console.log('='.repeat(100));
console.log('');

d.results.forEach((r, i) => {
  const props = r.properties || {};
  const title = props.Discussion?.title?.[0]?.plain_text || 'Untitled';
  const status = props.Status?.select?.name || 'None';
  const priority = props.Priority?.select?.name || '-';
  const typ = props.Type?.select?.name || '-';
  const resolution = (props.Resolution?.rich_text?.[0]?.plain_text || '').substring(0, 80);
  const thread = (props.Thread?.rich_text?.[0]?.plain_text || '').substring(0, 120);

  console.log(`[${i+1}] ${status.padEnd(12)} | ${priority.padEnd(3)} | ${typ.padEnd(8)} | ${title.substring(0,65)}`);
  console.log(`    ID: ${r.id}`);
  if (resolution) console.log(`    Resolution: ${resolution}`);
  if (thread && !resolution) console.log(`    Thread: ${thread}...`);
  console.log('');
});

console.log(`Total: ${d.results.length} items`);
