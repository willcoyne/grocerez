import { z } from "zod";
import { Allergen } from "./dietary.js";

export const CATEGORIES = ["produce", "dairy", "meat", "seafood", "bakery", "pantry", "frozen", "snacks", "beverages", "household", "other"] as const;
export const Category = z.enum(CATEGORIES);

export const Item = z.object({
  id: z.uuid(),
  name: z.string(),
  category: Category.nullable(),
  defaultAllergens: z.array(Allergen),
  shelfLifeDays: z.number().int().nullable(),
});
export type Item = z.infer<typeof Item>;

// levenshtein() in fuzzystrmatch refuses inputs over 255 chars, so names stay well under that.
const name = z.string().trim().min(1).max(100);

export const ItemSearchQuery = z.object({ q: name });
export const ItemSearchResponse = z.object({ match: z.enum(["exact", "suggested", "none"]), results: z.array(Item) });
export type ItemSearchResponse = z.infer<typeof ItemSearchResponse>;

export const CreateItemBody = z.object({ name, category: Category.optional(), aliasOf: z.uuid().optional() }).strict();
export type CreateItemBody = z.infer<typeof CreateItemBody>;
