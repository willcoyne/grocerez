import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import type { Allergen } from "../contracts/dietary.js";
import { allergensFromOffTags } from "./allergens.js";
import { http, USER_AGENT } from "./http.js";
import { normalize } from "./normalize.js";
import { offCode } from "./openfoodfacts.js";

/**
 * Keyless data sources for the product lookup agent (backend/13). Each result carries the URL it came from, which
 * is the only kind of URL the agent may cite.
 * - USDA FoodKeeper (shelf life): bundled as server/data/foodkeeper.json (public domain; fsis.usda.gov blocks scripts).
 * - BLS CPI average prices (price): bundled as server/data/bls-prices.json, latest month per census region.
 * - Open Food Facts (allergens / ingredients): live search API.
 * Rebuild the bundled files with the script described in plan/backend/13-ai-product-lookup/README.md.
 */

export type Source = { url: string; title: string };
type Span = { minDays?: number; maxDays?: number; tip?: string; note?: string };
type Food = { id: number; name: string; subtitle: string | null; category: string | null; keywords: string[]; storage: Record<string, Span> };
type PriceItem = { code: string; name: string; areas: Record<string, { usd: number; month: string; series: string }> };

const dataFile = <T>(name: string): T => JSON.parse(readFileSync(resolve(process.cwd(), "data", name), "utf8")) as T;
let foodkeeper: { url: string; foods: Food[] } | null = null;
let bls: { items: PriceItem[] } | null = null;

const words = (s: string) => normalize(s).split(" ").filter((w) => w.length > 1);
/** Fraction of the query's words found in the text (singular/plural tolerant). */
const overlap = (query: string[], text: string) => {
  const hay = new Set(words(text).flatMap((w) => [w, w.replace(/e?s$/, "")]));
  return query.filter((w) => hay.has(w) || hay.has(w.replace(/e?s$/, ""))).length / Math.max(query.length, 1);
};

export const FOODKEEPER_URL = "https://www.foodsafety.gov/keep-food-safe/foodkeeper-app";

/** Top FoodKeeper entries for a food name, with storage times in days. */
export function shelfLifeSearch(query: string, limit = 5) {
  const data = (foodkeeper ??= dataFile<{ url: string; foods: Food[] }>("foodkeeper.json"));
  const q = words(query);
  return data.foods
    .map((f) => ({ f, score: overlap(q, [f.name, f.subtitle, f.keywords.join(" ")].filter(Boolean).join(" ")) + overlap(q, f.name) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score || a.f.name.length - b.f.name.length)
    .slice(0, limit)
    .map(({ f }) => ({
      name: f.subtitle ? `${f.name} (${f.subtitle})` : f.name,
      category: f.category,
      storage: f.storage,
      // One URL per entry (fragment = FoodKeeper product ID) so each citation keeps its own title.
      source: { url: `${FOODKEEPER_URL}#product-${f.id}`, title: `USDA FoodKeeper: ${f.subtitle ? `${f.name}, ${f.subtitle}` : f.name}` } satisfies Source,
    }));
}

export type PriceRegion = "Northeast" | "Midwest" | "South" | "West";

/** Census region of a US ZIP code (by prefix; good enough for BLS regional averages). */
export function zipRegion(zip: string): PriceRegion {
  const p3 = Number(zip.slice(0, 3));
  if (p3 >= 197 && p3 <= 199) return "South"; // Delaware
  if (p3 >= 400 && p3 <= 427) return "South"; // Kentucky
  if (p3 >= 590 && p3 <= 599) return "West"; // Montana
  return (["Northeast", "Northeast", "South", "South", "Midwest", "Midwest", "Midwest", "South", "West", "West"] as const)[Number(zip[0])];
}

/** BLS average retail prices matching a food name: the region's latest month, else the US average. */
export function averagePriceSearch(query: string, region: PriceRegion | null, limit = 4) {
  const data = (bls ??= dataFile<{ items: PriceItem[] }>("bls-prices.json"));
  const q = words(query);
  return data.items
    .map((i) => ({ i, score: overlap(q, i.name.split(",").slice(0, 2).join(" ")) }))
    .filter((r) => r.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ i }) => {
      const [area, p] = region && i.areas[region] ? [region, i.areas[region]] : ["US", i.areas.US ?? Object.values(i.areas)[0]];
      return {
        item: i.name,
        averagePriceCents: Math.round(p.usd * 100),
        area: area === "US" ? "U.S. city average" : `${area} urban average`,
        month: p.month,
        source: { url: `https://data.bls.gov/timeseries/${p.series}`, title: `BLS average price: ${i.name}, ${area}, ${p.month}` } satisfies Source,
      };
    });
}

type OffHit = {
  code?: string; product_name?: string; brands?: string[] | string; quantity?: string;
  allergens_tags?: string[]; traces_tags?: string[]; ingredients_text?: string;
};

const offHit = (h: OffHit) => {
  const brand = Array.isArray(h.brands) ? h.brands.join(", ") : (h.brands ?? null);
  return {
    name: h.product_name ?? "(no name)",
    brand,
    quantity: h.quantity ?? null,
    contains: allergensFromOffTags(h.allergens_tags) as Allergen[],
    mayContain: allergensFromOffTags(h.traces_tags) as Allergen[],
    ingredients: h.ingredients_text ? h.ingredients_text.slice(0, 400) : null,
    source: {
      url: `https://world.openfoodfacts.org/product/${h.code}`,
      title: `Open Food Facts: ${[brand, h.product_name].filter(Boolean).join(" ")}`,
    } satisfies Source,
  };
};

const OFF_FIELDS = "code,product_name,brands,quantity,allergens_tags,traces_tags,ingredients_text";

/** Open Food Facts full-text product search (ingredients + allergen tags). */
export async function productSearch(query: string, limit = 5) {
  const url = `https://search.openfoodfacts.org/search?q=${encodeURIComponent(query)}&page_size=${limit}&fields=${OFF_FIELDS}`;
  const res = await http.fetch(url, { headers: { "User-Agent": USER_AGENT(), Accept: "application/json" }, signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Open Food Facts search returned ${res.status}`);
  const body = (await res.json()) as { hits?: OffHit[] };
  return (body.hits ?? []).filter((h) => h.code && /^\d+$/.test(h.code)).map(offHit);
}

/** Open Food Facts product by barcode (GTIN-14). null when unknown. */
export async function productByBarcode(gtin14: string) {
  const code = offCode(gtin14);
  const res = await http.fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json?fields=${OFF_FIELDS}`, {
    headers: { "User-Agent": USER_AGENT(), Accept: "application/json" }, signal: AbortSignal.timeout(8000),
  });
  if (res.status === 404) return null;
  if (!res.ok) throw new Error(`Open Food Facts returned ${res.status}`);
  const body = (await res.json()) as { status?: number; product?: OffHit };
  return body.status === 1 && body.product ? offHit({ ...body.product, code }) : null;
}
