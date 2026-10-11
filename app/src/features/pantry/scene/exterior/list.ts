// Pure helpers for the pinned paper list (no three.js imports, so they are cheap to test).

export const LIST_FALLBACK = ["ham", "eggs", "rice"];

/** First 3 non-empty shopping-list names, or the friendly fallback when there are none. */
export function listLines(preview: readonly string[] | null | undefined): string[] {
  const clean = (preview ?? [])
    .map((s) => (typeof s === "string" ? s.replace(/\s+/g, " ").trim() : ""))
    .filter(Boolean)
    .slice(0, 3);
  return clean.length ? clean : [...LIST_FALLBACK];
}
