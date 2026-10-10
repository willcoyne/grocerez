import { Tabs } from "expo-router/js-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAlertCount } from "@/components/AlertsSection";
import { TAB_BAR_HEIGHT, TabBar, useToastBottomInset } from "@/components/ui";
import { useExpirationReminders } from "@/notifications/useExpirationReminders";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { color } from "@/theme";

/** Tabs in order: List (default), Cabinet, Me, Household (DESIGN.md §3). Each screen renders its own TabHeader. */
export default function TabsLayout() {
  const groupId = useRequiredGroupId();
  const alertCount = useAlertCount(groupId);
  useExpirationReminders(groupId);
  const insets = useSafeAreaInsets();
  useToastBottomInset(TAB_BAR_HEIGHT + insets.bottom);

  return (
    <Tabs
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}
    >
      <Tabs.Screen name="index" options={{ title: "List" }} />
      <Tabs.Screen name="cabinet" options={{ title: "Cabinet" }} />
      <Tabs.Screen name="me" options={{ title: "Me" }} />
      <Tabs.Screen name="group" options={{ title: "Household", tabBarBadge: alertCount > 0 ? alertCount : undefined }} />
    </Tabs>
  );
}
