import crypto from 'node:crypto';

export function sha256(text) {
  return crypto.createHash('sha256').update(text).digest('hex');
}

export function nowIso() {
  return new Date().toISOString();
}

export function normalizeText(text) {
  return (text || '')
    .replace(/\r\n/g, '\n')
    .replace(/[ \t]+/g, ' ')
    .trim();
}

export function normalizeMerchant(text) {
  return (text || '').trim().toLowerCase();
}
