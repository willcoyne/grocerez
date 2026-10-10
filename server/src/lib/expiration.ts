// Per-category shelf life in days (USDA FoodKeeper-based, see plan GAPS #13). Missing category = no estimate.
export const CATEGORY_SHELF_LIFE_DAYS: Record<string, number> = {
  produce: 7,
  dairy: 10,
  meat: 3,
  seafood: 2,
  bakery: 5,
  frozen: 120,
  pantry: 365,
  snacks: 90,
  beverages: 180,
};

const DAY_MS = 24 * 60 * 60 * 1000;

/** purchasedAt + item shelf life, else the category default. Returns null when there is no basis (e.g. household). */
export function estimateExpiration(
  item: { shelfLifeDays?: number | null; category?: string | null },
  purchasedAt: Date,
): Date | null {
  const days = item.shelfLifeDays ?? (item.category ? CATEGORY_SHELF_LIFE_DAYS[item.category] : undefined);
  if (days == null || days < 0) return null;
  return new Date(purchasedAt.getTime() + days * DAY_MS);
}
