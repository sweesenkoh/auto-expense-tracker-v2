import 'dotenv/config';
import { openDb, getMeta, setMeta } from './db.js';
import { withGmailImap, fetchMessagesSince } from './gmail.js';
import { parseEmailToCandidate } from './parser.js';
import { sha256, normalizeText, nowIso } from './util.js';

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function getSince(db) {
  if (process.env.INGEST_SINCE) return process.env.INGEST_SINCE;
  return getMeta(db, 'last_ingest_raw_at');
}

function upsertRawEmail(db, row) {
  const stmt = db.prepare(`
    insert into raw_emails(message_id, gmail_uid, received_at, subject, from_addr, body_hash, raw_text, processed_at, status, error)
    values(@messageId, @gmailUid, @receivedAt, @subject, @fromAddr, @bodyHash, @rawText, @processedAt, @status, @error)
    on conflict(message_id) do update set
      received_at=excluded.received_at,
      subject=excluded.subject,
      from_addr=excluded.from_addr,
      body_hash=excluded.body_hash,
      raw_text=excluded.raw_text,
      processed_at=excluded.processed_at,
      status=excluded.status,
      error=excluded.error
  `);
  const info = stmt.run(row);
  const id = row.messageId
    ? db.prepare('select id from raw_emails where message_id = ?').get(row.messageId)?.id
    : null;
  return id || info.lastInsertRowid;
}

async function main() {
  const dbPath = process.env.DB_PATH || './data/expenses.sqlite';
  mustEnv('GMAIL_USER');
  mustEnv('GMAIL_APP_PASSWORD');

  const db = openDb(dbPath);
  const since = getSince(db);

  console.log(JSON.stringify({ ok: true, event: 'ingest_raw_start', since: since || null, dbPath }));

  let ingested = 0;
  let skippedDup = 0;

  await withGmailImap(process.env, async (client) => {
    const msgs = await fetchMessagesSince(client, { since });

    for (const msg of msgs) {
      const messageId = msg.envelope?.messageId || null;
      const receivedAt = (msg.internalDate ? new Date(msg.internalDate) : new Date()).toISOString();
      const subject = msg.envelope?.subject || '';
      const fromAddr = msg.envelope?.from?.[0]?.address || '';

      // Reuse existing parsing step *only* to reliably extract body text.
      // We do NOT use the candidate output for categorisation in raw-only mode.
      const parsed = await parseEmailToCandidate(msg.source);
      const normalizedBody = normalizeText(parsed.body);
      const bodyHash = sha256(normalizedBody);

      if (messageId) {
        const existing = db.prepare('select id from raw_emails where message_id = ?').get(messageId);
        if (existing) {
          skippedDup += 1;
          continue;
        }
      } else {
        const existing = db.prepare('select id from raw_emails where body_hash = ? and received_at >= datetime(?, "-2 days")')
          .get(bodyHash, receivedAt);
        if (existing) {
          skippedDup += 1;
          continue;
        }
      }

      upsertRawEmail(db, {
        messageId,
        gmailUid: msg.uid ? String(msg.uid) : null,
        receivedAt,
        subject,
        fromAddr,
        bodyHash,
        rawText: normalizedBody,
        processedAt: nowIso(),
        status: 'stored',
        error: null,
      });

      ingested += 1;
    }
  });

  setMeta(db, 'last_ingest_raw_at', nowIso());

  console.log(JSON.stringify({
    ok: true,
    event: 'ingest_raw_done',
    ingested,
    skippedDup,
  }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, event: 'ingest_raw_error', error: String(err?.stack || err) }));
  process.exit(1);
});
