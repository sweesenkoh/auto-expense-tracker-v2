import { simpleParser } from 'mailparser';
import { normalizeText, normalizeMerchant } from './util.js';

const TRANSFER_KEYWORDS = [
  'transfer',
  'fund transfer',
  'funds transfer',
  'fast',
  'giro',
  'paynow',
  'to account',
  'from account',
  'beneficiary',
  'recipient',
];

const REFUND_KEYWORDS = ['refund', 'refunded', 'reversal', 'reversed', 'chargeback'];

// Very conservative parsing: extract amount + currency + merchant-ish line if possible.
// Everything else can be improved later.
export async function parseEmailToCandidate(rawSource) {
  const mail = await simpleParser(rawSource);

  const subject = mail.subject || '';
  const from = mail.from?.text || '';
  const receivedAt = (mail.date ? new Date(mail.date) : new Date()).toISOString();

  const body = normalizeText(mail.text || mail.html || '');

  // Basic amount/currency detection
  // Examples: SGD 12.34, S$12.34, USD 10.00, $10.00
  const amountMatch = body.match(/\b(SGD|USD|EUR|GBP|AUD|CAD|JPY|CNY)\s*([0-9]+(?:\.[0-9]{1,2})?)\b/i)
    || body.match(/\b(S\$)\s*([0-9]+(?:\.[0-9]{1,2})?)\b/i)
    || body.match(/\b\$\s*([0-9]+(?:\.[0-9]{1,2})?)\b/);

  let currency = null;
  let amount = null;

  if (amountMatch) {
    if (amountMatch[1] && typeof amountMatch[1] === 'string') {
      const c = amountMatch[1].toUpperCase();
      currency = c === 'S$' ? 'SGD' : c;
      amount = Number(amountMatch[2]);
    } else {
      // $xx.xx unknown; assume SGD for local spend (can refine later)
      currency = 'SGD';
      amount = Number(amountMatch[1]);
    }
  }

  // Direction heuristics
  const lower = (subject + '\n' + body).toLowerCase();

  let txnType = 'expense';
  if (TRANSFER_KEYWORDS.some(k => lower.includes(k))) txnType = 'transfer';
  if (REFUND_KEYWORDS.some(k => lower.includes(k))) txnType = 'refund';
  if (lower.includes('credited') || lower.includes('credit') || lower.includes('salary')) txnType = 'income';

  // Merchant heuristic: use sender domain or first non-empty line with letters.
  let merchantRaw = null;
  const fromDomain = from.includes('<') ? from.split('<').pop()?.replace('>', '') : from;
  if (fromDomain && fromDomain.includes('@')) merchantRaw = fromDomain.split('@')[1];

  const lines = body.split('\n').map(l => l.trim()).filter(Boolean);
  const candidateLine = lines.find(l => /[a-zA-Z]{3,}/.test(l) && l.length < 80);
  if (candidateLine) merchantRaw = merchantRaw ? merchantRaw : candidateLine;

  const merchantNorm = normalizeMerchant(merchantRaw);

  // Category starts as Uncategorized; user opted to include ambiguous as Uncategorized
  const category = 'Uncategorized';

  // Confidence/needs_review
  const needsReview = !amount || !currency || !merchantNorm;
  const confidence = needsReview ? 0.3 : 0.7;

  return {
    meta: { subject, from, receivedAt },
    body,
    candidate: {
      txnType,
      postedAt: receivedAt,
      amountOriginal: amount || 0,
      currencyOriginal: currency || 'SGD',
      merchantRaw: merchantRaw || '',
      merchantNorm: merchantNorm || '',
      category,
      source: '',
      notes: '',
      confidence,
      needsReview,
    },
  };
}
