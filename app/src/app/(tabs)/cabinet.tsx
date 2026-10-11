import { useLocalSearchParams } from "expo-router";

import { PantryScreen } from "@/features/pantry/PantryScreen";

/**
 * Pantry tab (home): the 3D pantry replaced the old Cabinet list (features/pantry/SPEC.md).
 * `?week=<nonce>` opens the Week sheet (Household "Plan our week", alerts "Plan meals").
 */
export default function PantryTab() {
  const { week } = useLocalSearchParams<{ week?: string }>();
  return <PantryScreen weekSignal={week} />;
}
