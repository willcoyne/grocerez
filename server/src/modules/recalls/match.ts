// Pure recall-to-cabinet matching. Mirrors pg_trgm so a SQL version (strict_word_similarity) gives the same answers.

export const MATCH_THRESHOLD = 0.35;
/** Name words that never count toward the all-words gate (with words under 3 chars, like "oz"). */
export const STOP_WORDS = ["and", "the", "with", "for"];

/**
 * Case-, accent- and apostrophe-insensitive form applied to both sides of every comparison ("Häagen-Dazs" ~
 * "HAAGEN-DAZS", "Trader Joe's" ~ "TRADER JOES"). Same as the SQL function match_norm() (unaccent + lower + drop ' ’ ʼ `).
 */
export const matchNorm = (s: string) =>
  s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/['’ʼ`]/g, "");

const words = (s: string) => matchNorm(s).split(/[^\p{L}\p{N}]+/u).filter(Boolean);
/** Whole word, allowing one trailing "s" either way ("cracker" ~ "crackers", "kelloggs" ~ "kellogg"). */
const hasWord = (desc: Set<string>, w: string) => {
  const stem = w.replace(/s$/, "");
  return desc.has(stem) || desc.has(`${stem}s`);
};

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

/**
 * Brand appears in the description (normalized, whole words, optional trailing "s"): every brand word, or the first
 * brand word when it has 4+ letters, so a parent brand still matches its sub-brand ("Kraft Heinz" ~ "Kraft ...").
 * Same rule as the SQL in recalls/repo.ts.
 */
export function brandAppears(brand: string, description: string): boolean {
  const b = words(brand);
  const desc = new Set(words(description));
  return b.length > 0 && (b.every((w) => hasWord(desc, w)) || (b[0].length >= 4 && hasWord(desc, b[0])));
}

/**
 * Every significant word of `name` appears as a whole word in the description, allowing one trailing "s" either way
 * ("cracker" ~ "crackers"). Stops "Cheese Crackers" matching any recall that only mentions "cheese".
 * ponytail: "s"-only plurals; "berries"/"berry" don't pair. Add a stemmer if real misses show up.
 * Same rule as the SQL in recalls/repo.ts (`~ '\m<stem>s?\M'`).
 */
export function allWordsAppear(name: string, description: string): boolean {
  const desc = new Set(words(description));
  return words(name)
    .filter((w) => w.length >= 3 && !STOP_WORDS.includes(w))
    .every((w) => hasWord(desc, w));
}

/** A brand gates matching only if it has at least one letter or digit. */
const hasBrand = (brand?: string | null): brand is string => !!brand && words(brand).length > 0;

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
 * Candidate names: item name, aliases, and `brand + ' ' + productName`. A name qualifies when its score >= threshold
 * and all its significant words appear in the description; score = best qualifying name. When the brand is known it
 * must also appear in the description. Results are suggestions only.
 */
export function matchRecalls(recalls: MatchRecall[], items: MatchCabinetItem[]): RecallMatch[] {
  const out: RecallMatch[] = [];
  for (const r of recalls) {
    for (const it of items) {
      if (hasBrand(it.brand) && !brandAppears(it.brand, r.productDescription)) continue;
      const names = [it.itemName, ...(it.aliases ?? [])];
      if (it.productName) names.push(`${it.brand ?? ""} ${it.productName}`);
      const scores = names
        .filter((n) => allWordsAppear(n, r.productDescription))
        .map((n) => strictWordSimilarity(n, r.productDescription));
      const score = Math.max(0, ...scores);
      if (score >= MATCH_THRESHOLD) out.push({ recallId: r.id, groupId: it.groupId, cabinetItemId: it.id, score });
    }
  }
  return out;
}
