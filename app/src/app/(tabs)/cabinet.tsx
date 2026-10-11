import { Redirect, useLocalSearchParams } from "expo-router";

import CabinetScreen from "@/features/cabinet/CabinetScreen";
import { PantryScreen } from "@/features/pantry/PantryScreen";
import { useSetUiMode, useUiMode } from "@/state/uiPrefs";

/** Where a `?station=` link lands in the simple interface (each station is its own tab there). */
const SIMPLE_ROUTE = { list: "/list", me: "/me", week: "/week", household: "/group" } as const;

/**
 * Pantry tab. 3D room interface: the one 3D room (features/pantry/SPEC.md); the nav bar and `?station=list|me|week|
 * household` links move the camera inside it. Simple interface: the cabinet list (every cabinet action, no 3D).
 * The interface is saved per user (state/uiPrefs.tsx); "Simple view" / the 3D button switch it.
 */
export default function PantryTab() {
  const mode = useUiMode();
  const setMode = useSetUiMode();
  const { station } = useLocalSearchParams<{ station?: string }>();
  if (mode === "room") return <PantryScreen onShowList={() => setMode("simple")} />;
  const target = station ? SIMPLE_ROUTE[station as keyof typeof SIMPLE_ROUTE] : undefined;
  if (target) return <Redirect href={target} />;
  return <CabinetScreen onShow3D={() => setMode("room")} />;
}
