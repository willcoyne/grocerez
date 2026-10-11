import { Tabs } from "expo-router/js-tabs";
import type { ComponentProps } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAlertCount } from "@/components/AlertsSection";
import { TAB_BAR_HEIGHT, TabBar, useToastBottomInset, type TabId } from "@/components/ui";
import { navTabFor, requestStation, useCurrentStation } from "@/features/pantry/roomNav";
import { useExpirationReminders } from "@/notifications/useExpirationReminders";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { useUiMode } from "@/state/uiPrefs";
import { color } from "@/theme";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/** Simple interface: each nav tab is its own screen (route). */
const ROUTE_FOR: Record<TabId, string> = { pantry: "cabinet", list: "list", me: "me", week: "week", household: "group" };
const TAB_FOR: Record<string, TabId> = { cabinet: "pantry", list: "list", me: "me", week: "week", group: "household" };

/** 3D room interface: the nav bar drives the camera in the one persistent 3D room (features/pantry/roomNav.ts). */
function RoomTabBar({ alertCount }: { alertCount: number }) {
  const station = useCurrentStation();
  return <TabBar active={navTabFor(station)} onSelect={requestStation} badges={{ household: alertCount }} />;
}

/** Simple interface: the same bar switches screens. */
function SimpleTabBar({ state, navigation, alertCount }: TabBarProps & { alertCount: number }) {
  const active = TAB_FOR[state.routes[state.index]?.name ?? "cabinet"] ?? "pantry";
  return <TabBar active={active} onSelect={(id) => navigation.navigate(ROUTE_FOR[id])} badges={{ household: alertCount }} />;
}

/**
 * Two interfaces, chosen per user (state/uiPrefs.tsx) and saved to their account:
 * - 3D room: one real screen, the room (route `cabinet`, PantryScreen). The nav bar's Pantry · List · Me · Week ·
 *   Household move the camera between stations in that room and open their sheets (SPEC.md round 3); the other routes
 *   redirect into the room (`/cabinet?station=…`) so deep links keep working.
 * - Simple: Pantry (cabinet list), List, Me, Week and Household are plain screens; no 3D or animation.
 */
export default function TabsLayout() {
  const groupId = useRequiredGroupId();
  const alertCount = useAlertCount(groupId);
  const mode = useUiMode();
  useExpirationReminders(groupId);
  const insets = useSafeAreaInsets();
  useToastBottomInset(TAB_BAR_HEIGHT + insets.bottom);

  return (
    <Tabs
      initialRouteName="cabinet"
      tabBar={(props) =>
        mode === "room" ? <RoomTabBar alertCount={alertCount} /> : <SimpleTabBar {...props} alertCount={alertCount} />
      }
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}
    >
      <Tabs.Screen name="cabinet" options={{ title: "Pantry" }} />
      <Tabs.Screen name="list" options={{ title: "List" }} />
      <Tabs.Screen name="me" options={{ title: "Me" }} />
      <Tabs.Screen name="week" options={{ title: "Week" }} />
      <Tabs.Screen name="group" options={{ title: "Household" }} />
      <Tabs.Screen name="index" options={{ href: null }} />
    </Tabs>
  );
}
