/**
 * Expiration estimates (backend/09). Packages don't carry their expiration date in SmartLabel/product data,
 * so a bought item's date is purchasedAt + items.shelf_life_days, falling back to a per-category default
 * (FoodKeeper-style). Household items (and unknown categories) get no date.
 */
export const CATEGORY_SHELF_LIFE_DAYS: Record<string, number | null> = {
  produce: 7,
  dairy: 10,
  meat: 3,
  seafood: 2,
  bakery: 5,
  frozen: 120,
  pantry: 365,
  snacks: 90,
  beverages: 180,
  household: null,
  other: null,
};

/** Returns a UTC calendar date (time 00:00Z) or null if no estimate applies. */
export function estimateExpiration(
  item: { shelfLifeDays: number | null; category: string | null },
  purchasedAt: Date = new Date(),
): Date | null {
  const days = item.shelfLifeDays ?? (item.category ? CATEGORY_SHELF_LIFE_DAYS[item.category] ?? null : null);
  if (days == null) return null;
  return new Date(Date.UTC(purchasedAt.getUTCFullYear(), purchasedAt.getUTCMonth(), purchasedAt.getUTCDate() + days));
}

/** Date → "YYYY-MM-DD" (for @db.Date columns). */
export const toCalendarDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** "YYYY-MM-DD" → Date at 00:00Z. */
export const fromCalendarDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
