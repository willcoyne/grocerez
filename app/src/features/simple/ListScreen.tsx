import { useMutationState } from "@tanstack/react-query";
import { useIsFocused, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { type LayoutChangeEvent, RefreshControl, SectionList, StyleSheet, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";

import { errorMessage } from "@/api/client";
import { usePrices } from "@/api/hooks/ai";
import { useCabinet } from "@/api/hooks/cabinet";
import { useGroupDetail } from "@/api/hooks/groups";
import { useAddListItem, useCheckItem, useCompleteTrip, useDeleteListItem, useShoppingList } from "@/api/hooks/shoppingList";
import { RecallBanner } from "@/components/AlertsSection";
import { TabHeader } from "@/components/GroupSwitcher";
import { InviteBanner } from "@/components/InviteBanner";
import { ItemPicker } from "@/components/ItemPicker";
import {
  AiLabel,
  AppText,
  Button,
  DashedEmpty,
  ErrorState,
  InlineAdd,
  LoadingState,
  SectionLabel,
  TAB_BAR_HEIGHT,
  useToast,
  useToastBottomInset,
} from "@/components/ui";
import { ListRow } from "@/features/list/ListRow";
import { confirm } from "@/lib/confirm";
import { formatCents, formatCentsRange, plural } from "@/lib/format";
import { toSections } from "@/lib/listSections";
import { maybeAskNotificationPermission } from "@/notifications/expirations";
import { useSocketConnected } from "@/realtime/SocketProvider";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { color, space } from "@/theme";

import { RoomModeButton } from "./InterfaceChoice";

/** Simple interface List tab (DESIGN.md §4.5): rows in aisle sections, optimistic check-off, add field, Finish bar. */
export default function ListScreen() {
  const groupId = useRequiredGroupId();
  const connected = useSocketConnected();
  const focused = useIsFocused();
  // Live sync comes from the socket; while it's down, poll every 5 s on this screen.
  const list = useShoppingList(groupId, { refetchInterval: !connected && focused ? 5000 : false });
  const detail = useGroupDetail(groupId);
  const cabinet = useCabinet(groupId);
  const check = useCheckItem(groupId);
  const add = useAddListItem(groupId);
  const del = useDeleteListItem(groupId);
  const complete = useCompleteTrip(groupId);
  const { user } = useAuth();
  const router = useRouter();
  const { show: toast } = useToast();
  const insets = useSafeAreaInsets();
  const [addText, setAddText] = useState("");
  const [picking, setPicking] = useState(false);
  const [barHeight, setBarHeight] = useState(0);
  useToastBottomInset(TAB_BAR_HEIGHT + insets.bottom + barHeight);

  const syncing = useMutationState({
    filters: { mutationKey: ["check", groupId], status: "pending" },
    select: (m) => (m.state.variables as { id: string } | undefined)?.id,
  });
  const syncingIds = useMemo(() => new Set(syncing), [syncing]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of detail.data?.members ?? []) m.set(mem.id, mem.displayName);
    return m;
  }, [detail.data]);

  const lowItemIds = useMemo(
    () => new Set((cabinet.data ?? []).filter((c) => c.status === "running_low").map((c) => c.itemId)),
    [cabinet.data],
  );

  const sections = useMemo(() => toSections(list.data ?? []), [list.data]);
  // Read-only view of the cached estimate (fetched from the Prices modal).
  const prices = usePrices(groupId, { enabled: false }).data;
  /** itemId → "~$3.49" for the rows (from the last estimate). */
  const priceById = useMemo(
    () => new Map((prices?.items ?? []).map((p) => [p.itemId, `~${formatCents(p.typicalCents ?? Math.round((p.lowCents + p.highCents) / 2))}`])),
    [prices],
  );
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  const rows = list.data ?? [];
  const checkedRows = rows.filter((r) => r.checked);
  const toBuy = rows.length - checkedRows.length;

  async function finishTrip() {
    const n = checkedRows.length;
    if (!(await confirm("Finish trip?", `Move ${plural(n, "checked item")} to the cabinet?`, "Finish trip"))) return;
    const itemIds = checkedRows.map((r) => r.itemId);
    complete.mutate(undefined, {
      onSuccess: ({ movedToCabinet }) => {
        toast(`${plural(movedToCabinet, "item")} moved to the cabinet`);
        void maybeAskNotificationPermission();
        if (movedToCabinet > 0) router.push(`/expiration-check?itemIds=${itemIds.join(",")}`);
      },
      onError,
    });
  }

  function openPicker() {
    setPicking(true);
  }

  let body: React.ReactNode;
  if (list.isPending) body = <LoadingState />;
  else if (list.isError)
    body = (
      <View style={styles.pad}>
        <ErrorState message={errorMessage(list.error)} onRetry={() => void list.refetch()} />
      </View>
    );
  else
    body = (
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
        ListHeaderComponent={
          <View style={styles.headerBlock}>
            <InviteBanner />
            <RecallBanner groupId={groupId} />
            {rows.length > 0 ? (
              <AppText variant="bodyS" weight="semi" color="ink2">
                {`${toBuy} to buy · ${checkedRows.length} in the cart`}
              </AppText>
            ) : (
              <DashedEmpty>Nothing to buy. Everything you all want is already in the cabinet.</DashedEmpty>
            )}
            {rows.length > 0 ? (
              <View style={styles.priceRow}>
                <Button
                  label={prices ? `Est. ${formatCentsRange(prices.totalLowCents, prices.totalHighCents, true)}` : "Estimate prices"}
                  accessibilityLabel={
                    prices
                      ? `Estimated total ${formatCentsRange(prices.totalLowCents, prices.totalHighCents, true)}. Open prices`
                      : "Estimate prices"
                  }
                  variant="secondary"
                  size="sm"
                  onPress={() => router.push("/prices")}
                />
                <AiLabel text="AI estimate" />
              </View>
            ) : null}
            {!connected ? (
              <AppText variant="caption" color="muted">
                Live updates paused · refreshing every 5 s
              </AppText>
            ) : null}
          </View>
        }
        renderSectionHeader={({ section }) => <SectionLabel style={styles.section}>{section.title}</SectionLabel>}
        renderItem={({ item: row }) => (
          <ListRow
            row={row}
            meId={user?.id}
            names={names}
            runningLow={lowItemIds.has(row.itemId)}
            syncing={syncingIds.has(row.id)}
            priceText={priceById.get(row.itemId)}
            onToggle={(r) => check.mutate({ id: r.id, checked: !r.checked }, { onError })}
            onScan={(r) => router.push(`/scanner?mode=match-list-item&listItemId=${r.id}`)}
            onDelete={(r) => del.mutate(r.id, { onError })}
          />
        )}
        ItemSeparatorComponent={Gap}
        ListFooterComponent={
          <View style={styles.footer}>
            <InlineAdd
              label="Out of something? Add it to the list"
              placeholder="e.g. paper towels"
              value={addText}
              onChangeText={setAddText}
              onSubmit={openPicker}
              testID="list-add"
            />
          </View>
        }
      />
    );

  return (
    <View style={styles.flex} testID="tab-list">
      <TabHeader title="Shopping list" right={<RoomModeButton />} />
      <View style={styles.flex}>{body}</View>
      {rows.length > 0 ? (
        <View style={styles.finishBar} onLayout={(e: LayoutChangeEvent) => setBarHeight(e.nativeEvent.layout.height)}>
          <Button
            size="lg"
            fullWidth
            variant="primary"
            label={
              complete.isPending
                ? "Finishing…"
                : checkedRows.length === 0
                  ? "Check items off as you shop"
                  : `Finish trip · move ${checkedRows.length} to the cabinet`
            }
            disabled={checkedRows.length === 0 || complete.isPending}
            onPress={finishTrip}
            testID="finish-trip"
          />
        </View>
      ) : null}
      <ItemPicker
        visible={picking}
        title="Add to the list"
        initialText={addText.trim()}
        onClose={() => setPicking(false)}
        onPick={(item) =>
          add.mutate(
            { itemId: item.id },
            {
              onSuccess: () => {
                setAddText("");
                toast(`Added ${item.name} to the shopping list`);
              },
              onError,
            },
          )
        }
      />
    </View>
  );
}

function Gap() {
  return <View style={styles.gap} />;
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: space.screenX },
  content: { paddingHorizontal: space.screenX, paddingTop: space.lg, paddingBottom: space.xxl },
  headerBlock: { gap: space.md, marginBottom: space.xs },
  priceRow: { flexDirection: "row", alignItems: "center", gap: space.sm },
  section: { paddingTop: space.lg, paddingBottom: space.sm },
  gap: { height: space.sm },
  footer: { marginTop: space.xl },
  finishBar: {
    paddingTop: 10,
    paddingHorizontal: space.screenX,
    paddingBottom: space.md,
    borderTopWidth: 1,
    borderTopColor: color.border,
    backgroundColor: color.bg,
  },
});
