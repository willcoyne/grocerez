import { X } from 'lucide-react-native';
import { Pressable, StyleSheet, View } from 'react-native';

import { AppText, Button, Card, StatusChip } from '@/components/ui';
import { color, pressedOpacity, size, space } from '@/theme';

import type { PrefRow } from './useMeScreen';

/** One of my preferences: name, recurrence + status chips, Make one-time/staple, and ✕ remove. */
export function PreferenceRow({
  row,
  onToggleRecurrence,
  onRemove,
}: {
  row: PrefRow;
  onToggleRecurrence: () => void;
  onRemove: () => void;
}) {
  const name = row.item.name;
  const staple = row.recurrence === 'staple';
  return (
    <Card style={styles.card} testID={`row-${row.itemId}`}>
      <View style={styles.main}>
        <AppText variant="bodyL" weight="heavy">
          {name}
        </AppText>
        <View style={styles.chips}>
          <StatusChip tone="neutral" label={staple ? 'Staple' : 'This week only'} />
          <StatusChip tone={row.inCabinet ? 'ok' : 'warn'} label={row.inCabinet ? 'In cabinet' : 'On the list'} />
        </View>
      </View>
      <View style={styles.actions}>
        <Button
          label={staple ? 'Make one-time' : 'Make staple'}
          variant="ghost"
          size="sm"
          onPress={onToggleRecurrence}
          accessibilityLabel={staple ? `Make ${name} one-time` : `Make ${name} a staple`}
          testID={`row-${row.itemId}-recurrence`}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${name}`}
          onPress={onRemove}
          testID={`row-${row.itemId}-remove`}
          style={({ pressed }) => [styles.remove, pressed && { opacity: pressedOpacity }]}>
          <X size={20} color={color.ink2} />
        </Pressable>
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    paddingTop: space.sm,
    paddingRight: 6,
    paddingBottom: space.sm,
    paddingLeft: space.lg,
    gap: space.xs,
  },
  main: { flex: 1, minWidth: 140, gap: space.xs },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: space.xs },
  actions: { flexDirection: 'row', alignItems: 'center', marginLeft: 'auto' },
  remove: { width: size.hit, height: size.hit, alignItems: 'center', justifyContent: 'center' },
});
