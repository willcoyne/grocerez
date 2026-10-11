import type { Preference } from "@contracts/preferences";
import { useMemo, useState } from "react";
import { Modal, StyleSheet, View } from "react-native";

import { errorMessage } from "@/api/client";
import { useCabinet } from "@/api/hooks/cabinet";
import { useAddPreference, useDeletePreference, usePreferences, useUpdatePreference } from "@/api/hooks/preferences";
import { useShoppingList } from "@/api/hooks/shoppingList";
import { ItemPicker } from "@/components/ItemPicker";
import {
  AppText,
  Button,
  Card,
  DashedEmpty,
  ErrorState,
  InlineAdd,
  LoadingState,
  Segmented,
  TextField,
  useToast,
} from "@/components/ui";
import { PreferenceRow, type PrefStatus } from "@/features/me/PreferenceRow";
import { color, space } from "@/theme";

type Recurrence = Preference["recurrence"];

const RECURRENCE_OPTIONS: { value: Recurrence; label: string }[] = [
  { value: "staple", label: "Staple" },
  { value: "one_time", label: "This week only" },
];

const isTemp = (p: Preference) => p.id.startsWith("temp-");

/** Me note (pinned on the pantry) → "What I want from the store" (DESIGN.md §4.7). Data hooks here; rows are PreferenceRow. */
export function MyPreferences({ groupId }: { groupId: string }) {
  const prefs = usePreferences(groupId, "me");
  const cabinet = useCabinet(groupId);
  const list = useShoppingList(groupId);
  const add = useAddPreference(groupId);
  const update = useUpdatePreference(groupId);
  const del = useDeletePreference(groupId);
  const { show: toast } = useToast();
  const [segment, setSegment] = useState<Recurrence>("staple");
  const [text, setText] = useState("");
  const [picking, setPicking] = useState(false);
  const [editing, setEditing] = useState<Preference | null>(null);

  const inStock = useMemo(
    () => new Set((cabinet.data ?? []).filter((c) => c.status !== "running_low").map((c) => c.itemId)),
    [cabinet.data],
  );
  const onList = useMemo(() => new Set((list.data ?? []).map((l) => l.itemId)), [list.data]);
  const statusFor = (itemId: string): PrefStatus => (inStock.has(itemId) ? "in_cabinet" : onList.has(itemId) ? "on_list" : null);
  const onError = (e: unknown) => toast(errorMessage(e), { tone: "error" });
  const rows = prefs.data ?? [];

  return (
    <View style={styles.wrap}>
      <InlineAdd
        label="Add an item"
        placeholder="e.g. cheerios"
        buttonVariant="primary"
        value={text}
        onChangeText={setText}
        onSubmit={() => setPicking(true)}
        testID="me-add"
      />
      <Segmented options={RECURRENCE_OPTIONS} value={segment} onChange={setSegment} testID="recurrence" />
      <AppText variant="caption" color="muted">
        {segment === "staple"
          ? "Staples come back on the list every time you run out."
          : "One-time items leave your list after they're bought."}
      </AppText>

      {prefs.isPending ? (
        <LoadingState />
      ) : prefs.isError ? (
        <ErrorState message={errorMessage(prefs.error)} onRetry={() => void prefs.refetch()} />
      ) : rows.length === 0 ? (
        <DashedEmpty>Nothing yet. Add the things you want kept in stock, or just need this week.</DashedEmpty>
      ) : (
        rows.map((p) => (
          <PreferenceRow
            key={p.id}
            pref={p}
            status={statusFor(p.itemId)}
            disabled={isTemp(p)}
            onEdit={() => setEditing(p)}
            onToggleRecurrence={() =>
              update.mutate({ id: p.id, recurrence: p.recurrence === "staple" ? "one_time" : "staple" }, { onError })
            }
            onRemove={() => del.mutate(p.id, { onSuccess: () => toast(`Removed ${p.item.name}`), onError })}
          />
        ))
      )}

      <ItemPicker
        visible={picking}
        title={segment === "staple" ? "Add a staple" : "Add for this week"}
        initialText={text.trim()}
        onClose={() => setPicking(false)}
        onPick={(item) => {
          setText("");
          if (rows.some((p) => p.itemId === item.id)) {
            toast(`${item.name} is already on your list`);
            return;
          }
          add.mutate(
            { itemId: item.id, item, recurrence: segment },
            {
              onSuccess: () => toast(segment === "staple" ? `Added ${item.name} as a staple` : `Added ${item.name} for this week`),
              onError,
            },
          );
        }}
      />
      {editing ? <EditPreference groupId={groupId} pref={editing} onClose={() => setEditing(null)} /> : null}
    </View>
  );
}

/** Quantity / note / recurrence editor for one preference. */
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
          <AppText variant="h1" accessibilityRole="header">
            {pref.item.name}
          </AppText>
          <TextField label="Quantity" value={quantity} onChangeText={setQuantity} placeholder="2 gal" />
          <TextField label="Note" value={note} onChangeText={setNote} placeholder="the blue box" />
          <Segmented options={RECURRENCE_OPTIONS} value={recurrence} onChange={setRecurrence} />
          <Button
            label="Save"
            size="lg"
            fullWidth
            loading={update.isPending}
            onPress={() =>
              update.mutate(
                { id: pref.id, quantityText: quantity.trim().slice(0, 100) || null, note: note.trim().slice(0, 500) || null, recurrence },
                { onSuccess: onClose, onError: (e) => toast(errorMessage(e), { tone: "error" }) },
              )
            }
          />
          <Button label="Cancel" variant="ghost" fullWidth onPress={onClose} />
        </Card>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: space.md },
  backdrop: { flex: 1, backgroundColor: color.overlay, justifyContent: "center", padding: space.screenX },
  sheet: { gap: space.md, padding: space.xl },
});
