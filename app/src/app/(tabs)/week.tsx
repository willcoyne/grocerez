import { Redirect } from "expo-router";

import WeekScreen from "@/features/simple/WeekScreen";
import { useUiMode } from "@/state/uiPrefs";

/** Simple interface: the week tab. 3D room interface: lands in the room at that station (deep links keep working). */
export default function Tab() {
  return useUiMode() === "simple" ? <WeekScreen /> : <Redirect href="/cabinet?station=week" />;
}
