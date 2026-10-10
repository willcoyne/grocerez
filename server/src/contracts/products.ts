import { z } from "zod";
import { Allergen } from "./dietary.js";

// Exactly one of qrUrl (the URL in a SmartLabel QR code) or gtin (UPC/EAN barcode digits).
// qrUrl's host is checked against the SmartLabel allowlist by the service (400 VALIDATION_ERROR if not allowed).
export const ScanProductBody = z
  .object({
    qrUrl: z.string().trim().min(1).max(2048).optional(),
    gtin: z.string().trim().regex(/^\d{8,14}$/, "gtin must be 8-14 digits").optional(),
  })
  .strict()
  .refine((b) => (b.qrUrl === undefined) !== (b.gtin === undefined), "Send exactly one of qrUrl or gtin");
export type ScanProductBody = z.infer<typeof ScanProductBody>;

export const Product = z.object({
  id: z.uuid(),
  itemId: z.uuid().nullable(), // generic catalog item ("Honey Nut Cheerios" -> Cheerios)
  gtin: z.string().nullable(),
  smartlabelUrl: z.string().nullable(),
  brand: z.string().nullable(),
  name: z.string(),
  servingSize: z.string().nullable(),
  caloriesPerServing: z.number().nullable(),
  nutrition: z.record(z.string(), z.number()), // {fat_g, sat_fat_g, sodium_mg, carbs_g, sugar_g, protein_g, ...}
  ingredients: z.string().nullable(),
  allergens: z.array(Allergen), // "contains"
  mayContain: z.array(Allergen),
  healthScore: z.string().nullable(), // Nutri-Score letter A-E (Open Food Facts only)
  imageUrl: z.string().nullable(), // presigned S3 GET URL (1 hour), never the key
  source: z.enum(["smartlabel", "openfoodfacts", "manual"]),
  fetchedAt: z.iso.datetime(),
});
export type Product = z.infer<typeof Product>;
