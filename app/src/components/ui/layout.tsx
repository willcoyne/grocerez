import { ActivityIndicator, Pressable, StyleSheet, View, type StyleProp, type ViewProps, type ViewStyle } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { hashString, plural } from '@/lib/format';
import { color, radius, size, space } from '@/theme';

import { AppText } from './AppText';
import { Button } from './Button';

export type CardProps = ViewProps & { muted?: boolean; style?: StyleProp<ViewStyle> };

/** surface, 1px border, radius 14, padding 12. `muted` → surfaceMuted (checked rows). */
export function Card({ muted, style, ...rest }: CardProps) {
  return <View style={[styles.card, muted && styles.cardMuted, style]} {...rest} />;
}

/** Dashed empty-state box. Pass text as children (string) or custom content. */
export function DashedEmpty({ children, style, testID }: { children: React.ReactNode; style?: StyleProp<ViewStyle>; testID?: string }) {
  return (
    <View style={[styles.dashed, style]} testID={testID}>
      {typeof children === 'string' ? (
        <AppText color="ink2" center>
          {children}
        </AppText>
      ) : (
        children
      )}
    </View>
  );
}

/** Error state for every list screen (DESIGN.md §4): "Something went wrong." + Retry. */
export function ErrorState({
  onRetry,
  message,
  testID = 'error-state',
}: {
  onRetry?: () => void;
  /** Optional detail under the headline (e.g. the API error message). */
  message?: string;
  testID?: string;
}) {
  return (
    <DashedEmpty testID={testID}>
      <View style={styles.errorBody}>
        <AppText color="ink2" center>
          Something went wrong.
        </AppText>
        {message ? (
          <AppText variant="caption" color="muted" center>
            {message}
          </AppText>
        ) : null}
        {onRetry ? <Button label="Retry" variant="secondary" size="sm" onPress={onRetry} testID={`${testID}-retry`} /> : null}
      </View>
    </DashedEmpty>
  );
}

/** Loading state for list screens. */
export function LoadingState({ testID = 'loading-state' }: { testID?: string }) {
  return (
    <View style={styles.loading} testID={testID}>
      <ActivityIndicator color={color.primary} accessibilityLabel="Loading" />
    </View>
  );
}

export function SectionLabel({ children, style }: { children: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View style={style}>
      <AppText variant="micro" weight="bold" color="muted" uppercase accessibilityRole="header">
        {children}
      </AppText>
    </View>
  );
}

/**
 * Tab screen header: "{groupName} · {n} members" over the title.
 * `onGroupPress` makes the group line a button (household switcher); `right` sits beside the title.
 */
export function ScreenHeader({
  groupName,
  memberCount,
  title,
  onGroupPress,
  groupHint,
  right,
}: {
  groupName?: string;
  memberCount?: number;
  title: string;
  onGroupPress?: () => void;
  /** Trailing text on the group line, e.g. "Switch". */
  groupHint?: string;
  right?: React.ReactNode;
}) {
  const insets = useSafeAreaInsets();
  const groupLine = groupName ? (
    <AppText variant="caption" weight="semi" color="muted" numberOfLines={1}>
      {`${groupName} · ${plural(memberCount ?? 0, 'member')}`}
      {groupHint ? <AppText variant="caption" weight="bold" color="primary">{`  ${groupHint}`}</AppText> : null}
    </AppText>
  ) : null;
  return (
    <View style={[styles.header, { paddingTop: insets.top + 10 }]}>
      {groupLine && onGroupPress ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Household ${groupName}. Switch household`}
          onPress={onGroupPress}
          hitSlop={{ top: 12, bottom: 12 }}
          style={styles.groupBtn}>
          {groupLine}
        </Pressable>
      ) : (
        groupLine
      )}
      <View style={styles.titleRow}>
        <AppText variant="tabTitle" accessibilityRole="header" style={styles.flex}>
          {title}
        </AppText>
        {right}
      </View>
    </View>
  );
}

/** Decorative initial avatar; color from a stable hash of the user ID. */
export function Avatar({ userId, name, large }: { userId: string; name: string; large?: boolean }) {
  const d = large ? size.avatarLg : size.avatar;
  const bg = color.avatar[hashString(userId) % color.avatar.length];
  return (
    <View
      accessible={false}
      importantForAccessibility="no-hide-descendants"
      style={[styles.avatar, { width: d, height: d, borderRadius: d / 2, backgroundColor: bg }]}>
      <AppText variant="bodyL" weight="heavy">
        {name.trim().charAt(0).toUpperCase() || '?'}
      </AppText>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: color.surface,
    borderWidth: 1,
    borderColor: color.border,
    borderRadius: radius.card,
    padding: space.md,
  },
  cardMuted: { backgroundColor: color.surfaceMuted },
  dashed: {
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: color.borderDashed,
    borderRadius: radius.card,
    paddingVertical: 24,
    paddingHorizontal: space.xl,
    alignItems: 'center',
  },
  errorBody: { alignItems: 'center', gap: space.md },
  loading: { paddingVertical: 32, alignItems: 'center' },
  header: {
    paddingHorizontal: space.screenX,
    paddingBottom: space.md,
    borderBottomWidth: 1,
    borderBottomColor: color.border,
    backgroundColor: color.bg,
  },
  avatar: { alignItems: 'center', justifyContent: 'center' },
  groupBtn: { alignSelf: 'flex-start' },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  flex: { flex: 1 },
});
