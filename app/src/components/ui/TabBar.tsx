import { BookOpen, DoorClosed, List, User, Users, type LucideIcon } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { color, size } from '@/theme';

import { AppText } from './AppText';

/**
 * Bottom nav for the one-room app (features/pantry/SPEC.md round 3). Each tab is a place in the 3D room, not a
 * screen: pressing one asks the room to move the camera there (`onSelect`). Order: Pantry · List · Recipes · Me ·
 * Household. Pressing the active tab again still calls `onSelect` (the room uses it to go back, e.g. out of the shelves).
 */
export const TAB_IDS = ['pantry', 'list', 'recipes', 'me', 'household'] as const;
export type TabId = (typeof TAB_IDS)[number];

export const TAB_META: Record<TabId, { label: string; hint: string; Icon: LucideIcon }> = {
  pantry: { label: 'Pantry', hint: 'Shows the pantry', Icon: DoorClosed },
  list: { label: 'List', hint: 'Zooms in on the shopping list pinned to the pantry', Icon: List },
  recipes: { label: 'Recipes', hint: 'Goes to the recipe books', Icon: BookOpen },
  me: { label: 'Me', hint: 'Goes to your chalkboard: preferences, allergies, profile and appearance', Icon: User },
  household: { label: 'Household', hint: 'Goes to the household cork board: members, invites and alerts', Icon: Users },
};

/** Height of the bar above the safe area; screens use it to keep toasts and bottom bars clear. */
export const TAB_BAR_HEIGHT = size.tabBar;

export type TabBarProps = {
  active: TabId;
  onSelect: (id: TabId) => void;
  /** Numeric badges per tab (e.g. Household alerts); 0 / missing = no badge. */
  badges?: Partial<Record<TabId, number>>;
};

export function TabBar({ active, onSelect, badges }: TabBarProps) {
  const insets = useSafeAreaInsets();
  return (
    <View style={[styles.bar, { paddingBottom: insets.bottom, minHeight: size.tabBar + insets.bottom }]} accessibilityRole="tablist">
      {TAB_IDS.map((id) => {
        const meta = TAB_META[id];
        const focused = active === id;
        const tint = focused ? color.primary : color.muted;
        const badge = badges?.[id];
        const showBadge = badge != null && badge > 0;
        return (
          <Pressable
            key={id}
            testID={`tabbar-${id}`}
            accessibilityRole="tab"
            accessibilityLabel={showBadge ? `${meta.label}, ${badge} alerts` : meta.label}
            accessibilityHint={meta.hint}
            accessibilityState={{ selected: focused }}
            onPress={() => onSelect(id)}
            style={styles.tab}>
            <View style={[styles.indicator, focused && styles.indicatorOn]} />
            <View>
              <meta.Icon size={22} color={tint} />
              {showBadge ? (
                <View style={styles.badge} testID={`tabbar-${id}-badge`}>
                  <AppText variant="micro" weight="heavy" color="onPrimary" style={styles.badgeText}>
                    {String(badge)}
                  </AppText>
                </View>
              ) : null}
            </View>
            <AppText
              variant="micro"
              weight="bold"
              color={focused ? 'primary' : 'muted'}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.8}
              style={styles.label}>
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
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 2, minHeight: size.hit, paddingVertical: 4 },
  indicator: { position: 'absolute', top: 0, left: 12, right: 12, height: 3, backgroundColor: 'transparent' },
  indicatorOn: { backgroundColor: color.primary },
  badge: {
    position: 'absolute',
    top: -4,
    left: 14,
    minWidth: 18,
    height: 18,
    paddingHorizontal: 4,
    borderRadius: 9,
    backgroundColor: color.dangerFg,
    alignItems: 'center',
    justifyContent: 'center',
  },
  badgeText: { fontSize: 11, lineHeight: 14, letterSpacing: 0 },
  // five tabs on a 375 pt phone: no extra tracking, so "HOUSEHOLD" fits
  label: { letterSpacing: 0, paddingHorizontal: 2 },
});
