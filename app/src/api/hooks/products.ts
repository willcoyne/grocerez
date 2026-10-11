import type { Allergen } from "@contracts/dietary";
import type { GroupDetail } from "@contracts/groups";
import type { Product, ScanBody } from "@contracts/products";
import { useMutation } from "@tanstack/react-query";
import { useMemo } from "react";

import { useAuth } from "@/state/AuthContext";
import { api } from "../client";
import { useGroupDetail } from "./groups";
import { useDietary } from "./me";
import { useShoppingList } from "./shoppingList";

/** POST /products/scan {qrUrl} | {gtin}. Not retried: the scanner simply scans again. */
export function useScanProduct() {
  return useMutation({
    mutationFn: (body: ScanBody) => api<Product>("/products/scan", { method: "POST", body }),
    retry: false,
  });
}

export type HouseholdAllergens = Map<Allergen, string[]>;

/**
 * allergen → member names, for red "Contains" chips. Sources (no client-side rules, just collecting server data):
 * member allergens from GET /groups/:id when the API includes them, the allergen flags the server put on the shopping list,
 * and my own dietary profile. See DECISIONS "Needs backend change" (member allergens).
 */
export function useHouseholdAllergens(groupId: string): HouseholdAllergens {
  const detail = useGroupDetail(groupId);
  const list = useShoppingList(groupId);
  const dietary = useDietary();
  const { user } = useAuth();
  return useMemo(() => {
    const map: HouseholdAllergens = new Map();
    const add = (a: Allergen, name: string) => {
      const names = map.get(a) ?? [];
      if (!names.includes(name)) names.push(name);
      map.set(a, names);
    };
    for (const m of detail.data?.members ?? []) {
      const allergens = (m as GroupDetail["members"][number] & { allergens?: Allergen[] }).allergens;
      for (const a of allergens ?? []) add(a, m.displayName);
    }
    for (const r of list.data ?? []) for (const f of r.allergenFlags) add(f.allergen, f.displayName);
    for (const a of dietary.data?.allergens ?? []) add(a, user?.displayName ?? "You");
    return map;
  }, [detail.data, list.data, dietary.data, user]);
}
