// Former Cabinet tab (list view). No longer routed: the Pantry scene replaced it as the home tab (features/pantry).
// Kept as a component so its behaviour stays covered by src/__tests__/cabinet.test.tsx.
import type { CabinetItem } from "@contracts/cabinet";
import { useRouter } from "expo-router";
import { ScanLine } from "lucide-react-native";
import { useMemo, useState } from "react";
import { StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useAlerts } from "@/api/hooks/alerts";
import { useAddCabinetItem, useCabinet } from "@/api/hooks/cabinet";
import { TabHeader } from "@/components/GroupSwitcher";
import { InviteBanner } from "@/components/InviteBanner";
import { ItemPicker } from "@/components/ItemPicker";
import { Button, ErrorState, IconButton, LoadingState, ToggleChip, useToast } from "@/components/ui";
import { useCabinetActions } from "@/components/useCabinetActions";
import {
  CabinetRowMenu,
  CabinetView,
  LOCATION_LABEL,
  LOCATIONS,
  type CabinetFilter,
  type CabinetLocation,
} from "@/features/cabinet/CabinetView";
import { useRanOutPrompt } from "@/features/cabinet/ranOutStore";
import { useRequiredGroupId } from "@/state/ActiveGroupContext";
import { color, space } from "@/theme";

export default function CabinetScreen() {
  const groupId = useRequiredGroupId();
  const cabinet = useCabinet(groupId);
  const alerts = useAlerts(groupId);
  const actions = useCabinetActions(groupId);
  const prompt = useRanOutPrompt();
  const router = useRouter();
  const [filter, setFilter] = useState<CabinetFilter>("all");
  const [mapping, setMapping] = useState(false);
  const [menuFor, setMenuFor] = useState<CabinetItem | null>(null);
  const scan = () => router.push("/scanner?mode=add-to-cabinet");

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

  return (
    <View style={styles.flex}>
      <TabHeader
        title="Cabinet"
        right={
          <IconButton label="Scan a product" onPress={() => router.push("/scanner?mode=lookup")}>
            <ScanLine size={24} color={color.primary} />
          </IconButton>
        }
      />
      {cabinet.isPending ? (
        <LoadingState />
      ) : cabinet.isError ? (
        <View style={styles.pad}>
          <ErrorState message={errorMessage(cabinet.error)} onRetry={() => void cabinet.refetch()} />
        </View>
      ) : (
        <CabinetView
          total={cabinet.data.length}
          sections={sections}
          filter={filter}
          onFilter={setFilter}
          refreshing={cabinet.isRefetching}
          onRefresh={() => void cabinet.refetch()}
          banner={<InviteBanner />}
          prompt={prompt}
          promptBusy={actions.addingAnyway}
          onPromptAdd={() => prompt && actions.addAnyway(prompt)}
          onPromptDismiss={() => prompt && actions.dismissRanOut(prompt)}
          onAdd={() => setMapping(true)}
          onScan={scan}
          onOpen={(row) => router.push(`/item-detail/${row.id}`)}
          onLow={actions.markLow}
          onInStock={actions.backInStock}
          onRanOut={actions.ranOut}
          onMenu={setMenuFor}
        />
      )}
      <CabinetRowMenu
        row={menuFor}
        onClose={() => setMenuFor(null)}
        onDetails={(row) => router.push(`/item-detail/${row.id}`)}
        onRemove={(row) => void actions.remove(row)}
      />
      <MapOutPicker groupId={groupId} visible={mapping} onClose={() => setMapping(false)} onScan={scan} />
    </View>
  );
}

/** "Map out cabinet": ItemPicker in quick-add-many mode with a location selector. */
function MapOutPicker({ groupId, visible, onClose, onScan }: { groupId: string; visible: boolean; onClose: () => void; onScan: () => void }) {
  const add = useAddCabinetItem(groupId);
  const { show: toast } = useToast();
  const [location, setLocation] = useState<CabinetLocation>("pantry");
  return (
    <ItemPicker
      visible={visible}
      title="Add to cabinet"
      keepOpen
      onClose={onClose}
      onPick={(item) =>
        add.mutate(
          { itemId: item.id, location },
          { onSuccess: () => toast(`${item.name} is in the cabinet`), onError: (e) => toast(errorMessage(e), { tone: "error" }) },
        )
      }
      header={
        <View style={styles.gap}>
          <View style={styles.chips}>
            {LOCATIONS.map((l) => (
              <ToggleChip key={l} label={LOCATION_LABEL[l]} selected={location === l} onPress={() => setLocation(l)} />
            ))}
          </View>
          <Button
            label="Scan instead"
            variant="ghost"
            size="sm"
            onPress={() => {
              onClose();
              onScan();
            }}
          />
        </View>
      }
    />
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pad: { padding: space.screenX },
  gap: { gap: space.sm },
  chips: { flexDirection: "row", flexWrap: "wrap", gap: space.sm },
});
