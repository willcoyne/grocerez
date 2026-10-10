import type { CabinetItem } from "@contracts/cabinet";
import { useRouter } from "expo-router";
import { useMemo, useState } from "react";
import { Modal, Pressable, RefreshControl, SectionList, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useAlerts } from "@/api/hooks/alerts";
import { useAddCabinetItem, useCabinet } from "@/api/hooks/cabinet";
import { ExpirationPill, StatusChip } from "@/components/Badges";
import { InviteBanner } from "@/components/InviteBanner";
import { ItemPicker } from "@/components/ItemPicker";
import { EmptyState, ErrorState, LoadingState } from "@/components/States";
import { useToast } from "@/components/Toast";
import { Button, Card, Chip, IconButton } from "@/components/ui";
import { useCabinetActions } from "@/components/useCabinetActions";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { colors, fontSize, spacing, TAP_TARGET } from "@/theme";

type Location = NonNullable<CabinetItem["location"]>;
const LOCATIONS: Location[] = ["fridge", "freezer", "pantry", "other"];
const LOCATION_LABEL: Record<Location, string> = { fridge: "Fridge", freezer: "Freezer", pantry: "Pantry", other: "Other" };
type Filter = "all" | Location | "expiring" | "low";

export default function CabinetScreen() {
  const groupId = useRequiredGroupId();
  const cabinet = useCabinet(groupId);
  const alerts = useAlerts(groupId);
  const actions = useCabinetActions(groupId);
  const router = useRouter();
  const [filter, setFilter] = useState<Filter>("all");
  const [mapping, setMapping] = useState(false);
  const [menuFor, setMenuFor] = useState<CabinetItem | null>(null);

  // "Expiring soon" uses the server's expiring list (alerts), so the rule lives in one place.
  const expiringIds = useMemo(() => new Set((alerts.data?.expiring ?? []).map((c) => c.id)), [alerts.data]);

  const sections = useMemo(() => {
    const rows = (cabinet.data ?? []).filter((r) => {
      if (filter === "all") return true;
      if (filter === "expiring") return expiringIds.has(r.id);
      if (filter === "low") return r.status === "running_low";
      return (r.location ?? "other") === filter;
    });
    return LOCATIONS.map((loc) => ({
      title: LOCATION_LABEL[loc],
      data: rows.filter((r) => (r.location ?? "other") === loc).sort((a, b) => a.item.name.localeCompare(b.item.name)),
    })).filter((s) => s.data.length > 0);
  }, [cabinet.data, filter, expiringIds]);

  if (cabinet.isPending) return <LoadingState />;
  if (cabinet.isError) return <ErrorState error={cabinet.error} onRetry={() => cabinet.refetch()} />;

  const empty = cabinet.data.length === 0;

  return (
    <View style={styles.flex}>
      <InviteBanner />
      {empty ? (
        <EmptyState title="Your cabinet is empty" message="Finish a shopping trip or add what you already have.">
          <Button title="Add items" onPress={() => setMapping(true)} />
          <Button title="Scan instead" variant="secondary" onPress={() => router.push("/scanner?mode=add-to-cabinet")} />
        </EmptyState>
      ) : (
        <SectionList
          sections={sections}
          keyExtractor={(r) => r.id}
          stickySectionHeadersEnabled={false}
          refreshControl={<RefreshControl refreshing={cabinet.isRefetching} onRefresh={() => void cabinet.refetch()} />}
          ListHeaderComponent={
            <View style={styles.header}>
              <View style={styles.headerRow}>
                <Text style={styles.count}>{cabinet.data.length} items</Text>
                <View style={styles.headerActions}>
                  <Button title="Scan" variant="secondary" compact onPress={() => router.push("/scanner?mode=lookup")} />
                  <Button title="+ Add" compact onPress={() => setMapping(true)} />
                </View>
              </View>
              <View style={styles.filters}>
                {(["all", ...LOCATIONS, "expiring", "low"] as Filter[]).map((f) => (
                  <Chip
                    key={f}
                    label={f === "all" ? "All" : f === "expiring" ? "Expiring soon" : f === "low" ? "Low stock" : LOCATION_LABEL[f]}
                    selected={filter === f}
                    onPress={() => setFilter(f)}
                  />
                ))}
              </View>
            </View>
          }
          ListEmptyComponent={<Text style={[styles.muted, styles.pad]}>Nothing matches this filter.</Text>}
          renderSectionHeader={({ section }) => <Text style={styles.section}>{section.title}</Text>}
          renderItem={({ item: row }) => (
            <CabinetRow
              row={row}
              onPress={() => router.push(`/item-detail/${row.id}`)}
              onMenu={() => setMenuFor(row)}
            />
          )}
        />
      )}
      <RowMenu
        row={menuFor}
        onClose={() => setMenuFor(null)}
        actions={actions}
        onDetails={(row) => router.push(`/item-detail/${row.id}`)}
      />
      <MapOutPicker groupId={groupId} visible={mapping} onClose={() => setMapping(false)} />
    </View>
  );
}

