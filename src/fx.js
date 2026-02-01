import fetch from 'node-fetch';
import { nowIso } from './util.js';

// Caches rate in DB. Returns rate (1 unit base -> quote).
export function getFxRate(db, { date, base, quote, provider = 'exchangerate.host' }) {
  if (base === quote) return 1;

  const cached = db
    .prepare('select rate from fx_rates where date = ? and base = ? and quote = ? and provider = ?')
    .get(date, base, quote, provider);

  if (cached?.rate) return cached.rate;

  // Fetch synchronously by blocking on async via deasync pattern is ugly; so this function
  // is expected to be called from an async wrapper.
  throw new Error('FX_RATE_NOT_CACHED');
}

export async function fetchAndCacheFxRate(db, { date, base, quote, provider = 'exchangerate.host' }) {
  if (base === quote) return 1;

  const url = `https://api.exchangerate.host/convert?from=${encodeURIComponent(base)}&to=${encodeURIComponent(quote)}&amount=1&date=${encodeURIComponent(date)}`;
  const res = await fetch(url, {
    headers: { 'Accept': 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`FX_HTTP_${res.status}`);
  }
  const data = await res.json();
  const rate = Number(data?.info?.rate ?? data?.result);
  if (!Number.isFinite(rate) || rate <= 0) {
    throw new Error('FX_BAD_RATE');
  }

  db.prepare(
    'insert or replace into fx_rates(date, base, quote, rate, provider, fetched_at) values(?,?,?,?,?,?)',
  ).run(date, base, quote, rate, provider, nowIso());

  return rate;
}
