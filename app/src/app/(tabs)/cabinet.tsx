import { useLocalSearchParams } from "expo-router";
import { useState } from "react";

import CabinetScreen from "@/features/cabinet/CabinetScreen";
import { PantryScreen } from "@/features/pantry/PantryScreen";

/**
 * Pantry tab (home): the 3D pantry (features/pantry/SPEC.md), with a "List view" knob that switches to the cabinet
 * list (every cabinet action: place filters, quick actions, scan lookup, map out the cabinet) and a "3D view" button back.
 * `?week=<nonce>` opens the Week sheet (Household "Plan our week", alerts "Plan meals").
 */
export default function PantryTab() {
  const { week } = useLocalSearchParams<{ week?: string }>();
  const [view, setView] = useState<"3d" | "list">("3d");
  return view === "3d"
    ? <PantryScreen weekSignal={week} onShowList={() => setView("list")} />
    : <CabinetScreen onShow3D={() => setView("3d")} />;
}
