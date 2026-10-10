import { z } from "zod";
import { AppError } from "../../lib/errors.js";
import { FETCH_TIMEOUT_MS, USER_AGENT, readCapped, safeImageUrl, upstreamError, type ProductData } from "./common.js";
import { mapAllergens } from "../../lib/allergens.js";

const FIELDS = [
  "code", "product_name", "brands", "serving_size", "nutriments", "ingredients_text", "allergens_tags", "traces_tags",
  "nutriscore_grade", "image_front_url", "categories_tags",
].join(",");

const str = z.string().nullish().catch(null);
const tags = z.array(z.string()).nullish().catch(null);
const OffResponse = z.object({
  status: z.coerce.number().optional(),
  product: z
    .object({
      code: str,
      product_name: str,
      brands: str,
      serving_size: str,
      nutriments: z.record(z.string(), z.unknown()).nullish().catch(null),
      ingredients_text: str,
      allergens_tags: tags,
      traces_tags: tags,
      nutriscore_grade: str,
      image_front_url: str,
      categories_tags: tags,
    })
    .nullish(),
});
type OffProduct = NonNullable<z.infer<typeof OffResponse>["product"]>;

// OFF nutriment name -> our key. OFF stores everything in grams, so `_mg` keys get multiplied by 1000.
const NUTRIENTS: [string, string][] = [
  ["fat", "fat_g"],
  ["saturated-fat", "sat_fat_g"],
  ["trans-fat", "trans_fat_g"],
  ["cholesterol", "cholesterol_mg"],
  ["sodium", "sodium_mg"],
  ["carbohydrates", "carbs_g"],
  ["fiber", "fiber_g"],
  ["sugars", "sugar_g"],
  ["added-sugars", "added_sugar_g"],
  ["proteins", "protein_g"],
];

const num = (v: unknown) => {
  const n = typeof v === "string" ? parseFloat(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
};
const blank = (s: string | null | undefined) => (s && s.trim() ? s.trim() : null);
// "en:tree-nuts" -> "tree nuts"
const tagText = (t: string[] | null | undefined) => (t ?? []).map((x) => x.replace(/^\w+:/, "").replace(/-/g, " ")).join(", ");

export function mapOffProduct(p: OffProduct, gtin: string): ProductData | null {
  const name = blank(p.product_name);
  if (!name) return null;
  const n = p.nutriments ?? {};
  // Per serving when OFF has it, otherwise per 100 g.
  const perServing = num(n["energy-kcal_serving"]) != null;
  const suffix = perServing ? "_serving" : "_100g";
  const nutrition: Record<string, number> = {};
  for (const [off, key] of NUTRIENTS) {
    const v = num(n[off + suffix]);
    if (v != null) nutrition[key] = key.endsWith("_mg") ? Math.round(v * 1000 * 100) / 100 : v;
  }
  return {
    source: "openfoodfacts",
    name,
    brand: blank(p.brands?.split(",")[0]),
    gtin: blank(p.code) ?? gtin,
    servingSize: perServing ? blank(p.serving_size) : n["energy-kcal_100g"] != null ? "100 g" : blank(p.serving_size),
    caloriesPerServing: num(n["energy-kcal" + suffix]),
    nutrition,
    ingredients: blank(p.ingredients_text),
    allergens: mapAllergens(tagText(p.allergens_tags)),
    mayContain: mapAllergens(tagText(p.traces_tags)),
    healthScore: /^[a-e]$/i.test(p.nutriscore_grade ?? "") ? p.nutriscore_grade!.toUpperCase() : null,
    imageUrl: safeImageUrl(p.image_front_url),
    categoriesTags: p.categories_tags ?? [],
  };
}

export const GTIN_RE = /^\d{8,14}$/;

/** Looks up a barcode on Open Food Facts. Returns null when OFF doesn't know it (or has no product name). */
export async function lookupOpenFoodFacts(
  gtin: string,
  deps: { fetch?: typeof fetch; timeoutMs?: number } = {},
): Promise<{ product: ProductData; raw: unknown } | null> {
  if (!GTIN_RE.test(gtin)) throw new AppError(400, "VALIDATION_ERROR", "gtin must be 8-14 digits");
  const url = `https://world.openfoodfacts.org/api/v2/product/${gtin}.json?fields=${FIELDS}`;
  const signal = AbortSignal.timeout(deps.timeoutMs ?? FETCH_TIMEOUT_MS);
  let raw: unknown;
  try {
    const res = await (deps.fetch ?? fetch)(url, { signal, headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
    if (res.status === 404) {
      await res.body?.cancel();
      return null;
    }
    if (!res.ok) {
      await res.body?.cancel();
      throw upstreamError(`Open Food Facts returned ${res.status}`);
    }
    raw = JSON.parse(await readCapped(res));
  } catch (err) {
    if (err instanceof AppError) throw err;
    throw upstreamError(signal.aborted ? "Open Food Facts timed out" : "Open Food Facts request failed");
  }
  const parsed = OffResponse.safeParse(raw);
  if (!parsed.success) throw upstreamError("Unexpected Open Food Facts response");
  if (parsed.data.status === 0 || !parsed.data.product) return null;
  const product = mapOffProduct(parsed.data.product, gtin);
  return product && { product, raw };
}
