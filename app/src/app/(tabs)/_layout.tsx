import Ionicons from "@expo/vector-icons/Ionicons";
import { Tabs } from "expo-router/js-tabs";
import type { ColorValue } from "react-native";

import { GroupSwitcher } from "@/components/GroupSwitcher";

import { colors } from "@/theme";

type IconName = keyof typeof Ionicons.glyphMap;

function icon(name: IconName) {
  function TabIcon({ color, size }: { color: ColorValue; size: number }) {
    return <Ionicons name={name} color={color as string} size={size} />;
  }
  return TabIcon;
}

export default function TabsLayout() {
  return (
    <Tabs
      screenOptions={{
        tabBarActiveTintColor: colors.primary,
        tabBarInactiveTintColor: colors.textMuted,
        headerTitleStyle: { fontWeight: "700" },
        sceneStyle: { backgroundColor: colors.background },
        headerTitle: () => <GroupSwitcher />,
      }}
    >
      <Tabs.Screen name="index" options={{ title: "List", tabBarIcon: icon("checkbox-outline") }} />
      <Tabs.Screen name="cabinet" options={{ title: "Cabinet", tabBarIcon: icon("file-tray-stacked-outline") }} />
      <Tabs.Screen name="me" options={{ title: "Me", tabBarIcon: icon("person-circle-outline") }} />
      <Tabs.Screen name="group" options={{ title: "Group", tabBarIcon: icon("people-outline") }} />
    </Tabs>
  );
}
