import { levenshtein, matchItem, normalizeItemName } from '../fuzzy';

describe('normalizeItemName', () => {
  it.each([
    ['Cheerios!', 'cheerio'],
    ['  Paper   Towels ', 'paper towel'],
    ["Lay's", 'lay'],
    ['Mac & Cheese', 'mac & cheese'],
    ['Swiss', 'swiss'], // trailing "ss" is kept
    ['Bananas', 'banana'],
  ])('%s → %s', (input, expected) => {
    expect(normalizeItemName(input)).toBe(expected);
  });
});

describe('levenshtein', () => {
  it('counts edits', () => {
    expect(levenshtein('cherio', 'cheerio')).toBe(1);
    expect(levenshtein('kitten', 'sitting')).toBe(3);
    expect(levenshtein('', 'abc')).toBe(3);
  });
});

describe('matchItem', () => {
  const keys = ['Cheerios', 'Milk', 'Oreos', 'Rice', 'Bread'].map((n) => ({
    itemId: n.toLowerCase(),
    key: normalizeItemName(n),
  }));

  it('"Cheerios!" is exact', () => {
    expect(matchItem('Cheerios!', keys)).toEqual({ match: 'exact', itemIds: ['cheerios'] });
  });

  it.each(['cherios', 'Cherrios'])('"%s" suggests Cheerios', (q) => {
    const r = matchItem(q, keys);
    expect(r.match).toBe('suggested');
    expect(r.itemIds[0]).toBe('cheerios');
  });

  it('uses the ≤1 threshold for short queries', () => {
    expect(matchItem('mlk', keys).match).toBe('suggested'); // distance 1
    expect(matchItem('mk', keys).match).toBe('none'); // distance 2, query under 5 chars
  });

  it('returns none for unrelated text', () => {
    expect(matchItem('paper towels', keys).match).toBe('none');
  });

  it('matches aliases exactly', () => {
    const withAlias = [...keys, { itemId: 'cheerios', key: normalizeItemName('cherios') }];
    expect(matchItem('cherios', withAlias)).toEqual({ match: 'exact', itemIds: ['cheerios'] });
  });
});
