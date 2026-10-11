import type { Allergen } from "@contracts/dietary";
import { useMemo } from "react";

import { useDietary } from "@/api/hooks/me";
import { useHouseholdAllergens, type HouseholdAllergens } from "@/api/hooks/products";
import { useAuth } from "@/state/AuthContext";

/** Who in the household reacts to the allergens on a label. All allergen data comes from the server. */
export type AllergenAudience = {
  /** allergen → member names (useHouseholdAllergens; includes the signed-in user under their display name). */
  household: HouseholdAllergens;
  /** The signed-in user's own allergens (GET /me/dietary). */
  mine: Allergen[];
  /** The signed-in user's display name, so they can be shown as "You" instead. */
  meName: string | null;
};

export function useAllergenAudience(groupId: string): AllergenAudience {
  const household = useHouseholdAllergens(groupId);
  const dietary = useDietary();
  const { user } = useAuth();
  const mineData = dietary.data?.allergens;
  const meName = user?.displayName ?? null;
  return useMemo(() => ({ household, mine: mineData ?? [], meName }), [household, mineData, meName]);
}

export type AllergenHit = { allergen: Allergen; mine: boolean; others: string[] };

/** For one allergen: is the signed-in user allergic, and which other members are (names, deduped). */
export function whoReacts(a: Allergen, audience: AllergenAudience): AllergenHit {
  const mine = audience.mine.includes(a);
  const names = audience.household.get(a) ?? [];
  const others = names.filter((n) => n !== audience.meName && n !== "You");
  return { allergen: a, mine: mine || (names.length > others.length && audience.meName !== null), others };
}

/** Allergens on a label that affect someone, the signed-in user's first. */
export function labelConflicts(list: Allergen[], audience: AllergenAudience): AllergenHit[] {
  return [...new Set(list)]
    .map((a) => whoReacts(a, audience))
    .filter((h) => h.mine || h.others.length > 0)
    .sort((x, y) => Number(y.mine) - Number(x.mine));
}

/** "You, Sam" / "Sam and Alex". */
export function peopleText(hit: Pick<AllergenHit, "mine" | "others">): string {
  return [...(hit.mine ? ["You"] : []), ...hit.others].join(", ");
}
