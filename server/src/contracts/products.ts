import { z } from "zod";
import { Category } from "./common.js";
import { Allergen } from "./dietary.js";
import { ItemRef } from "./items.js";

/** Exactly one of qrUrl (SmartLabel QR link) or gtin (UPC/EAN barcode digits). */
export const ScanBody = z
  .object({
    qrUrl: z.string().trim().min(1).max(2048).optional(),
    gtin: z.string().trim().regex(/^\d{8,14}$/, "must be 8–14 digits").optional(),
  })
  .strict()
  .refine((b) => (b.qrUrl ? 1 : 0) + (b.gtin ? 1 : 0) === 1, { message: "Send exactly one of qrUrl or gtin" });
export type ScanBody = z.infer<typeof ScanBody>;

export const ProductSource = z.enum(["smartlabel", "openfoodfacts", "manual"]);

export const Product = z.object({
  id: z.uuid(),
  itemId: z.uuid(),
  /** The generic catalog item this product counts as (e.g. a Honey Nut Cheerios box → Cheerios). */
  item: ItemRef,
  gtin: z.string().nullable(),
  smartlabelUrl: z.string().nullable(),
  brand: z.string().nullable(),
  name: z.string(),
  servingSize: z.string().nullable(),
  caloriesPerServing: z.number().nullable(),
  /** {basis: "serving"|"100g", fat_g, sat_fat_g, sodium_mg, carbs_g, sugar_g, protein_g, fiber_g} (keys present when known). */
  nutrition: z.record(z.string(), z.union([z.number(), z.string()])).nullable(),
  ingredients: z.string().nullable(),
  allergens: z.array(Allergen),
  mayContain: z.array(Allergen),
  /** Nutri-Score letter A–E when known. */
  healthScore: z.string().nullable(),
  imageUrl: z.string().nullable(),
  source: ProductSource,
  fetchedAt: z.string(),
});
export type Product = z.infer<typeof Product>;

/** POST /products/lookup (backend/13): exactly one of name or gtin; ZIP falls back to the user's profile. */
export const LookupBody = z
  .object({
    name: z.string().trim().min(2).max(120).optional(),
    gtin: z.string().trim().regex(/^\d{8,14}$/, "must be 8–14 digits").optional(),
    zipCode: z.string().trim().regex(/^\d{5}$/, "must be a 5-digit ZIP code").optional(),
    /** Cabinet row (in the caller's group) to give an estimated expiration date. */
    groupId: z.uuid().optional(),
    cabinetItemId: z.uuid().optional(),
    /** Ignore a cached result younger than 30 days. */
    refresh: z.boolean().optional(),
  })
  .strict()
  .refine((b) => (b.name ? 1 : 0) + (b.gtin ? 1 : 0) === 1, { message: "Send exactly one of name or gtin" })
  .refine((b) => !b.cabinetItemId || b.groupId, { message: "cabinetItemId needs groupId" });
export type LookupBody = z.infer<typeof LookupBody>;

/** A web page or dataset record a fact came from. Every URL was returned by one of the agent's tools. */
export const Citation = z.object({ url: z.string(), title: z.string(), quote: z.string() });
export type Citation = z.infer<typeof Citation>;

export const StoragePlace = z.enum(["pantry", "fridge", "freezer"]);

export const ShelfLifeEntry = z.object({
  storage: StoragePlace,
  opened: z.boolean(),
  minDays: z.number().int().nullable(),
  maxDays: z.number().int(),
});

/** What the agent returns (and the API returns under `result`). Unsourced facts are null / empty. */
export const ProductFacts = z.object({
  product: z.object({
    name: z.string(),
    brand: z.string().nullable(),
    /** Generic grocery name used to link the catalog item ("Milk"). */
    genericName: z.string(),
    category: Category.nullable(),
  }),
  shelfLife: z
    .object({
      /** Longest safe time, in days, in the usual storage place, unopened. */
      maxDays: z.number().int(),
      usualStorage: StoragePlace,
      entries: z.array(ShelfLifeEntry),
      notes: z.string().nullable(),
      /**
       * The expiration estimate: days after purchase by which this product, bought at a store and stored the usual
       * way, is most likely expired (time already spent in distribution and typical opening taken into account).
       */
      expiresAfterDays: z.number().int().nullable(),
      /** One sentence explaining expiresAfterDays. */
      expiresBasis: z.string().nullable(),
      sources: z.array(Citation),
    })
    .nullable(),
  price: z
    .object({
      typicalCents: z.number().int(),
      unit: z.string(),
      area: z.string(),
      asOf: z.string(),
      /** Always false for now: BLS regional averages, not prices at a specific store. */
      local: z.boolean(),
      sources: z.array(Citation),
    })
    .nullable(),
  allergens: z.object({
    contains: z.array(Allergen),
    mayContain: z.array(Allergen),
    basis: z.string(),
    sources: z.array(Citation),
  }),
});
export type ProductFacts = z.infer<typeof ProductFacts>;

/**
 * Days after purchase used for an ESTIMATED expiration date ("most likely expired by"). In the usual storage place:
 * the agent's researched expiresAfterDays (already checked against the sources by verifyFacts). Stored somewhere
 * else (milk put in the freezer): that place's unopened maximum. Without an estimate: the cautious end of the
 * unopened range. Shared by the API and the app.
 */
export function expirationDays(shelfLife: NonNullable<ProductFacts["shelfLife"]>, place?: string | null): number {
  const unopened = (p: string | null | undefined) => shelfLife.entries.find((e) => e.storage === p && !e.opened);
  const elsewhere = place && place !== shelfLife.usualStorage ? unopened(place) : undefined;
  if (elsewhere) return elsewhere.maxDays;
  if (shelfLife.expiresAfterDays) return shelfLife.expiresAfterDays;
  const entry = unopened(shelfLife.usualStorage);
  return entry ? (entry.minDays ?? entry.maxDays) : shelfLife.maxDays;
}

export const ProductLookup = z.object({
  itemId: z.uuid().nullable(),
  item: ItemRef.nullable(),
  zipCode: z.string().nullable(),
  result: ProductFacts,
  model: z.string(),
  estimate: z.literal(true),
  cached: z.boolean(),
  fetchedAt: z.string(),
  /** Set when cabinetItemId was sent and its expiration was filled in (YYYY-MM-DD). */
  cabinetExpiresAt: z.string().nullable(),
});
export type ProductLookup = z.infer<typeof ProductLookup>;
