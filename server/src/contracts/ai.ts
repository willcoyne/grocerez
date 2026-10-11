import { z } from "zod";

// ─── Recipes ─────────────────────────────────────────────────────────────────

export const SuggestRecipesBody = z.object({
  maxRecipes: z.number().int().min(1).max(5).default(3),
  mustUseExpiring: z.boolean().default(true),
});
export type SuggestRecipesBody = z.infer<typeof SuggestRecipesBody>;

/** What Claude must return (structured output). Validated again with zod. */
export const ClaudeRecipes = z.object({
  recipes: z
    .array(
      z.object({
        title: z.string().min(1).max(200),
        summary: z.string().max(1000),
        minutes: z.number().int().min(1).max(1440),
        servings: z.number().int().min(1).max(50),
        ingredients: z.array(z.string().min(1).max(200)).min(1).max(40),
        usesCabinetItems: z.array(z.string().max(200)).max(40),
        missingItems: z.array(z.string().min(1).max(200)).max(30),
        steps: z.array(z.string().min(1).max(1000)).min(1).max(30),
        allergenWarnings: z.array(z.string().max(300)).max(20),
      }),
    )
    .max(10),
});

export const Recipe = z.object({
  title: z.string(),
  summary: z.string(),
  minutes: z.number().int(),
  servings: z.number().int(),
  ingredients: z.array(z.string()),
  usesCabinetItems: z.array(z.string()),
  /** Cabinet items expiring within 3 days that this recipe uses (computed by the server). */
  usesExpiring: z.array(z.string()),
  /** Mapped to the catalog via /items/search logic; itemId null = no catalog match (the app can POST /items first). */
  missingItems: z.array(
    z.object({ name: z.string(), itemId: z.uuid().nullable(), itemName: z.string().nullable(), match: z.enum(["exact", "suggested", "none"]) }),
  ),
  steps: z.array(z.string()),
  allergenWarnings: z.array(z.string()),
});
export type Recipe = z.infer<typeof Recipe>;

// ─── Prices ──────────────────────────────────────────────────────────────────

export const PricesBody = z.object({ zipCode: z.string().regex(/^\d{5}$/, "must be a 5-digit ZIP code").optional() });

export const PriceItem = z.object({
  itemId: z.uuid(),
  name: z.string(),
  lowCents: z.number().int(),
  highCents: z.number().int(),
  typicalCents: z.number().int().nullable(),
  unit: z.string().nullable(),
  sources: z.array(z.string()),
  /**
   * regional_average: based on a BLS average retail price for the ZIP's census region (sources = data.bls.gov series).
   * ai_estimate: the model's typical US supermarket price, no source (items BLS doesn't track).
   */
  basis: z.enum(["regional_average", "ai_estimate"]),
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
