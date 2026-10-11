import type { CabinetItem } from "@contracts/cabinet";
import type { Allergen } from "@contracts/dietary";
import { useMemo } from "react";

import { useCabinet } from "@/api/hooks/cabinet";
import { useDietary } from "@/api/hooks/me";
import { useShoppingList } from "@/api/hooks/shoppingList";

import { SHELF_GROUPS, type PantryItem, type ShelfGroup, type ShelfSection } from "./types";

const GROUP_LABELS: Record<ShelfGroup, string> = {
  snacks: "SNACKS",
  ingredients: "INGREDIENTS",
  produce: "PRODUCE",
  fridge: "FRIDGE",
  freezer: "FREEZER",
};

const CATEGORY_GROUPS: Record<string, ShelfGroup> = {
  snacks: "snacks",
  beverages: "snacks",
  produce: "produce",
  dairy: "fridge",
  meat: "fridge",
  seafood: "fridge",
  frozen: "freezer",
};

/** Where a row sits: an explicit fridge/freezer location wins, otherwise the item's category decides. */
export function groupFor(row: Pick<CabinetItem, "location" | "item">): ShelfGroup {
  if (row.location === "fridge") return "fridge";
  if (row.location === "freezer") return "freezer";
  const category = row.item.category;
  return (category && CATEGORY_GROUPS[category]) || "ingredients";
}

export function toPantryItem(row: CabinetItem): PantryItem {
  return {
    id: row.id,
    itemId: row.itemId,
    name: row.item.name,
    brand: row.product?.brand ?? null,
    category: row.item.category,
    location: row.location,
    group: groupFor(row),
    allergens: row.allergens ?? [],
    status: row.status,
    expiresAt: row.expiresAt,
    caloriesPerServing: row.product?.caloriesPerServing ?? null,
    healthScore: row.product?.healthScore ?? null,
    imageUrl: row.photoUrl ?? row.product?.imageUrl ?? null,
    ingredients: row.product?.ingredients ?? null,
    servingSize: row.product?.servingSize ?? null,
  };
}

const byName = (a: PantryItem, b: PantryItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) || a.id.localeCompare(b.id);

/** Non-empty sections in SHELF_GROUPS order, items sorted by name. */
export function buildSections(items: PantryItem[]): ShelfSection[] {
  const buckets = new Map<ShelfGroup, PantryItem[]>();
  for (const item of items) {
    const list = buckets.get(item.group);
    if (list) list.push(item);
    else buckets.set(item.group, [item]);
  }
  return SHELF_GROUPS.flatMap((group) => {
    const list = buckets.get(group);
    return list?.length ? [{ group, label: GROUP_LABELS[group], items: [...list].sort(byName) }] : [];
  });
}

const NO_ALLERGENS: Allergen[] = [];

/**
 * Everything the pantry scene needs for one group. Realtime invalidation (cabinet:changed, list:changed) is handled
 * app-wide by SocketProvider, so this hook only reads the cached queries.
 */
export function usePantry(groupId: string) {
  const cabinet = useCabinet(groupId);
  const dietary = useDietary();
  const list = useShoppingList(groupId);

  const items = useMemo(() => (cabinet.data ?? []).map(toPantryItem), [cabinet.data]);
  const sections = useMemo(() => buildSections(items), [items]);
  const myAllergens = dietary.data?.allergens ?? NO_ALLERGENS;
  const listPreview = useMemo(
    () =>
      (list.data ?? [])
        .filter((r) => !r.checked)
        .slice(0, 3)
        .map((r) => r.item.name),
    [list.data],
  );

  return {
    sections,
    items,
    myAllergens,
    listPreview,
    isLoading: cabinet.isLoading,
    error: cabinet.error,
    refetch: cabinet.refetch,
  };
}
