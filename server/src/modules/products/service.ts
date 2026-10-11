import { prisma } from "../../db.js";
import type { Allergen } from "../../contracts/dietary.js";
import type { Product, ScanBody } from "../../contracts/products.js";
import { AppError, badRequest } from "../../lib/errors.js";
import { http, USER_AGENT } from "../../lib/http.js";
import { images } from "../../lib/images.js";
import { logger } from "../../lib/logger.js";
import { s3 } from "../../lib/s3.js";
import { normalizeGtin, openFoodFacts, type OffProduct } from "../../lib/openfoodfacts.js";
import { canonicalSmartLabelUrl, hasLabelData, parseSmartLabel, smartlabel } from "../../lib/smartlabel.js";
import { itemsService } from "../items/service.js";
import { productInclude, productsRepo } from "./repo.js";

export const CACHE_DAYS = 30;
const fresh = (fetchedAt: Date) => Date.now() - fetchedAt.getTime() < CACHE_DAYS * 24 * 3600 * 1000;

type Row = NonNullable<Awaited<ReturnType<typeof productsRepo.findById>>>;

const notFoundProduct = () => new AppError(404, "PRODUCT_NOT_FOUND", "We couldn't find data for that product");

function rawImageUrl(raw: unknown): string | null {
  const url = (raw as { product?: { image_front_url?: unknown } } | null)?.product?.image_front_url;
  return typeof url === "string" && url.startsWith("https://") ? url : null;
}

export async function toProduct(p: Row): Promise<Product> {
  return {
    id: p.id,
    itemId: p.itemId,
    item: { id: p.item.id, name: p.item.name, category: p.item.category },
    gtin: p.gtin,
    smartlabelUrl: p.smartlabelUrl,
    brand: p.brand,
    name: p.name,
    servingSize: p.servingSize,
    caloriesPerServing: p.caloriesPerServing == null ? null : Number(p.caloriesPerServing),
    nutrition: (p.nutrition ?? null) as Product["nutrition"],
    ingredients: p.ingredients,
    allergens: p.allergens as Allergen[],
    mayContain: p.mayContain as Allergen[],
    healthScore: p.healthScore,
    imageUrl: (await images.urlFor(p.imageS3Key)) ?? rawImageUrl(p.raw),
    source: p.source,
    fetchedAt: p.fetchedAt.toISOString(),
  };
}

/**
 * Link a product to a generic catalog item through the /items/search logic (exact hits only, in this order):
 * the full name; the brand (the catalog has brand items such as Cheerios, Oreos, Lay's); then every shorter
 * run of words, longest first and rightmost first ("Honey Nut Cheerios" → … → "Cheerios"). Failing that, the
 * full name's "suggested" match; otherwise a new item is created with the guessed category.
 */
export async function linkItem(name: string, category: string, createdBy: string | null, brand?: string | null): Promise<string> {
  const exact = async (q: string) => {
    const res = await itemsService.search(q).catch(() => null);
    return res?.match === "exact" ? res.results[0].id : null;
  };
  const full = await itemsService.search(name).catch(() => null);
  if (full?.match === "exact") return full.results[0].id;
  if (brand) {
    const hit = await exact(brand);
    if (hit) return hit;
  }
  const words = name.split(/\s+/).filter(Boolean).slice(0, 8);
  for (let len = words.length - 1; len >= 1; len--) {
    for (let start = words.length - len; start >= 0; start--) {
      const hit = await exact(words.slice(start, start + len).join(" "));
      if (hit) return hit;
    }
  }
  if (full?.match === "suggested") return full.results[0].id;
  const created = await itemsService.resolve(name, { category, createdBy, createIfMissing: true });
  if (!created) throw notFoundProduct();
  return created.item.id;
}

const IMAGE_HOSTS = new Set(["images.openfoodfacts.org", "static.openfoodfacts.org"]);
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

/**
 * backend/11 step 5: download the Open Food Facts image on the server and PutObject it under products/{id}.jpg,
 * so the app doesn't hotlink. Only https on the OFF image hosts, no redirects, ≤ 5 MB, image/* only.
 * No-op without S3 or when the product already has a copy. Failures are logged, never fail the scan.
 */
export async function copyProductImage(productId: string, imageUrl: string | null): Promise<void> {
  if (!imageUrl || !s3.isConfigured()) return;
  try {
    const url = new URL(imageUrl);
    if (url.protocol !== "https:" || !IMAGE_HOSTS.has(url.hostname)) return;
    const existing = await prisma.product.findUnique({ where: { id: productId }, select: { imageS3Key: true } });
    if (existing?.imageS3Key) return;
    const res = await http.fetch(url.toString(), { redirect: "error", headers: { "User-Agent": USER_AGENT() }, signal: AbortSignal.timeout(5000) });
    const type = res.headers.get("content-type") ?? "";
    if (!res.ok || !type.startsWith("image/")) return;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (bytes.byteLength === 0 || bytes.byteLength > MAX_IMAGE_BYTES) return;
    const key = `products/${productId}.jpg`;
    await s3.putObject(key, bytes, type);
    await prisma.product.update({ where: { id: productId }, data: { imageS3Key: key } });
  } catch (err) {
    logger.warn({ err: String(err), productId }, "product image copy failed");
  }
}

/** Runs after a product is saved (overridable in tests). */
export const productHooks = {
  afterSave: (productId: string, imageUrl: string | null): Promise<void> => copyProductImage(productId, imageUrl),
};

