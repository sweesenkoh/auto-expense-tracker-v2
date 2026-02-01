import { describe, it, expect } from 'vitest';
import { normalizeCategory } from '../src/categories.js';

const spec = {
  canonical: new Set(['Food', 'Transport', 'Uncategorized']),
  aliases: new Map([
    ['food', 'Food'],
    ['mrt', 'Transport'],
  ]),
};

describe('category normalization', () => {
  it('keeps canonical as-is', () => {
    const r = normalizeCategory('Food', spec);
    expect(r.category).toBe('Food');
    expect(r.unknown).toBe(false);
    expect(r.changed).toBe(false);
  });

  it('normalizes alias', () => {
    const r = normalizeCategory('food', spec);
    expect(r.category).toBe('Food');
    expect(r.unknown).toBe(false);
    expect(r.changed).toBe(true);
  });

  it('normalizes case-insensitive canonical', () => {
    const r = normalizeCategory('tRaNsPoRt', spec);
    expect(r.category).toBe('Transport');
    expect(r.unknown).toBe(false);
  });

  it('unknown becomes Uncategorized', () => {
    const r = normalizeCategory('WeirdNewCat', spec);
    expect(r.category).toBe('Uncategorized');
    expect(r.unknown).toBe(true);
    expect(r.changed).toBe(true);
  });
});
