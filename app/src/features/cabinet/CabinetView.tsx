import type { CabinetItem } from "@contracts/cabinet";
import { MoreHorizontal } from "lucide-react-native";
import type { ReactNode } from "react";
import { Modal, Pressable, RefreshControl, ScrollView, SectionList, StyleSheet, View } from "react-native";

import { ExpirationPill, StockChip } from "@/components/Badges";
import { AppText, Button, Card, DashedEmpty, IconButton, SectionLabel, ToggleChip } from "@/components/ui";
import { labelize, plural } from "@/lib/format";
import { color, radius, space } from "@/theme";

import { RanOutPrompt } from "./RanOutPrompt";

export type CabinetLocation = NonNullable<CabinetItem["location"]>;
export const LOCATIONS: CabinetLocation[] = ["fridge", "freezer", "pantry", "other"];
export const LOCATION_LABEL: Record<CabinetLocation, string> = { fridge: "Fridge", freezer: "Freezer", pantry: "Pantry", other: "Other" };
export type CabinetFilter = "all" | CabinetLocation | "expiring" | "low";
const FILTERS: CabinetFilter[] = ["all", ...LOCATIONS, "expiring", "low"];
const FILTER_LABEL = (f: CabinetFilter) =>
  f === "all" ? "All" : f === "expiring" ? "Expiring soon" : f === "low" ? "Low stock" : LOCATION_LABEL[f];

export type CabinetRowActions = {
  onOpen: (row: CabinetItem) => void;
  onLow: (row: CabinetItem) => void;
  onInStock: (row: CabinetItem) => void;
  onRanOut: (row: CabinetItem) => void;
  onMenu: (row: CabinetItem) => void;
};

/**
 * Presentational Cabinet (DESIGN.md §4.6 + carson's locations, filters and expiration chips).
 * Sections are grouped by location; the screen hook owns data and mutations.
 */
export function CabinetView({
  total,
  sections,
  filter,
  onFilter,
  refreshing,
  onRefresh,
  prompt,
  promptBusy,
  onPromptAdd,
  onPromptDismiss,
  onAdd,
  onScan,
  banner,
  ...actions
}: {
  total: number;
  sections: { title: string; data: CabinetItem[] }[];
  filter: CabinetFilter;
  onFilter: (f: CabinetFilter) => void;
  refreshing: boolean;
  onRefresh: () => void;
  prompt: CabinetItem | null;
  promptBusy?: boolean;
  onPromptAdd: () => void;
  onPromptDismiss: () => void;
  onAdd: () => void;
  onScan: () => void;
  banner?: ReactNode;
} & CabinetRowActions) {
  const empty = total === 0;
  return (
    <SectionList
      testID="tab-cabinet"
      sections={empty ? [] : sections}
      keyExtractor={(r) => r.id}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={styles.content}
      refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
      ListHeaderComponent={
        <View style={styles.gap}>
          {banner}
          {prompt ? (
            <RanOutPrompt name={prompt.item.name} busy={promptBusy} onAdd={onPromptAdd} onDismiss={onPromptDismiss} />
          ) : null}
          {empty ? (
            <DashedEmpty>
              Your cabinet is empty. Finish a shopping trip, or add what you already have below. This step is optional.
            </DashedEmpty>
          ) : (
            <>
              <AppText variant="bodyS" weight="semi" color="ink2">
                {`${plural(total, "item")} in the house`}
              </AppText>
              <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.filters}>
                {FILTERS.map((f) => (
                  <ToggleChip key={f} label={FILTER_LABEL(f)} selected={filter === f} onPress={() => onFilter(f)} />
                ))}
              </ScrollView>
            </>
          )}
        </View>
      }
      ListEmptyComponent={empty ? null : <DashedEmpty>Nothing matches this filter.</DashedEmpty>}
      renderSectionHeader={({ section }) => <SectionLabel style={styles.section}>{section.title}</SectionLabel>}
      renderItem={({ item: row }) => <CabinetRow row={row} {...actions} />}
      ItemSeparatorComponent={() => <View style={styles.sep} />}
      ListFooterComponent={
        <View style={styles.footer}>
          <SectionLabel>Map out the cabinet (optional)</SectionLabel>
          <View style={styles.row}>
            <Button label="Add what you have" variant="secondary" flex onPress={onAdd} />
            <Button label="Scan" variant="secondary" flex onPress={onScan} />
          </View>
        </View>
      }
    />
  );
}

