import { Redirect } from "expo-router";

import ListScreen from "@/features/simple/ListScreen";
import { useUiMode } from "@/state/uiPrefs";

/** Simple interface: the list tab. 3D room interface: lands in the room at that station (deep links keep working). */
export default function Tab() {
  return useUiMode() === "simple" ? <ListScreen /> : <Redirect href="/cabinet?station=list" />;
}
