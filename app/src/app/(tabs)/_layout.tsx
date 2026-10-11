import { Tabs } from "expo-router/js-tabs";
import type { ComponentProps } from "react";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { useAlertCount } from "@/components/AlertsSection";
import { TAB_BAR_HEIGHT, TabBar, useToastBottomInset } from "@/components/ui";
import { useExpirationReminders } from "@/notifications/useExpirationReminders";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { color } from "@/theme";

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>["tabBar"]>>[0];

/** Route names that exist only to redirect and never show as a tab. */
const HIDDEN_TABS = new Set(["index"]);

/** The custom TabBar renders every route it is given, so drop the redirect-only routes (and remap the focus index). */
function VisibleTabBar(props: TabBarProps) {
  const { state } = props;
  const routes = state.routes.filter((r) => !HIDDEN_TABS.has(r.name));
  const focusedKey = state.routes[state.index]?.key;
  const index = Math.max(0, routes.findIndex((r) => r.key === focusedKey));
  return <TabBar {...props} state={{ ...state, routes, index }} />;
}

/**
 * Tabs in order: Pantry (home, route `cabinet`), Household. "/" (index) redirects to the Pantry.
 * The shopping list, Me and Week are papers pinned on the 3D pantry (features/pantry), not tabs.
 * Each screen renders its own header; the Pantry scene fills the area above the tab bar.
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
      tabBar={(props) => <VisibleTabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}
    >
      <Tabs.Screen name="cabinet" options={{ title: "Pantry" }} />
      <Tabs.Screen name="group" options={{ title: "Household", tabBarBadge: alertCount > 0 ? alertCount : undefined }} />
      <Tabs.Screen name="index" options={{ href: null }} />
    </Tabs>
  );
}
