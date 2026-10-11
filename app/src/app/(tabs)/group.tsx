import { Redirect } from "expo-router";

import GroupScreen from "@/features/simple/GroupScreen";
import { useUiMode } from "@/state/uiPrefs";

/** Simple interface: the household tab. 3D room interface: lands in the room at that station (deep links keep working). */
export default function Tab() {
  return useUiMode() === "simple" ? <GroupScreen /> : <Redirect href="/cabinet?station=household" />;
}
