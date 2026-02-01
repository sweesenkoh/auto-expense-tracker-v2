# auto-expense-tracker-v2

## Human-in-the-loop (manual confirmation) mode

Swee Sen preference: **no automatic parsing/commits**.

### Categories (canonical + controlled expansion)
- Canonical list lives in `categories.json` (committed to repo)
- Batch creation normalizes casing/aliases to prevent duplicates like `food` vs `Food`
- Unknown categories are forced to `Uncategorized` and flagged for review, with the suggestion stored as `proposedCategory:...` in notes

Nightly flow (10:45pm SGT):
1) `npm run ingest:raw` — fetch + store raw emails only (dedupe)
2) `npm run propose` — output stored raw emails for an LLM to read
3) LLM produces a `proposals.json` (array of transactions with required fields)
4) `npm run batches -- create --input proposals.json` — saves the proposals as a **pending batch**
5) After user confirmation: `npm run batches -- commit --batch <id>` — writes into `transactions`

This avoids silent misclassification (e.g. transfers as expenses) by requiring confirmation.

Nightly Gmail ingestion → SQLite ledger (expenses/income/transfers/refunds) with SGD conversion.

## Setup

1) Copy env:

```bash
cp .env.example .env
```

2) Fill in `GMAIL_USER` + `GMAIL_APP_PASSWORD` (Gmail App Password).

3) Install deps:

```bash
npm install
```

## Run ingestion

```bash
npm run ingest
```

## Query examples

```bash
npm run query -- spend --days 7
npm run query -- by-category --days 7
```
