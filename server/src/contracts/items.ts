import { z } from "zod";
import { Category } from "./common.js";
import { Allergen } from "./dietary.js";

export const Item = z.object({
  id: z.uuid(),
  name: z.string(),
  normalizedName: z.string(),
  category: z.string().nullable(),
  defaultAllergens: z.array(Allergen),
  shelfLifeDays: z.number().int().nullable(),
});
export type Item = z.infer<typeof Item>;

export const ItemSearchQuery = z.object({ q: z.string().max(200) });

export const MatchKind = z.enum(["exact", "suggested", "none"]);
/**
 * exact: results = [the item]. suggested: results[0] is "Did you mean…?", the rest are other similar items.
 * none: results are "similar" options (possibly empty); offer to create a new item.
 * related: items that mean something close (Akamai embeddings), e.g. "oreo" → Cookies, Chips Ahoy.
 * Never repeats an item from `results`; empty when embeddings aren't configured or the lookup fails.
 */
export const ItemSearchResponse = z.object({ match: MatchKind, results: z.array(Item), related: z.array(Item) });
export type ItemSearchResponse = z.infer<typeof ItemSearchResponse>;

export const CreateItemBody = z.object({
  name: z.string().trim().min(1).max(200),
  category: Category.optional(),
  /** The user confirmed "Did you mean X?": store `name` as an alias of item `aliasOf`. */
  aliasOf: z.uuid().optional(),
});
export type CreateItemBody = z.infer<typeof CreateItemBody>;

/** Small item summary embedded in preference / cabinet / list rows. */
export const ItemRef = z.object({ id: z.uuid(), name: z.string(), category: z.string().nullable() });
export type ItemRef = z.infer<typeof ItemRef>;
