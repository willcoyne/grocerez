import { z } from "zod";
import { Item } from "./items.js";

// Matches the database `allergen` enum (plan/database/02-users).
export const Allergen = z.enum([
  "milk", "eggs", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soy", "sesame", "gluten",
]);
export type Allergen = z.infer<typeof Allergen>;

// ---- Requests (POST /groups/:groupId/recipes/suggest, POST /groups/:groupId/shopping-list/prices)

// Both bodies are optional: a POST with no body (req.body undefined) means "all defaults".
const orEmpty = (v: unknown) => v ?? {};

export const RecipeSuggestRequest = z.preprocess(
  orEmpty,
  z.object({
    maxRecipes: z.number().int().min(1).max(5).default(3),
    mustUseExpiring: z.boolean().default(true),
  }),
);
export type RecipeSuggestRequest = z.infer<typeof RecipeSuggestRequest>;

export const PriceEstimateRequest = z.preprocess(
  orEmpty,
  z.object({
    zipCode: z.string().regex(/^\d{5}$/, "zipCode must be a 5-digit US ZIP code").optional(),
  }),
);
export type PriceEstimateRequest = z.infer<typeof PriceEstimateRequest>;

// ---- What Claude must return. Plain types only (structured outputs ignore numeric bounds);
// range and safety checks happen in modules/ai after parsing. `.strict()` rejects extra fields.

export const Recipe = z.strictObject({
  title: z.string().min(1),
  summary: z.string(),
  minutes: z.number().int(),
  servings: z.number().int(),
  usesCabinetItems: z.array(z.string()),
  missingItems: z.array(z.string()),
  steps: z.array(z.string()),
  allergenWarnings: z.array(z.string()),
});
export type Recipe = z.infer<typeof Recipe>;

export const RecipeModelOutput = z.strictObject({ recipes: z.array(Recipe) });

export const PriceModelItem = z.strictObject({
  itemId: z.string(),
  itemName: z.string(),
  lowCents: z.number().int(),
  typicalCents: z.number().int(),
  highCents: z.number().int(),
  unit: z.string(),
  sourceUrls: z.array(z.string()),
});
export const PriceModelOutput = z.strictObject({ prices: z.array(PriceModelItem) });

// ---- Responses

// missingItemMatches: each missingItems name resolved through /items/search logic (exact or close match), item null if none.
// "Add missing to list" = POST /groups/:groupId/shopping-list {itemId} for each non-null item.
export const SuggestedRecipe = Recipe.extend({
  missingItemMatches: z.array(z.object({ name: z.string(), item: Item.nullable() })),
});
export type SuggestedRecipe = z.infer<typeof SuggestedRecipe>;
export const RecipeSuggestResponse = z.array(SuggestedRecipe);

export const PricedItem = PriceModelItem.extend({ estimate: z.literal(true) });
export type PricedItem = z.infer<typeof PricedItem>;

export const PriceEstimateResponse = z.object({
  items: z.array(PricedItem),
  totalLowCents: z.number().int(),
  totalHighCents: z.number().int(),
  /** List items with no usable estimate (model skipped them or returned impossible numbers). Not in the totals. */
  unpricedItemIds: z.array(z.string()),
});
export type PriceEstimateResponse = z.infer<typeof PriceEstimateResponse>;
