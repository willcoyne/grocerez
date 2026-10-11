import { z } from "zod";
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
