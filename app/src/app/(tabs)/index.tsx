import type { ShoppingListItem } from "@contracts/shoppingList";
import { useMutationState } from "@tanstack/react-query";
import { useIsFocused, useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { usePrices } from "@/api/hooks/ai";
import { useGroupDetail } from "@/api/hooks/groups";
import { useAddListItem, useCheckItem, useCompleteTrip, useDeleteListItem, useShoppingList } from "@/api/hooks/shoppingList";
import { RecallBanner } from "@/components/AlertsSection";
import { AllergenBadge } from "@/components/Badges";
import { InviteBanner } from "@/components/InviteBanner";
import { ItemPicker } from "@/components/ItemPicker";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useToast } from "@/components/Toast";
import { Button, Chip, IconButton } from "@/components/ui";
import { confirm } from "@/lib/confirm";
import { formatCentsRange } from "@/lib/format";
import { toSections } from "@/lib/listSections";
import { maybeAskNotificationPermission } from "@/notifications/expirations";
import { useSocketConnected } from "@/realtime/SocketProvider";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { useAuth } from "@/state/AuthContext";
import { colors, fontSize, radius, spacing, TAP_TARGET } from "@/theme";

export default function ListScreen() {
  const groupId = useRequiredGroupId();
  const connected = useSocketConnected();
  const focused = useIsFocused();
  // Live sync comes from the socket; while it's down, poll every 5 s on this screen.
  const list = useShoppingList(groupId, { refetchInterval: !connected && focused ? 5000 : false });
  const detail = useGroupDetail(groupId);
  const check = useCheckItem(groupId);
  const add = useAddListItem(groupId);
  const del = useDeleteListItem(groupId);
  const complete = useCompleteTrip(groupId);
  const { user } = useAuth();
  const router = useRouter();
  const toast = useToast();
  const [picking, setPicking] = useState(false);

  const syncing = useMutationState({
    filters: { mutationKey: ["check", groupId], status: "pending" },
    select: (m) => (m.state.variables as { id: string } | undefined)?.id,
  });
  const syncingIds = useMemo(() => new Set(syncing), [syncing]);

  const names = useMemo(() => {
    const m = new Map<string, string>();
    for (const mem of detail.data?.members ?? []) m.set(mem.id, mem.displayName);
    if (user) m.set(user.id, "you");
    return m;
  }, [detail.data, user]);

  const sections = useMemo(() => toSections(list.data ?? []), [list.data]);
  // Read-only view of the cached estimate (fetched from the Prices modal).
  const prices = usePrices(groupId, { enabled: false }).data;
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  if (list.isPending) return <LoadingState message="Loading the list…" />;
  if (list.isError) return <ErrorState error={list.error} onRetry={() => list.refetch()} />;

  const total = list.data.length;
  const checkedRows = list.data.filter((r) => r.checked);

  async function finishTrip() {
    const n = checkedRows.length;
    if (!(await confirm("Finish trip?", `Move ${n} checked item${n === 1 ? "" : "s"} to the cabinet?`, "Finish trip"))) return;
    const itemIds = checkedRows.map((r) => r.itemId);
    complete.mutate(undefined, {
      onSuccess: ({ movedToCabinet }) => {
        toast(`${movedToCabinet} item${movedToCabinet === 1 ? "" : "s"} added to cabinet`);
        void maybeAskNotificationPermission();
        if (movedToCabinet > 0) router.push(`/expiration-check?itemIds=${itemIds.join(",")}`);
      },
      onError,
    });
  }

  return (
    <View style={styles.flex}>
      <InviteBanner />
      <RecallBanner groupId={groupId} />
      <SectionList
        sections={sections}
        keyExtractor={(r) => r.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={total === 0 ? styles.grow : styles.listPad}
        refreshControl={<RefreshControl refreshing={list.isRefetching} onRefresh={() => void list.refetch()} />}
        ListHeaderComponent={
          <View style={styles.header}>
            <Text style={styles.count} accessibilityRole="header">
              {total} items · {checkedRows.length} checked
            </Text>
            <View style={styles.headerActions}>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={prices ? `Estimated total ${formatCentsRange(prices.totalLowCents, prices.totalHighCents, true)}. Open prices` : "Estimate prices"}
                onPress={() => router.push("/prices")}
                style={styles.priceChip}
              >
                <Text style={styles.priceText}>
                  ✨ {prices ? `Est. ${formatCentsRange(prices.totalLowCents, prices.totalHighCents, true)}` : "Est. price"}
                </Text>
              </Pressable>
              <IconButton label="Add an item to the list" onPress={() => setPicking(true)}>
                <Text style={styles.plus}>＋</Text>
              </IconButton>
            </View>
            {!connected ? <Text style={styles.muted}>Live updates paused · refreshing every 5 s</Text> : null}
          </View>
        }
        ListEmptyComponent={
          <EmptyState title="Nothing to buy 🎉" message="Everything you all want is in the cabinet." />
        }
        renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
        renderItem={({ item: row }) => (
          <ListRow
            row={row}
            syncing={syncingIds.has(row.id)}
            checkedByName={row.checkedBy ? (names.get(row.checkedBy) ?? "someone") : null}
            addedByName={row.addedBy ? (names.get(row.addedBy) ?? "someone") : null}
            onToggle={() => check.mutate({ id: row.id, checked: !row.checked }, { onError })}
            onScan={() => router.push(`/scanner?mode=match-list-item&listItemId=${row.id}`)}
            onDelete={() => del.mutate(row.id, { onError })}
          />
        )}
      />
      {total > 0 ? (
        <View style={styles.footer}>
          <Button
            title={complete.isPending ? "Finishing…" : `Finish trip${checkedRows.length ? ` (${checkedRows.length})` : ""}`}
            disabled={checkedRows.length === 0 || complete.isPending}
            loading={complete.isPending}
            onPress={finishTrip}
          />
        </View>
      ) : null}
      <ItemPicker
        visible={picking}
        title="We're out of…"
        onClose={() => setPicking(false)}
        onPick={(item) => add.mutate({ itemId: item.id }, { onSuccess: () => toast(`${item.name} added`), onError })}
      />
    </View>
  );
}

function ListRow({
  row,
  syncing,
  checkedByName,
  addedByName,
  onToggle,
  onScan,
  onDelete,
}: {
  row: ShoppingListItem;
  syncing: boolean;
  checkedByName: string | null;
  addedByName: string | null;
  onToggle: () => void;
  onScan: () => void;
  onDelete: () => void;
}) {
  const wanted = row.wantedBy.map((w) => w.displayName).join(", ");
  return (
    <View style={[styles.row, row.checked && styles.rowChecked]}>
      <Pressable
        accessibilityRole="checkbox"
        accessibilityState={{ checked: row.checked }}
        accessibilityLabel={`${row.item.name}${row.quantityText ? `, ${row.quantityText}` : ""}`}
        onPress={onToggle}
        style={styles.checkArea}
      >
        <View style={[styles.box, row.checked && styles.boxChecked]}>{row.checked ? <Text style={styles.tick}>✓</Text> : null}</View>
        <View style={styles.flex}>
          <Text style={[styles.name, row.checked && styles.struck]}>
            {row.item.name}
            {row.quantityText ? <Text style={styles.muted}> · {row.quantityText}</Text> : null}
            {syncing ? <Text style={styles.syncing} accessibilityLabel="syncing"> ●</Text> : null}
          </Text>
          {wanted ? <Text style={styles.muted}>for {wanted}</Text> : null}
          {row.checked && checkedByName ? <Text style={styles.muted}>✓ by {checkedByName}</Text> : null}
          {row.reason === "manual" && addedByName ? <Chip label={`added by ${addedByName}`} /> : null}
          {row.allergenFlags.length > 0 ? (
            <View style={styles.badges}>
              {row.allergenFlags.map((f) => (
                <AllergenBadge key={`${f.userId}-${f.allergen}`} flag={f} />
              ))}
            </View>
          ) : null}
        </View>
      </Pressable>
      <IconButton label={`Scan a product for ${row.item.name}`} onPress={onScan}>
        <Text style={styles.icon}>⌗</Text>
      </IconButton>
      {row.reason === "manual" ? (
        <IconButton label={`Delete ${row.item.name} from the list`} onPress={onDelete}>
          <Text style={styles.icon}>✕</Text>
        </IconButton>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  grow: { flexGrow: 1 },
  listPad: { paddingBottom: 96 },
  header: { padding: spacing.lg, gap: spacing.sm },
  headerActions: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  count: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
  priceChip: {
    minHeight: TAP_TARGET,
    justifyContent: "center",
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.aiLight,
  },
  priceText: { color: colors.ai, fontWeight: "700", fontSize: fontSize.sm },
  plus: { fontSize: fontSize.xxl, color: colors.primary },
  section: { fontSize: fontSize.md, fontWeight: "800", color: colors.textMuted, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  rowChecked: { backgroundColor: colors.background },
  checkArea: { flex: 1, flexDirection: "row", alignItems: "center", gap: spacing.md, minHeight: TAP_TARGET + 8 },
  box: {
    width: 32,
    height: 32,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
  },
  boxChecked: { backgroundColor: colors.primary },
  tick: { color: colors.onPrimary, fontSize: fontSize.lg, fontWeight: "800" },
  name: { fontSize: fontSize.lg, fontWeight: "600", color: colors.text },
  struck: { textDecorationLine: "line-through", color: colors.textMuted },
  muted: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: "400", textDecorationLine: "none" },
  syncing: { color: colors.warning, fontSize: fontSize.sm },
  badges: { flexDirection: "row", flexWrap: "wrap", gap: spacing.xs, marginTop: spacing.xs },
  icon: { fontSize: fontSize.xl, color: colors.textMuted },
  footer: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    padding: spacing.md,
    backgroundColor: colors.background,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
});
