// Pure helpers for the pinned paper list (no three.js imports, so they are cheap to test).

export const LIST_FALLBACK = ["ham", "eggs", "rice"];

export const WEEK_FALLBACK = ["Tap to", "plan this", "week"];

/** Longest Week-note line; longer titles are cut ("Mon Chicken..") so the big type stays readable on the door. */
const WEEK_LINE_MAX = 14;

/** Up to 3 "Mon Chicken.." lines for the pinned Week note, or a friendly fallback while the plan loads. */
export function weekNoteLines(preview: readonly string[] | null | undefined): string[] {
  const clean = (preview ?? [])
    .map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean)
    .slice(0, 3)
    .map((s) => (s.length > WEEK_LINE_MAX ? `${s.slice(0, WEEK_LINE_MAX - 2).trimEnd()}..` : s));
  return clean.length ? clean : [...WEEK_FALLBACK];
}

/** First 3 non-empty shopping-list names, or the friendly fallback when there are none. */
export function listLines(preview: readonly string[] | null | undefined): string[] {
  const clean = (preview ?? [])
    .map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
  return clean.length ? clean : [...LIST_FALLBACK];
}
