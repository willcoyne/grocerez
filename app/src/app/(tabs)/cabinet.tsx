import { useLocalSearchParams } from "expo-router";
import { useMemo, useState } from "react";

import CabinetScreen from "@/features/cabinet/CabinetScreen";
import { PantryScreen } from "@/features/pantry/PantryScreen";

/**
 * Pantry tab (home): the 3D pantry (features/pantry/SPEC.md), with a "List view" knob that switches to the cabinet
 * list (every cabinet action: place filters, quick actions, scan lookup, map out the cabinet) and a "3D view" button back.
 * The shopping list, Me and Week live on papers pinned to the pantry; `?list=`, `?me=` or `?week=<nonce>` flies to one
 * and opens it (Household "Plan our week", alerts "Plan meals").
 */
export default function PantryTab() {
  const { list, me, week } = useLocalSearchParams<{ list?: string; me?: string; week?: string }>();
  const [view, setView] = useState<"3d" | "list">("3d");
  const noteSignal = useMemo(
    () =>
      week ? { kind: "week" as const, nonce: `week-${week}` }
      : list ? { kind: "list" as const, nonce: `list-${list}` }
      : me ? { kind: "me" as const, nonce: `me-${me}` }
      : undefined,
    [list, me, week],
  );
  return view === "3d"
    ? <PantryScreen noteSignal={noteSignal} onShowList={() => setView("list")} />
    : <CabinetScreen onShow3D={() => setView("3d")} />;
}
