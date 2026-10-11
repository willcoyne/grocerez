import { z } from "zod";

/** Matches the DB enum `allergen` (9 major U.S. allergens + gluten). */
export const ALLERGENS = ["milk", "eggs", "fish", "shellfish", "tree_nuts", "peanuts", "wheat", "soy", "sesame", "gluten"] as const;
export const Allergen = z.enum(ALLERGENS);
export type Allergen = z.infer<typeof Allergen>;

/** Matches the CHECK on user_diets.diet. */
export const DIETS = [
  "vegetarian", "vegan", "pescatarian", "keto", "halal", "kosher", "low_sodium", "dairy_free", "gluten_free",
] as const;
export const Diet = z.enum(DIETS);
export type Diet = z.infer<typeof Diet>;

export const Dietary = z.object({
  diets: z.array(Diet).max(DIETS.length),
  allergens: z.array(Allergen).max(ALLERGENS.length),
});
export type Dietary = z.infer<typeof Dietary>;

export const DietaryBody = Dietary;
