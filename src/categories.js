import fs from 'node:fs';
import path from 'node:path';

export function loadCategories(categoriesPath = null) {
  const p = categoriesPath || process.env.CATEGORIES_PATH || path.join(process.cwd(), 'categories.json');
  if (!fs.existsSync(p)) {
    return { path: p, canonical: new Set(), aliases: new Map(), ok: false };
  }
  const parsed = JSON.parse(fs.readFileSync(p, 'utf-8'));
  const canonical = new Set((parsed.canonical || []).map(String));
  const aliases = new Map();
  for (const [k, v] of Object.entries(parsed.aliases || {})) {
    aliases.set(String(k).toLowerCase(), String(v));
  }
  return { path: p, canonical, aliases, ok: true };
}

export function normalizeCategory(input, { canonical, aliases }) {
  const raw = (input ?? '').toString().trim();
  if (!raw) return { category: 'Uncategorized', changed: raw !== 'Uncategorized', unknown: false, original: raw };

  // Exact match
  if (canonical.has(raw)) return { category: raw, changed: false, unknown: false, original: raw };

  // Alias (case-insensitive)
  const aliased = aliases.get(raw.toLowerCase());
  if (aliased && canonical.has(aliased)) {
    return { category: aliased, changed: true, unknown: false, original: raw };
  }

  // Case-insensitive canonical match
  for (const c of canonical) {
    if (c.toLowerCase() === raw.toLowerCase()) {
      return { category: c, changed: true, unknown: false, original: raw };
    }
  }

  return { category: 'Uncategorized', changed: true, unknown: true, original: raw };
}