function CabinetRow({ row, onOpen, onLow, onInStock, onRanOut, onMenu }: { row: CabinetItem } & CabinetRowActions) {
  const name = row.item.name;
  const meta = [row.item.category ? labelize(row.item.category) : null, row.product?.brand, row.quantityText].filter(Boolean).join(" · ");
  const low = row.status === "running_low";
  return (
    <Card style={styles.card} testID={`row-${row.itemId}`}>
      <Pressable
        onPress={() => onOpen(row)}
        onLongPress={() => onMenu(row)}
        accessibilityRole="button"
        accessibilityLabel={`${name}${row.product?.brand ? `, ${row.product.brand}` : ""}. Open details`}
        accessibilityHint="Long press for more actions"
        style={styles.top}
      >
        <View style={styles.flex}>
          <AppText variant="bodyL" weight="heavy">
            {name}
          </AppText>
          <AppText variant="caption" color="muted">
            {meta}
          </AppText>
        </View>
        <StockChip status={row.status} />
      </Pressable>
      {row.expiresAt ? <ExpirationPill expiresAt={row.expiresAt} source={row.expirationSource} /> : null}
      <View style={styles.row}>
        <Button
          label={low ? "Back in stock" : "Running low"}
          variant="secondary"
          size="sm"
          flex
          accessibilityLabel={low ? `${name} back in stock` : `${name} running low`}
          onPress={() => (low ? onInStock(row) : onLow(row))}
        />
        <Button
          label="Ran out"
          variant="danger-secondary"
          size="sm"
          flex
          accessibilityLabel={`${name} ran out`}
          onPress={() => onRanOut(row)}
        />
        <IconButton label={`Actions for ${name}`} onPress={() => onMenu(row)}>
          <MoreHorizontal size={22} color={color.ink2} />
        </IconButton>
      </View>
    </Card>
  );
}

/** Long-press / "more" sheet: details and remove (the inline buttons cover status changes). */
export function CabinetRowMenu({
  row,
  onClose,
  onDetails,
  onRemove,
}: {
  row: CabinetItem | null;
  onClose: () => void;
  onDetails: (row: CabinetItem) => void;
  onRemove: (row: CabinetItem) => void;
}) {
  if (!row) return null;
  const run = (fn: (r: CabinetItem) => void) => () => {
    onClose();
    fn(row);
  };
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close actions">
        <View style={styles.menu}>
          <AppText variant="bodyL" weight="heavy">
            {row.item.name}
          </AppText>
          <Button label="Details & expiration" variant="secondary" fullWidth onPress={run(onDetails)} />
          <Button label="Remove" variant="danger-secondary" fullWidth onPress={run(onRemove)} />
          <Button label="Cancel" variant="ghost" fullWidth onPress={onClose} />
        </View>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  content: { padding: space.screenX, paddingBottom: 32 },
  gap: { gap: space.md, marginBottom: space.sm },
  filters: { gap: space.sm },
  section: { paddingTop: space.lg, paddingBottom: space.sm },
  sep: { height: space.sm },
  card: { gap: 10 },
  top: { flexDirection: "row", alignItems: "flex-start", gap: space.sm },
  flex: { flex: 1 },
  row: { flexDirection: "row", alignItems: "center", gap: space.sm },
  footer: { gap: space.sm, marginTop: space.xl },
  backdrop: { flex: 1, backgroundColor: color.overlay, justifyContent: "flex-end", padding: space.screenX },
  menu: { backgroundColor: color.surface, borderRadius: radius.cardLg, padding: space.lg, gap: space.sm },
});