function CabinetRow({ row, onPress, onMenu }: { row: CabinetItem; onPress: () => void; onMenu: () => void }) {
  return (
    <Pressable
      style={styles.row}
      onPress={onPress}
      onLongPress={onMenu}
      accessibilityRole="button"
      accessibilityLabel={`${row.item.name}${row.product?.brand ? `, ${row.product.brand}` : ""}. Open details`}
      accessibilityHint="Long press for actions"
    >
      <View style={styles.flex}>
        <Text style={styles.name}>
          {row.item.name}
          {row.quantityText ? <Text style={styles.muted}> · {row.quantityText}</Text> : null}
        </Text>
        {row.product?.brand ? <Text style={styles.muted}>{row.product.brand}</Text> : null}
        <View style={styles.pills}>
          <ExpirationPill expiresAt={row.expiresAt} source={row.expirationSource} />
          <StatusChip status={row.status} />
        </View>
      </View>
      <IconButton label={`Actions for ${row.item.name}`} onPress={onMenu}>
        <Text style={styles.more}>⋯</Text>
      </IconButton>
    </Pressable>
  );
}

function RowMenu({
  row,
  onClose,
  actions,
  onDetails,
}: {
  row: CabinetItem | null;
  onClose: () => void;
  actions: ReturnType<typeof useCabinetActions>;
  onDetails: (row: CabinetItem) => void;
}) {
  if (!row) return null;
  const run = (fn: () => void) => () => {
    onClose();
    fn();
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close actions">
        <Card style={styles.menu}>
          <Text style={styles.menuTitle}>{row.item.name}</Text>
          {row.status === "running_low" ? (
            <Button title="Back in stock" variant="secondary" onPress={run(() => actions.backInStock(row))} />
          ) : (
            <Button title="Running low" variant="secondary" onPress={run(() => actions.markLow(row))} />
          )}
          <Button title="Ran out" variant="secondary" onPress={run(() => actions.ranOut(row))} />
          <Button title="Details & expiration" variant="secondary" onPress={run(() => onDetails(row))} />
          <Button title="Remove" variant="danger" onPress={run(() => void actions.remove(row))} />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </Card>
      </Pressable>
    </Modal>
  );
}

/** "Map out cabinet": ItemPicker in quick-add-many mode with a location selector. */
function MapOutPicker({ groupId, visible, onClose }: { groupId: string; visible: boolean; onClose: () => void }) {
  const add = useAddCabinetItem(groupId);
  const toast = useToast();
  const router = useRouter();
  const [location, setLocation] = useState<Location>("pantry");
  return (
    <ItemPicker
      visible={visible}
      title="Add to cabinet"
      keepOpen
      onClose={onClose}
      onPick={(item) => add.mutate({ itemId: item.id, location }, { onError: (e) => toast(errorMessage(e), { tone: "error" }) })}
      header={
        <View style={styles.gap}>
          <View style={styles.filters}>
            {LOCATIONS.map((l) => (
              <Chip key={l} label={LOCATION_LABEL[l]} selected={location === l} onPress={() => setLocation(l)} />
            ))}
          </View>
          <Button
            title="Scan instead"
            variant="ghost"
            compact
            onPress={() => {
              onClose();
              router.push("/scanner?mode=add-to-cabinet");
            }}
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  gap: { gap: spacing.sm },
  pad: { padding: spacing.lg },
  header: { padding: spacing.lg, gap: spacing.md },
  headerRow: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  headerActions: { flexDirection: "row", gap: spacing.sm },
  count: { fontSize: fontSize.md, color: colors.textMuted, fontWeight: "600" },
  filters: { flexDirection: "row", flexWrap: "wrap", gap: spacing.sm },
  section: { fontSize: fontSize.md, fontWeight: "800", color: colors.textMuted, paddingHorizontal: spacing.lg, paddingTop: spacing.md },
  row: {
    flexDirection: "row",
    alignItems: "center",
    minHeight: TAP_TARGET + 12,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    backgroundColor: colors.surface,
  },
  name: { fontSize: fontSize.md, fontWeight: "600", color: colors.text },
  muted: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: "400" },
  pills: { flexDirection: "row", gap: spacing.xs, marginTop: spacing.xs, flexWrap: "wrap" },
  more: { fontSize: fontSize.xl, color: colors.textMuted },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "flex-end", padding: spacing.lg },
  menu: { gap: spacing.sm },
  menuTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
});
