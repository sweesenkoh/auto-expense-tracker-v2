import 'dotenv/config';
import { openDb } from './db.js';

function usage() {
  console.log('Usage:');
  console.log('  node src/propose.js --limit 50');
  process.exit(1);
}

function getArg(name, def = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  return process.argv[idx + 1] ?? def;
}

const limit = Number(getArg('--limit', '50'));
if (!Number.isFinite(limit) || limit <= 0) usage();

const dbPath = process.env.DB_PATH || './data/expenses.sqlite';
const db = openDb(dbPath);

// Only emails we have stored but not yet proposed in any pending batch.
const rows = db.prepare(`
  select re.id, re.received_at, re.subject, re.from_addr, re.raw_text
  from raw_emails re
  left join proposed_transactions pt on pt.raw_email_id = re.id
  left join batches b on b.id = pt.batch_id
  where re.status = 'stored'
    and (pt.id is null or b.status != 'pending')
  order by re.received_at asc
  limit ?
`).all(limit);

console.log(JSON.stringify({
  ok: true,
  event: 'propose_input',
  count: rows.length,
  emails: rows.map(r => ({
    rawEmailId: r.id,
    receivedAt: r.received_at,
    subject: r.subject,
    from: r.from_addr,
    rawText: r.raw_text,
  }))
}));
