import type { Allergen } from "../contracts/dietary.js";
import { allergensFromOffTags } from "./allergens.js";
import { AppError } from "./errors.js";
import { http, USER_AGENT } from "./http.js";

/** GS1 check digit of a GTIN-14 (same rule as the SQL gtin_check_digit_ok()). */
export function gtinCheckDigitOk(g14: string): boolean {
  if (!/^\d{14}$/.test(g14)) return false;
  let sum = 0;
  for (let i = 0; i < 13; i++) sum += Number(g14[i]) * (i % 2 === 0 ? 3 : 1);
  return (10 - (sum % 10)) % 10 === Number(g14[13]);
}

/** UPC-E (8 digits, number system 0/1) → UPC-A (12 digits), or null if it isn't UPC-E shaped. */
export function expandUpcE(d: string): string | null {
  if (!/^[01]\d{7}$/.test(d)) return null;
  const [ns, x1, x2, x3, x4, x5, x6, check] = d;
  let body: string;
  if ("012".includes(x6)) body = `${x1}${x2}${x6}0000${x3}${x4}${x5}`;
  else if (x6 === "3") body = `${x1}${x2}${x3}00000${x4}${x5}`;
  else if (x6 === "4") body = `${x1}${x2}${x3}${x4}00000${x5}`;
  else body = `${x1}${x2}${x3}${x4}${x5}0000${x6}`;
  return `${ns}${body}${check}`;
}

/**
 * Digits only → GTIN-14 with a valid check digit, or null (DB-07: the database CHECK requires exactly this).
 * 12/13/14 digits are left-padded, so UPC-A, EAN-13 and GTIN-14 scans share a cache row. 8 digits are UPC-E
 * (expanded to UPC-A) when that reading has a valid check digit, else EAN-8.
 */
export function normalizeGtin(raw: string): string | null {
  const d = raw.replace(/\D/g, "");
  if (d.length === 8) {
    const upcA = expandUpcE(d)?.padStart(14, "0");
    if (upcA && gtinCheckDigitOk(upcA)) return upcA;
  } else if (![12, 13, 14].includes(d.length)) {
    return null;
  }
  const g = d.padStart(14, "0");
  return gtinCheckDigitOk(g) ? g : null;
}

/** The code Open Food Facts indexes: EAN-13 (or EAN-8 for short codes). */
export function offCode(gtin14: string): string {
  const stripped = gtin14.replace(/^0+/, "");
  return stripped.length <= 8 ? stripped.padStart(8, "0") : stripped.padStart(13, "0");
}

export type OffProduct = {
  name: string;
  brand: string | null;
  servingSize: string | null;
  calories: number | null;
  nutrition: Record<string, number | string> | null;
  ingredients: string | null;
  allergens: Allergen[];
  mayContain: Allergen[];
  healthScore: string | null;
  imageUrl: string | null;
  categoryGuess: string;
  raw: unknown;
};

/** Open Food Facts categories_tags → our item category (best effort). */
export function guessCategory(tags: string[] | null | undefined): string {
  const t = (tags ?? []).join(" ");
  const rules: [RegExp, string][] = [
    [/frozen/, "frozen"],
    [/breakfast-cereals|cereals|pastas|rices|canned|condiments|sauces|spreads|baking|flours|oils/, "pantry"],
    [/snacks|chips|crisps|biscuits|cookies|candies|confectioner|chocolates/, "snacks"],
    [/beverages|drinks|juices|sodas|waters|coffees|teas/, "beverages"],
    [/dairies|milks|cheeses|yogurts|butters|eggs/, "dairy"],
    [/breads|bakery|pastries/, "bakery"],
    [/seafood|fishes|fish/, "seafood"],
    [/meats|poultry|sausages/, "meat"],
    [/fruits|vegetables|fresh/, "produce"],
  ];
  for (const [re, cat] of rules) if (re.test(t)) return cat;
  return "other";
}

const round = (n: unknown, f = 1) => (typeof n === "number" && Number.isFinite(n) ? Math.round(n * f * 100) / 100 : undefined);

/** Maps an OFF v2 product payload to our product columns. */
export function mapOffProduct(payload: { product?: Record<string, unknown> }): OffProduct | null {
  const p = payload.product;
  const name = typeof p?.product_name === "string" ? p.product_name.trim() : "";
  if (!p || !name) return null;
  const n = (p.nutriments ?? {}) as Record<string, number>;
  const perServing = n["energy-kcal_serving"] != null;
  const suffix = perServing ? "_serving" : "_100g";
  const nutrition: Record<string, number | string> = { basis: perServing ? "serving" : "100g" };
  const fields: [string, string, number][] = [
    ["fat", "fat_g", 1], ["saturated-fat", "sat_fat_g", 1], ["sodium", "sodium_mg", 1000], ["carbohydrates", "carbs_g", 1],
    ["sugars", "sugar_g", 1], ["proteins", "protein_g", 1], ["fiber", "fiber_g", 1],
  ];
  for (const [k, out, f] of fields) {
    const v = round(n[k + suffix], f);
    if (v !== undefined) nutrition[out] = v;
  }
  const brands = typeof p.brands === "string" ? p.brands.split(",")[0].trim() : "";
  return {
    name: name.slice(0, 200),
    brand: brands || null,
    servingSize: typeof p.serving_size === "string" ? p.serving_size : null,
    calories: round(n["energy-kcal" + suffix]) ?? null,
    nutrition: Object.keys(nutrition).length > 1 ? nutrition : null,
    ingredients: typeof p.ingredients_text === "string" && p.ingredients_text.trim() ? p.ingredients_text.trim() : null,
    allergens: allergensFromOffTags(p.allergens_tags as string[]),
    mayContain: allergensFromOffTags(p.traces_tags as string[]),
    healthScore: typeof p.nutriscore_grade === "string" && /^[a-e]$/.test(p.nutriscore_grade) ? p.nutriscore_grade.toUpperCase() : null,
    imageUrl: typeof p.image_front_url === "string" ? p.image_front_url : null,
    categoryGuess: guessCategory(p.categories_tags as string[]),
    raw: payload,
  };
}

export const openFoodFacts = {
  /** GET world.openfoodfacts.org/api/v2/product/{code}.json (fixed host; code is digits only). null = not found. */
  async lookup(gtin14: string): Promise<OffProduct | null> {
    const code = offCode(gtin14);
    let res: Response;
    try {
      res = await http.fetch(`https://world.openfoodfacts.org/api/v2/product/${code}.json`, {
        headers: { "User-Agent": USER_AGENT(), Accept: "application/json" },
        signal: AbortSignal.timeout(5000),
        redirect: "error",
      });
    } catch {
      throw new AppError(502, "UPSTREAM_UNAVAILABLE", "Product database is unreachable, try again");
    }
    if (res.status === 404) return null;
    if (!res.ok) throw new AppError(502, "UPSTREAM_UNAVAILABLE", "Product database is unreachable, try again");
    const body = (await res.json()) as { status?: number; product?: Record<string, unknown> };
    if (body.status !== 1) return null;
    return mapOffProduct(body);
  },
};
