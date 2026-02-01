import 'dotenv/config';
import fs from 'node:fs';
import { openDb } from './db.js';
import { loadCategories, normalizeCategory } from './categories.js';

function usage() {
  console.log('Usage:');
  console.log('  node src/batches.js create --input proposals.json');
  console.log('  node src/batches.js show --batch <id>');
  console.log('  node src/batches.js commit --batch <id>');
  console.log('  node src/batches.js cancel --batch <id>');
  process.exit(1);
}

function getArg(name, def = null) {
  const idx = process.argv.indexOf(name);
  if (idx === -1) return def;
  return process.argv[idx + 1] ?? def;
}

function nowIso() {
  return new Date().toISOString();
}

const cmd = process.argv[2];
if (!cmd) usage();

const dbPath = process.env.DB_PATH || './data/expenses.sqlite';
const db = openDb(dbPath);

function requireBatch(id) {
  const b = db.prepare('select * from batches where id = ?').get(id);
  if (!b) throw new Error(`BATCH_NOT_FOUND:${id}`);
  return b;
}

if (cmd === 'create') {
  const input = getArg('--input');
  if (!input) usage();
  const raw = fs.readFileSync(input, 'utf-8');
  const parsed = JSON.parse(raw);

  const proposals = Array.isArray(parsed) ? parsed : parsed?.proposals;
  if (!Array.isArray(proposals) || proposals.length === 0) {
    throw new Error('INVALID_PROPOSALS_INPUT');
  }

  const batchInfo = db.prepare('insert into batches(status, created_at, committed_at, notes) values(?,?,?,?)')
    .run('pending', nowIso(), null, null);
  const batchId = batchInfo.lastInsertRowid;

  const catSpec = loadCategories();

  const ins = db.prepare(`
    insert into proposed_transactions(
      batch_id, raw_email_id,
      txn_type, posted_at, amount_original, currency_original,
      amount_sgd, fx_rate_to_sgd, fx_provider,
      merchant_raw, merchant_norm, category, source,
      account_from, account_to, notes,
      confidence, needs_review,
      proposal_json, created_at
    ) values(
      @batchId, @rawEmailId,
      @txnType, @postedAt, @amountOriginal, @currencyOriginal,
      @amountSgd, @fxRateToSgd, @fxProvider,
      @merchantRaw, @merchantNorm, @category, @source,
      @accountFrom, @accountTo, @notes,
      @confidence, @needsReview,
      @proposalJson, @createdAt
    )
  `);

  const tx = db.transaction((items) => {
    for (const p of items) {
      const norm = catSpec.ok
        ? normalizeCategory(p.category ?? 'Uncategorized', catSpec)
        : { category: (p.category ?? 'Uncategorized'), unknown: false, changed: false, original: (p.category ?? '') };

      // If the category is unknown, force Uncategorized + needs_review.
      const needsReview = (p.needsReview ? 1 : 0) || (norm.unknown ? 1 : 0);

      // Preserve suggested new categories in notes for human approval later.
      const notes = [p.notes ?? ''];
      if (norm.unknown && norm.original) notes.push(`proposedCategory:${norm.original}`);
      if (p.proposedCategory) notes.push(`proposedCategory:${p.proposedCategory}`);

      ins.run({
        batchId,
        rawEmailId: p.rawEmailId ?? null,
        txnType: p.txnType,
        postedAt: p.postedAt ?? null,
        amountOriginal: Number(p.amountOriginal ?? 0),
        currencyOriginal: p.currencyOriginal,
        amountSgd: p.amountSgd == null ? null : Number(p.amountSgd),
        fxRateToSgd: p.fxRateToSgd == null ? null : Number(p.fxRateToSgd),
        fxProvider: p.fxProvider ?? null,
        merchantRaw: p.merchantRaw ?? null,
        merchantNorm: p.merchantNorm ?? null,
        category: norm.category ?? 'Uncategorized',
        source: p.source ?? 'gmail',
        accountFrom: p.accountFrom ?? null,
        accountTo: p.accountTo ?? null,
        notes: notes.filter(Boolean).join(' | '),
        confidence: p.confidence == null ? null : Number(p.confidence),
        needsReview,
        proposalJson: JSON.stringify(p),
        createdAt: nowIso(),
      });
    }
  });

  tx(proposals);

  console.log(JSON.stringify({ ok: true, event: 'batch_created', batchId, count: proposals.length }));
  process.exit(0);
}

if (cmd === 'show') {
  const batchId = Number(getArg('--batch'));
  if (!Number.isFinite(batchId)) usage();
  const b = requireBatch(batchId);

  const items = db.prepare(`
    select id, raw_email_id, txn_type, posted_at, amount_sgd, amount_original, currency_original, merchant_norm, merchant_raw, category, needs_review
    from proposed_transactions
    where batch_id = ?
    order by id asc
  `).all(batchId);

  console.log(JSON.stringify({ ok: true, event: 'batch_show', batch: b, items }, null, 2));
  process.exit(0);
}

if (cmd === 'commit') {
  const batchId = Number(getArg('--batch'));
  if (!Number.isFinite(batchId)) usage();
  const b = requireBatch(batchId);
  if (b.status !== 'pending') throw new Error(`BATCH_NOT_PENDING:${batchId}:${b.status}`);

  const proposals = db.prepare('select * from proposed_transactions where batch_id = ? order by id asc').all(batchId);

  const insertTxn = db.prepare(`
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

  const markProcessed = db.prepare('update raw_emails set status = ?, processed_at = ? where id = ?');
  const updateBatch = db.prepare('update batches set status = ?, committed_at = ? where id = ?');

  const tx = db.transaction(() => {
    for (const p of proposals) {
      insertTxn.run({
        txnType: p.txn_type,
        postedAt: p.posted_at,
        amountOriginal: p.amount_original,
        currencyOriginal: p.currency_original,
        amountSgd: p.amount_sgd,
        fxRateToSgd: p.fx_rate_to_sgd,
        fxProvider: p.fx_provider,
        merchantRaw: p.merchant_raw,
        merchantNorm: p.merchant_norm,
        category: p.category || 'Uncategorized',
        source: p.source || 'gmail',
        accountFrom: p.account_from,
        accountTo: p.account_to,
        notes: p.notes || '',
        confidence: p.confidence,
        needsReview: p.needs_review || 0,
        rawEmailId: p.raw_email_id,
        createdAt: nowIso(),
      });
      if (p.raw_email_id) markProcessed.run('processed', nowIso(), p.raw_email_id);
    }
    updateBatch.run('committed', nowIso(), batchId);
  });

  tx();

  console.log(JSON.stringify({ ok: true, event: 'batch_committed', batchId, count: proposals.length }));
  process.exit(0);
}

if (cmd === 'cancel') {
  const batchId = Number(getArg('--batch'));
  if (!Number.isFinite(batchId)) usage();
  const b = requireBatch(batchId);
  if (b.status !== 'pending') throw new Error(`BATCH_NOT_PENDING:${batchId}:${b.status}`);
  db.prepare('update batches set status = ? where id = ?').run('cancelled', batchId);
  console.log(JSON.stringify({ ok: true, event: 'batch_cancelled', batchId }));
  process.exit(0);
}

usage();
