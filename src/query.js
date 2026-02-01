import 'dotenv/config';
import { openDb } from './db.js';

function usage() {
  console.log('Usage:');
  console.log('  node src/query.js spend --days 7');
  console.log('  node src/query.js by-category --days 7');
  process.exit(1);
}

function getArg(name, def = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  return process.argv[idx + 1] ?? def;
}

function daysBackRange(days) {
  const d = Number(days);
  if (!Number.isFinite(d) || d <= 0) throw new Error('Invalid days');
  const end = new Date();
  const start = new Date(Date.now() - d * 24 * 60 * 60 * 1000);
  return { start: start.toISOString(), end: end.toISOString() };
}

const cmd = process.argv[2];
if (!cmd) usage();

const dbPath = process.env.DB_PATH || './data/expenses.sqlite';
const db = openDb(dbPath);

const days = getArg('--days', '7');
const { start, end } = daysBackRange(days);

if (cmd === 'spend') {
  const row = db.prepare(`
    select coalesce(sum(amount_sgd), 0) as total
    from transactions
    where txn_type = 'expense'
      and posted_at >= ? and posted_at <= ?
  `).get(start, end);

  console.log(JSON.stringify({
    currency: 'SGD',
    days: Number(days),
    total: Number(row.total || 0),
  }));
  process.exit(0);
}

if (cmd === 'by-category') {
  const rows = db.prepare(`
    select category, coalesce(sum(amount_sgd), 0) as total
    from transactions
    where txn_type = 'expense'
      and posted_at >= ? and posted_at <= ?
    group by category
    order by total desc
  `).all(start, end);

  console.log(JSON.stringify({
    currency: 'SGD',
    days: Number(days),
    categories: rows.map(r => ({ category: r.category || 'Uncategorized', total: Number(r.total || 0) })),
  }));
  process.exit(0);
}

usage();
