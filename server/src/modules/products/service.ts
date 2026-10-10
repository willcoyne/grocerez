import type { CATEGORIES } from "../../contracts/items.js";
import type { Product, ScanProductBody } from "../../contracts/products.js";
import { AppError } from "../../lib/errors.js";
import { logger } from "../../lib/logger.js";
import { presignGet, putObject } from "../../lib/s3.js";
import * as items from "../items/service.js";
import { CACHE_MS, normGtin, stripControl, type ProductData } from "./common.js";
import { fetchProductImage } from "./image.js";
import { lookupOpenFoodFacts } from "./openFoodFacts.js";
import { productsRepo, type ProductRow } from "./repo.js";
import { allowedSmartLabelUrl, fetchSmartLabelPage, parseSmartLabel } from "./smartlabel.js";

export { CACHE_MS };
const RAW_HTML_CHARS = 100_000; // enough of the page to debug a parser miss without storing 2 MB per row

type Category = (typeof CATEGORIES)[number];
type Fetched ={ data: ProductData; raw: unknown };

export async function scan(body: ScanProductBody, userId: string): Promise<Product> {
  if (body.qrUrl) {
    const url = allowedSmartLabelUrl(body.qrUrl);
    if (!url) throw new AppError(400, "VALIDATION_ERROR", "qrUrl is not a SmartLabel URL");
    const key = url.toString();
    return cached(await productsRepo.byUrl(key), () => fromSmartLabel(key), key, userId);
  }
  const gtin = body.gtin!;
  return cached(await productsRepo.byGtin(normGtin(gtin)), () => fromOpenFoodFacts(gtin), null, userId);
}

/** Serves a row younger than 30 days; otherwise refetches. If the refetch fails upstream, a stale row beats an error. */
async function cached(row: ProductRow | null, fetchFresh: () => Promise<Fetched>, url: string | null, userId: string) {
  if (row && Date.now() - row.fetchedAt.getTime() < CACHE_MS) return toProduct(row);
  let fresh: Fetched;
  try {
    fresh = await fetchFresh();
  } catch (err) {
    if (row && err instanceof AppError && err.status === 502) return toProduct(row);
    throw err;
  }
  return toProduct(await save(fresh, url, userId));
}

async function fromSmartLabel(url: string): Promise<Fetched> {
  const page = await fetchSmartLabelPage(url);
  const { product, gtin } = parseSmartLabel(page.html);
  if (product) return { data: product, raw: { url: page.url, html: page.html.slice(0, RAW_HTML_CHARS) } };
  // Not a usable label page, but it named a barcode: fall back to Open Food Facts (step 3.5).
  if (gtin) return fromOpenFoodFacts(gtin);
  throw notFound();
}

async function fromOpenFoodFacts(gtin: string): Promise<Fetched> {
  const off = await lookupOpenFoodFacts(gtin);
  if (!off) throw notFound();
  // Keep OFF's code only if it is the same barcode we asked for (it may report a UPC-A as EAN-13).
  if (!off.product.gtin || normGtin(off.product.gtin) !== normGtin(gtin)) off.product.gtin = gtin;
  return { data: off.product, raw: off.raw };
}

const notFound = () => new AppError(404, "PRODUCT_NOT_FOUND", "No product data found for this code");

async function save(fetched: Fetched, url: string | null, userId: string): Promise<ProductRow> {
  // Upstream text is crowd-edited / page-controlled: no NULs or control characters reach Postgres.
  const { data, raw } = stripControl(fetched);
  if (data.gtin) data.gtin = normGtin(data.gtin);
  const existing = (data.gtin && (await productsRepo.byGtin(data.gtin))) || (url && (await productsRepo.byUrl(url))) || null;
  const itemId = existing?.itemId ?? (await linkItem(data, userId));
  let row = await productsRepo.save(data, url, itemId, raw);
  if (!row.imageS3Key && data.imageUrl) row = (await copyImage(row.id, data.imageUrl)) ?? row;
  return row;
}

/** Step 5: the product name through the /items/search logic; exact or suggested wins, otherwise a new catalog item. */
async function linkItem(data: ProductData, userId: string): Promise<string | null> {
  const name = data.name.trim().slice(0, 100);
  try {
    const found = await items.search(name);
    if (found.match !== "none") return found.results[0].id;
    return (await items.create({ name, category: guessCategory(data.categoriesTags) }, userId)).id;
  } catch (err) {
    if (err instanceof AppError && err.status === 400) return null; // name has no letters or digits
    throw err;
  }
}

// First matching rule wins; tags are checked most specific first (OFF lists broad tags before narrow ones).
// ponytail: keyword heuristic over OFF categories_tags; a real taxonomy map if categories turn out wrong often.
const CATEGORY_RULES: [RegExp, Category][] = [
  [/frozen/, "frozen"],
  [/seafood|fish|shrimp|tuna|salmon/, "seafood"],
  [/meat|poultry|chicken|beef|pork|sausage|ham\b|bacon/, "meat"],
  [/dair|milk|cheese|yogh?urt|butter|cream/, "dairy"],
  [/bread|bakery|pastr|cake|bagel|tortilla|bun/, "bakery"],
  [/snack|chips|crisps|cookie|biscuit|cand(y|ies)|confection|chocolate|cracker/, "snacks"],
  [/beverage|drink|juice|soda|water|coffee|tea\b/, "beverages"],
  [/fresh|^en:fruits$|^en:vegetables$/, "produce"],
  [/cereal|pasta|rice|sauce|condiment|spread|canned|soup|flour|sugar|oil|spice|legume|bean|noodle/, "pantry"],
];

export function guessCategory(tags: string[]): Category {
  for (const tag of [...tags].reverse()) {
    const t = tag.toLowerCase();
    if (t.startsWith("en:plant-based-foods")) continue; // "…-and-beverages" is on almost every food
    const rule = CATEGORY_RULES.find(([re]) => re.test(t));
    if (rule) return rule[1];
  }
  return "other";
}

/** backend/11 step 5: copy the photo to S3 so we don't hotlink. Best effort: a failed copy never fails the scan. */
async function copyImage(productId: string, imageUrl: string): Promise<ProductRow | null> {
  try {
    const { body, contentType } = await fetchProductImage(imageUrl);
    const key = `products/${productId}.jpg`;
    await putObject(key, body, contentType);
    return await productsRepo.setImageKey(productId, key);
  } catch (err) {
    logger.warn({ err, productId }, "product image copy failed");
    return null;
  }
}

export async function toProduct(row: ProductRow): Promise<Product> {
  return {
    id: row.id,
    itemId: row.itemId,
    gtin: row.gtin,
    smartlabelUrl: row.smartlabelUrl,
    brand: row.brand,
    name: row.name,
    servingSize: row.servingSize,
    caloriesPerServing: row.caloriesPerServing == null ? null : Number(row.caloriesPerServing),
    nutrition: (row.nutrition ?? {}) as Record<string, number>,
    ingredients: row.ingredients,
    allergens: row.allergens,
    mayContain: row.mayContain,
    healthScore: row.healthScore,
    imageUrl: row.imageS3Key ? await presignGet(row.imageS3Key) : null,
    source: row.source,
    fetchedAt: row.fetchedAt.toISOString(),
  };
}
