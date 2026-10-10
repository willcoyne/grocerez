import type { CabinetItem, Item } from '@contracts/models';
import { useMemo, useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { useAddToCabinet, useCabinet, useRanOut, useSetCabinetStatus } from '@/api/hooks/useCabinet';
import { useGroup } from '@/api/hooks/useGroup';
import { useAddToList, useShoppingList } from '@/api/hooks/useShoppingList';
import { AppText, ErrorState, LoadingState, ScreenHeader, useToast } from '@/components/ui';
import { ItemAddField } from '@/features/items/ItemAddField';
import { plural } from '@/lib/format';
import { color, space } from '@/theme';

import { CabinetView } from './CabinetView';
import { RanOutPrompt } from './RanOutPrompt';

const FAIL = 'Something went wrong. Try again.';

/** Cabinet tab (DESIGN.md §4.6): data hooks + CabinetView. */
export function CabinetScreen() {
  const toast = useToast();
  const scrollRef = useRef<ScrollView>(null);
  const group = useGroup();
  const cabinet = useCabinet();
  const list = useShoppingList();
  const setStatus = useSetCabinetStatus();
  const ranOut = useRanOut();
  const addToCabinet = useAddToCabinet();
  const addToList = useAddToList();
  const [prompt, setPrompt] = useState<{ itemId: string; name: string } | null>(null);

  const alsoOnList = useMemo(
    () => new Set((list.data ?? []).filter((r) => r.reason === 'preference').map((r) => r.itemId)),
    [list.data],
  );

  const pendingRowId =
    (setStatus.isPending ? setStatus.variables?.id : undefined) ?? (ranOut.isPending ? ranOut.variables?.id : undefined) ?? null;

  const onLow = async (row: CabinetItem) => {
    try {
      const { wantedOnList } = await setStatus.mutateAsync({ id: row.id, status: 'running_low' });
      toast.show(wantedOnList ? `${row.item.name} is running low, so it's on the list` : `Marked ${row.item.name} running low`);
    } catch {
      toast.show(FAIL);
    }
  };

  const onBackInStock = async (row: CabinetItem) => {
    try {
      await setStatus.mutateAsync({ id: row.id, status: 'in_stock' });
    } catch {
      toast.show(FAIL);
    }
  };

  const onRanOut = async (row: CabinetItem) => {
    try {
      const { requeued } = await ranOut.mutateAsync({ id: row.id });
      if (requeued) {
        toast.show(`${row.item.name} is back on the shopping list`);
      } else {
        setPrompt({ itemId: row.itemId, name: row.item.name });
        scrollRef.current?.scrollTo({ y: 0, animated: false });
      }
    } catch {
      toast.show(FAIL);
    }
  };

  const onPromptAdd = async () => {
    if (!prompt) return;
    try {
      await addToList.mutateAsync({ itemId: prompt.itemId });
      toast.show(`${prompt.name} added to the shopping list`);
      setPrompt(null);
    } catch {
      toast.show(FAIL);
    }
  };

  const onAddItem = async (item: Item) => {
    await addToCabinet.mutateAsync({ itemId: item.id });
    toast.show(`${item.name} is in the cabinet`);
  };

  const rows = cabinet.data;

  return (
    <View testID="tab-cabinet" style={styles.root}>
      <ScreenHeader groupName={group.data?.name} memberCount={group.data?.members.length} title="Cabinet" />
      <ScrollView ref={scrollRef} contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        {prompt ? (
          <RanOutPrompt
            name={prompt.name}
            busy={addToList.isPending}
            onAdd={() => void onPromptAdd()}
            onDismiss={() => setPrompt(null)}
          />
        ) : null}
        {cabinet.isError && !rows ? (
          <ErrorState onRetry={() => void cabinet.refetch()} />
        ) : !rows ? (
          <LoadingState />
        ) : (
          <>
            <AppText variant="bodyS" weight="semi" color="ink2" testID="cabinet-summary">
              {`${plural(rows.length, 'item')} in the house`}
            </AppText>
            <CabinetView
              rows={rows}
              alsoOnList={alsoOnList}
              pendingRowId={pendingRowId}
              onLow={(r) => void onLow(r)}
              onBackInStock={(r) => void onBackInStock(r)}
              onRanOut={(r) => void onRanOut(r)}
            />
            <ItemAddField
              label="Map out the cabinet (optional): add what you have"
              placeholder="e.g. rice"
              buttonVariant="secondary"
              testID="cabinet-add"
              onItem={onAddItem}
            />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
  content: { paddingHorizontal: space.screenX, paddingTop: space.lg, paddingBottom: 120, gap: space.md },
});
