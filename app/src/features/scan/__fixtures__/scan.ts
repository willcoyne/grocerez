import type { Product } from "@contracts/products";
import type { ShoppingListItem } from "@contracts/shoppingList";

import { testGroup } from "@/test-utils";

export const g = testGroup.id;
export const CHEERIOS_ITEM = { id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", name: "Cheerios", category: "pantry" };

export const product: Product = {
  id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  itemId: CHEERIOS_ITEM.id,
  item: CHEERIOS_ITEM,
  gtin: "00016000275287",
  smartlabelUrl: null,
  brand: "General Mills",
  name: "Cheerios Original",
  servingSize: "1.5 cup (39 g)",
  caloriesPerServing: 140,
  nutrition: { basis: "serving", fat_g: 2.5, sat_fat_g: 0.5, sodium_mg: 190, carbs_g: 29, sugar_g: 2, protein_g: 5, fiber_g: 4 },
  ingredients: "Whole Grain Oats, Corn Starch, Sugar, Salt, Tripotassium Phosphate, Vitamin E.",
  allergens: ["wheat"],
  mayContain: ["peanuts"],
  healthScore: "a",
  imageUrl: null,
  source: "smartlabel",
  fetchedAt: "2026-10-10T00:00:00.000Z",
};

export function listRow(over: Partial<ShoppingListItem> = {}): ShoppingListItem {
  return {
    id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    groupId: g,
    itemId: CHEERIOS_ITEM.id,
    item: CHEERIOS_ITEM,
    reason: "preference",
    wantedBy: [],
    quantityText: "1 box",
    allergenFlags: [],
    checked: false,
    checkedBy: null,
    checkedAt: null,
    scannedProductId: null,
    addedBy: null,
    createdAt: "",
    updatedAt: "",
    ...over,
  };
}

/** Routes every scan screen needs for household allergens. */
export function baseRoutes(opts: { list?: ShoppingListItem[]; myAllergens?: string[]; flags?: ShoppingListItem["allergenFlags"] } = {}) {
  return {
    [`GET /groups/${g}`]: () => ({ ...testGroup, members: [] }),
    [`GET /groups/${g}/shopping-list`]: () => opts.list ?? [],
    "GET /me/dietary": () => ({ diets: [], allergens: opts.myAllergens ?? [] }),
  };
}
