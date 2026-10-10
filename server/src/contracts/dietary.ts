import { Allergen as DbAllergen } from "@prisma/client";
import { z } from "zod";

// Same values as the DB enum `allergen` and the user_diets CHECK list (migration users_profile).
export const Allergen = z.enum(DbAllergen);
export const Diet = z.enum(["vegetarian", "vegan", "pescatarian", "keto", "halal", "kosher", "low_sodium", "dairy_free", "gluten_free"]);

export const Dietary = z.object({ diets: z.array(Diet), allergens: z.array(Allergen) });
export type Dietary = z.infer<typeof Dietary>;

// Duplicates are dropped rather than rejected.
export const PutDietaryBody = z
  .object({ diets: z.array(Diet).max(20), allergens: z.array(Allergen).max(20) })
  .strict()
  .transform((b) => ({ diets: [...new Set(b.diets)], allergens: [...new Set(b.allergens)] }));
