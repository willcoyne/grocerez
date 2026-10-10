import type { Tabs } from 'expo-router';
import { Archive, List, User, Users, type LucideIcon } from 'lucide-react-native';
import type { ComponentProps } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, size } from '@/theme';

import { AppText } from './AppText';

type TabBarProps = Parameters<NonNullable<ComponentProps<typeof Tabs>['tabBar']>>[0];

/** Route name → label, icon, testID. Order matches DESIGN.md §3: List, Cabinet, Me, Household. */
export const TAB_META: Record<string, { label: string; Icon: LucideIcon }> = {
  list: { label: 'List', Icon: List },
  cabinet: { label: 'Cabinet', Icon: Archive },
  me: { label: 'Me', Icon: User },
  group: { label: 'Household', Icon: Users },
};

/** Height of the bar above the safe area; screens use it to keep toasts and bottom bars clear. */
export const TAB_BAR_HEIGHT = size.tabBar;

export function TabBar({ state, navigation }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, height: size.tabBar + insets.bottom }]} accessibilityRole="tablist">
      {state.routes.map((route, index) => {
        const meta = TAB_META[route.name];
        if (!meta) return null;
        const focused = state.index === index;
        const tint = focused ? color.primary : color.muted;
        const onPress = () => {
          const event = navigation.emit({ type: 'tabPress', target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) navigation.navigate(route.name, route.params);
        };
        return (
          <Pressable
            key={route.key}
            testID={`tabbar-${route.name}`}
            accessibilityRole="tab"
            accessibilityLabel={meta.label}
            accessibilityState={{ selected: focused }}
            onPress={onPress}
            style={styles.tab}>
            <View style={[styles.indicator, focused && styles.indicatorOn]} />
            <meta.Icon size={22} color={tint} />
            <AppText variant="micro" weight="bold" color={focused ? 'primary' : 'muted'}>
              {meta.label}
            </AppText>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    backgroundColor: color.surface,
    borderTopWidth: 1,
    borderTopColor: color.border,
  },
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: size.hit },
  indicator: { position: 'absolute', top: 0, left: 16, right: 16, height: 3, backgroundColor: 'transparent' },
  indicatorOn: { backgroundColor: color.primary },
});
