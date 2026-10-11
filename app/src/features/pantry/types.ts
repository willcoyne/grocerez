import type { Allergen } from "@contracts/dietary";

export type PantryPhase = "closed" | "opening" | "zooming" | "shelves" | "closing" | "list";

/** The papers pinned on the pantry's right stile, top to bottom. The `list` phase flies to (and lifts) one of them. */
export type NoteKind = "list" | "me" | "week";

/** Shelf groups, top to bottom (infinite-shelves.jpg). */
export const SHELF_GROUPS = ["snacks", "ingredients", "produce", "fridge", "freezer"] as const;
export type ShelfGroup = (typeof SHELF_GROUPS)[number];

export type FoodKind =
  | "chips" // bag
  | "box" // cereal / crackers / cookies
  | "can"
  | "jar"
  | "bottle"
  | "carton" // milk / juice
  | "eggs"
  | "cheese"
  | "meat"
  | "fish"
  | "bread"
  | "fruit"
  | "veg"
  | "leafy"
  | "icecream"
  | "frozenbox"
  | "generic";

/** One cabinet row, flattened for the scene. */
export type PantryItem = {
  /** cabinet row id */
  id: string;
  itemId: string;
  name: string;
  brand: string | null;
  category: string | null;
  location: "fridge" | "freezer" | "pantry" | "other" | null;
  group: ShelfGroup;
  allergens: Allergen[];
  status: "in_stock" | "running_low";
  /** YYYY-MM-DD */
  expiresAt: string | null;
  caloriesPerServing: number | null;
  healthScore: string | null; // Nutri-Score letter a–e
  imageUrl: string | null;
  /** label ingredient text (null = no label scanned) */
  ingredients: string | null;
  /** serving size as printed, e.g. "30 g" */
  servingSize: string | null;
};

export type ShelfSection = { group: ShelfGroup; label: string; items: PantryItem[] };

export type PantryFilters = {
  /** hide items containing any of these allergens */
  excludeAllergens: Allergen[];
  /** only items safe for me (none of my allergens) */
  safeForMe: boolean;
  /** Nutri-Score letters to keep; empty = all */
  healthScores: string[];
  /** max calories per serving; null = any */
  maxCalories: number | null;
  groups: ShelfGroup[]; // empty = all
  expiringSoon: boolean; // within 3 days
  runningLow: boolean;
};

export const EMPTY_FILTERS: PantryFilters = {
  excludeAllergens: [],
  safeForMe: false,
  healthScores: [],
  maxCalories: null,
  groups: [],
  expiringSoon: false,
  runningLow: false,
};
