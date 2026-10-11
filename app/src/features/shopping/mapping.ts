/**
 * Pure mapping from shopping-list rows to what the store scene draws. No business rules live here: allergen flags,
 * who wants what and the aisle category all come from the server; this file only reshapes them.
 */
import { CATEGORIES } from "@contracts/common";
import type { Allergen } from "@contracts/dietary";
import type { AllergenFlag, ShoppingListItem } from "@contracts/shoppingList";

import { groupFor } from "../pantry/data";
import type { PantryItem } from "../pantry/types";

/** Store aisles in walking order: CATEGORIES order, with meat and seafood sharing one counter. */
export type AisleKey = Exclude<(typeof CATEGORIES)[number], "seafood">;
export const AISLE_ORDER: AisleKey[] = CATEGORIES.filter((c): c is AisleKey => c !== "seafood");

export const AISLE_LABELS: Record<AisleKey, string> = {
  produce: "PRODUCE",
  bakery: "BAKERY",
  meat: "MEAT & SEAFOOD",
  dairy: "DAIRY",
  frozen: "FROZEN",
  pantry: "PANTRY",
  snacks: "SNACKS",
  beverages: "BEVERAGES",
  household: "HOUSEHOLD",
  other: "OTHER",
};

/** Visual treatment of an aisle section. */
export type AisleTheme = "shelf" | "produce" | "bakery" | "cooler" | "freezer";
export const AISLE_THEME: Record<AisleKey, AisleTheme> = {
  produce: "produce",
  bakery: "bakery",
  meat: "cooler",
  dairy: "cooler",
  frozen: "freezer",
  pantry: "shelf",
  snacks: "shelf",
  beverages: "shelf",
  household: "shelf",
  other: "shelf",
};

export function aisleFor(category: string | null | undefined): AisleKey {
  const c = (category ?? "").trim().toLowerCase();
  if (c === "seafood") return "meat";
  return (AISLE_ORDER as string[]).includes(c) ? (c as AisleKey) : "other";
}

/** One list row as the store scene sees it. */
export type StoreItem = {
  row: ShoppingListItem;
  /** Shape the pantry's FoodItem mesh understands. `id` is the shopping-list row id. */
  pantry: PantryItem;
  aisle: AisleKey;
  /** The signed-in user is flagged for this item (red glow). */
  mine: boolean;
  /** Flags for other members (badge on the price tag). */
  others: AllergenFlag[];
};

const uniq = <T,>(xs: T[]) => [...new Set(xs)];

export function toPantryItem(row: ShoppingListItem): PantryItem {
  const base = {
    id: row.id,
    itemId: row.itemId,
    name: row.item.name,
    brand: null,
    category: row.item.category,
    location: null,
    group: groupFor({ location: null, item: row.item }),
    allergens: uniq(row.allergenFlags.map((f) => f.allergen)) as Allergen[],
    status: "in_stock" as const,
    expiresAt: null,
    caloriesPerServing: null,
    healthScore: null,
    imageUrl: null,
  } satisfies PantryItem;
  // Optional label fields some PantryItem versions carry (round-2 "flip" back label). Spread so the literal never trips
  // excess-property checks whichever version of the type is in the tree.
  const extra = { ingredients: null, servingSize: null };
  return { ...extra, ...base };
}

export function toStoreItem(row: ShoppingListItem, meId: string | null | undefined): StoreItem {
  return {
    row,
    pantry: toPantryItem(row),
    aisle: aisleFor(row.item.category),
    mine: !!meId && row.allergenFlags.some((f) => f.userId === meId),
    others: row.allergenFlags.filter((f) => f.userId !== meId),
  };
}

/** "Contains peanuts (Ann), milk (Ben)" for screen readers and the 2D list. */
export function allergenSummary(flags: AllergenFlag[], meId: string | null | undefined): string {
  if (flags.length === 0) return "";
  const parts = flags.map((f) => `${f.allergen.replace(/_/g, " ")} (${f.userId === meId ? "you" : f.displayName})`);
  return `Contains ${parts.join(", ")}`;
}

/** Short badge text for the 3D price tag: "! ANN · PEANUTS" or "! 2 MEMBERS". */
export function othersBadge(others: AllergenFlag[]): string | null {
  if (others.length === 0) return null;
  const people = uniq(others.map((f) => f.displayName));
  if (people.length === 1) {
    const allergens = uniq(others.map((f) => f.allergen.replace(/_/g, " ")));
    const text = `${people[0]} · ${allergens.join(", ")}`;
    return text.length > 22 ? `${people[0]} · ${allergens.length} allergens` : text;
  }
  return `${people.length} members`;
}

export type StoreSection = { aisle: AisleKey; label: string; theme: AisleTheme; items: StoreItem[] };

const byName = (a: StoreItem, b: StoreItem) =>
  a.pantry.name.localeCompare(b.pantry.name, undefined, { sensitivity: "base" }) || a.row.id.localeCompare(b.row.id);

/** Non-empty aisles in store order, items by name. */
export function buildStoreSections(items: StoreItem[]): StoreSection[] {
  const buckets = new Map<AisleKey, StoreItem[]>();
  for (const it of items) {
    const list = buckets.get(it.aisle);
    if (list) list.push(it);
    else buckets.set(it.aisle, [it]);
  }
  return AISLE_ORDER.flatMap((aisle) => {
    const list = buckets.get(aisle);
    return list?.length ? [{ aisle, label: AISLE_LABELS[aisle], theme: AISLE_THEME[aisle], items: [...list].sort(byName) }] : [];
  });
}
