import type { PlannedMeal } from "@contracts/mealPlan";
import { addDays as addDaysFns, format } from "date-fns";

import { parseCalendarDate, toCalendarDate } from "@/lib/format";

// Calendar-date helpers for the Week calendar. Dates are household "YYYY-MM-DD" strings from the server (it sends
// `today`), so the app never guesses the household's time zone; these only do display and day arithmetic.

export const WEEK_DAYS = 7;

export function addDays(ymd: string, n: number): string {
  return toCalendarDate(addDaysFns(parseCalendarDate(ymd), n));
}

/** The 7 dates starting at `from`. */
export function weekDates(from: string): string[] {
  return Array.from({ length: WEEK_DAYS }, (_, i) => addDays(from, i));
}

/** "MON 12" (section label), "Mon" (short), "Monday, October 12" (spoken). */
export function dayLabels(ymd: string) {
  const d = parseCalendarDate(ymd);
  return {
    section: `${format(d, "EEE").toUpperCase()} ${format(d, "d")}`,
    short: format(d, "EEE"),
    spoken: format(d, "EEEE, MMMM d"),
  };
}

/** "Oct 12–18", or "Oct 29–Nov 4" across months. */
export function rangeLabel(from: string, to: string): string {
  const a = parseCalendarDate(from);
  const b = parseCalendarDate(to);
  return a.getMonth() === b.getMonth() ? `${format(a, "MMM d")}–${format(b, "d")}` : `${format(a, "MMM d")}–${format(b, "MMM d")}`;
}

/** Planned dinners by date. */
export function byDate(meals: readonly PlannedMeal[] | undefined): Map<string, PlannedMeal> {
  return new Map((meals ?? []).map((m) => [m.date, m]));
}

/**
 * Lines for the pinned Week note on the pantry door: the next `days` days, "Mon  Lemon chicken" or "Wed  —".
 * Empty when the plan hasn't loaded (the 3D note then shows its own fallback).
 */
export function weekPreviewLines(plan: { from: string; meals: readonly PlannedMeal[] } | undefined, days = 4): string[] {
  if (!plan) return [];
  const planned = byDate(plan.meals);
  return weekDates(plan.from)
    .slice(0, days)
    .map((d) => `${dayLabels(d).short}  ${planned.get(d)?.meal.title ?? "—"}`);
}

/** Which dates a "Plan our week" run targets: the first 3 unplanned days, else (re-plan) the first 3 days. */
export function datesToPlan(dates: readonly string[], planned: ReadonlyMap<string, unknown>, count = 3): string[] {
  const open = dates.filter((d) => !planned.has(d));
  return (open.length ? open : dates).slice(0, count);
}
