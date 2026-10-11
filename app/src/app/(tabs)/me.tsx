import { Redirect } from "expo-router";

import MeScreen from "@/features/simple/MeScreen";
import { useUiMode } from "@/state/uiPrefs";

/** Simple interface: the me tab. 3D room interface: lands in the room at that station (deep links keep working). */
export default function Tab() {
  return useUiMode() === "simple" ? <MeScreen /> : <Redirect href="/cabinet?station=me" />;
}