type ProductData = {
  gtin: string | null;
  smartlabelUrl: string | null;
  brand: string | null;
  name: string;
  servingSize: string | null;
  calories: number | null;
  nutrition: Record<string, number | string> | null;
  ingredients: string | null;
  allergens: Allergen[];
  mayContain: Allergen[];
  healthScore: string | null;
  source: "smartlabel" | "openfoodfacts";
  raw: unknown;
  categoryGuess: string;
  imageUrl: string | null;
};

/** Upsert into the global cache (matched by gtin, then smartlabel_url). */
async function save(d: ProductData, userId: string): Promise<Row> {
  const existing =
    (d.gtin ? await productsRepo.findByGtin(prisma, d.gtin) : null) ??
    (d.smartlabelUrl ? await productsRepo.findByUrl(prisma, d.smartlabelUrl) : null);
  const itemId = existing?.itemId ?? (await linkItem(d.name, d.categoryGuess, userId, d.brand));
  const data = {
    itemId,
    gtin: d.gtin ?? existing?.gtin ?? null,
    smartlabelUrl: d.smartlabelUrl ?? existing?.smartlabelUrl ?? null,
    brand: d.brand,
    name: d.name,
    servingSize: d.servingSize,
    caloriesPerServing: d.calories,
    nutrition: d.nutrition ?? undefined,
    ingredients: d.ingredients,
    allergens: d.allergens,
    mayContain: d.mayContain,
    healthScore: d.healthScore,
    source: d.source,
    raw: (d.raw ?? undefined) as object | undefined,
    fetchedAt: new Date(),
  };
  const row = existing ? await productsRepo.update(prisma, existing.id, data) : await productsRepo.create(prisma, data);
  await productHooks.afterSave(row.id, d.imageUrl);
  return (await productsRepo.findById(prisma, row.id)) ?? row;
}

const fromOff = (off: OffProduct, gtin: string, smartlabelUrl: string | null): ProductData => ({
  gtin, smartlabelUrl, brand: off.brand, name: off.name, servingSize: off.servingSize, calories: off.calories,
  nutrition: off.nutrition, ingredients: off.ingredients, allergens: off.allergens, mayContain: off.mayContain,
  healthScore: off.healthScore, source: "openfoodfacts", raw: off.raw, categoryGuess: off.categoryGuess, imageUrl: off.imageUrl,
});

async function scanGtin(gtin: string, userId: string, smartlabelUrl: string | null = null): Promise<Row> {
  const cached = await productsRepo.findByGtin(prisma, gtin);
  if (cached && fresh(cached.fetchedAt) && (!smartlabelUrl || cached.smartlabelUrl)) return cached;
  let off: OffProduct | null;
  try {
    off = await openFoodFacts.lookup(gtin);
  } catch (err) {
    if (cached) return cached; // stale beats nothing
    throw err;
  }
  if (!off) {
    if (cached) return cached;
    throw notFoundProduct();
  }
  return save(fromOff(off, gtin, smartlabelUrl), userId);
}

async function scanSmartLabel(qrUrl: string, userId: string): Promise<Row> {
  const url = canonicalSmartLabelUrl(qrUrl);
  const cached = await productsRepo.findByUrl(prisma, url);
  if (cached && fresh(cached.fetchedAt)) return cached;
  let page;
  try {
    page = await smartlabel.fetchPage(url);
  } catch (err) {
    if (err instanceof AppError && err.code === "HOST_NOT_ALLOWED") throw err;
    if (cached) return cached;
    if (err instanceof AppError) throw err;
    throw new AppError(502, "UPSTREAM_UNAVAILABLE", "SmartLabel page is unreachable, try again");
  }
  if (page.status >= 400) {
    if (cached) return cached;
    throw notFoundProduct();
  }
  const parsed = parseSmartLabel(page.body, page.finalUrl);
  const gtin = parsed.gtin ? normalizeGtin(parsed.gtin) : null;
  if (hasLabelData(parsed)) {
    return save(
      {
        gtin, smartlabelUrl: url, brand: parsed.brand, name: parsed.name!, servingSize: parsed.servingSize,
        calories: parsed.calories, nutrition: parsed.nutrition, ingredients: parsed.ingredients,
        allergens: parsed.allergens, mayContain: parsed.mayContain, healthScore: null, source: "smartlabel",
        raw: { template: parsed.template, url: page.finalUrl }, categoryGuess: "other", imageUrl: null,
      },
      userId,
    );
  }
  // Parsing found no label data but a GTIN: continue with the barcode path (step 3.5).
  if (gtin) return scanGtin(gtin, userId, url);
  if (cached) return cached;
  throw notFoundProduct();
}

export const productsService = {
  async scan(userId: string, body: ScanBody): Promise<Product> {
    if (body.gtin) {
      const gtin = normalizeGtin(body.gtin);
      if (!gtin) throw badRequest("Barcode must have 8, 12, 13 or 14 digits and a valid check digit", "VALIDATION_ERROR");
      return toProduct(await scanGtin(gtin, userId));
    }
    return toProduct(await scanSmartLabel(body.qrUrl!, userId));
  },

  async get(id: string): Promise<Product | null> {
    const row = await prisma.product.findUnique({ where: { id }, include: productInclude });
    return row ? toProduct(row) : null;
  },
};
