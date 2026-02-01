import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

export function openDb(dbPath) {
  const dir = path.dirname(dbPath);
  fs.mkdirSync(dir, { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  migrate(db);
  return db;
}

function migrate(db) {
  db.exec(`
    create table if not exists meta (
      key text primary key,
      value text not null
    );

    create table if not exists fx_rates (
      date text not null,
      base text not null,
      quote text not null,
      rate real not null,
      provider text not null,
      fetched_at text not null,
      primary key(date, base, quote, provider)
    );

    create table if not exists raw_emails (
      id integer primary key autoincrement,
      message_id text,
      gmail_uid text,
      received_at text,
      subject text,
      from_addr text,
      body_hash text not null,
      raw_text text,
      processed_at text,
      status text not null,
      error text
    );

    create unique index if not exists raw_emails_message_id_uq on raw_emails(message_id);
    create index if not exists raw_emails_body_hash_ix on raw_emails(body_hash);
    create index if not exists raw_emails_received_at_ix on raw_emails(received_at);

    create table if not exists transactions (
      id integer primary key autoincrement,
      txn_type text not null,
      posted_at text,
      amount_original real not null,
      currency_original text not null,
      amount_sgd real,
      fx_rate_to_sgd real,
      fx_provider text,
      merchant_raw text,
      merchant_norm text,
      category text,
      source text,
      account_from text,
      account_to text,
      notes text,
      confidence real,
      needs_review integer not null default 0,
      raw_email_id integer,
      created_at text not null,
      foreign key(raw_email_id) references raw_emails(id)
    );

    create index if not exists transactions_posted_at_ix on transactions(posted_at);
    create index if not exists transactions_type_ix on transactions(txn_type);
    create index if not exists transactions_needs_review_ix on transactions(needs_review);

    -- Human-in-the-loop: proposed transactions that require confirmation
    create table if not exists batches (
      id integer primary key autoincrement,
      status text not null, -- pending|committed|cancelled
      created_at text not null,
      committed_at text,
      notes text
    );

    create table if not exists proposed_transactions (
      id integer primary key autoincrement,
      batch_id integer not null,
      raw_email_id integer,

      txn_type text not null,
      posted_at text,
      amount_original real not null,
      currency_original text not null,
      amount_sgd real,
      fx_rate_to_sgd real,
      fx_provider text,
      merchant_raw text,
      merchant_norm text,
      category text,
      source text,
      account_from text,
      account_to text,
      notes text,
      confidence real,
      needs_review integer not null default 0,

      proposal_json text, -- full structured proposal for audit/debug
      created_at text not null,

      foreign key(batch_id) references batches(id),
      foreign key(raw_email_id) references raw_emails(id)
    );

    create index if not exists proposed_transactions_batch_ix on proposed_transactions(batch_id);
    create index if not exists proposed_transactions_raw_email_ix on proposed_transactions(raw_email_id);
  `);
}

export function getMeta(db, key) {
  const row = db.prepare('select value from meta where key = ?').get(key);
  return row?.value ?? null;
}

export function setMeta(db, key, value) {
  db.prepare('insert into meta(key, value) values(?, ?) on conflict(key) do update set value=excluded.value')
    .run(key, value);
}
