import { Tabs } from "expo-router/js-tabs";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAlertCount } from "@/components/AlertsSection";
import { TAB_BAR_HEIGHT, TabBar, useToastBottomInset } from "@/components/ui";
import { navTabFor, requestStation, useCurrentStation } from "@/features/pantry/roomNav";
import { useExpirationReminders } from "@/notifications/useExpirationReminders";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { color } from "@/theme";

/** The nav bar drives the camera in the one persistent 3D room (features/pantry/roomNav.ts), not the router. */
function RoomTabBar({ alertCount }: { alertCount: number }) {
  const station = useCurrentStation();
  return <TabBar active={navTabFor(station)} onSelect={requestStation} badges={{ household: alertCount }} />;
}

/**
 * One real screen: the 3D room (route `cabinet`, PantryScreen). The nav bar's Pantry · List · Me · Week · Household
 * move the camera between stations in that room and open their sheets (SPEC.md round 3).
 * The old tab routes stay as hidden redirects so deep links keep working: "/" → the room, `/list`, `/me`, `/group`
 * → the room at that station (`/cabinet?station=…`).
 */
export default function TabsLayout() {
  const groupId = useRequiredGroupId();
  const alertCount = useAlertCount(groupId);
  useExpirationReminders(groupId);
  const insets = useSafeAreaInsets();
  useToastBottomInset(TAB_BAR_HEIGHT + insets.bottom);

  return (
    <Tabs
      initialRouteName="cabinet"
      tabBar={() => <RoomTabBar alertCount={alertCount} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}
    >
      <Tabs.Screen name="cabinet" options={{ title: "Pantry" }} />
      <Tabs.Screen name="list" options={{ href: null }} />
      <Tabs.Screen name="me" options={{ href: null }} />
      <Tabs.Screen name="group" options={{ href: null }} />
      <Tabs.Screen name="index" options={{ href: null }} />
    </Tabs>
  );
}
