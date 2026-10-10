import { differenceInCalendarDays, format, formatDistanceToNowStrict, parseISO } from "date-fns";

/** "tree_nuts" → "Tree nuts", "one_time" → "One time". */
export function labelize(value: string): string {
  const s = value.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** "2h ago" style relative time for invites, check-offs, etc. */
export function timeAgo(iso: string, now = new Date()): string {
  const d = parseISO(iso);
  if (Number.isNaN(d.getTime())) return "";
  if (Math.abs(now.getTime() - d.getTime()) < 60_000) return "just now";
  return `${formatDistanceToNowStrict(d)} ago`;
}

/** 349 → "$3.49" */
export function formatCents(cents: number): string {
  return `$${(cents / 100).toFixed(2)}`;
}

/** 3400, 4100 → "$34–$41" (whole dollars for totals). */
export function formatCentsRange(low: number, high: number, wholeDollars = false): string {
  const f = (c: number) => (wholeDollars ? `$${Math.round(c / 100)}` : formatCents(c));
  return low === high ? f(low) : `${f(low)}–${f(high)}`;
}

/** Parse a calendar date "YYYY-MM-DD" as a local date (not UTC midnight). */
export function parseCalendarDate(ymd: string): Date {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(y, (m ?? 1) - 1, d ?? 1);
}

export function toCalendarDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

/** Days until a "YYYY-MM-DD" date (negative = expired). Display only; the server decides what "expiring" means. */
export function daysUntil(ymd: string, now = new Date()): number {
  return differenceInCalendarDays(parseCalendarDate(ymd), now);
}

/** "Oct 14" */
export function shortDate(ymd: string): string {
  return format(parseCalendarDate(ymd), "MMM d");
}
