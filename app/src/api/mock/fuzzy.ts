// Item-name normalization and fuzzy matching (DESIGN.md §6.3). The mock's stand-in for
// the server's pg_trgm + levenshtein() search in plan/database/04.

/** lowercase, strip punctuation except `&`, collapse spaces, drop a trailing `s` but not `ss`. */
export function normalizeItemName(input: string): string {
  let s = input.toLowerCase();
  s = s.replace(/[^\p{L}\p{N}&\s]/gu, '');
  s = s.replace(/\s+/g, ' ').trim();
  if (s.endsWith('s') && !s.endsWith('ss')) s = s.slice(0, -1);
  return s;
}

export function levenshtein(a: string, b: string): number {
  if (a === b) return 0;
  if (!a.length) return b.length;
  if (!b.length) return a.length;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const cur = [i];
    for (let j = 1; j <= b.length; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    prev = cur;
  }
  return prev[b.length];
}

/** One searchable key: an item's normalized name or one of its aliases. */
export type SearchKey = { itemId: string; key: string };

export type MatchResult = { match: 'exact' | 'suggested' | 'none'; itemIds: string[] };

const MAX_SIMILAR = 5;
const SIMILAR_DISTANCE = 4;

export function matchItem(query: string, keys: SearchKey[]): MatchResult {
  const q = normalizeItemName(query);
  const exact = keys.find((k) => k.key === q);
  if (exact) return { match: 'exact', itemIds: [exact.itemId] };

  // Best (smallest) distance per item across its name and aliases.
  const best = new Map<string, number>();
  for (const k of keys) {
    const d = levenshtein(q, k.key);
    if (d < (best.get(k.itemId) ?? Infinity)) best.set(k.itemId, d);
  }
  const ranked = [...best.entries()].sort((a, b) => a[1] - b[1]);
  const threshold = q.length < 5 ? 1 : 2;

  if (ranked.length && ranked[0][1] <= threshold) {
    return { match: 'suggested', itemIds: ranked.slice(0, MAX_SIMILAR).map(([id]) => id) };
  }
  return {
    match: 'none',
    itemIds: ranked.filter(([, d]) => d <= SIMILAR_DISTANCE).slice(0, MAX_SIMILAR).map(([id]) => id),
  };
}
