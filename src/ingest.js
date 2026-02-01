import 'dotenv/config';
import { openDb, getMeta, setMeta } from './db.js';
import { withGmailImap, fetchMessagesSince } from './gmail.js';
import { parseEmailToCandidate } from './parser.js';
import { sha256, normalizeText, nowIso } from './util.js';
import { fetchAndCacheFxRate } from './fx.js';

function mustEnv(name) {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function getSince() {
  // Priority: INGEST_SINCE env → meta.last_ingest_at → start of today in timezone (best-effort)
  if (process.env.INGEST_SINCE) return process.env.INGEST_SINCE;
  return null;
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

  // If conflict update happened, lastInsertRowid may not be correct. Fetch id.
  const id = db.prepare('select id from raw_emails where message_id = ?').get(row.messageId)?.id;
  return id || info.lastInsertRowid;
}

function insertTransaction(db, tx) {
  const stmt = db.prepare(`
    insert into transactions(
      txn_type, posted_at, amount_original, currency_original,
      amount_sgd, fx_rate_to_sgd, fx_provider,
      merchant_raw, merchant_norm, category, source,
      account_from, account_to, notes,
      confidence, needs_review, raw_email_id, created_at
    ) values(
      @txnType, @postedAt, @amountOriginal, @currencyOriginal,
      @amountSgd, @fxRateToSgd, @fxProvider,
      @merchantRaw, @merchantNorm, @category, @source,
      @accountFrom, @accountTo, @notes,
      @confidence, @needsReview, @rawEmailId, @createdAt
    )
  `);
  stmt.run(tx);
}

async function main() {
  const dbPath = process.env.DB_PATH || './data/expenses.sqlite';
  const tz = process.env.TIMEZONE || 'Asia/Singapore';
  const fxProvider = process.env.FX_PROVIDER || 'exchangerate.host';

  mustEnv('GMAIL_USER');
  mustEnv('GMAIL_APP_PASSWORD');

  const db = openDb(dbPath);

  const metaSince = getMeta(db, 'last_ingest_at');
  const since = getSince() || metaSince;

  console.log(JSON.stringify({
    ok: true,
    event: 'ingest_start',
    since: since || null,
    tz,
    dbPath,
  }));

  const ambiguous = [];
  let ingested = 0;
  let skippedDup = 0;

  await withGmailImap(process.env, async (client) => {
    const msgs = await fetchMessagesSince(client, { since });

    for (const msg of msgs) {
      const messageId = msg.envelope?.messageId || null;
      // If no messageId, we still allow ingest, but dedupe by hash.
      const receivedAt = (msg.internalDate ? new Date(msg.internalDate) : new Date()).toISOString();
      const subject = msg.envelope?.subject || '';
      const fromAddr = msg.envelope?.from?.[0]?.address || '';

      const parsed = await parseEmailToCandidate(msg.source);
      const normalizedBody = normalizeText(parsed.body);
      const bodyHash = sha256(normalizedBody);

      // Dedupe: message-id if present, else bodyHash+receivedAt-day range.
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

      const rawEmailId = upsertRawEmail(db, {
        messageId,
        gmailUid: msg.uid ? String(msg.uid) : null,
        receivedAt,
        subject,
        fromAddr,
        bodyHash,
        rawText: normalizedBody,
        processedAt: nowIso(),
        status: 'processed',
        error: null,
      });

      const c = parsed.candidate;
      const postedDate = (c.postedAt || receivedAt).slice(0, 10);

      // FX
      let rate = 1;
      if (c.currencyOriginal !== 'SGD') {
        rate = await fetchAndCacheFxRate(db, { date: postedDate, base: c.currencyOriginal, quote: 'SGD', provider: fxProvider });
      }

      const amountSgd = c.amountOriginal * rate;

      insertTransaction(db, {
        txnType: c.txnType,
        postedAt: c.postedAt,
        amountOriginal: c.amountOriginal,
        currencyOriginal: c.currencyOriginal,
        amountSgd,
        fxRateToSgd: rate,
        fxProvider,
        merchantRaw: c.merchantRaw,
        merchantNorm: c.merchantNorm,
        category: c.category || 'Uncategorized',
        source: c.source || '',
        accountFrom: null,
        accountTo: null,
        notes: c.notes || '',
        confidence: c.confidence,
        needsReview: c.needsReview ? 1 : 0,
        rawEmailId,
        createdAt: nowIso(),
      });

      ingested += 1;
      if (c.needsReview) {
        ambiguous.push({
          subject: parsed.meta.subject,
          receivedAt,
          txnType: c.txnType,
          amountOriginal: c.amountOriginal,
          currencyOriginal: c.currencyOriginal,
          amountSgd,
          merchant: c.merchantRaw,
          category: c.category || 'Uncategorized',
        });
      }
    }
  });

  setMeta(db, 'last_ingest_at', nowIso());

  console.log(JSON.stringify({
    ok: true,
    event: 'ingest_done',
    ingested,
    skippedDup,
    ambiguousCount: ambiguous.length,
    ambiguous,
  }));
}

main().catch((err) => {
  console.error(JSON.stringify({ ok: false, event: 'ingest_error', error: String(err?.stack || err) }));
  process.exit(1);
});
