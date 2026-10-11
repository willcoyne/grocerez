import { TabHeader } from "@/components/GroupSwitcher";
import { View } from "react-native";

import { WeekSheet } from "@/features/week/WeekSheet";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";

import { RoomModeButton } from "./InterfaceChoice";

/** Simple interface Week tab: the Week paper (dinners, use-soon, the Pantry Agent) as a plain page. */
export default function WeekScreen() {
  const groupId = useRequiredGroupId();
  return (
    <View style={{ flex: 1 }} testID="tab-week">
      <TabHeader title="Week" right={<RoomModeButton />} />
      <WeekSheet key={groupId} visible page groupId={groupId} onClose={() => {}} />
    </View>
  );
}
