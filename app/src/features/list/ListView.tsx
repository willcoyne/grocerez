import type { Item, Member, ShoppingListItem } from '@contracts/models';
import { ScrollView, StyleSheet, View, type LayoutChangeEvent } from 'react-native';

import { AppText, Button, DashedEmpty, ErrorState, LoadingState } from '@/components/ui';
import { ItemAddField } from '@/features/items/ItemAddField';
import { color, space } from '@/theme';

import { ListRow } from './ListRow';

export type ListViewProps = {
  status: 'loading' | 'error' | 'ready';
  rows: ShoppingListItem[];
  meId: string | undefined;
  members: Pick<Member, 'id' | 'displayName'>[];
  /** itemIds that are `running_low` in the cabinet. */
  runningLowItemIds: Set<string>;
  /** Row ids whose check-off is still syncing. */
  syncingIds: Set<string>;
  finishing: boolean;
  onRetry: () => void;
  onToggle: (row: ShoppingListItem) => void;
  onAddItem: (item: Item) => Promise<void>;
  onFinish: () => void;
  onFinishBarLayout?: (height: number) => void;
};

/** Presentational List tab body (DESIGN.md §4.5, §9): rows, the add field and the Finish bar. */
export function ListView({
  status,
  rows,
  meId,
  members,
  runningLowItemIds,
  syncingIds,
  finishing,
  onRetry,
  onToggle,
  onAddItem,
  onFinish,
  onFinishBarLayout,
}: ListViewProps) {
  const checked = rows.filter((r) => r.checked).length;
  const toBuy = rows.length - checked;

  return (
    <View style={styles.fill}>
      <ScrollView style={styles.fill} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {status === 'loading' ? <LoadingState testID="list-loading" /> : null}
        {status === 'error' ? <ErrorState onRetry={onRetry} testID="list-error" /> : null}
        {status === 'ready' ? (
          <>
            {rows.length === 0 ? (
              <DashedEmpty testID="list-empty">
                Nothing to buy. Everything you all want is already in the cabinet.
              </DashedEmpty>
            ) : (
              <>
                <AppText variant="bodyS" weight="semi" color="ink2" testID="list-summary">
                  {`${toBuy} to buy · ${checked} in the cart`}
                </AppText>
                <View style={styles.rows}>
                  {rows.map((row) => (
                    <ListRow
                      key={row.id}
                      row={row}
                      meId={meId}
                      members={members}
                      runningLow={runningLowItemIds.has(row.itemId)}
                      syncing={syncingIds.has(row.id)}
                      onToggle={onToggle}
                    />
                  ))}
                </View>
              </>
            )}
            <ItemAddField
              label="Out of something? Add it to the list"
              placeholder="e.g. paper towels"
              buttonVariant="secondary"
              testID="list-add"
              onItem={onAddItem}
            />
          </>
        ) : null}
      </ScrollView>
      {status === 'ready' ? (
        <View
          style={styles.finishBar}
          testID="finish-bar"
          onLayout={(e: LayoutChangeEvent) => onFinishBarLayout?.(e.nativeEvent.layout.height)}>
          <Button
            size="lg"
            fullWidth
            variant="primary"
            disabled={checked === 0}
            loading={finishing}
            label={checked === 0 ? 'Check items off as you shop' : `Finish trip · move ${checked} to the cabinet`}
            onPress={onFinish}
            testID="finish-trip"
          />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  fill: { flex: 1 },
  content: { paddingHorizontal: space.screenX, paddingVertical: space.lg, gap: space.md },
  rows: { gap: space.sm },
  finishBar: {
    paddingTop: 10,
    paddingHorizontal: space.screenX,
    paddingBottom: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
});
