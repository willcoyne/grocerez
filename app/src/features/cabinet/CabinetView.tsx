import type { CabinetItem } from '@contracts/models';
import { StyleSheet, View } from 'react-native';

import { AppText, Button, Card, DashedEmpty, StatusChip } from '@/components/ui';
import { humanize } from '@/lib/format';
import { space } from '@/theme';

export type CabinetViewProps = {
  /** Server-sorted (aisle order). Not re-sorted here. */
  rows: CabinetItem[];
  /** itemIds that are running low and wanted by someone (on the shopping list). */
  alsoOnList: ReadonlySet<string>;
  /** Cabinet row id with a request in flight (its buttons are disabled). */
  pendingRowId?: string | null;
  onLow: (row: CabinetItem) => void;
  onBackInStock: (row: CabinetItem) => void;
  onRanOut: (row: CabinetItem) => void;
};

export const CABINET_EMPTY_COPY =
  'Your cabinet is empty. Finish a shopping trip, or add what you already have below. This step is optional.';

/**
 * Presentational cabinet (DESIGN.md §4.6, §9). Rows carry itemId, category and location so a future
 * 3D pantry view can replace this component while keeping useCabinet().
 */
export function CabinetView({ rows, alsoOnList, pendingRowId, onLow, onBackInStock, onRanOut }: CabinetViewProps) {
  if (rows.length === 0) return <DashedEmpty testID="cabinet-empty">{CABINET_EMPTY_COPY}</DashedEmpty>;
  return (
    <View style={styles.list}>
      {rows.map((row) => (
        <CabinetRow
          key={row.id}
          row={row}
          alsoOnList={alsoOnList.has(row.itemId)}
          busy={pendingRowId === row.id}
          onLow={onLow}
          onBackInStock={onBackInStock}
          onRanOut={onRanOut}
        />
      ))}
    </View>
  );
}

type RowProps = Omit<CabinetViewProps, 'rows' | 'alsoOnList' | 'pendingRowId'> & {
  row: CabinetItem;
  alsoOnList: boolean;
  busy: boolean;
};

function CabinetRow({ row, alsoOnList, busy, onLow, onBackInStock, onRanOut }: RowProps) {
  const { name, category } = row.item;
  const low = row.status === 'running_low';
  const meta = `${humanize(category)}${low && alsoOnList ? ' · also on the shopping list' : ''}`;
  return (
    <Card testID={`row-${row.itemId}`} style={styles.row}>
      <View style={styles.top}>
        <View style={styles.text}>
          <AppText variant="bodyL" weight="heavy">
            {name}
          </AppText>
          <AppText variant="caption" color="muted" testID={`row-${row.itemId}-meta`}>
            {meta}
          </AppText>
        </View>
        <StatusChip
          large
          tone={low ? 'warn' : 'ok'}
          label={low ? 'Running low' : 'In stock'}
          testID={`row-${row.itemId}-status`}
        />
      </View>
      <View style={styles.actions}>
        {low ? (
          <Button
            label="Back in stock"
            variant="secondary"
            size="sm"
            flex
            disabled={busy}
            accessibilityLabel={`Mark ${name} back in stock`}
            onPress={() => onBackInStock(row)}
            testID={`row-${row.itemId}-instock`}
          />
        ) : (
          <Button
            label="Running low"
            variant="secondary"
            size="sm"
            flex
            disabled={busy}
            accessibilityLabel={`Mark ${name} running low`}
            onPress={() => onLow(row)}
            testID={`row-${row.itemId}-low`}
          />
        )}
        <Button
          label="Ran out"
          variant="danger-secondary"
          size="sm"
          flex
          disabled={busy}
          accessibilityLabel={`${name} ran out`}
          onPress={() => onRanOut(row)}
          testID={`row-${row.itemId}-ranout`}
        />
      </View>
    </Card>
  );
}

const styles = StyleSheet.create({
  list: { gap: space.sm },
  row: { gap: 10 },
  top: { flexDirection: 'row', alignItems: 'flex-start', gap: space.sm, flexWrap: 'wrap' },
  text: { flex: 1, minWidth: 140 },
  actions: { flexDirection: 'row', gap: space.sm },
});
