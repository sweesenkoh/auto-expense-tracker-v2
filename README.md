# auto-expense-tracker-v2

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
