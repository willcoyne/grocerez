import type { Allergen } from "@contracts/dietary";

import type { PantryFilters, PantryItem } from "./types";

/** Days ahead (inclusive) that count as "expiring soon". Already-expired items count too. */
export const EXPIRING_SOON_DAYS = 3;

/** True when the item contains any of my allergens. */
export function isAllergic(item: Pick<PantryItem, "allergens">, myAllergens: readonly Allergen[]): boolean {
  if (!myAllergens.length || !item.allergens.length) return false;
  return item.allergens.some((a) => myAllergens.includes(a));
}

/** YYYY-MM-DD of `now + days` in the device's local time zone. */
function localDate(now: Date, days = 0): string {
  const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() + days);
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mm}-${dd}`;
}

/**
 * Ids of the items that pass every active filter (empty / false / null criteria are ignored).
 * Unknown values never pass a value filter: an item with no health score is hidden by a health-score filter, and an
 * item with unknown calories is hidden by a max-calories filter.
 */
export function applyFilters(
  items: readonly PantryItem[],
  filters: PantryFilters,
  myAllergens: readonly Allergen[],
  now: Date = new Date(),
): { visible: Set<string> } {
  const scores = new Set(filters.healthScores.map((s) => s.toUpperCase()));
  const groups = new Set(filters.groups);
  const soonCutoff = filters.expiringSoon ? localDate(now, EXPIRING_SOON_DAYS) : null;

  const visible = new Set<string>();
  for (const item of items) {
    if (filters.excludeAllergens.length && item.allergens.some((a) => filters.excludeAllergens.includes(a))) continue;
    if (filters.safeForMe && isAllergic(item, myAllergens)) continue;
    if (scores.size && !(item.healthScore && scores.has(item.healthScore.toUpperCase()))) continue;
    if (filters.maxCalories != null && !(item.caloriesPerServing != null && item.caloriesPerServing <= filters.maxCalories)) continue;
    if (groups.size && !groups.has(item.group)) continue;
    if (soonCutoff && !(item.expiresAt && item.expiresAt <= soonCutoff)) continue;
    if (filters.runningLow && item.status !== "running_low") continue;
    visible.add(item.id);
  }
  return { visible };
}

/** Number of active filter criteria (one per non-default field), for the filter button badge. */
export function activeFilterCount(filters: PantryFilters): number {
  return [
    filters.excludeAllergens.length > 0,
    filters.safeForMe,
    filters.healthScores.length > 0,
    filters.maxCalories != null,
    filters.groups.length > 0,
    filters.expiringSoon,
    filters.runningLow,
  ].filter(Boolean).length;
}

/** Lowercase, accents stripped ("Jalapeño" → "jalapeno"), whitespace collapsed. */
export function normalizeText(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

/** 0 = prefix, 1 = word prefix, 2 = substring, null = no match. */
function matchRank(text: string, q: string): number | null {
  let idx = text.indexOf(q);
  if (idx < 0) return null;
  if (idx === 0) return 0;
  for (; idx > 0; idx = text.indexOf(q, idx + 1)) {
    if (!/[a-z0-9]/.test(text[idx - 1]!)) return 1;
  }
  return 2;
}

/**
 * Case- and accent-insensitive substring search over name and brand. Ranked prefix > word prefix > substring;
 * at the same rank a name match beats a brand match, then alphabetical. Blank query → [].
 */
export function searchItems(items: readonly PantryItem[], query: string): PantryItem[] {
  const q = normalizeText(query);
  if (!q) return [];
  const scored: { item: PantryItem; score: number }[] = [];
  for (const item of items) {
    const nameRank = matchRank(normalizeText(item.name), q);
    const brandRank = item.brand ? matchRank(normalizeText(item.brand), q) : null;
    const candidates = [nameRank == null ? null : nameRank * 2, brandRank == null ? null : brandRank * 2 + 1].filter(
      (n): n is number => n != null,
    );
    if (candidates.length) scored.push({ item, score: Math.min(...candidates) });
  }
  return scored
    .sort((a, b) => a.score - b.score || a.item.name.localeCompare(b.item.name, undefined, { sensitivity: "base" }))
    .map((s) => s.item);
}
