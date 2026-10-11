import { normalize } from "../../lib/normalize.js";

/**
 * Recipe search ranking (challenge 01 §12 / §12.1). Lower score = better. Cosine distance units.
 *   normal: distance − 0.03·mustUse − 0.10·coverage + 0.01·max(0, missing − 4) − 0.05 if the query's dish word is in the title
 *   browse:          − 0.15·mustUse − 0.10·coverage + 0.01·max(0, missing − 4)   (no embedding; distance reported as 0)
 * coverage = share of a recipe's ingredients the household has; missing = how many it doesn't.
 */
export const MUST_USE_BOOST = 0.03;
export const BROWSE_MUST_USE_BOOST = 0.15;
export const COVERAGE_BOOST = 0.1;
export const MISSING_PENALTY = 0.01;
export const DISH_BOOST = 0.05;
const MISSING_FREE = 4;
/** Browse candidates must use a mustUse item or have at least this cabinet coverage. */
export const BROWSE_MIN_COVERAGE = 0.4;
/** Browse diversity: at most this many results from one site. */
const PER_SITE = 2;

/** Always in a kitchen: neither "covered" nor "missing". */
const STAPLES = new Set(["salt", "pepper", "black pepper", "kosher salt", "sea salt", "water", "ice", "cooking spray"]);

/** Dish nouns for the normal-mode boost and the browse near-duplicate check. */
const DISHES: [string, RegExp][] = [
  ["pasta", /\bpastas?\b/i], ["quesadilla", /\bquesadillas?\b/i], ["taco", /\btacos?\b/i],
  ["stir-fry", /\bstir[\s-]?fr(?:y|ies|ied)\b/i], ["curry", /\bcurr(?:y|ies)\b/i], ["soup", /\bsoups?\b/i],
  ["salad", /\bsalads?\b/i], ["burger", /\bburgers?\b/i], ["chili", /\bchil(?:i|li|e)s?\b/i], ["bowl", /\bbowls?\b/i],
  ["pizza", /\bpizzas?\b/i], ["casserole", /\bcasseroles?\b/i], ["skillet", /\bskillets?\b/i],
];
const PROTEINS = /\b(chicken|beef|pork|turkey|salmon|shrimp|prawns?|tofu|lamb|sausage|fish|tuna|cod|steak|beans?|lentils?|chickpeas?|eggs?)\b/i;

/** The first dish noun in a text (query or title), or null. */
export const dishOf = (text: string) => DISHES.find(([, re]) => re.test(text))?.[0] ?? null;
const proteinOf = (title: string) => PROTEINS.exec(title)?.[1].toLowerCase().replace(/(?:es|s)$/, "") ?? null;

const pad = (s: string) => ` ${normalize(s)} `;

/** Names → one case-insensitive whole-word Postgres regex (plural-tolerant), for the SQL browse prefilter. null if empty. */
export function termsRegex(names: string[]): string | null {
  const terms = [...new Set(names.map((n) => normalize(n)).filter(Boolean))].map((n) => n.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  return terms.length ? `\\m(${terms.join("|")})(e?s)?\\M` : null;
}

export type Fit = { uses: string[]; coverage: number; missing: number };

/**
 * How well a recipe fits this kitchen. Names match whole-word in either direction (normalized, as listWriter/safety do):
 * "Boneless Chicken Breast" ⊇ "chicken breast", "Chicken" ⊆ "chicken breast".
 */
export function kitchenFit(ingredients: string[], mustUse: string[], cabinet: string[]): Fit {
  const cab = [...new Set(cabinet.map(pad))].filter((c) => c.trim());
  const wants = mustUse.map((name) => ({ name, key: pad(name) })).filter((u) => u.key.trim());
  const names = [...new Set(ingredients.map(pad))].filter((n) => n.trim() && !STAPLES.has(n.trim()));
  const matches = (a: string, b: string) => a.includes(b) || b.includes(a);
  const have = names.filter((n) => cab.some((c) => matches(n, c))).length;
  return {
    uses: wants.filter((u) => names.some((n) => n.includes(u.key))).map((u) => u.name),
    coverage: names.length ? have / names.length : 0,
    missing: names.length - have,
  };
}

const missingPenalty = (missing: number) => MISSING_PENALTY * Math.max(0, missing - MISSING_FREE);

type Row = { distance: number; ingredients: string[]; title?: string };
export type Ranked<R> = Fit & { r: R; score: number };

/** Normal (query) mode: similarity re-ranked by kitchen fit, plus a boost when the title has the query's dish word. */
export function rankByKitchenFit<R extends Row>(rows: R[], mustUse: string[], cabinet: string[], query = ""): Ranked<R>[] {
  const dish = dishOf(query);
  const dishRe = dish ? DISHES.find(([d]) => d === dish)![1] : null;
  return rows
    .map((r) => {
      const fit = kitchenFit(r.ingredients, mustUse, cabinet);
      const dishHit = dishRe && r.title && dishRe.test(r.title) ? DISH_BOOST : 0;
      const score = r.distance - MUST_USE_BOOST * fit.uses.length - COVERAGE_BOOST * fit.coverage + missingPenalty(fit.missing) - dishHit;
      return { r, ...fit, score };
    })
    .sort((a, b) => a.score - b.score);
}

/**
 * Browse mode: kitchen fit only. Keeps recipes that use a mustUse item or cover ≥ 40% from the cabinet, then picks
 * the best `limit` with at most 2 per site and no near-duplicates (same main protein AND same dish word).
 */
export function rankForBrowse<R extends Row & { site: string; title: string }>(
  rows: R[],
  mustUse: string[],
  cabinet: string[],
  limit: number,
): Ranked<R>[] {
  const scored = rows
    .map((r) => {
      const fit = kitchenFit(r.ingredients, mustUse, cabinet);
      const score = -BROWSE_MUST_USE_BOOST * fit.uses.length - COVERAGE_BOOST * fit.coverage + missingPenalty(fit.missing);
      return { r, ...fit, score };
    })
    .filter((x) => x.uses.length > 0 || x.coverage >= BROWSE_MIN_COVERAGE)
    .sort((a, b) => a.score - b.score || a.r.title.localeCompare(b.r.title));

  const out: Ranked<R>[] = [];
  const perSite = new Map<string, number>();
  const seen = new Set<string>();
  for (const x of scored) {
    if (out.length >= limit) break;
    const site = x.r.site.toLowerCase();
    if ((perSite.get(site) ?? 0) >= PER_SITE) continue;
    const protein = proteinOf(x.r.title);
    const dish = dishOf(x.r.title);
    const key = protein && dish ? `${protein}|${dish}` : `title|${normalize(x.r.title)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    perSite.set(site, (perSite.get(site) ?? 0) + 1);
    out.push(x);
  }
  return out;
}
