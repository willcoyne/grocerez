import type { Preference } from "@contracts/preferences";
import { useMemo, useState } from "react";
import { Modal, Pressable, StyleSheet, Text, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useCabinet } from "@/api/hooks/cabinet";
import { useAddPreference, useDeletePreference, usePreferences, useUpdatePreference } from "@/api/hooks/preferences";
import { useShoppingList } from "@/api/hooks/shoppingList";
import { colors, fontSize, radius, spacing, TAP_TARGET } from "@/theme";
import { ItemPicker } from "./ItemPicker";
import { ErrorState, LoadingState } from "./States";
import { useToast } from "@/components/ui";
import { Button, Card, Chip, Input, SectionHeader } from "./ui";

type Recurrence = Preference["recurrence"];

/** Me tab → "My list": Staples / This week, with "In cabinet ✓" / "On list" tags so the set math is visible. */
export function MyPreferences({ groupId }: { groupId: string }) {
  const prefs = usePreferences(groupId, "me");
  const cabinet = useCabinet(groupId);
  const list = useShoppingList(groupId);
  const add = useAddPreference(groupId);
  const del = useDeletePreference(groupId);
  const { show: toast } = useToast();
  const [segment, setSegment] = useState<Recurrence>("staple");
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<Preference | null>(null);

  const inCabinet = useMemo(() => new Set((cabinet.data ?? []).map((c) => c.itemId)), [cabinet.data]);
  const onList = useMemo(() => new Set((list.data ?? []).map((l) => l.itemId)), [list.data]);
  const rows = (prefs.data ?? []).filter((p) => p.recurrence === segment);
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });

  return (
    <View>
      <SectionHeader title="My list" right={<Button title="+ Add" compact onPress={() => setPicking(true)} />} />
      <View style={styles.segments} accessibilityRole="tablist">
        {(["staple", "one_time"] as const).map((s) => (
          <Pressable
            key={s}
            accessibilityRole="tab"
            accessibilityState={{ selected: segment === s }}
            onPress={() => setSegment(s)}
            style={[styles.segment, segment === s && styles.segmentActive]}
          >
            <Text style={[styles.segmentText, segment === s && styles.segmentTextActive]}>
              {s === "staple" ? "Staples" : "This week"}
            </Text>
          </Pressable>
        ))}
      </View>
      <Text style={styles.muted}>
        {segment === "staple" ? "Always keep stocked: comes back on the list when it runs out." : "Bought once, then removed."}
      </Text>

      <Card style={styles.card}>
        {prefs.isPending ? (
          <LoadingState />
        ) : prefs.isError ? (
          <ErrorState error={prefs.error} onRetry={() => prefs.refetch()} />
        ) : rows.length === 0 ? (
          <Text style={styles.muted}>Nothing here yet. Tap “+ Add”.</Text>
        ) : (
          rows.map((p) => (
            <View key={p.id} style={styles.row}>
              <Pressable
                style={styles.flex}
                accessibilityRole="button"
                accessibilityLabel={`Edit ${p.item.name}`}
                onPress={() => !p.id.startsWith("temp-") && setEditing(p)}
              >
                <Text style={styles.name}>
                  {p.item.name}
                  {p.quantityText ? <Text style={styles.muted}> · {p.quantityText}</Text> : null}
                </Text>
                {p.note ? <Text style={styles.muted}>{p.note}</Text> : null}
                <View style={styles.tags}>
                  {inCabinet.has(p.itemId) ? <Chip tone="success" label="In cabinet ✓" /> : null}
                  {onList.has(p.itemId) ? <Chip tone="warning" label="On list" /> : null}
                </View>
              </Pressable>
              <Button
                title="Delete"
                variant="ghost"
                compact
                accessibilityLabel={`Delete ${p.item.name}`}
                disabled={p.id.startsWith("temp-")}
                onPress={() => del.mutate(p.id, { onError })}
              />
            </View>
          ))
        )}
      </Card>

      <ItemPicker
        visible={picking}
        title={segment === "staple" ? "Add a staple" : "Add for this week"}
        onClose={() => setPicking(false)}
        onPick={(item) => add.mutate({ itemId: item.id, item, recurrence: segment }, { onError })}
      />
      {editing ? <EditPreference groupId={groupId} pref={editing} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}

function EditPreference({ groupId, pref, onClose }: { groupId: string; pref: Preference; onClose: () => void }) {
  const update = useUpdatePreference(groupId);
  const { show: toast } = useToast();
  const [quantity, setQuantity] = useState(pref.quantityText ?? "");
  const [note, setNote] = useState(pref.note ?? "");
  const [recurrence, setRecurrence] = useState<Recurrence>(pref.recurrence);

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.backdrop}>
        <Card style={styles.sheet}>
          <Text style={styles.sheetTitle}>{pref.item.name}</Text>
          <Input label="Quantity" value={quantity} onChangeText={setQuantity} placeholder="2 gal" maxLength={100} />
          <Input label="Note" value={note} onChangeText={setNote} placeholder="the blue box" maxLength={500} />
          <View style={styles.tags}>
            <Chip label="Staple" selected={recurrence === "staple"} onPress={() => setRecurrence("staple")} />
            <Chip label="This week" selected={recurrence === "one_time"} onPress={() => setRecurrence("one_time")} />
          </View>
          <Button
            title="Save"
            loading={update.isPending}
            onPress={() =>
              update.mutate(
                { id: pref.id, quantityText: quantity.trim() || null, note: note.trim() || null, recurrence },
                { onSuccess: onClose, onError: (e) => toast(errorMessage(e), { tone: "error" }) },
              )
            }
          />
          <Button title="Cancel" variant="ghost" onPress={onClose} />
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  segments: { flexDirection: "row", backgroundColor: colors.border, borderRadius: radius.md, padding: 2, marginBottom: spacing.sm },
  segment: { flex: 1, minHeight: TAP_TARGET - 4, alignItems: "center", justifyContent: "center", borderRadius: radius.md - 2 },
  segmentActive: { backgroundColor: colors.surface },
  segmentText: { fontSize: fontSize.md, color: colors.textMuted },
  segmentTextActive: { color: colors.text, fontWeight: "700" },
  card: { marginTop: spacing.sm },
  row: { flexDirection: "row", alignItems: "center", gap: spacing.sm, minHeight: TAP_TARGET },
  flex: { flex: 1, gap: 2, paddingVertical: spacing.xs },
  name: { fontSize: fontSize.md, color: colors.text, fontWeight: "600" },
  muted: { fontSize: fontSize.sm, color: colors.textMuted, fontWeight: "400" },
  tags: { flexDirection: "row", gap: spacing.xs, flexWrap: "wrap" },
  backdrop: { flex: 1, backgroundColor: colors.overlay, justifyContent: "center", padding: spacing.lg },
  sheet: { gap: spacing.md },
  sheetTitle: { fontSize: fontSize.lg, fontWeight: "700", color: colors.text },
});
