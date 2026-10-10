import { z } from 'zod';

// Mirrors the DB enums in plan/database/02-users. Move to server/src/contracts when the backend exists.
export const allergenValues = [
  'milk',
  'eggs',
  'fish',
  'shellfish',
  'tree_nuts',
  'peanuts',
  'wheat',
  'soy',
  'sesame',
  'gluten',
] as const;

export const dietValues = [
  'vegetarian',
  'vegan',
  'pescatarian',
  'keto',
  'halal',
  'kosher',
  'low_sodium',
  'dairy_free',
  'gluten_free',
] as const;

export const AllergenSchema = z.enum(allergenValues);
export const DietSchema = z.enum(dietValues);
export type Allergen = z.infer<typeof AllergenSchema>;
export type Diet = z.infer<typeof DietSchema>;

export const DietarySchema = z.object({ diets: z.array(DietSchema), allergens: z.array(AllergenSchema) });
export type Dietary = z.infer<typeof DietarySchema>;
