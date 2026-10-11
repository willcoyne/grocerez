import type { ExpiryWarning, MealPlanResponse } from "../../contracts/mealPlan.js";
import { toCalendarDate } from "../../lib/expiration.js";
import { namesMatch } from "../../lib/normalize.js";

/** A cabinet item that can expire (mealPlanRepo.expirable), with its date as YYYY-MM-DD. */
export type Expirable = { id: string; name: string; expiresAt: string };

export const toExpirables = (rows: { id: string; expiresAt: Date | null; item: { name: string } }[]): Expirable[] =>
  rows.filter((r) => r.expiresAt).map((r) => ({ id: r.id, name: r.item.name, expiresAt: toCalendarDate(r.expiresAt)! }));

const usedBy = (uses: string[], c: Expirable) => uses.some((u) => namesMatch(u, c.name));

/** Spec §14 rule 1: used cabinet items that expire before `date`. */
export const warningsFor = (uses: string[], date: string, cabinet: Expirable[]): ExpiryWarning[] =>
  cabinet
    .filter((c) => c.expiresAt < date && usedBy(uses, c))
    .map((c) => ({ kind: "expires_before" as const, item: c.name, expiresAt: c.expiresAt }));

/** Earliest expiry among the cabinet items a meal uses, or null. */
export const deadlineFor = (uses: string[], cabinet: Expirable[], today?: string): string | null =>
  cabinet.filter((c) => (today === undefined || c.expiresAt >= today) && usedBy(uses, c)).reduce<string | null>((min, c) => (min === null || c.expiresAt < min ? c.expiresAt : min), null);

/** Spec §14 rule 3: items expiring by `horizon` (or already expired) and the earliest meal in today…weekEnd using each. */
export function coverage(
  cabinet: Expirable[],
  meals: { id: string; date: string; uses: string[] }[],
  today: string,
  weekEnd: string,
  horizon: string,
  daysBetween: (a: string, b: string) => number,
): MealPlanResponse["expiring"] {
  const week = meals.filter((m) => m.date >= today && m.date <= weekEnd).sort((a, b) => a.date.localeCompare(b.date));
  return cabinet
    .filter((c) => c.expiresAt <= horizon)
    .map((c) => {
      const m = c.expiresAt < today ? undefined : week.find((w) => usedBy(w.uses, c));
      return {
        cabinetItemId: c.id,
        name: c.name,
        expiresAt: c.expiresAt,
        daysLeft: daysBetween(today, c.expiresAt),
        plannedOn: m?.date ?? null,
        plannedMealId: m?.id ?? null,
      };
    });
}
