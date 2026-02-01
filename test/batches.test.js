import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDb } from '../src/db.js';

function tmpDbPath() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aetv2-'));
  return path.join(dir, 'test.sqlite');
}

describe('batches + proposed_transactions', () => {
  it('creates schema and can commit a proposed transaction into transactions', () => {
    const dbPath = tmpDbPath();
    const db = openDb(dbPath);

    // insert a raw email
    const rawInfo = db.prepare(`
      insert into raw_emails(message_id, gmail_uid, received_at, subject, from_addr, body_hash, raw_text, processed_at, status, error)
      values(?,?,?,?,?,?,?,?,?,?)
    `).run(
      '<msg-1>',
      '123',
      new Date('2026-02-01T00:00:00Z').toISOString(),
      'Test',
      'bank@example.com',
      'hash',
      'raw',
      new Date().toISOString(),
      'stored',
      null
    );
    const rawEmailId = rawInfo.lastInsertRowid;

    // create batch
    const bInfo = db.prepare('insert into batches(status, created_at) values(?, ?)').run('pending', new Date().toISOString());
    const batchId = bInfo.lastInsertRowid;

    db.prepare(`
      insert into proposed_transactions(
        batch_id, raw_email_id,
        txn_type, posted_at, amount_original, currency_original,
        amount_sgd, fx_rate_to_sgd, fx_provider,
        merchant_raw, merchant_norm, category, source,
        account_from, account_to, notes,
        confidence, needs_review,
        proposal_json, created_at
      ) values(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `).run(
      batchId,
      rawEmailId,
      'expense',
      '2026-02-01T01:00:00Z',
      12.34,
      'SGD',
      12.34,
      1,
      'frankfurter',
      'MCD',
      'mcdonalds',
      'Food',
      'gmail',
      null,
      null,
      'test',
      0.9,
      0,
      '{}',
      new Date().toISOString()
    );

    // emulate commit logic (call same SQL as batches.js uses)
    const proposals = db.prepare('select * from proposed_transactions where batch_id = ?').all(batchId);
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
          category: p.category,
          source: p.source,
          accountFrom: p.account_from,
          accountTo: p.account_to,
          notes: p.notes,
          confidence: p.confidence,
          needsReview: p.needs_review,
          rawEmailId: p.raw_email_id,
          createdAt: new Date().toISOString(),
        });
      }
      db.prepare('update batches set status = ? where id = ?').run('committed', batchId);
    });
    tx();

    const txn = db.prepare('select * from transactions where raw_email_id = ?').get(rawEmailId);
    expect(txn).toBeTruthy();
    expect(txn.txn_type).toBe('expense');
    expect(Number(txn.amount_sgd)).toBeCloseTo(12.34);

    const b = db.prepare('select status from batches where id = ?').get(batchId);
    expect(b.status).toBe('committed');
  });
});
