import { z } from "zod";

// Recipe suggestions (POST /recipes/suggest) were retired by the Pantry Agent's cited web recipes (challenge 01 §11).

// ─── Prices ──────────────────────────────────────────────────────────────────

export const PricesBody = z.object({ zipCode: z.string().regex(/^\d{5}$/, "must be a 5-digit ZIP code").optional() });

export const ClaudePrices = z.object({
  prices: z
    .array(
      z.object({
        itemId: z.string(),
        itemName: z.string(),
        lowCents: z.number().int(),
        highCents: z.number().int(),
        typicalCents: z.number().int().nullable(),
        unit: z.string().max(100).nullable(),
        sourceUrls: z.array(z.string().max(2000)).max(10),
      }),
    )
    .max(200),
});

export const PriceItem = z.object({
  itemId: z.uuid(),
  name: z.string(),
  lowCents: z.number().int(),
  highCents: z.number().int(),
  typicalCents: z.number().int().nullable(),
  unit: z.string().nullable(),
  sources: z.array(z.string()),
  /** Always true: label these as "estimate" in the app. */
  estimate: z.literal(true),
  cached: z.boolean(),
  fetchedAt: z.string(),
});

export const PricesResponse = z.object({
  zipCode: z.string(),
  items: z.array(PriceItem),
  /** List items without a usable estimate. */
  missingItemIds: z.array(z.uuid()),
  totalLowCents: z.number().int(),
  totalHighCents: z.number().int(),
});
export type PricesResponse = z.infer<typeof PricesResponse>;
