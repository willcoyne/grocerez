// Pure recall-to-cabinet matching. Mirrors pg_trgm so a SQL version (strict_word_similarity) gives the same answers.

export const MATCH_THRESHOLD = 0.35;

const words = (s: string) => s.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter(Boolean);

function trigrams(ws: string[]): Set<string> {
  const set = new Set<string>();
  for (const w of ws) {
    const p = `  ${w} `;
    for (let i = 0; i + 3 <= p.length; i++) set.add(p.slice(i, i + 3));
  }
  return set;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / (a.size + b.size - inter);
}

/** pg_trgm similarity(a, b). */
export const similarity = (a: string, b: string) => jaccard(trigrams(words(a)), trigrams(words(b)));

/** pg_trgm-style strict_word_similarity(needle, haystack): best similarity against any run of whole words in haystack. */
export function strictWordSimilarity(needle: string, haystack: string): number {
  const n = trigrams(words(needle));
  const hw = words(haystack);
  let best = 0;
  // ponytail: O(words^2) spans, fine for recall descriptions (a few hundred words max)
  for (let i = 0; i < hw.length; i++)
    for (let j = i + 1; j <= hw.length; j++) best = Math.max(best, jaccard(n, trigrams(hw.slice(i, j))));
  return best;
}

/** Brand appears in the description as whole words (case/punctuation-insensitive). */
export function brandAppears(brand: string, description: string): boolean {
  const b = words(brand).join(" ");
  return b.length > 0 && ` ${words(description).join(" ")} `.includes(` ${b} `);
}

export type MatchRecall = { id: string; productDescription: string };
export type MatchCabinetItem = {
  id: string; // cabinet_item_id
  groupId: string;
  itemName: string;
  aliases?: string[];
  brand?: string | null;
  productName?: string | null;
};
export type RecallMatch = { recallId: string; groupId: string; cabinetItemId: string; score: number };

/**
 * Score = best of item name, aliases, and `brand + ' ' + productName`. A match needs score >= threshold
 * and, when the brand is known, the brand must appear in the description. Results are suggestions only.
 */
export function matchRecalls(recalls: MatchRecall[], items: MatchCabinetItem[]): RecallMatch[] {
  const out: RecallMatch[] = [];
  for (const r of recalls) {
    for (const it of items) {
      if (it.brand && !brandAppears(it.brand, r.productDescription)) continue;
      const names = [it.itemName, ...(it.aliases ?? [])];
      if (it.productName) names.push(`${it.brand ?? ""} ${it.productName}`);
      const score = Math.max(...names.map((n) => strictWordSimilarity(n, r.productDescription)));
      if (score >= MATCH_THRESHOLD) out.push({ recallId: r.id, groupId: it.groupId, cabinetItemId: it.id, score });
    }
  }
  return out;
}
