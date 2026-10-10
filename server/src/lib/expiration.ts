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

/** Default household time zone (same as the groups.time_zone column default). */
export const DEFAULT_TIME_ZONE = "America/Chicago";

/**
 * The calendar date of `at` in `timeZone`, as a Date at 00:00Z (the @db.Date convention), plus `addDays` days.
 * DB-08: "today" and estimates use the household's day, not the server's UTC day
 * (SQL equivalent: (at AT TIME ZONE groups.time_zone)::date + addDays).
 */
export function localDate(at: Date, timeZone: string = DEFAULT_TIME_ZONE, addDays = 0): Date {
  const ymd = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).format(at);
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + addDays));
}

/** The household's current date (+ addDays) as a Date at 00:00Z. */
export const householdToday = (timeZone: string = DEFAULT_TIME_ZONE, addDays = 0): Date => localDate(new Date(), timeZone, addDays);

/** True if `tz` is an IANA zone name that Node and the database CHECK (is_valid_time_zone) both accept. */
export function isValidTimeZone(tz: string): boolean {
  if (!/^([A-Za-z_]+(\/[A-Za-z0-9_+-]+)+|UTC)$/.test(tz)) return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch {
    return false;
  }
}

/**
 * purchasedAt's date in the household's time zone + shelf life, as a calendar date (time 00:00Z),
 * or null if no estimate applies.
 */
export function estimateExpiration(
  item: { shelfLifeDays: number | null; category: string | null },
  purchasedAt: Date = new Date(),
  timeZone: string = DEFAULT_TIME_ZONE,
): Date | null {
  const days = item.shelfLifeDays ?? (item.category ? CATEGORY_SHELF_LIFE_DAYS[item.category] ?? null : null);
  if (days == null) return null;
  return localDate(purchasedAt, timeZone, days);
}

type GroupReader = {
  group: { findUnique(args: { where: { id: string }; select: { timeZone: true } }): Promise<{ timeZone: string } | null> };
};

/** groups.time_zone for a group (the default if the group is gone). */
export async function groupTimeZone(db: GroupReader, groupId: string): Promise<string> {
  return (await db.group.findUnique({ where: { id: groupId }, select: { timeZone: true } }))?.timeZone ?? DEFAULT_TIME_ZONE;
}

/** Date → "YYYY-MM-DD" (for @db.Date columns). */
export const toCalendarDate = (d: Date | null): string | null => (d ? d.toISOString().slice(0, 10) : null);

/** "YYYY-MM-DD" → Date at 00:00Z. */
export const fromCalendarDate = (s: string): Date => new Date(`${s}T00:00:00.000Z`);
