import type { Member, ShoppingListItem } from '@contracts/models';
import { StyleSheet, View } from 'react-native';

import { AppText, Card, Checkbox, StatusChip } from '@/components/ui';
import { allergenLabel, nameFor, namesFor } from '@/lib/format';
import { color, radius, space } from '@/theme';

export type ListRowProps = {
  row: ShoppingListItem;
  meId: string | undefined;
  members: Pick<Member, 'id' | 'displayName'>[];
  runningLow: boolean;
  syncing: boolean;
  onToggle: (row: ShoppingListItem) => void;
};

function metaFor(row: ShoppingListItem, meId: string | undefined, members: ListRowProps['members']): string {
  if (row.checked) {
    return `In the cart · checked by ${nameFor(row.checkedBy ?? '', meId, members)}`;
  }
  if (row.reason === 'manual') return "Not in anyone's preferences";
  return `For ${namesFor(row.wantedBy, meId, members)}`;
}

/** One shopping-list row (DESIGN.md §4.5). */
export function ListRow({ row, meId, members, runningLow, syncing, onToggle }: ListRowProps) {
  const name = row.item.name;
  const chips: { key: string; label: string; tone: 'danger' | 'warn' | 'neutral' }[] = [
    ...row.allergenFlags.map((f) => ({
      key: `a-${f.userId}-${f.allergen}`,
      label: `Contains ${allergenLabel(f.allergen)} · ${f.userId === meId ? 'you' : f.displayName}`,
      tone: 'danger' as const,
    })),
    ...(runningLow ? [{ key: 'low', label: 'Running low at home', tone: 'warn' as const }] : []),
    ...(row.reason === 'manual' ? [{ key: 'manual', label: 'Added by hand', tone: 'neutral' as const }] : []),
  ];

  return (
    <Card muted={row.checked} style={styles.card} testID={`row-${row.itemId}`}>
      <Checkbox checked={row.checked} name={name} onPress={() => onToggle(row)} testID={`row-${row.itemId}-check`} />
      <View style={styles.body}>
        <View style={styles.titleLine}>
          <AppText variant="bodyL" weight="heavy" color={row.checked ? 'muted' : 'ink'} strike={row.checked} style={styles.name}>
            {name}
          </AppText>
          {syncing ? (
            <View
              style={styles.syncDot}
              accessible
              accessibilityLabel="Syncing"
              testID={`row-${row.itemId}-syncing`}
            />
          ) : null}
        </View>
        <AppText variant="caption" color="muted">
          {metaFor(row, meId, members)}
        </AppText>
        {chips.length > 0 ? (
          <View style={styles.chips}>
            {chips.map((c) => (
              <StatusChip key={c.key} label={c.label} tone={c.tone} />
            ))}
          </View>
        ) : null}
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: space.sm,
    paddingTop: space.sm,
    paddingRight: space.md,
    paddingBottom: 10,
    paddingLeft: 6,
  },
  body: { flex: 1, gap: 2, paddingTop: space.sm },
  titleLine: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  name: { flexShrink: 1 },
  syncDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: color.muted },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: space.xs },
});
