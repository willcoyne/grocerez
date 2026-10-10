import { Tabs } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { TAB_BAR_HEIGHT, TabBar, useToastBottomInset } from '@/components/ui';
import { color } from '@/theme';

/** Tabs in order: List (default), Cabinet, Me, Household (DESIGN.md §3). */
export default function TabsLayout() {
  const insets = useSafeAreaInsets();
  useToastBottomInset(TAB_BAR_HEIGHT + insets.bottom);

  return (
    <Tabs
      initialRouteName="list"
      tabBar={(props) => <TabBar {...props} />}
      screenOptions={{ headerShown: false, sceneStyle: { backgroundColor: color.bg } }}>
      <Tabs.Screen name="list" />
      <Tabs.Screen name="cabinet" />
      <Tabs.Screen name="me" />
      <Tabs.Screen name="group" />
    </Tabs>
  );
}
