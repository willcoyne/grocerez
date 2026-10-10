import type { Item, ShoppingListItem } from '@contracts/models';
import { useIsFocused } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import { StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useCabinet } from '@/api/hooks/useCabinet';
import { useGroup } from '@/api/hooks/useGroup';
import { useMe } from '@/api/hooks/useMe';
import {
  useAddToList,
  useFinishTrip,
  useShoppingList,
  useSyncingListIds,
  useToggleListItem,
} from '@/api/hooks/useShoppingList';
import { ScreenHeader, TAB_BAR_HEIGHT, useToast, useToastBottomInset } from '@/components/ui';
import { ListView } from '@/features/list/ListView';
import { plural } from '@/lib/format';
import { useSocketConnected } from '@/realtime/useRealtime';
import { color } from '@/theme';

/** Estimate until the Finish bar reports its real height (padding 10 + 12, border 1, button 52). */
const FINISH_BAR_ESTIMATE = 75;
const POLL_MS = 5000;

/** List tab (DESIGN.md §4.5): data hooks here, presentation in ListView. */
export default function ListScreen() {
  const insets = useSafeAreaInsets();
  const toast = useToast();
  const focused = useIsFocused();
  const socketUp = useSocketConnected();

  const list = useShoppingList({ refetchInterval: focused && !socketUp ? POLL_MS : false });
  const cabinet = useCabinet();
  const group = useGroup();
  const me = useMe();
  const syncingIds = useSyncingListIds();
  const toggle = useToggleListItem();
  const addToList = useAddToList();
  const finish = useFinishTrip();

  const [finishBarHeight, setFinishBarHeight] = useState(FINISH_BAR_ESTIMATE);
  useToastBottomInset(TAB_BAR_HEIGHT + insets.bottom + finishBarHeight);

  const runningLowItemIds = useMemo(
    () => new Set((cabinet.data ?? []).filter((c) => c.status === 'running_low').map((c) => c.itemId)),
    [cabinet.data],
  );

  const onToggle = useCallback(
    (row: ShoppingListItem) => {
      toggle.mutate(
        { id: row.id, checked: !row.checked },
        { onError: () => toast.show('Something went wrong. Try again.') },
      );
    },
    [toggle, toast],
  );

  const onAddItem = useCallback(
    async (item: Item) => {
      const { alreadyOnList } = await addToList.mutateAsync({ itemId: item.id });
      toast.show(alreadyOnList ? `${item.name} is already on the list` : `Added ${item.name} to the shopping list`);
    },
    [addToList, toast],
  );

  const onFinish = useCallback(() => {
    finish.mutate(undefined, {
      onSuccess: ({ movedToCabinet }) => toast.show(`${plural(movedToCabinet, 'item')} moved to the cabinet`),
      onError: () => toast.show('Something went wrong. Try again.'),
    });
  }, [finish, toast]);

  const status = list.isError && !list.data ? 'error' : list.data ? 'ready' : 'loading';

  return (
    <View testID="tab-list" style={styles.root}>
      <ScreenHeader
        title="Shopping list"
        groupName={group.data?.name}
        memberCount={group.data?.memberCount ?? group.data?.members.length}
      />
      <ListView
        status={status}
        rows={list.data ?? []}
        meId={me.data?.id}
        members={group.data?.members ?? []}
        runningLowItemIds={runningLowItemIds}
        syncingIds={syncingIds}
        finishing={finish.isPending}
        onRetry={() => void list.refetch()}
        onToggle={onToggle}
        onAddItem={onAddItem}
        onFinish={onFinish}
        onFinishBarLayout={(h) => h > 0 && setFinishBarHeight(Math.round(h))}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: color.bg },
});
